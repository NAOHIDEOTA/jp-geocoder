#!/usr/bin/env node
/**
 * 住居表示（番・号）のインデックスを生成する（DOC.md §4.4 / Step 4）。
 *
 * 入力: mt_rsdtdsp_blk/_pos（街区）・mt_rsdtdsp_rsdt/_pos（住居）。都道府県単位
 * 出力: rsdt/{lg_code}.json ＋ shards.json に分割情報を追記
 *
 * 号は全国2,200万点。街区の座標を絶対値で持ち、号はそこからの差分（1e-6度の整数）
 * にする。同じ街区内に集まるので差分は3桁前後に収まり素の半分以下になる。
 *
 * さらに73%の街区は号が 1..N の連番なので、キーを持たず配列で並べる（118.6→100MB）。
 *   q: [[dLat,dLng], ...]     号 1..N
 *   r: { "12": [dLat,dLng] }  飛び番・枝番
 *
 * blk_pos は JGD2000、rsdt_pos は JGD2011 だが差は1m未満なので変換しない（§9.2）。
 */

import { mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";

import { readZipCsv } from "../lib/csv.mjs";

const ABR = "data/abr";
const OUT = "dist-data/v1";
/**
 * 1ファイルに入れる号の上限。超えたら machiaza_id 順に分割する。
 * 町字数で切るとサイズが揃わない（実測で1.3MB のファイルができた）。
 */
const MAX_RSDT_PER_FILE = 15000;

const round6 = (n) => Number(n.toFixed(6));
const delta = (v, base) => Math.round((v - base) * 1e6);

const prefs = [
  ...new Set(
    (await readdir(ABR))
      .map((f) => /^mt_rsdtdsp_rsdt_pref(\d+)\.csv\.zip$/.exec(f)?.[1])
      .filter(Boolean),
  ),
].sort();

/**
 * 出力先は毎回作り直す。
 * 分割数が変わると旧名のファイル（342025.json ⇔ 342025_0.json）が残り、
 * shards.json と食い違ったまま配信物に混ざる。実際に372件の残骸が出た。
 */
await rm(`${OUT}/rsdt`, { recursive: true, force: true });
await mkdir(`${OUT}/rsdt`, { recursive: true });

const rsdtShards = {}; // lg_code -> 分割パートの先頭 machiaza_id（単一なら []）
let totalBlk = 0,
  totalRsdt = 0,
  blkNoPos = 0,
  rsdtNoPos = 0;
let files = 0,
  bytesGz = 0,
  maxGz = 0,
  maxName = "";

for (const pp of prefs) {
  // --- 街区（番）の座標 ---
  const blkPos = new Map(); // `${lg}/${machiaza}/${blk_id}` -> [lat,lng]
  for await (const r of readZipCsv(
    `${ABR}/mt_rsdtdsp_blk_pos_pref${pp}.csv.zip`,
  )) {
    const lat = Number(r.rep_lat),
      lng = Number(r.rep_lon);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      blkPos.set(`${r.lg_code}/${r.machiaza_id}/${r.blk_id}`, [lat, lng]);
    }
  }

  /** lg -> machiaza_id -> blk_num -> { p:[lat,lng], r:{ 号: [dLat,dLng] } } */
  const byCity = new Map();
  const blkKeyOf = new Map(); // `${lg}/${machiaza}/${blk_num}` -> `${lg}/${machiaza}/${blk_id}`

  for await (const r of readZipCsv(`${ABR}/mt_rsdtdsp_blk_pref${pp}.csv.zip`)) {
    if (r.ablt_date) continue; // 廃止済みは載せない
    totalBlk++;
    const pos = blkPos.get(`${r.lg_code}/${r.machiaza_id}/${r.blk_id}`);
    if (!pos) {
      blkNoPos++;
      continue;
    }

    if (!byCity.has(r.lg_code)) byCity.set(r.lg_code, new Map());
    const city = byCity.get(r.lg_code);
    if (!city.has(r.machiaza_id)) city.set(r.machiaza_id, {});
    city.get(r.machiaza_id)[r.blk_num] = {
      p: [round6(pos[0]), round6(pos[1])],
    };
    blkKeyOf.set(
      `${r.lg_code}/${r.machiaza_id}/${r.blk_num}`,
      `${r.lg_code}/${r.machiaza_id}/${r.blk_id}`,
    );
  }

  // --- 住居（号）の座標 ---
  const rsdtPos = new Map(); // `${lg}/${machiaza}/${blk_id}/${rsdt_id}/${rsdt2_id}` -> [lat,lng]
  for await (const r of readZipCsv(
    `${ABR}/mt_rsdtdsp_rsdt_pos_pref${pp}.csv.zip`,
  )) {
    const lat = Number(r.rep_lat),
      lng = Number(r.rep_lon);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      rsdtPos.set(
        `${r.lg_code}/${r.machiaza_id}/${r.blk_id}/${r.rsdt_id}/${r.rsdt2_id}`,
        [lat, lng],
      );
    }
  }

  for await (const r of readZipCsv(
    `${ABR}/mt_rsdtdsp_rsdt_pref${pp}.csv.zip`,
  )) {
    if (r.ablt_date) continue;
    totalRsdt++;
    const pos = rsdtPos.get(
      `${r.lg_code}/${r.machiaza_id}/${r.blk_id}/${r.rsdt_id}/${r.rsdt2_id}`,
    );
    if (!pos) {
      rsdtNoPos++;
      continue;
    }

    const city = byCity.get(r.lg_code);
    const town = city?.get(r.machiaza_id);
    const blk = town?.[r.blk_num];
    // 街区に座標が無いと差分の基準が取れない。その号は落とす（番でも解決できる）
    if (!blk) continue;

    // 枝番（rsdt_num2）は「32-1」の形でキーにする。東京都で0.44%と稀
    const key = r.rsdt_num2 ? `${r.rsdt_num}-${r.rsdt_num2}` : r.rsdt_num;
    (blk.r ??= {})[key] = [delta(pos[0], blk.p[0]), delta(pos[1], blk.p[1])];
  }

  // 号が 1..N の連番なら配列にしてキーを落とす
  for (const towns of byCity.values()) {
    for (const town of towns.values()) {
      for (const blk of Object.values(town)) {
        const r = blk.r;
        if (!r) continue;
        const ks = Object.keys(r);
        const nums = ks.map(Number);
        if (ks.every((k) => /^\d+$/.test(k)) && nums.every((v, i) => v === i + 1)) {
          blk.q = ks.map((k) => r[k]);
          delete blk.r;
        }
      }
    }
  }

  // --- 出力 ---
  for (const [lg, towns] of byCity) {
    const ids = [...towns.keys()].sort();

    // 号の件数が上限を超えたら次のパートへ送る。1町字が単独で上限を超える場合は
    // それ以上分割しない（街区単位まで割ると番→号の参照が複雑になるため）
    const parts = [];
    let cur = [];
    let curCount = 0;
    for (const id of ids) {
      // 連番は q（配列）、飛び番は r（キー付き）に入る。両方数えないと分割が偏る
      let n = 0;
      for (const blk of Object.values(towns.get(id))) {
        n += (blk.q?.length ?? 0) + Object.keys(blk.r ?? {}).length;
      }
      if (cur.length && curCount + n > MAX_RSDT_PER_FILE) {
        parts.push(cur);
        cur = [];
        curCount = 0;
      }
      cur.push(id);
      curCount += n;
    }
    if (cur.length) parts.push(cur);

    rsdtShards[lg] = parts.length === 1 ? [] : parts.slice(1).map((p) => p[0]);

    for (let i = 0; i < parts.length; i++) {
      const t = {};
      for (const id of parts[i]) t[id] = towns.get(id);
      const name = parts.length === 1 ? `${lg}.json` : `${lg}_${i}.json`;
      const json = JSON.stringify({ code: lg, t });
      await writeFile(`${OUT}/rsdt/${name}`, json);
      const gz = gzipSync(Buffer.from(json), { level: 9 }).length;
      files++;
      bytesGz += gz;
      if (gz > maxGz) {
        maxGz = gz;
        maxName = name;
      }
    }
  }
  process.stdout.write(`  pref${pp} done (${byCity.size} cities)\n`);
}

