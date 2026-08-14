#!/usr/bin/env node
/**
 * 旧自治体名のエイリアスを生成する（DOC.md §12.3 / Step 7）。
 *
 * 入力: CODH 歴史的行政区域データセットβ版
 * 出力: dist-data/v1/alias.json（値は市区町村コード。住所文字列をキーにしない）
 *
 * CODH に「旧自治体 → 後継自治体」の対応は入っていない。e-Stat は機械取得できず、
 * 総務省の改正一覧表は最近の改正しか含まないため、手元のデータから2つの規則で当てる。
 *   現存名と基底が一致    8.2%  浦和市→浦和区
 *   町字名の先頭に残存   70.4%  音別町→釧路市音別町○○
 *   対応づけ不可         21.4%  上磯町→北斗市 のように痕跡が残らない合併
 */

import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";

import { toKey } from "../../dist/core/normalize.js";
import { toKanaKey } from "../../dist/core/kana.js";

const CODH = "data/codh/geoshape_city_id.csv";
const OUT = "dist-data/v1";

/** 「市」「町」「村」「区」を落とした基底名 */
const SUFFIX = "市町村区";
const base = (n) => (n && SUFFIX.includes(n[n.length - 1]) ? n.slice(0, -1) : n);

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(",");
  return lines.slice(1).map((l) => {
    const f = l.split(",");
    return Object.fromEntries(header.map((h, i) => [h, f[i] ?? ""]));
  });
}

const rows = parseCsv(await readFile(CODH, "utf-8"));
const currentIds = new Set(
  (await readFile("data/codh/code_gci.csv", "utf-8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => l.split(",")[0]),
);

const cities = JSON.parse(await readFile(`${OUT}/cities.json`, "utf-8")).cities;
const prefCode = new Map(
  cities.filter((c) => c.level === "pref").map((c) => [c.name, c.code]),
);

/** 都道府県 -> 基底名 -> 現在の市区町村 */
const curBase = new Map();
for (const c of cities) {
  if (c.level === "pref") continue;
  const m = curBase.get(c.pref) ?? new Map();
  const short = c.level === "ward" ? c.name.split("市").pop() : c.name;
  if (!m.has(base(short))) m.set(base(short), c);
  if (!m.has(base(c.name))) m.set(base(c.name), c);
  curBase.set(c.pref, m);
}

/** 都道府県 -> [町字名, lg_code][] */
const townsByPref = new Map();
for (const f of await readdir(`${OUT}/oaza`)) {
  const shard = JSON.parse(await readFile(`${OUT}/oaza/${f}`, "utf-8"));
  for (const entries of Object.values(shard)) {
    for (const e of entries) {
      const p = e[0].slice(0, 2);
      const list = townsByPref.get(p) ?? [];
      list.push([e[2], e[0]]);
      townsByPref.set(p, list);
    }
  }
}

const alias = {}; // 正規化キー -> [lg_code, ...]
const stat = { direct: 0, viaTown: 0, miss: 0, old: 0 };
const missed = [];
const seen = new Set();

for (const r of rows) {
  const code5 = (r["geoshape_city_id"] ?? "").slice(0, 5);
  const pref = prefCode.get(r["都道府県名"]);
  if (!pref || !/^\d{5}$/.test(code5)) continue;
  // 現存する自治体は対象外
  if (currentIds.has(code5)) continue;

  const name = `${r["市区町村名"]}${(r["接尾辞"] ?? "").split("/")[0]}`;
  const key = `${pref}\t${name}`;
  if (seen.has(key)) continue;
  seen.add(key);
  stat.old++;

  const b = base(name);
  let target = curBase.get(pref)?.get(b);

  if (!target) {
    // 町字名の先頭に旧自治体名が残っているか（合併時に大字として残る典型）
    const hits = (townsByPref.get(pref) ?? [])
      .filter(([t]) => t.startsWith(name) || t.startsWith(b))
      .map(([, c]) => c);
    if (hits.length) {
      const count = new Map();
      for (const c of hits) count.set(c, (count.get(c) ?? 0) + 1);
      const best = [...count.entries()].sort((x, y) => y[1] - x[1])[0][0];
      target = cities.find((c) => c.code === best);
      if (target) stat.viaTown++;
    }
  } else {
    stat.direct++;
  }

  if (!target) {
    stat.miss++;
    if (missed.length < 20) missed.push(`${r["都道府県名"]}${name}`);
    continue;
  }

  for (const k of [toKey(name), toKey(`${r["都道府県名"]}${name}`)]) {
    if (!k) continue;
    const list = (alias[k] ??= []);
    if (!list.includes(target.code)) list.push(target.code);
  }
}

await mkdir(OUT, { recursive: true });
const json = JSON.stringify(alias);
await writeFile(`${OUT}/alias.json`, json);

console.log(`1970年以降に存在し現在は廃止された市区町村: ${stat.old.toLocaleString()} 件`);
console.log(`  現存名と基底が一致   ${stat.direct.toLocaleString()} = ${((stat.direct / stat.old) * 100).toFixed(1)}%`);
console.log(`  町字名の先頭に残存   ${stat.viaTown.toLocaleString()} = ${((stat.viaTown / stat.old) * 100).toFixed(1)}%`);
console.log(`  対応づけ不可         ${stat.miss.toLocaleString()} = ${((stat.miss / stat.old) * 100).toFixed(1)}%`);
console.log(`\nalias.json: ${Object.keys(alias).length.toLocaleString()} キー / ${(json.length / 1024).toFixed(1)} KB (gzip ${(gzipSync(Buffer.from(json), { level: 9 }).length / 1024).toFixed(1)} KB)`);
console.log(`対応づけ不可の例: ${missed.slice(0, 10).join(", ")}`);
