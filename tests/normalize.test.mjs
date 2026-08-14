/**
 * 正規化キーの期待値。DOC.md §11 / §14.1-3
 *
 * **実装より先にここを書くこと。** 期待値が無いと正規化の設計判断がぶれる。
 * ここが仕様の一次情報であり、実装はこれに合わせる。
 *
 * 「衝突させない」側のケースは実データ検証（scripts/verify-keys.mjs）で
 * 実際に事故った組を回帰テストとして固定してある。消さないこと。
 */

import test from "node:test";
import assert from "node:assert/strict";

import { toKey, toExactKey, normalizeBanchi } from "../dist/core/normalize.js";
import { toKanaKey, toKanaLooseKey } from "../dist/core/kana.js";
import {
  kanjiToNumber,
  numberToKanji,
  normalizeChomeDisplay,
} from "../dist/core/numbers.js";

/** 同じキーに落ちるべき表記の組 */
const SAME_KEY = [
  ["霞ヶ関", "霞ケ関", "霞が関", "霞カ関"],
  ["井之頭", "井ノ頭", "井の頭"],
  ["三ヶ日", "三カ日", "三ケ日"],
  ["一ノ関", "一之関", "一の関"],
  ["髙崎", "高崎"],
  ["渡邊", "渡邉", "渡辺"],
  ["世田谷", "世 田 谷", "世田谷　"],
  ["太子堂五", "太子堂5", "太子堂５"],
  ["麹町１丁目", "麹町一丁目"],
];

test("同じ表記ゆれは同じキーに落ちる", () => {
  for (const group of SAME_KEY) {
    const keys = group.map(toKey);
    const first = keys[0];
    for (let i = 1; i < keys.length; i++) {
      assert.equal(
        keys[i],
        first,
        `${group[i]} -> ${keys[i]} != ${group[0]} -> ${first}`,
      );
    }
  }
});

/**
 * 送り字の有無は別地名。**削除してはいけない。**
 * 実データ検証で座標が2km以上離れていることを確認済みの組（回帰テスト）。
 */
test("送り字の有無で別地名になる組を衝突させない", () => {
  const DISTINCT = [
    ["中島", "中ノ島", 19369], // 新潟市
    ["岩崎", "岩ケ崎", 31510], // 新潟県
    ["坂下", "坂ノ下", 9975], // 岩手県
    ["田沢", "田の沢", 6080], // 秋田県
    ["西沢", "西の沢", 10753], // 茨城県
    ["中町", "中之町", 3487], // 兵庫県
    ["川上町", "川之上町", 3041], // 兵庫県
  ];
  for (const [a, b, meters] of DISTINCT) {
    assert.notEqual(
      toKey(a),
      toKey(b),
      `${a} と ${b} は ${meters}m 離れた別地点`,
    );
  }
});

test("カタカナ地名を壊さない（統一は漢字/数字に挟まれたときだけ）", () => {
  assert.equal(toKey("アカシア通"), "アカシア通");
  assert.equal(toKey("モノレール"), "モノレール");
  assert.equal(toKey("カノン坂"), "カノン坂");
  // 先頭・末尾は触らない
  assert.equal(toKey("ノ田"), "ノ田");
});

test("異体字・旧字体を統一する", () => {
  assert.equal(toKey("﨑玉"), toKey("崎玉"));
  assert.equal(toKey("澤田"), toKey("沢田"));
  assert.equal(toKey("廣島"), toKey("広島"));
  assert.equal(toKey("龍ケ崎"), toKey("竜ヶ崎"));
});

test("漢数字を数値に読む", () => {
  assert.equal(kanjiToNumber("一"), 1);
  assert.equal(kanjiToNumber("十"), 10);
  assert.equal(kanjiToNumber("十二"), 12);
  assert.equal(kanjiToNumber("二十三"), 23);
  assert.equal(kanjiToNumber("三百"), 300);
  assert.equal(kanjiToNumber("千二百三十四"), 1234);
  assert.equal(kanjiToNumber("二三"), 23); // 位取りなしは桁の並び
  assert.equal(kanjiToNumber("〇"), 0);
});

test("番地の区切りを - に統一する", () => {
  for (const s of [
    "1-2-3",
    "１－２－３",
    "1の2の3",
    "一丁目二番三号",
    "1丁目2番3号",
    "1ー2ー3",
    "一の二の三",
  ]) {
    assert.equal(normalizeBanchi(s), "1-2-3", `${s} -> ${normalizeBanchi(s)}`);
  }
});