// shards.json に追記（build-towns.mjs の後に実行すること）
const shardsPath = `${OUT}/shards.json`;
const shards = JSON.parse(await readFile(shardsPath, "utf-8"));
shards.rsdt = rsdtShards;
await writeFile(shardsPath, JSON.stringify(shards));

console.log(
  `\n街区(番): ${totalBlk.toLocaleString()} 件 / 座標なし ${blkNoPos.toLocaleString()} = ${((blkNoPos / totalBlk) * 100).toFixed(2)}%`,
);
console.log(
  `住居(号): ${totalRsdt.toLocaleString()} 件 / 座標なし ${rsdtNoPos.toLocaleString()} = ${((rsdtNoPos / totalRsdt) * 100).toFixed(3)}%`,
);
console.log(`\n出力:`);
console.log(
  `  rsdt/       ${files.toLocaleString()} ファイル / ${(bytesGz / 1048576).toFixed(1)} MB (gzip)`,
);
console.log(
  `              最大 ${(maxGz / 1024).toFixed(0)} KB (${maxName}) / 平均 ${(bytesGz / files / 1024).toFixed(0)} KB`,
);
console.log(
  `  shards.json ${(gzipSync(Buffer.from(JSON.stringify(shards))).length / 1024).toFixed(1)} KB (gzip)`,
);
