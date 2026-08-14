#!/usr/bin/env node
/**
 * 地番のインデックスを生成する（DOC.md §12.1 / Step 5）。
 *
 * 入力: mt_parcel（2億1,184万筆）/ mt_parcel_pos（座標があるのは 9,974万筆 = 47%）
 * 出力: dist-data/v1/parcel/{lg_code}[_n].json ＋ shards.json に分割情報を追記
 *
 *   { code, t: { <machiaza_id>: { o:[lat,lng], a:[], b:[], c:[], y:[], x:[], s:[] } } }
 *     o     町字ごとの原点（筆の重心）
 *     a/b/c 地番の3要素（prc_num1/2/3）。a は連続差分
 *     y/x   原点からの差分（1e-5度＝約1.1m）。連続差分
 *     s     縮尺の分母（accuracy の判定用）
 *
 * 符号化は列指向 + 連続差分。実測（四日市市 38,534点）:
 *   キー付きオブジェクト 5.81 B/点 / 列指向 4.41 / 列指向+連続差分 2.83 ← 採用
 *
 * accuracy は縮尺だけで決める。ABR は地図種別を持たない（rep_src_code が全件 "1"）。
 * 1/500以下は surveyed、それ以外は legacy に倒す。同一町字内でも混在する（7%）ので筆ごと。
 */

import { mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { gzipSync } from "node:zlib";

import { readZipCsv } from "../lib/csv.mjs";

const ABR = "data/abr";
const OUT = "dist-data/v1";
/** 1ファイルに入れる筆の数。§4.1 の「1ファイル 100KB 前後」を狙う */
const MAX_PER_FILE = 40_000;
/** 座標の精度。1e-5 度 ≒ 1.1m */
const SCALE = 1e5;

/** 連続差分に変換する */
const diff = (arr) => arr.map((v, i) => (i ? v - arr[i - 1] : v));

const cityCodes = [
  ...new Set(
    (await readdir(ABR))
      .map((f) => /^mt_parcel_city(\d+)\.csv\.zip$/.exec(f)?.[1])
      .filter(Boolean),
  ),
].sort();

console.log(`地番マスターのある市区町村: ${cityCodes.length} 件`);

await rm(`${OUT}/parcel`, { recursive: true, force: true });
await mkdir(`${OUT}/parcel`, { recursive: true });

const parcelShards = {}; // lg_code -> 分割パートの先頭 machiaza_id（単一なら []）
let total = 0, withPos = 0, files = 0, gzBytes = 0, maxGz = 0, maxName = "";
let done = 0;

for (const code of cityCodes) {
  const pos = new Map(); // `${machiaza_id}/${prc_id}` -> [lat,lng]
  try {
    for await (const r of readZipCsv(`${ABR}/mt_parcel_pos_city${code}.csv.zip`)) {
      const lat = Number(r.rep_lat), lng = Number(r.rep_lon);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        // 同一筆に複数点があることがある。最初の1点を採る
        const k = `${r.machiaza_id}/${r.prc_id}`;
        if (!pos.has(k)) pos.set(k, [lat, lng, Number(r.rep_scale) || 0]);
      }
    }
  } catch {
    // 位置参照拡張が無い自治体（1,887 中 38 件）。地番はあるが座標が無い
  }

  /** machiaza_id -> 筆の配列 */
  const towns = new Map();
  for await (const r of readZipCsv(`${ABR}/mt_parcel_city${code}.csv.zip`)) {
    if (r.ablt_date) continue; // 廃止済みは載せない
    total++;
    const p = pos.get(`${r.machiaza_id}/${r.prc_id}`);
    if (!p) continue;
    withPos++;
    let list = towns.get(r.machiaza_id);
    if (!list) { list = []; towns.set(r.machiaza_id, list); }
    list.push({
      a: Number(r.prc_num1) || 0,
      b: Number(r.prc_num2) || 0,
      c: Number(r.prc_num3) || 0,
      lat: p[0],
      lng: p[1],
      s: p[2],
    });
  }

  if (towns.size) {
    // 筆の数でパートを切る。町字単位では偏りが大きすぎる
    const ids = [...towns.keys()].sort();
    const parts = [];
    let cur = [], curN = 0;
    for (const id of ids) {
      const n = towns.get(id).length;
      if (cur.length && curN + n > MAX_PER_FILE) { parts.push(cur); cur = []; curN = 0; }
      cur.push(id);
      curN += n;
    }
    if (cur.length) parts.push(cur);
    parcelShards[code] = parts.length === 1 ? [] : parts.slice(1).map((p) => p[0]);

    for (let i = 0; i < parts.length; i++) {
      const t = {};
      for (const id of parts[i]) {
        const list = towns.get(id);
        // 原点は町字内の筆の重心。差分を小さく保つため
        const o = [
          Number((list.reduce((s, x) => s + x.lat, 0) / list.length).toFixed(6)),
          Number((list.reduce((s, x) => s + x.lng, 0) / list.length).toFixed(6)),
        ];
        list.sort((x, y) => x.a - y.a || x.b - y.b || x.c - y.c);
        t[id] = {
          o,
          a: diff(list.map((x) => x.a)),
          b: list.map((x) => x.b),
          c: list.map((x) => x.c),
          y: diff(list.map((x) => Math.round((x.lat - o[0]) * SCALE))),
          x: diff(list.map((x) => Math.round((x.lng - o[1]) * SCALE))),
          s: list.map((x) => x.s),
        };
      }
      const name = parts.length === 1 ? `${code}.json` : `${code}_${i}.json`;
      const json = JSON.stringify({ code, t });
      await writeFile(`${OUT}/parcel/${name}`, json);
      const gz = gzipSync(Buffer.from(json), { level: 9 }).length;
      files++;
      gzBytes += gz;
      if (gz > maxGz) { maxGz = gz; maxName = name; }
    }
  }

  if (++done % 200 === 0) {
    process.stdout.write(`  ${done}/${cityCodes.length} 市区町村 / ${withPos.toLocaleString()} 筆 / ${(gzBytes / 1048576).toFixed(0)}MB\n`);
  }
}

const shardsPath = `${OUT}/shards.json`;
const shards = JSON.parse(await readFile(shardsPath, "utf-8"));
shards.parcel = parcelShards;
await writeFile(shardsPath, JSON.stringify(shards));

console.log(`\n地番: ${total.toLocaleString()} 筆 / 座標あり ${withPos.toLocaleString()} = ${((withPos / total) * 100).toFixed(1)}%`);
console.log(`\n出力:`);
console.log(`  parcel/     ${files.toLocaleString()} ファイル / ${(gzBytes / 1048576).toFixed(1)} MB (gzip)`);
console.log(`              最大 ${(maxGz / 1024).toFixed(0)} KB (${maxName}) / 平均 ${(gzBytes / files / 1024).toFixed(0)} KB`);
console.log(`              ${(gzBytes / withPos).toFixed(2)} バイト/点`);
console.log(`  shards.json ${(gzipSync(Buffer.from(JSON.stringify(shards))).length / 1024).toFixed(1)} KB (gzip)`);
