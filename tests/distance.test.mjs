/**
 * タイポ許容の期待値。DOC.md §6.2 / §6.3 / Step 6
 *
 * §6.3 の禁止ルールを守れているかが本体。
 * 素朴なレーベンシュタインを住居表示に当てると事故るので、
 * 「弾けること」のテストのほうが重要。
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  boundedLevenshtein,
  allowedDistance,
  typoDistance,
  fuzzyPrefix,
} from "../dist/core/distance.js";

test("上限つき編集距離", () => {
  assert.equal(boundedLevenshtein("世田谷区", "世田谷区", 1), 0);
  assert.equal(boundedLevenshtein("浦和く", "浦和区", 1), 1);
  assert.equal(boundedLevenshtein("世田ケ谷区", "世田谷区", 1), 1, "余分な1文字");
  assert.equal(boundedLevenshtein("太子道", "太子堂", 1), 1);
  // 上限を超えたら max+1 を返して打ち切る
  assert.equal(boundedLevenshtein("あいうえお", "かきくけこ", 1), 2);
  assert.equal(boundedLevenshtein("abc", "abcdef", 1), 2);
});

test("許容距離は文字数で変わる（§6.3）", () => {
  assert.equal(allowedDistance(1), 0);
  assert.equal(allowedDistance(3), 0, "「本町」「南」は完全一致のみ");
  assert.equal(allowedDistance(4), 1);
  assert.equal(allowedDistance(10), 1);
});

/** ここが §6.3 の核心。数字を距離で吸収してはいけない */
test("数字は完全一致のみ（丁目・番地を取り違えない）", () => {
  assert.equal(typoDistance("1丁目", "2丁目"), null, "1丁目と2丁目は別物");
  assert.equal(typoDistance("太子堂1丁目", "太子堂2丁目"), null);
  assert.equal(typoDistance("北12条西3丁目", "北12条西4丁目"), null);
  assert.equal(typoDistance("1-2-3", "1-2-8"), null);
  // 数字が同じなら文字側のタイポは拾ってよい
  assert.equal(typoDistance("北12条東3丁目", "北12条西3丁目"), 1);
});

test("短い地名は完全一致のみ（潰しすぎない）", () => {
  assert.equal(typoDistance("本町", "元町"), null);
  assert.equal(typoDistance("南", "北"), null);
  assert.equal(typoDistance("緑町", "縁町"), null);
  // 4文字以上なら距離1を許す
  assert.equal(typoDistance("世田ケ谷区", "世田谷区"), 1);
});

test("前方一致でタイポ候補を探す", () => {
  const DICT = [
    { key: "世田谷区", value: "A" },
    { key: "千代田区", value: "B" },
    { key: "さいたま市浦和区", value: "C" },
  ];
  // 「世田ヶ谷区」は正規化で「世田ケ谷区」になる。区名に ヶ は無いので距離1
  const r = fuzzyPrefix("世田ケ谷区太子堂5-5-5", DICT);
  assert.equal(r[0].value, "A");
  assert.equal(r[0].distance, 1);
  assert.equal(r[0].rest, "太子堂5-5-5", "消費した分だけ残りが減る");
});

test("完全一致は fuzzy の結果に混ぜない（距離0は前方一致側の仕事）", () => {
  const DICT = [{ key: "世田谷区", value: "A" }];
  assert.equal(fuzzyPrefix("世田谷区太子堂", DICT).length, 0);
});

test("かけ離れた入力は拾わない", () => {
  const DICT = [{ key: "世田谷区", value: "A" }, { key: "千代田区", value: "B" }];
  assert.equal(fuzzyPrefix("存在しない場所", DICT).length, 0);
});
