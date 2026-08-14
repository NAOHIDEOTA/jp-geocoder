#!/usr/bin/env node
/**
 * 町字の転置インデックスを生成する（DOC.md §4.1 / §4.3 / Step 3）。
 *
 * 入力: ABR mt_town_all（72.7万件）/ mt_town_pos / ISJ 19.0b（座標の補完。§12.4）
 * 出力:
 *   oaza/{n}.json  漢字キー → 町字エントリ [lg_code, machiaza_id, 表示名, lat, lng, flags]
 *                  flags bit0=住居表示実施、bit1=座標が親からの継承（§8.4）
 *   kana/{n}.json  カナキー → 漢字キーへの参照（第2軸。§5.5）
 *   shards.json    シャード境界表（クライアントが二分探索する）
 *
 * 転置の値に座標・フラグ・表示名まで載せる。コードだけだと市区町村省略時に
 * 各市の詳細を引くことになり fetch が28回に達した（§1.2 の目標は2〜3回）。
 *
 * カナ索引は参照だけを持つ（実体複製で 11.3MB → 6.3MB）。98%のカナキーは
 * 漢字キー1個しか指さず、カナ入力は漢字で当たらなかったときだけなので影響は小さい。
 */

import { mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { gzipSync } from "node:zlib";
import path from "node:path";

import { readZipCsv, parseLine } from "../lib/csv.mjs";
import { toKey } from "../../dist/core/normalize.js";
import { toKanaKey } from "../../dist/core/kana.js";
import { normalizeChomeDisplay } from "../../dist/core/numbers.js";
import { expandAliases } from "../../dist/core/aliases.js";

const ABR = "data/abr";
const ISJ = "data/isj";
const OUT = "dist-data/v1";
/** 1シャードに詰めるキー数。§4.1 の「約100KB / ファイル」を狙う */
const SHARD_SIZE = 2000;

// ---------------------------------------------------------------- 座標

const abrPos = new Map();
for (const f of (await readdir(ABR)).filter((x) =>
  /^mt_town_pos_pref\d+\.csv\.zip$/.test(x),
)) {
  for await (const r of readZipCsv(path.join(ABR, f))) {
    const lat = Number(r.rep_lat), lng = Number(r.rep_lon);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      abrPos.set(`${r.lg_code}/${r.machiaza_id}`, [lat, lng]);
    }
  }
}
console.log(`ABR 町字座標: ${abrPos.size.toLocaleString()} 件`);

/** ISJ は CP932。市区町村コードは検査数字なし5桁（ABR の lg_code 先頭5桁と一致） */
const isjPos = new Map();
{
  const files = (await readdir(ISJ)).filter((x) => x.endsWith(".zip"));
  const decoder = new TextDecoder("shift_jis");
  for (const f of files) {
    const buf = await new Promise((resolve, reject) => {
      const p = spawn("unzip", ["-p", path.join(ISJ, f)]);
      const chunks = [];
      p.stdout.on("data", (c) => chunks.push(c));
      p.on("close", () => resolve(Buffer.concat(chunks)));
      p.on("error", reject);
    });
    let header = null;
    for (const line of decoder.decode(buf).split(/\r?\n/)) {
      if (!line) continue;
      const c = parseLine(line).map((x) => x.replace(/^"|"$/g, ""));
      if (!header) { header = c; continue; }
      const [, , city5, , , name, lat, lng] = c;
      const la = Number(lat), ln = Number(lng);
      if (Number.isFinite(la) && Number.isFinite(ln)) {
        isjPos.set(`${city5}/${toKey(name)}`, [la, ln]);
      }
    }
  }
  console.log(`ISJ 町字座標: ${isjPos.size.toLocaleString()} 件（${files.length} 都道府県）`);
}

// ---------------------------------------------------------------- 町字

const rows = [];
for await (const r of readZipCsv(`${ABR}/mt_town_all.csv.zip`)) {
  const oaza = r.oaza_cho ?? "", chome = r.chome ?? "", koaza = r.koaza ?? "";
  if (!`${oaza}${chome}${koaza}`) continue;
  rows.push({
    lg: r.lg_code,
    id: r.machiaza_id,
    oaza, chome, koaza,
    oazaKana: r.oaza_cho_kana ?? "",
    chomeKana: r.chome_kana ?? "",
    koazaKana: r.koaza_kana ?? "",
    rsdt: r.rsdt_addr_flg === "1" ? 1 : 0,
  });
}
console.log(`町字: ${rows.length.toLocaleString()} 件`);

