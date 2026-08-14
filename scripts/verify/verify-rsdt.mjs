#!/usr/bin/env node
/**
 * 実データで住居表示（番・号）の解決を検証する（Step 4）。
 *
 * 期待値は「実在する住所の座標」なので、正解座標を持っていない。
 * したがって次の3つで検証する:
 *   1. matchLevel が期待どおりか（rsdt / block / oaza）
 *   2. 号の座標が町字代表点から**離れている**こと（＝本当に号を引けている）
 *   3. 同じ町字の別の号どうしが**別の座標**になること（丸まっていない）
 */

import { readFile } from "node:fs/promises";
import { createGeocoder } from "../../dist/index.js";

const ROOT = "dist-data/v1";
let fetchCount = 0;
const memo = new Map();
const fetcher = {
  async get(path) {
    if (memo.has(path)) return memo.get(path);
    fetchCount++;
    const p = readFile(`${ROOT}/${path}`, "utf-8").then(JSON.parse);
    memo.set(path, p);
    return p;
  },
};
const geo = createGeocoder({ baseUrl: "local", fetcher, limit: 5 });

const dist = (a, b) => {
  const R = 6371000, r = (d) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

/** [入力, 期待 matchLevel] */
const CASES = [
  ["東京都世田谷区太子堂5-5-5", "rsdt"],
  ["世田谷区太子堂5-5-5", "rsdt"],
  ["太子堂5-5-5", "rsdt"],
  // 以下は ABR に号レコードが無い町字。番までしか降りられないのが正しい挙動（§8.4）
  ["東京都千代田区霞が関1-1-1", "block"],
  ["東京都中央区銀座4-5-6", "rsdt"],
  ["中央区銀座4-5-6", "rsdt"],
  ["東京都新宿区西新宿2-8-1", "block"],
  ["大阪市中央区大手前2-1-22", "rsdt"],
  ["神奈川県横浜市西区みなとみらい2-3-1", "block"],
  ["福岡市博多区博多駅中央街1-1", "block"],
  ["名古屋市中区三の丸3-1-2", "block"],
  ["兵庫県神戸市中央区加納町6-5-1", "block"],
  ["沖縄県那覇市泉崎1-2-2", "rsdt"],
  ["札幌市北区北12条西3丁目1-1", "rsdt"],
  ["東京都世田谷区太子堂5-5", "block"], // 号を書かない → 番どまり
  ["東京都世田谷区太子堂5", "oaza"], // 丁目だけ → 町字どまり
  ["岩手県花巻市石鳥谷町好地第3地割", "oaza"], // 住居表示未実施（地番地域）
  ["東京都世田谷区太子堂5-5-5ハイツ太子堂201", "rsdt"], // 建物名つき
];

console.log("=== 住居表示（番・号）の解決 ===\n");
let ok = 0;
const misses = [];
for (const [input, expect] of CASES) {
  const before = fetchCount;
  const r = await geo.geocode(input);
  const c = r.candidates[0];
  const pass = c?.matchLevel === expect;
  if (pass) ok++;
  else misses.push({ input, expect, got: c?.matchLevel ?? null });
  console.log(
    `${pass ? "✔" : "✖"} ${input}\n` +
    `    ${c ? c.address : "(解決不可)"}\n` +
    `    [${c?.matchLevel}/${c?.system}/${c?.accuracy}] ` +
    `(${c ? `${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}` : "-"}) ` +
    `${c?.building ? `building="${c.building}" ` : ""}fetch+${fetchCount - before}`
  );
}
console.log(`\nmatchLevel の一致: ${ok}/${CASES.length}`);
for (const m of misses) console.log(`  ✖ ${m.input}  期待 ${m.expect} / 結果 ${m.got}`);

// --- 2. 号の座標が町字代表点から離れているか ---
console.log("\n=== 号の座標が町字代表点に丸まっていないか ===");
for (const [full, townOnly] of [
  ["東京都世田谷区太子堂5-5-5", "東京都世田谷区太子堂5"],
  ["東京都中央区銀座4-5-6", "東京都中央区銀座4"],
  ["大阪市中央区大手前2-1-22", "大阪市中央区大手前2"],
]) {
  const a = (await geo.geocode(full)).candidates[0];
  const b = (await geo.geocode(townOnly)).candidates[0];
  const d = dist(a, b);
  console.log(`  ${full}\n    号 (${a.lat}, ${a.lng}) vs 町字代表点 (${b.lat}, ${b.lng}) → ${d.toFixed(0)}m ${d > 5 ? "✔" : "✖ 丸まっている"}`);
}

// --- 3. 同じ街区の別の号が別座標になるか ---
console.log("\n=== 同じ街区の別の号が別座標になるか ===");
for (const base of ["東京都中央区銀座4-5", "東京都世田谷区太子堂5-5"]) {
  const pts = [];
  for (const n of [1, 2, 3, 4, 5]) {
    const c = (await geo.geocode(`${base}-${n}`)).candidates[0];
    if (c?.matchLevel === "rsdt") pts.push(`${c.lat},${c.lng}`);
  }
  const uniq = new Set(pts).size;
  console.log(`  ${base}-1〜5 → ${pts.length}件解決 / 座標のユニーク数 ${uniq} ${uniq > 1 ? "✔" : "✖ 全部同じ"}`);
}

// --- 速度 ---
const N = 500;
const t0 = process.hrtime.bigint();
for (let i = 0; i < N; i++) await geo.geocode(CASES[i % CASES.length][0]);
const t1 = process.hrtime.bigint();
console.log(`\n速度: ${(Number(t1 - t0) / 1e6 / N).toFixed(3)}ms/件（キャッシュ済み） / 総fetch ${fetchCount}`);