test("カナキーは長音・促音・拗音・ヶを吸収する", () => {
  assert.equal(toKanaKey("セタガヤ"), toKanaKey("せたがや"));
  assert.equal(toKanaKey("トウキョウ"), toKanaKey("とうきよう"));
  assert.equal(toKanaKey("ホッカイドウ"), toKanaKey("ほつかいどう"));
  assert.equal(toKanaKey("チョウフ"), toKanaKey("ちようふ"));
  assert.equal(toKanaKey("オーサカ"), toKanaKey("オサカ"));
  assert.equal(toKanaKey("カスミヶセキ"), toKanaKey("かすみせき"));
});

test("カナキーは旧仮名を吸収する", () => {
  assert.equal(toKanaKey("ゐなか"), toKanaKey("いなか"));
  assert.equal(toKanaKey("ヱビス"), toKanaKey("えびす"));
});

/**
 * 濁点は第2軸では潰さない。潰すのは第3軸（toKanaLooseKey）だけ。
 * 実データ検証で座標が2km以上離れていることを確認済みの組（回帰テスト）。
 */
test("濁点の違いは第2軸では別キー、第3軸でのみ同一", () => {
  const PAIRS = [
    ["しんかわちよう", "じんかわちよう", "新川町 / 陣川町 8.5km"],
    ["なかしま", "ながしま", "中島 / 長島 2.2km"],
    ["ふせ", "ふぜ", "布施 / 布瀬 10.8km"],
  ];
  for (const [a, b, why] of PAIRS) {
    assert.notEqual(toKanaKey(a), toKanaKey(b), why);
    assert.equal(
      toKanaLooseKey(a),
      toKanaLooseKey(b),
      `第3軸では拾える: ${why}`,
    );
  }
});

test("異なる地名を衝突させない", () => {
  assert.notEqual(toKey("世田谷"), toKey("千代田"));
  assert.notEqual(toKey("北青山"), toKey("南青山"));
  assert.notEqual(toKey("本町"), toKey("元町"));
  assert.notEqual(toKanaKey("しんじゆく"), toKanaKey("しぶや"));
});

test("丁目の表示を漢数字に統一する（ABR は全角数字と漢数字が混在）", () => {
  assert.equal(normalizeChomeDisplay("５丁目"), "五丁目");
  assert.equal(normalizeChomeDisplay("5丁目"), "五丁目");
  assert.equal(normalizeChomeDisplay("五丁目"), "五丁目");
  assert.equal(normalizeChomeDisplay("１２丁目"), "十二丁目");
  assert.equal(normalizeChomeDisplay("20丁目"), "二十丁目");
  // 丁目以外は触らない
  assert.equal(normalizeChomeDisplay("１丁目北"), "１丁目北");
  assert.equal(normalizeChomeDisplay(""), "");
});

test("アラビア数字→漢数字の位取り", () => {
  assert.equal(numberToKanji(1), "一");
  assert.equal(numberToKanji(10), "十");
  assert.equal(numberToKanji(12), "十二");
  assert.equal(numberToKanji(23), "二十三");
  assert.equal(numberToKanji(100), "百");
  assert.equal(numberToKanji(234), "二百三十四");
});

/**
 * 送り字の統一は表記の区別を消してしまうことがある。
 * 実データで535件、同一市区町村内の別の町字が同じキーに落ちていた（§5.2.1）。
 * 引き当ては統一キーで行い、候補の絞り込みは toExactKey で行う。
 */
test("toExactKey は送り字を統一しない", () => {
  // 統一キーでは同じになる
  assert.equal(toKey("野増字王の上"), toKey("野増字王ノ上"));
  assert.equal(toKey("上戸町南方カ字"), toKey("上戸町南方ケ字"));
  // 表記どおりのキーでは区別される
  assert.notEqual(toExactKey("野増字王の上"), toExactKey("野増字王ノ上"));
  assert.notEqual(toExactKey("上戸町南方カ字"), toExactKey("上戸町南方ケ字"));
});

test("toExactKey は toKey と文字数が一致する（位置で切り出せる）", () => {
  for (const s of [
    "東京都大島町野増字王の上",
    "石川県珠洲市上戸町南方カ字",
    "東京都千代田区霞ヶ関一丁目1番1号",
    "北海道札幌市北区北十二条西三丁目",
    "東京都世田谷区太子堂五丁目5番5号",
  ]) {
    assert.equal(toExactKey(s).length, toKey(s).length, s);
  }
});

test("toExactKey も異体字・漢数字・空白は正規化する", () => {
  assert.equal(toExactKey("髙崎"), toExactKey("高崎"));
  assert.equal(toExactKey("麹町六丁目"), "麹町6丁目");
  assert.equal(toExactKey("世 田 谷"), "世田谷");
});
