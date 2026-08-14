#!/usr/bin/env node
/**
 * 実データの cities.json で geocode() を動かし、精度と速度を実測する。
 *
 * DOC.md §6.2 は「市区町村 約1,900件の総当たり編集距離 → 1ms未満」と見積もっている。
 * これが満たせるなら wasm 化は不要（§14.2）。ここで実測して判断材料にする。
 *
 * 事前に `node scripts/build-cities.mjs` が必要。
 */

import { readFile } from "node:fs/promises";
import { createGeocoder } from "../../dist/index.js";

const FILE = "dist-data/v1/cities.json";
const cities = JSON.parse(await readFile(FILE, "utf-8"));

const fetcher = {
  async get(path) {
    if (path === "cities.json") return cities;
    throw new Error(`未実装のパス: ${path}`);
  },
};
// limit を広げてある。Step 2 では市区町村の候補が最終結果として出てしまうため、
// 既定の5件だと同名市区町村（中央区は12市）で正解が圏外に落ちるのを観察するため。
const geo = createGeocoder({ baseUrl: "local", fetcher, limit: 20 });

/** [入力, 期待する市区町村名] */
const CASES = [
  ["東京都世田谷区太子堂5-5-5", "世田谷区"],
  ["世田谷区太子堂5-5-5", "世田谷区"],
  ["東京都中央区銀座1-1-1", "中央区"],
  // 都道府県を省いた「中央区」は12市にある。規模では決まらない（札幌市中央区の方が人口が多い）。
  // 町字「銀座」との積集合で決まる＝Step 3 の担当。ここでは候補に含まれていればよい。
  ["中央区銀座1-1-1", "*中央区"],
  ["浦和区高砂3-15-1", "さいたま市浦和区"],
  ["さいたま市浦和区高砂3-15-1", "さいたま市浦和区"],
  ["札幌市北区北12条西3丁目", "札幌市北区"],
  ["北海道札幌市北区北12条西3丁目", "札幌市北区"],
  ["京都府京都市下京区四条通烏丸東入長刀鉾町", "京都市下京区"],
  ["京都市下京区四条通烏丸東入長刀鉾町", "京都市下京区"],
  ["岩手県花巻市石鳥谷町好地第3地割", "花巻市"],
  ["北海道石狩郡当別町", "当別町"],
  ["北海道当別町", "当別町"],
  ["三重県四日市市相生町1", "四日市市"],
  ["神奈川県横浜市西区みなとみらい2-3-1", "横浜市西区"],
  ["大阪市中央区大手前2", "大阪市中央区"],
  ["福岡県福岡市博多区博多駅中央街1-1", "福岡市博多区"],
  ["愛知県名古屋市中区三の丸3-1-2", "名古屋市中区"],
  ["兵庫県神戸市中央区加納町6-5-1", "神戸市中央区"],
  ["沖縄県那覇市泉崎1-2-2", "那覇市"],
];

console.log(`cities.json: ${cities.cities.length} entries\n`);

let ok = 0;
const misses = [];
for (const [input, expect] of CASES) {
  const r = await geo.geocode(input);
  const got = r.candidates[0]?.components.city ?? null;
  // "*" 始まりは「候補のどれかに含まれていればよい」（Step 3 で1件に絞られる）
  const pass = expect.startsWith("*")
    ? r.candidates.some((c) => c.components.city === expect.slice(1))
    : got === expect;
  if (pass) ok++;
  else misses.push({ input, expect, got, n: r.candidates.length });
  console.log(
    `${pass ? "✔" : "✖"} ${input}\n` +
      `    → ${got ?? "(解決不可)"}  候補${r.candidates.length}件  ` +
      `matchLevel=${r.candidates[0]?.matchLevel ?? "-"}  ` +
      `${r.candidates[0] ? `(${r.candidates[0].lat.toFixed(4)}, ${r.candidates[0].lng.toFixed(4)})` : ""}`,
  );
}

console.log(`\n精度: ${ok}/${CASES.length}`);
{
  const r = await geo.geocode("中央区銀座1-1-1");
  console.log(
    `  参考: 「中央区銀座1-1-1」の候補 ${r.candidates.length} 件 → ` +
      r.candidates.map((c) => c.components.city).join(", "),
  );
  console.log(
    "        1件に絞るには町字「銀座」との積集合が要る（DOC.md §6.1・Step 3）",
  );
}
for (const m of misses)
  console.log(`  ✖ ${m.input}  期待 ${m.expect} / 結果 ${m.got}`);

// --- 速度（DOC.md §6.2 / §14.2） ---
const WARM = 200;
const N = 2000;
for (let i = 0; i < WARM; i++) await geo.geocode(CASES[i % CASES.length][0]);

const t0 = process.hrtime.bigint();
for (let i = 0; i < N; i++) await geo.geocode(CASES[i % CASES.length][0]);
const t1 = process.hrtime.bigint();

const perMs = Number(t1 - t0) / 1e6 / N;
console.log(
  `\n速度: ${N}回で ${(Number(t1 - t0) / 1e6).toFixed(0)}ms → 1回あたり ${perMs.toFixed(3)}ms`,
);
console.log(
  perMs < 1
    ? "→ §6.2 の目標（1ms未満）を満たす。wasm 化は不要（§14.2）"
    : "→ §6.2 の目標を超えている。索引構造の見直しか wasm 化を検討（§14.2）",
);
