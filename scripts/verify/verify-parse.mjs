#!/usr/bin/env node
/**
 * 住所パーサを実データで検証する。
 *
 * DOC.md §5.3 は北海道の条丁目・岩手の地割・京都の通り名に「専用パーサが必要」と
 * 書いているが、正規化キー（漢数字変換）＋前方一致だけで解けるなら不要になる。
 * ここで実際の町字マスターから索引を作り、現実的な入力で引けるかを確かめる。
 *
 * 使い方: node scripts/verify-parse.mjs
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";

import { toKey } from "../../dist/core/normalize.js";
import { consumeLongest, toEntries } from "../../dist/core/consume.js";
import { expandAliases } from "../../dist/core/aliases.js";

const ZIP = "data/abr/mt_town_all.csv.zip";
if (!existsSync(ZIP)) {
  console.error(
    `${ZIP} がありません。先に \`make data-download\` を実行してください。`,
  );
  process.exit(1);
}

function parseLine(line) {
  const out = [];
  let cur = "",
    quoted = false;
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

/** 検証対象の市区町村（DOC.md §11 のテストケース群に対応） */
const TARGETS = [
  { label: "札幌市北区（条丁目）", city: "札幌市", ward: "北区" },
  { label: "花巻市（地割）", city: "花巻市", ward: "" },
  { label: "京都市下京区（通り名）", city: "京都市", ward: "下京区" },
  { label: "世田谷区（住居表示）", city: "世田谷区", ward: "" },
];

/** label -> DictEntry[] */
const dicts = new Map(TARGETS.map((t) => [t.label, []]));

const unzip = spawn("unzip", ["-p", ZIP]);
const rl = createInterface({ input: unzip.stdout, crlfDelay: Infinity });
let header = null,
  idx = {};

for await (const line of rl) {
  if (!line) continue;
  const f = parseLine(line);
  if (!header) {
    header = f;
    idx = Object.fromEntries(header.map((h, i) => [h, i]));
    continue;
  }

  const city = f[idx.city] ?? "",
    ward = f[idx.ward] ?? "";
  const t = TARGETS.find((x) => x.city === city && x.ward === ward);
  if (!t) continue;

  const oaza = f[idx.oaza_cho] ?? "",
    chome = f[idx.chome] ?? "",
    koaza = f[idx.koaza] ?? "";
  const name = `${oaza}${chome}${koaza}`;
  if (!name) continue;
  const kana = `${f[idx.oaza_cho_kana] ?? ""}${f[idx.chome_kana] ?? ""}${f[idx.koaza_kana] ?? ""}`;

  const aliases = expandAliases({ oaza, chome, koaza });
  dicts
    .get(t.label)
    .push(
      ...toEntries(
        aliases,
        { name, id: f[idx.machiaza_id] },
        kana || undefined,
      ),
    );
}

/**
 * 現実的な利用者入力 → 期待する町字（**ABR の正式名**）と残り。
 *
 * 期待値は ABR の格納順（oaza + chome + koaza）で書く。
 * 京都は格納順と実表記順が逆なので、入力と期待値の語順が入れ替わるのが正しい。
 */
const CASES = [
  ["札幌市北区（条丁目）", "北12条西3丁目1-1", "北１２条西３丁目", "1-1"],
  ["札幌市北区（条丁目）", "北十二条西三丁目1-1", "北１２条西３丁目", "1-1"],
  ["札幌市北区（条丁目）", "北２４条西５丁目", "北２４条西５丁目", ""],
  ["花巻市（地割）", "石鳥谷町好地第3地割", "石鳥谷町好地第３地割", ""],
  ["花巻市（地割）", "大迫町大迫第14地割", "大迫町大迫第１４地割", ""],
  // 京都: 入力は「通り名 + 町名」、ABR は「町名 + 通り名」
  [
    "京都市下京区（通り名）",
    "四条通烏丸東入長刀鉾町",
    "長刀鉾町四条通烏丸東入",
    "",
  ],
  [
    "京都市下京区（通り名）",
    "烏丸通四条下ル水銀屋町",
    "水銀屋町烏丸通四条下る",
    "",
  ],
  // 丁目省略: 「太子堂5」が五丁目に解決され、残りが番・号になる
  ["世田谷区（住居表示）", "太子堂5-5-5", "太子堂５丁目", "-5-5"],
  ["世田谷区（住居表示）", "太子堂五丁目5番5号", "太子堂５丁目", "5番5号"],
];

let ok = 0,
  ng = 0;
for (const [label, input, expect, expectRest] of CASES) {
  const dict = dicts.get(label) ?? [];
  const r = consumeLongest(input, dict);
  const got = r?.value?.name ?? null;
  const pass =
    got !== null &&
    toKey(got) === toKey(expect) &&
    r.rest === toKey(expectRest);
  if (pass) ok++;
  else ng++;
  console.log(
    `${pass ? "✔" : "✖"} [${label}] "${input}"\n` +
      `    期待 ${expect}  残り "${toKey(expectRest)}"\n` +
      `    結果 ${got ?? "(一致なし)"}${r ? `  残り "${r.rest}"  ${r.kind}` : ""}`,
  );
}

console.log(`\n索引件数:`);
for (const [label, d] of dicts)
  console.log(`  ${label}: ${d.length.toLocaleString()} 件`);
console.log(`\n結果: ${ok} 成功 / ${ng} 失敗`);
if (ng) console.log("→ 失敗したケースは専用パーサ（DOC.md §5.3）が必要");
else console.log("→ 正規化キー＋前方一致だけで解けている。専用パーサは不要");
