#!/usr/bin/env node
/**
 * 住居表示データの「町字単位」のカバレッジを測る。
 *
 * §13-1 で測った「号レベル座標の充足率 99.997%」は
 * **号レコードのうち座標を持つ割合**であって、
 * 「住居表示実施の町字のうち号データがある割合」ではない。
 *
 * 実測で、住居表示実施フラグが立っているのに号レコードが1件も無い町字が
 * 見つかった（例: 東京都新宿区西新宿二丁目＝都庁の住所）。
 * 利用者から見た「号まで解決できる確率」はこちらの指標で決まる。
 */

import { readFile, readdir } from "node:fs/promises";

const ROOT = "dist-data/v1";
const shards = JSON.parse(await readFile(`${ROOT}/shards.json`, "utf-8"));

/** lg_code -> Set<machiaza_id>（番あり）/ Set<machiaza_id>（号あり） */
const withBlk = new Map();
const withRsdt = new Map();

for (const f of (await readdir(`${ROOT}/rsdt`)).filter((x) => x.endsWith(".json"))) {
  const file = JSON.parse(await readFile(`${ROOT}/rsdt/${f}`, "utf-8"));
  const lg = file.code;
  if (!withBlk.has(lg)) { withBlk.set(lg, new Set()); withRsdt.set(lg, new Set()); }
  for (const [id, blocks] of Object.entries(file.t)) {
    withBlk.get(lg).add(id);
    for (const b of Object.values(blocks)) {
      if (b.r && Object.keys(b.r).length) { withRsdt.get(lg).add(id); break; }
    }
  }
}

let rsdtTowns = 0, hasBlk = 0, hasRsdt = 0;
const examples = [];

for (const f of (await readdir(`${ROOT}/detail`)).filter((x) => x.endsWith(".json"))) {
  const file = JSON.parse(await readFile(`${ROOT}/detail/${f}`, "utf-8"));
  const lg = file.code;
  for (const t of file.towns) {
    if (t.r !== 1) continue; // 住居表示実施のみが対象
    rsdtTowns++;
    const b = withBlk.get(lg)?.has(t.id) ?? false;
    const r = withRsdt.get(lg)?.has(t.id) ?? false;
    if (b) hasBlk++;
    if (r) hasRsdt++;
    if (b && !r && examples.length < 15) examples.push(`${lg} ${t.n}`);
  }
}

const pct = (n) => `${((n / rsdtTowns) * 100).toFixed(1)}%`;
console.log(`住居表示実施の町字: ${rsdtTowns.toLocaleString()} 件`);
console.log(`  番（街区）データあり: ${hasBlk.toLocaleString()} = ${pct(hasBlk)}`);
console.log(`  号データあり:         ${hasRsdt.toLocaleString()} = ${pct(hasRsdt)}`);
console.log(`  番はあるが号が無い:   ${(hasBlk - hasRsdt).toLocaleString()} = ${pct(hasBlk - hasRsdt)}`);
console.log(`  どちらも無い:         ${(rsdtTowns - hasBlk).toLocaleString()} = ${pct(rsdtTowns - hasBlk)}`);
console.log(`\n「番はあるが号が無い」町字の例:`);
for (const e of examples) console.log(`  ${e}`);
