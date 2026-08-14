#!/usr/bin/env node
/**
 * 実データで町字レベルの解決を検証する（Step 3）。
 *
 * dist-data/v1 をローカルファイルとして読む fetcher を注入し、
 * 精度・fetch 回数・速度を実測する。
 *
 * 事前に build-cities.mjs / build-towns.mjs が必要。
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

/** [入力, 期待する町字名] — null は「解決できなくてよい」 */
const CASES = [
  ["東京都世田谷区太子堂5-5-5", "太子堂五丁目"],
  ["世田谷区太子堂5-5-5", "太子堂五丁目"],
  ["太子堂5-5-5", "太子堂五丁目"],
  ["東京都中央区銀座1-1-1", "銀座一丁目"],
  ["中央区銀座1-1-1", "銀座一丁目"],
  ["銀座4-5-6", "銀座四丁目"],
  ["東京都千代田区霞が関1-1-1", "霞が関一丁目"],
  ["東京都千代田区霞ヶ関1-1-1", "霞が関一丁目"],
  ["札幌市北区北12条西3丁目1-1", "北１２条西三丁目"],
  ["京都市下京区四条通烏丸東入長刀鉾町", "長刀鉾町四条通烏丸東入"],
  ["岩手県花巻市石鳥谷町好地第3地割", "石鳥谷町好地第３地割"],
  ["さいたま市浦和区高砂3-15-1", "高砂三丁目"],
  ["浦和区高砂3-15-1", "高砂三丁目"],
  ["三重県四日市市相生町1", "相生町"],
  ["神奈川県横浜市西区みなとみらい2-3-1", "みなとみらい二丁目"],
  ["大阪市中央区大手前2-1-22", "大手前二丁目"],
  ["福岡市博多区博多駅中央街1-1", "博多駅中央街"],
  ["名古屋市中区三の丸3-1-2", "三の丸三丁目"],
  ["沖縄県那覇市泉崎1-2-2", "泉崎一丁目"],
  ["兵庫県神戸市中央区加納町6-5-1", "加納町六丁目"],
];

console.log("=== 町字レベルの解決 ===\n");
let ok = 0;
const misses = [];
for (const [input, expect] of CASES) {
  const before = fetchCount;
  const r = await geo.geocode(input);
  const fetches = fetchCount - before;
  const c = r.candidates[0];
  const got = c?.components.oaza ?? null;
  const pass = got === expect;
  if (pass) ok++;
  else misses.push({ input, expect, got });
  console.log(
    `${pass ? "✔" : "✖"} ${input}\n` +
      `    → ${c ? `${c.components.city} ${got ?? "-"}` : "(解決不可)"}  ` +
      `${c ? `[${c.matchLevel}/${c.system}] (${c.lat.toFixed(5)}, ${c.lng.toFixed(5)})` : ""}  ` +
      `候補${r.candidates.length}件 fetch+${fetches}`,
  );
}

console.log(`\n精度: ${ok}/${CASES.length}`);
for (const m of misses)
  console.log(`  ✖ ${m.input}  期待 ${m.expect} / 結果 ${m.got}`);

// --- fetch 回数（§1.2: キャッシュヒット時 fetch 2〜3回） ---
memo.clear();
fetchCount = 0;
const cold = createGeocoder({ baseUrl: "local", fetcher, limit: 5 });
await cold.geocode("東京都世田谷区太子堂5-5-5");
const first = fetchCount;
await cold.geocode("東京都世田谷区若林1-1-1");
const second = fetchCount - first;
await cold.geocode("大阪市中央区大手前2-1-22");
const third = fetchCount - first - second;
console.log(
  `\nfetch 回数: 初回 ${first}（cities+shards+oaza+detail） / 同一市 +${second} / 別の市 +${third}`,
);

// --- 速度 ---
const N = 500;
const t0 = process.hrtime.bigint();
for (let i = 0; i < N; i++) await geo.geocode(CASES[i % CASES.length][0]);
const t1 = process.hrtime.bigint();
console.log(
  `速度: ${N}回で ${(Number(t1 - t0) / 1e6).toFixed(0)}ms → 1回あたり ${(Number(t1 - t0) / 1e6 / N).toFixed(3)}ms（全ファイルキャッシュ済み）`,
);
