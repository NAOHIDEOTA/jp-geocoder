#!/usr/bin/env node
/**
 * /v1/cities.json を生成する（DOC.md §4.2 / Step 2）。
 *
 * 入力: ABR の mt_pref / mt_pref_pos / mt_city / mt_city_pos / mt_town_all
 * 出力: dist-data/v1/cities.json
 *
 * メモリ常駐する唯一の索引なので小さく保つ（§3.1）。キーは正規化済みで焼き込む。
 */

import { mkdir, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

import { readZipCsv } from "../lib/csv.mjs";
import { toKey } from "../../dist/core/normalize.js";
import { toKanaKey } from "../../dist/core/kana.js";

const ABR = "data/abr";
const OUT_DIR = "dist-data/v1";

/** 政令市の行政区は 171 件（v0.1 の「175件」は誤り。実測値） */
const rows = [];
for await (const r of readZipCsv(`${ABR}/mt_city_all.csv.zip`)) rows.push(r);

/** lg_code -> {lat,lng} */
const pos = new Map();
for await (const r of readZipCsv(`${ABR}/mt_city_pos_all.csv.zip`)) {
  const lat = Number(r.rep_lat),
    lng = Number(r.rep_lon);
  if (Number.isFinite(lat) && Number.isFinite(lng))
    pos.set(r.lg_code, { lat, lng });
}

const prefPos = new Map();
for await (const r of readZipCsv(`${ABR}/mt_pref_pos_all.csv.zip`)) {
  const lat = Number(r.rep_lat),
    lng = Number(r.rep_lon);
  if (Number.isFinite(lat) && Number.isFinite(lng))
    prefPos.set(r.lg_code, { lat, lng });
}

/** §7 の tie-break に使う規模の指標。本来は人口だが ABR に無いので町字数で代用 */
const townCount = new Map();
for await (const r of readZipCsv(`${ABR}/mt_town_all.csv.zip`)) {
  townCount.set(r.lg_code, (townCount.get(r.lg_code) ?? 0) + 1);
}

/** 政令市本体（ward が空で、同名で ward 付きの行があるもの）の表 */
const cityBodyByName = new Map(); // `${pref}/${city}` -> lg_code
for (const r of rows) {
  if (!r.ward) cityBodyByName.set(`${r.pref}/${r.city}`, r.lg_code);
}
const hasWards = new Set(
  rows.filter((r) => r.ward).map((r) => `${r.pref}/${r.city}`),
);

const out = [];

// 都道府県 47件。座標のために入れる（名前の解決は src/core/pref.ts）。
// lg_code は検査数字つき6桁（北海道 = 010006）
for await (const r of readZipCsv(`${ABR}/mt_pref_all.csv.zip`)) {
  if (r.ablt_date) continue; // 廃止済みは載せない
  const code = r.lg_code.slice(0, 2);
  const p = prefPos.get(r.lg_code) ?? null;
  out.push({
    code,
    pref: code,
    name: r.pref,
    level: "pref",
    k: [toKey(r.pref)],
    kk: [toKanaKey(r.pref_kana)],
    ...(p ? { lat: p.lat, lng: p.lng } : {}),
  });
}

// --- 市区町村 ---
for (const r of rows) {
  const prefCode = r.lg_code.slice(0, 2);
  const isWard = Boolean(r.ward);
  const name = isWard ? r.ward : r.city;
  const kana = isWard ? r.ward_kana : r.city_kana;

  let level;
  if (isWard) level = "ward";
  else if (r.pref === "東京都" && r.city.endsWith("区")) level = "special_ward";
  else level = "city";

  /**
   * 別名キー（§5.2.2）:
   *   行政区    「浦和区」「さいたま市浦和区」（区名単体で引けることが要件）
   *   郡つき町村「当別町」「石狩郡当別町」（郡は省略されるのが普通）
   */
  const names = [name];
  if (isWard) names.push(`${r.city}${r.ward}`);
  else if (r.county) names.push(`${r.county}${r.city}`);

  const kanas = [kana];
  if (isWard) kanas.push(`${r.city_kana}${r.ward_kana}`);
  else if (r.county) kanas.push(`${r.county_kana}${r.city_kana}`);

  const p = pos.get(r.lg_code);
  const entry = {
    code: r.lg_code,
    pref: prefCode,
    name: isWard ? `${r.city}${r.ward}` : r.city,
    level,
    k: [...new Set(names.map(toKey))],
    kk: [...new Set(kanas.filter(Boolean).map(toKanaKey))],
    towns: townCount.get(r.lg_code) ?? 0,
  };
  if (r.county) entry.county = r.county;
  if (isWard) entry.parent = cityBodyByName.get(`${r.pref}/${r.city}`) ?? null;
  if (p) {
    entry.lat = p.lat;
    entry.lng = p.lng;
  }
  out.push(entry);
}

const payload = {
  generated: new Date().toISOString().slice(0, 10),
  source: "デジタル庁 アドレス・ベース・レジストリ",
  cities: out,
};

await mkdir(OUT_DIR, { recursive: true });
const json = JSON.stringify(payload);
await writeFile(`${OUT_DIR}/cities.json`, json);

const gz = gzipSync(Buffer.from(json), { level: 9 });
const byLevel = out.reduce(
  (a, c) => ((a[c.level] = (a[c.level] ?? 0) + 1), a),
  {},
);
const noPos = out.filter((c) => c.lat === undefined).length;

console.log(`cities.json: ${out.length} entries`);
console.log(`  内訳: ${JSON.stringify(byLevel)}`);
console.log(`  政令市の行政区: ${byLevel.ward ?? 0} 件`);
console.log(`  座標なし: ${noPos} 件`);
console.log(
  `  サイズ: ${(json.length / 1024).toFixed(1)} KB (gzip ${(gz.length / 1024).toFixed(1)} KB)`,
);
