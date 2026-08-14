/**
 * 住所パーサの期待値。DOC.md §11 / §14.1-3
 * 実装より先にここを書くこと。
 */

import test from "node:test";
import assert from "node:assert/strict";

import { consumePref } from "../dist/core/pref.js";
import { parseTail, looksLikeBuilding } from "../dist/core/banchi.js";
import {
  consumeLongest,
  consumeAll,
  toEntry,
  toEntries,
} from "../dist/core/consume.js";
import { expandAliases } from "../dist/core/aliases.js";

test("都道府県を先頭から削り取る", () => {
  assert.deepEqual(consumePref("東京都世田谷区太子堂"), {
    code: "13",
    name: "東京都",
    rest: "世田谷区太子堂",
  });
  assert.equal(consumePref("北海道札幌市北区")?.name, "北海道");
  assert.equal(consumePref("神奈川県横浜市")?.code, "14");
  // 接尾辞なしでも引ける
  assert.equal(consumePref("東京世田谷区")?.name, "東京都");
  // 省略は正常
  assert.equal(consumePref("世田谷区太子堂"), null);
});

test("都道府県名と同名の市を取り違えない", () => {
  // 「京都市」を「京都府 + 市」と切ってはいけない
  assert.equal(consumePref("京都市中京区"), null);
  assert.equal(consumePref("大阪市北区"), null);
  assert.equal(consumePref("長野市"), null);
  assert.equal(consumePref("広島市中区"), null);
  // 正式名なら当然引ける
  assert.equal(consumePref("京都府京都市中京区")?.rest, "京都市中京区");
});

test("最長一致を取る（京都を京都府より先に切らない）", () => {
  assert.equal(consumePref("京都府宇治市")?.name, "京都府");
  assert.equal(consumePref("京都府宇治市")?.rest, "宇治市");
});

test("番地をトークン化する（意味づけはしない）", () => {
  assert.deepEqual(parseTail("5-5-5").tokens, [
    { value: 5 },
    { value: 5 },
    { value: 5 },
  ]);
  assert.deepEqual(parseTail("1234-5").tokens, [{ value: 1234 }, { value: 5 }]);
  assert.deepEqual(parseTail("1の2の3").tokens, [
    { value: 1 },
    { value: 2 },
    { value: 3 },
  ]);
});

test("明示された単位は保持する", () => {
  assert.deepEqual(parseTail("1丁目2番3号").tokens, [
    { value: 1, unit: "chome" },
    { value: 2, unit: "ban" },
    { value: 3, unit: "go" },
  ]);
  assert.deepEqual(parseTail("一丁目二番三号").tokens, [
    { value: 1, unit: "chome" },
    { value: 2, unit: "ban" },
    { value: 3, unit: "go" },
  ]);
});

test("建物名・部屋番号を切り離す（DOC.md §5.4）", () => {
  const a = parseTail("3-1-1○○ビル3F");
  assert.deepEqual(a.tokens, [{ value: 3 }, { value: 1 }, { value: 1 }]);
  assert.equal(a.building, "○○ビル3F");

  // 4つ目の数字は部屋番号（住所は3階層まで）
  const b = parseTail("5-5-5-301");
  assert.deepEqual(b.tokens, [{ value: 5 }, { value: 5 }, { value: 5 }]);
  assert.equal(b.building, "301");

  // 「3号」は住所であって建物ではない
  const c = parseTail("5-5-3号");
  assert.equal(c.building, undefined);
  assert.deepEqual(c.tokens.at(-1), { value: 3, unit: "go" });

  const d = parseTail("1-2-3ハイツ太子堂201");
  assert.equal(d.building, "ハイツ太子堂201");
});

test("建物名らしさを判定する", () => {
  assert.equal(looksLikeBuilding("○○ビル3F"), true);
  assert.equal(looksLikeBuilding("301"), true);
  assert.equal(looksLikeBuilding("ハイツ太子堂"), true);
  assert.equal(looksLikeBuilding(""), false);
});

/**
 * 前方一致で削り取る枠組み（辞書は呼び出し側から渡す）。
 * 辞書のキーは正規化済みである必要があるため toEntry() を通す。
 */
const DICT = [
  toEntry("一番町", "A"),
  toEntry("一番町一丁目", "B"),
  toEntry("中央区", "C"),
  toEntry("世田谷区", "D", "セタガヤク"),
];

test("最長一致を取る（一番町 より 一番町一丁目 を優先）", () => {
  const r = consumeLongest("一番町一丁目1-1", DICT);
  assert.equal(r.value, "B");
  assert.equal(r.rest, "1-1");
  assert.equal(r.kind, "exact");
  assert.equal(r.score, 1.0);
});

test("カナ軸で拾う（IME誤変換の受け皿）", () => {
  // 漢字では当たらないが読みで当たる
  const r = consumeLongest("瀬田谷区太子堂", DICT, "せたがやく太子堂");
  assert.equal(r.value, "D");
  assert.equal(r.kind, "kana");
  assert.equal(r.score, 0.9);
});

test("候補を絞りきらずに全部返せる（中央区は12市にある）", () => {
  const all = consumeAll("中央区銀座1-1-1", DICT);
  assert.equal(all.length, 1);
  assert.equal(all[0].rest, "銀座1-1-1");
});

test("一致しなければ null", () => {
  assert.equal(consumeLongest("存在しない町", DICT), null);
});

/** 索引側のキー展開（DOC.md §5.2）。実データ検証で必要と判明したケース */
test("丁目省略の別名キーを作る", () => {
  const a = expandAliases({ oaza: "太子堂", chome: "５丁目" });
  assert.deepEqual(a, [
    { name: "太子堂５丁目" },
    { name: "太子堂５", guard: "nodigit" },
  ]);
});

test("丁目省略の別名は直後が数字なら一致しない", () => {
  const dict = toEntries(
    expandAliases({ oaza: "太子堂", chome: "５丁目" }),
    "T",
  );
  // 「太子堂5-5-5」は五丁目に解決される
  assert.equal(consumeLongest("太子堂5-5-5", dict)?.rest, "-5-5");
  // 「太子堂50番地」は五丁目に食われてはいけない
  assert.equal(consumeLongest("太子堂50番地", dict), null);
});

test("京都の通り名は格納順と表記順が逆なので組み替えて登録する", () => {
  // ABR: oaza_cho="長刀鉾町" koaza="四条通烏丸東入" / 利用者は逆順で書く
  const names = expandAliases({
    oaza: "長刀鉾町",
    koaza: "四条通烏丸東入",
  }).map((x) => x.name);
  assert.ok(names.includes("長刀鉾町四条通烏丸東入"), "ABR の格納順");
  assert.ok(names.includes("四条通烏丸東入長刀鉾町"), "実際の住所表記順");
  assert.ok(names.includes("四条通烏丸東入"), "町名を省いた入力");
});

test("京都の上ル/上る・東入ル/東入の表記ゆれを展開する", () => {
  const names = expandAliases({
    oaza: "水銀屋町",
    koaza: "烏丸通四条下る",
  }).map((x) => x.name);
  assert.ok(names.includes("烏丸通四条下る水銀屋町"));
  assert.ok(names.includes("烏丸通四条下ル水銀屋町"), "カタカナのルでも引ける");
});

test("通り名でない小字は組み替えない", () => {
  const a = expandAliases({ oaza: "好地", koaza: "第３地割" });
  assert.deepEqual(a, [{ name: "好地第３地割" }]);
});