/** 親（大字・丁目）の座標。小字に座標が無いときの継承元 */
const parentPos = new Map();
for (const r of rows) {
  const p =
    abrPos.get(`${r.lg}/${r.id}`) ??
    isjPos.get(`${r.lg.slice(0, 5)}/${toKey(`${r.oaza}${r.chome}${r.koaza}`)}`);
  if (!p) continue;
  const pk = `${r.lg}/${toKey(`${r.oaza}${r.chome}`)}`;
  if (!parentPos.has(pk)) parentPos.set(pk, p);
}
for (const [k, v] of isjPos) parentPos.set(`isj:${k}`, v);

// ---------------------------------------------------------------- 索引の組み立て

const byKanji = new Map();
const byKana = new Map();

const stat = { abr: 0, isj: 0, parent: 0, none: 0 };
const statOaza = { total: 0, pos: 0 };
const statKoaza = { total: 0, pos: 0 };
let kanaRegistered = 0, kanaSkipped = 0;

const push = (map, key, entry) => {
  if (!key) return;
  let list = map.get(key);
  if (!list) { list = []; map.set(key, list); }
  list.push(entry);
};

/** 名称中の全角数字を半角へ（漢数字はそのまま。三軒茶屋の「三」を壊さない） */
const halfDigits = (s) => s.replace(/[０-９]/gu, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

/** 「５丁目」「五丁目」→ 5。丁目でない値（空・変則）は 0 */
function chomeNumber(chome) {
  const m = /^([0-9０-９〇零一壱二弐三参四五六七八九十百千]+)丁目$/u.exec(chome);
  if (!m) return 0;
  const n = Number(toKey(m[1]));
  return Number.isFinite(n) ? n : 0;
}

for (const r of rows) {
  const city5 = r.lg.slice(0, 5);
  const rawName = `${r.oaza}${r.chome}${r.koaza}`;
  const isKoaza = Boolean(r.koaza);
  // 分割して持つ（components で分けて返すため）。§12.5 の漢数字統一は表示側で行う
  const oazaName = halfDigits(r.oaza);
  const chomeNum = chomeNumber(r.chome);
  // 「丁目」の形でない chome（ごく少数の変則値）は大字側に寄せて情報を失わない
  const oddChome = chomeNum ? "" : normalizeChomeDisplay(r.chome);
  const koazaName = halfDigits(`${oddChome}${r.koaza}`);

  let pos = abrPos.get(`${r.lg}/${r.id}`);
  let inherited = false;
  if (pos) stat.abr++;
  else {
    pos = isjPos.get(`${city5}/${toKey(rawName)}`);
    if (pos) stat.isj++;
    else {
      pos =
        parentPos.get(`${r.lg}/${toKey(`${r.oaza}${r.chome}`)}`) ??
        parentPos.get(`isj:${city5}/${toKey(`${r.oaza}${r.chome}`)}`) ??
        parentPos.get(`isj:${city5}/${toKey(r.oaza)}`);
      if (pos) { stat.parent++; inherited = true; }
      else stat.none++;
    }
  }

  const bucket = isKoaza ? statKoaza : statOaza;
  bucket.total++;
  if (pos && !inherited) bucket.pos++;

  const flags = (r.rsdt ? 1 : 0) | (inherited ? 2 : 0);
  const entry = pos
    ? [r.lg, r.id, oazaName, chomeNum, koazaName, Number(pos[0].toFixed(6)), Number(pos[1].toFixed(6)), flags]
    : [r.lg, r.id, oazaName, chomeNum, koazaName, null, null, flags];

  // 漢字キー（別名を含む。§5.2.2）
  const aliases = expandAliases({ oaza: r.oaza, chome: r.chome, koaza: r.koaza });
  for (const a of new Set(aliases.map((x) => toKey(x.name)))) push(byKanji, a, entry);

  /**
   * カナキー（第2軸。§5.5）。漢字側と同じ別名展開を行う。完全形だけだと
   * 「たいしどう5-5-5」が「たいしどうごちようめ」に前方一致せずカナ軸が死ぬ。
   * 小字のカナが空の行は登録しない（同一大字の小字が全部同じキーに落ちるため）。
   */
  const kana = `${r.oazaKana}${r.chomeKana}${r.koazaKana}`;
  if (kana && (!isKoaza || r.koazaKana)) {
    const keys = new Set([toKanaKey(kana)]);
    // 丁目省略の別名: 「たいしどう5」（漢字側の「太子堂5」に対応）
    const m = /^([0-9０-９〇零一壱二弐三参四五六七八九十百千]+)丁目$/u.exec(r.chome);
    if (m && !r.koaza && r.oazaKana) {
      const n = toKey(m[1]); // 漢数字・全角をアラビア数字に寄せる
      keys.add(`${toKanaKey(r.oazaKana)}${n}`);
    }
    // 値は漢字キーへの参照。実体は漢字索引にしか置かない
    const ref = toKey(aliases[0].name);
    for (const k of keys) {
      const list = byKana.get(k) ?? [];
      if (!list.includes(ref)) list.push(ref);
      byKana.set(k, list);
    }
    kanaRegistered++;
  } else {
    kanaSkipped++;
  }
}

const t = rows.length;
const pct = (n) => `${((n / t) * 100).toFixed(1)}%`;
console.log(`\n座標の内訳:`);
console.log(`  ABR       ${stat.abr.toLocaleString()} = ${pct(stat.abr)}`);
console.log(`  ISJ補完   ${stat.isj.toLocaleString()} = ${pct(stat.isj)}`);
console.log(`  親から継承 ${stat.parent.toLocaleString()} = ${pct(stat.parent)}`);
console.log(`  座標なし   ${stat.none.toLocaleString()} = ${pct(stat.none)}`);
console.log(`階層別（継承を除く）: 大字・丁目 ${((statOaza.pos / statOaza.total) * 100).toFixed(1)}% / 小字 ${((statKoaza.pos / statKoaza.total) * 100).toFixed(1)}%`);
console.log(`\n漢字キー ${byKanji.size.toLocaleString()} 件 / カナキー ${byKana.size.toLocaleString()} 件`);
console.log(`  カナ登録 ${kanaRegistered.toLocaleString()} 件 / 見送り ${kanaSkipped.toLocaleString()} 件（小字のカナ欠落）`);

// ---------------------------------------------------------------- 出力

await rm(`${OUT}/oaza`, { recursive: true, force: true });
await rm(`${OUT}/kana`, { recursive: true, force: true });
await rm(`${OUT}/detail`, { recursive: true, force: true }); // 転置に吸収したので廃止
await mkdir(`${OUT}/oaza`, { recursive: true });
await mkdir(`${OUT}/kana`, { recursive: true });

async function writeShards(map, dir) {
  const keys = [...map.keys()].sort();
  const bounds = [];
  let gz = 0, max = 0;
  for (let i = 0, n = 0; i < keys.length; i += SHARD_SIZE, n++) {
    const slice = keys.slice(i, i + SHARD_SIZE);
    bounds.push(slice[0]);
    const obj = {};
    for (const k of slice) obj[k] = map.get(k);
    const json = JSON.stringify(obj);
    await writeFile(`${OUT}/${dir}/${n}.json`, json);
    const g = gzipSync(Buffer.from(json), { level: 9 }).length;
    gz += g;
    max = Math.max(max, g);
  }
  console.log(
    `  ${dir}/  ${bounds.length} ファイル / ${(gz / 1048576).toFixed(1)} MB (gzip) / ` +
    `最大 ${(max / 1024).toFixed(0)} KB / 平均 ${(gz / bounds.length / 1024).toFixed(0)} KB`,
  );
  return bounds;
}

console.log(`\n出力:`);
const oazaBounds = await writeShards(byKanji, "oaza");
const kanaBounds = await writeShards(byKana, "kana");

// 既存の shards.json があれば rsdt / parcel の分割情報を引き継ぐ。
// 丸ごと書き直すと、towns だけ再ビルドしたとき番・号と地番の解決が黙って死ぬ
let prev = {};
try {
  prev = JSON.parse(await readFile(`${OUT}/shards.json`, "utf-8"));
} catch {
  /* 初回ビルド */
}
const shards = {
  oaza: { size: SHARD_SIZE, bounds: oazaBounds },
  kana: { size: SHARD_SIZE, bounds: kanaBounds },
  ...(prev.rsdt ? { rsdt: prev.rsdt } : {}),
  ...(prev.parcel ? { parcel: prev.parcel } : {}),
};
await writeFile(`${OUT}/shards.json`, JSON.stringify(shards));
console.log(`  shards.json ${(gzipSync(Buffer.from(JSON.stringify(shards))).length / 1024).toFixed(1)} KB (gzip)`);
console.log(`\n※ detail/ は廃止（転置に吸収）。続けて build-rsdt.mjs を実行すること`);
