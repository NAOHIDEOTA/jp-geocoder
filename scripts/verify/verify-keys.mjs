#!/usr/bin/env node
/**
 * 正規化キー仕様を実データで検証する（DOC.md §14.1-2 の凍結前チェック）。
 *
 * 検証したいこと:
 *   1. 潰しすぎていないか — 同一市区町村内で別の町字が同じキーに落ちていないか
 *      （市区町村をまたぐ同名は正常。§6.1 の積集合で解決するため）
 *   2. カナキーの衝突率 — 第2軸として使えるだけの識別力があるか
 *   3. 落とし穴の実例 — 「関ケ原 → 関原」のような削除規則の副作用
 *
 * 使い方:
 *   node scripts/verify-keys.mjs
 * 事前に `make data-download`（mt_town_all.csv.zip の取得）が必要。
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";

import { toKey } from "../../dist/core/normalize.js";
import { toKanaKey } from "../../dist/core/kana.js";

const ZIP = "data/abr/mt_town_all.csv.zip";

if (!existsSync(ZIP)) {
  console.error(
    `${ZIP} がありません。先に \`make data-download\` を実行してください。`,
  );
  process.exit(1);
}

/** RFC4180 の最小実装（ABR の CSV は引用符つきフィールドを含む） */
function parseLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

const unzip = spawn("unzip", ["-p", ZIP]);
const rl = createInterface({ input: unzip.stdout, crlfDelay: Infinity });

let header = null;
let idx = {};
let rows = 0;

/** key: `${lg_code}\t${normalizedKey}` -> { names:Set<表記>, ids:Set<`${lg}/${machiaza_id}`> } */
const kanjiBuckets = new Map();
const kanaBuckets = new Map();
/** `${lg}/${machiaza_id}` -> {lat,lng}。mt_town_pos から読む */
const pos = new Map();

function bump(map, key, name, id) {
  let e = map.get(key);
  if (!e) {
    e = { names: new Set(), ids: new Set() };
    map.set(key, e);
  }
  e.names.add(name);
  e.ids.add(id);
}

for await (const line of rl) {
  if (!line) continue;
  const f = parseLine(line);
  if (!header) {
    header = f;
    idx = Object.fromEntries(header.map((h, i) => [h, i]));
    continue;
  }
  rows++;

  const lg = f[idx.lg_code] ?? "";
  const oaza = f[idx.oaza_cho] ?? "";
  const chome = f[idx.chome] ?? "";
  const koaza = f[idx.koaza] ?? "";
  const name = `${oaza}${chome}${koaza}`;
  if (!name) continue;

  const kana = `${f[idx.oaza_cho_kana] ?? ""}${f[idx.chome_kana] ?? ""}${f[idx.koaza_kana] ?? ""}`;

  const id = `${lg}/${f[idx.machiaza_id] ?? ""}`;
  bump(kanjiBuckets, `${lg}\t${toKey(name)}`, name, id);
  if (kana) bump(kanaBuckets, `${lg}\t${toKanaKey(kana)}`, name, id);
}

/**
 * 衝突が「良性」か「悪性」かを座標で判定する。
 *   良性 … ABR 側の表記ゆれ重複。同じ場所なので潰れて正しい（距離 ≒ 0）
 *   悪性 … 別の場所が同じキーに落ちた。規則が潰しすぎている
 */
function haversine(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** 衝突グループ内の最大距離。座標が1つ以下なら null（判定不能） */
function spread(ids, pos) {
  const pts = ids.map((id) => pos.get(id)).filter(Boolean);
  if (pts.length < 2) return null;
  let max = 0;
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++)
      max = Math.max(max, haversine(pts[i], pts[j]));
  return max;
}

function report(label, buckets, pos) {
  let colliding = 0;
  let lostEntries = 0;
  const examples = [];
  const dist = { benign: 0, suspect: 0, harmful: 0, unknown: 0 };

  for (const [k, entry] of buckets) {
    const set = entry.names;
    if (set.size <= 1) continue;
    colliding++;
    lostEntries += set.size - 1;

    const d = spread([...entry.ids], pos);
    if (d === null) dist.unknown++;
    else if (d < 200) dist.benign++;
    else if (d < 2000) dist.suspect++;
    else dist.harmful++;

    if ((d ?? 0) >= 2000 && examples.length < 15) {
      examples.push({
        key: k.split("\t")[1],
        lg: k.split("\t")[0],
        names: [...set],
        d: Math.round(d),
      });
    }
  }
  const rate = ((lostEntries / rows) * 100).toFixed(4);
  console.log(`\n[${label}]`);
  console.log(`  ユニークキー   ${buckets.size.toLocaleString()}`);
  console.log(`  衝突キー       ${colliding.toLocaleString()}`);
  console.log(
    `  失われる件数   ${lostEntries.toLocaleString()} / ${rows.toLocaleString()} = ${rate}%`,
  );
  const judged = dist.benign + dist.suspect + dist.harmful;
  console.log(`  内訳（衝突グループ内の最大距離）:`);
  console.log(
    `    200m未満（同一地点＝ABR側の表記ゆれ重複。潰れて正しい） ${dist.benign}`,
  );
  console.log(
    `    200m〜2km（要確認）                                    ${dist.suspect}`,
  );
  console.log(
    `    2km以上（別地点＝潰しすぎ）                            ${dist.harmful}`,
  );
  console.log(
    `    座標なしで判定不能                                      ${dist.unknown}`,
  );
  if (judged) {
    const bad = ((dist.harmful / judged) * 100).toFixed(1);
    console.log(`    → 判定できた ${judged} 件のうち悪性は ${bad}%`);
  }
  if (examples.length) {
    console.log("  悪性の例（2km以上離れているのに同じキー）:");
    for (const e of examples)
      console.log(`    ${e.lg} ${e.key}  <- ${e.names.join(" / ")}  (${e.d}m)`);
  }
  return {
    unique: buckets.size,
    colliding,
    lostEntries,
    rate: Number(rate),
    dist,
  };
}

// mt_town_pos（都道府県単位）を読み込む
const { readdirSync } = await import("node:fs");
for (const f of readdirSync("data/abr").filter((x) =>
  /^mt_town_pos_pref\d+\.csv\.zip$/.test(x),
)) {
  await new Promise((resolve, reject) => {
    const p = spawn("unzip", ["-p", `data/abr/${f}`]);
    const r = createInterface({ input: p.stdout, crlfDelay: Infinity });
    let h = null,
      ix = {};
    r.on("line", (line) => {
      if (!line) return;
      const c = parseLine(line);
      if (!h) {
        h = c;
        ix = Object.fromEntries(h.map((x, i) => [x, i]));
        return;
      }
      const lat = Number(c[ix.rep_lat]),
        lng = Number(c[ix.rep_lon]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        pos.set(`${c[ix.lg_code]}/${c[ix.machiaza_id]}`, { lat, lng });
      }
    });
    r.on("close", resolve);
    p.on("error", reject);
  });
}
console.log(
  `町字 ${rows.toLocaleString()} 件を検証（座標 ${pos.size.toLocaleString()} 件を突合）`,
);
const kanji = report("漢字キー", kanjiBuckets, pos);
const kana = report("カナキー", kanaBuckets, pos);

console.log("\n判定:");
console.log(
  `  漢字キーの衝突率 ${kanji.rate}% ${kanji.rate < 0.1 ? "→ 実用上問題なし" : "→ 規則の見直しが必要"}`,
);
console.log(
  `  カナキーの衝突率 ${kana.rate}% （第2軸なので漢字キーより高くてよい）`,
);
