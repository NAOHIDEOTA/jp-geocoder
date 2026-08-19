#!/usr/bin/env node
/**
 * /v1/rail.json を生成する。
 *
 * 入力: data/ekidata/ に手で置いた 駅データ.jp の CSV（会員登録が要るので自動取得できない）
 *   station*.csv … 駅（座標つき）
 *   line*.csv    … 路線
 *   company*.csv … 事業者
 * 出力: dist-data/v1/rail.json
 *
 * 駅は全国で1万件ほどしかなく、最寄り駅検索には結局全件の座標が要る。
 * 都道府県で割っても県境をまたぐ検索で複数ファイルが必要になるだけなので、
 * 1ファイルにまとめて1回の fetch で完結させる（町字の索引とは事情が違う）。
 *
 * 配信サイズを抑えるため列指向ではなく「行の配列＋列順を固定」で持つ。
 * 列名を1万回繰り返さないだけで生JSONが1/3になる。
 */

import { mkdir, readdir, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

import { readCsv } from "../lib/csv.mjs";

const SRC = "data/ekidata";
const OUT_DIR = "dist-data/v1";

/** data/ekidata/ から prefix に一致する CSV を1つ選ぶ（日付つきファイル名のため） */
async function pick(prefix) {
  const files = (await readdir(SRC)).filter(
    (f) => f.startsWith(prefix) && f.endsWith(".csv"),
  );
  if (!files.length) {
    throw new Error(
      `${SRC}/${prefix}*.csv が見つかりません。` +
        `駅データ.jp (https://ekidata.jp/dl/) から取得して ${SRC}/ に置いてください。`,
    );
  }
  // 日付が新しいものを採る
  return `${SRC}/${files.sort().at(-1)}`;
}

/** e_status: 0=運用中 / 1=廃止 / 2=移転。運用中だけを配信する */
const ACTIVE = "0";

// --- 事業者 ---
const companies = new Map();
for await (const r of readCsv(await pick("company"))) {
  if (r.e_status !== ACTIVE) continue;
  companies.set(r.company_cd, r.company_name);
}

// --- 路線 ---
const lines = [];
const lineIndex = new Map();
for await (const r of readCsv(await pick("line"))) {
  if (r.e_status !== ACTIVE) continue;
  const entry = {
    code: Number(r.line_cd),
    name: r.line_name,
    company: companies.get(r.company_cd) ?? "",
  };
  lines.push(entry);
  lineIndex.set(entry.code, entry);
}

// --- 駅 ---
/**
 * 列順（rail.json の stations はこの順の配列）:
 *   0 code       駅コード
 *   1 groupCode  同一駅グループ（乗換で同じ番号になる）
 *   2 name       駅名
 *   3 lineCode   路線コード
 *   4 pref       都道府県コード 1-47
 *   5 postalCode 郵便番号（ハイフンなし7桁）
 *   6 address    住所
 *   7 lat        緯度
 *   8 lng        経度
 */
const stations = [];
let dropped = 0;
let noLine = 0;
for await (const r of readCsv(await pick("station"))) {
  if (r.e_status !== ACTIVE) {
    dropped++;
    continue;
  }
  const lat = Number(r.lat);
  const lng = Number(r.lon);
  // 座標が無い／日本の範囲外の駅は配信しない（最寄り検索を壊すため）
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
  if (lat < 20 || lat > 46 || lng < 122 || lng > 154) continue;
  if (!lineIndex.has(Number(r.line_cd))) noLine++;

  stations.push([
    Number(r.station_cd),
    Number(r.station_g_cd),
    r.station_name,
    Number(r.line_cd),
    Number(r.pref_cd),
    r.post.replace(/-/g, ""),
    r.address,
    Number(lat.toFixed(6)),
    Number(lng.toFixed(6)),
  ]);
}

stations.sort((a, b) => a[0] - b[0]);
lines.sort((a, b) => a.code - b.code);

const payload = {
  generated: new Date().toISOString().slice(0, 10),
  source: "駅データ.jp",
  /** stations の列順。利用側が位置を決め打ちしないで済むように配信物に持たせる */
  columns: [
    "code",
    "groupCode",
    "name",
    "lineCode",
    "pref",
    "postalCode",
    "address",
    "lat",
    "lng",
  ],
  lines,
  stations,
};

await mkdir(OUT_DIR, { recursive: true });
const json = JSON.stringify(payload);
await writeFile(`${OUT_DIR}/rail.json`, json);
const gz = gzipSync(Buffer.from(json), { level: 9 });

const prefs = new Set(stations.map((s) => s[4]));
/**
 * 駅が1件も無い路線。無料版では新幹線11路線がこれに該当する（駅が有料版のみ）。
 * listLines() は駅から路線を引くのでこれらは出てこない。増えていたら入力を疑う。
 */
const stationCount = new Map();
for (const s of stations) stationCount.set(s[3], (stationCount.get(s[3]) ?? 0) + 1);
const empty = lines.filter((l) => !stationCount.has(l.code));

console.log(`rail.json: ${stations.length} stations / ${lines.length} lines`);
console.log(`  除外(廃止・移転): ${dropped} 件`);
console.log(`  路線が引けない駅: ${noLine} 件`);
console.log(`  都道府県: ${prefs.size} / 47`);
console.log(`  駅が0件の路線: ${empty.length} 件`);
if (empty.length) {
  console.log(`    ${empty.map((l) => l.name).join(" / ")}`);
}
console.log(
  `  サイズ: ${(json.length / 1024).toFixed(1)} KB (gzip ${(gz.length / 1024).toFixed(1)} KB)`,
);
