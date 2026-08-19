/**
 * 市区町村一覧の期待値。
 *
 * 既存APIの出力（総務省コード表 + 文字列切り出し）を踏襲することが要件なので、
 * 「政令指定都市をどう畳むか」と「政令市以外は畳まない」の2点が本体。
 * 郡名を出さない・特別区を単独で出すのは既定の挙動として固定する。
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMunicipalities,
  buildPrefectures,
} from "../dist/core/municipalities.js";
import { resolvePref } from "../dist/core/pref.js";
import { createGeocoder } from "../dist/geocode.js";

/** cities.json の部分集合。政令市・特別区・郡部の町・通常の市を1つずつ含む */
const RECORDS = [
  { code: "13", pref: "13", name: "東京都", level: "pref", lat: 35.68, lng: 139.76, k: [], kk: [] },
  { code: "131016", pref: "13", name: "千代田区", level: "special_ward", k: [], kk: [] },
  { code: "133035", pref: "13", name: "瑞穂町", level: "city", county: "西多摩郡", k: [], kk: [] },
  { code: "14", pref: "14", name: "神奈川県", level: "pref", lat: 35.44, lng: 139.63, k: [], kk: [] },
  { code: "141003", pref: "14", name: "横浜市", level: "city", k: [], kk: [] },
  { code: "141011", pref: "14", name: "横浜市鶴見区", level: "ward", parent: "141003", k: [], kk: [] },
  { code: "141020", pref: "14", name: "横浜市神奈川区", level: "ward", parent: "141003", k: [], kk: [] },
  { code: "141305", pref: "14", name: "川崎市", level: "city", k: [], kk: [] },
  { code: "141313", pref: "14", name: "川崎市川崎区", level: "ward", parent: "141305", k: [], kk: [] },
  { code: "142018", pref: "14", name: "横須賀市", level: "city", k: [], kk: [] },
  { code: "143014", pref: "14", name: "葉山町", level: "city", county: "三浦郡", k: [], kk: [] },
];

test("wards: 政令指定都市は行政区ごとに1件ずつ並ぶ（既定）", () => {
  assert.deepEqual(buildMunicipalities(RECORDS, "14"), [
    { municipality: "横浜市", ward: ["鶴見区"] },
    { municipality: "横浜市", ward: ["神奈川区"] },
    { municipality: "川崎市", ward: ["川崎区"] },
    { municipality: "横須賀市" },
    { municipality: "葉山町" },
  ]);
});

test("nested: 政令指定都市は市1件に区がまとまる", () => {
  assert.deepEqual(buildMunicipalities(RECORDS, "14", "nested"), [
    { municipality: "横浜市", ward: ["鶴見区", "神奈川区"] },
    { municipality: "川崎市", ward: ["川崎区"] },
    { municipality: "横須賀市" },
    { municipality: "葉山町" },
  ]);
});

test("政令市以外はモードで変わらない", () => {
  const pick = (mode) =>
    buildMunicipalities(RECORDS, "14", mode).filter((m) => !m.ward);
  assert.deepEqual(pick("wards"), pick("nested"));
});

test("政令指定都市の本体レコードは単独では出さない", () => {
  const names = buildMunicipalities(RECORDS, "14").map((m) => m.municipality);
  // 「横浜市」は区つきでしか現れない（区なしの単独エントリを作らない）
  assert.equal(
    buildMunicipalities(RECORDS, "14").filter(
      (m) => m.municipality === "横浜市" && !m.ward,
    ).length,
    0,
  );
  assert.ok(names.includes("横浜市"));
});

test("特別区は単独の市区町村として出る（市と区に割らない）", () => {
  assert.deepEqual(buildMunicipalities(RECORDS, "13"), [
    { municipality: "千代田区" },
    { municipality: "瑞穂町" },
  ]);
});

test("郡名は出力に含めない（county は別フィールドに持つだけ）", () => {
  const hit = buildMunicipalities(RECORDS, "14").find(
    (m) => m.municipality === "葉山町",
  );
  assert.deepEqual(hit, { municipality: "葉山町" });
});

test("並びは団体コード順", () => {
  const got = buildMunicipalities(RECORDS, "14").map((m) => m.municipality);
  assert.deepEqual(got, [
    "横浜市",
    "横浜市",
    "川崎市",
    "横須賀市",
    "葉山町",
  ]);
});

test("都道府県はコード・名称・接尾辞なしのどれでも引ける", () => {
  const expected = { code: "14", name: "神奈川県" };
  assert.deepEqual(resolvePref(14), expected);
  assert.deepEqual(resolvePref("14"), expected);
  assert.deepEqual(resolvePref("１４"), expected, "全角数字");
  assert.deepEqual(resolvePref("神奈川県"), expected);
  assert.deepEqual(resolvePref("神奈川"), expected);
  assert.deepEqual(resolvePref("北海道"), { code: "01", name: "北海道" });
  assert.deepEqual(resolvePref("01"), { code: "01", name: "北海道" });
  assert.deepEqual(resolvePref("京都"), { code: "26", name: "京都府" });
});

test("都道府県として解決できない入力は null", () => {
  assert.equal(resolvePref(0), null);
  assert.equal(resolvePref(48), null);
  assert.equal(resolvePref(""), null);
  assert.equal(resolvePref("さいたま県"), null);
  assert.equal(resolvePref("東京都渋谷区"), null, "都道府県より下が続くものは不成立");
  assert.equal(resolvePref("京都市"), null);
});

/** fetcher を差し替えて配信物なしで結線を確認する */
function fakeGeocoder() {
  return createGeocoder({
    fetcher: {
      async get(path) {
        if (path === "cities.json")
          return { generated: "test", source: "test", cities: RECORDS };
        throw new Error(`unexpected fetch: ${path}`);
      },
    },
  });
}

test("listMunicipalities: 出典つきで返る", async () => {
  const { municipalities, attribution } =
    await fakeGeocoder().listMunicipalities("神奈川県");
  assert.equal(municipalities.length, 5);
  assert.deepEqual(municipalities[0], {
    municipality: "横浜市",
    ward: ["鶴見区"],
  });
  assert.deepEqual(attribution, ["デジタル庁 アドレス・ベース・レジストリ"]);
});

test("listMunicipalities: designatedCity オプションが効く", async () => {
  const { municipalities } = await fakeGeocoder().listMunicipalities(14, {
    designatedCity: "nested",
  });
  assert.deepEqual(municipalities[0], {
    municipality: "横浜市",
    ward: ["鶴見区", "神奈川区"],
  });
});

test("listMunicipalities: 未知の都道府県は空配列（例外にしない）", async () => {
  const res = await fakeGeocoder().listMunicipalities("存在しない県");
  assert.deepEqual(res.municipalities, []);
  assert.deepEqual(res.attribution, ["デジタル庁 アドレス・ベース・レジストリ"]);
});

test("listMunicipalities: cities.json は1回しか取りに行かない", async () => {
  let calls = 0;
  const geocoder = createGeocoder({
    fetcher: {
      async get(path) {
        calls += 1;
        if (path === "cities.json")
          return { generated: "test", source: "test", cities: RECORDS };
        throw new Error(`unexpected fetch: ${path}`);
      },
    },
  });
  await geocoder.listMunicipalities(14);
  await geocoder.listMunicipalities(13);
  assert.equal(calls, 1);
});

test("buildPrefectures: 都道府県だけを座標つきでコード順に返す", () => {
  assert.deepEqual(buildPrefectures(RECORDS), [
    { code: "13", name: "東京都", lat: 35.68, lng: 139.76 },
    { code: "14", name: "神奈川県", lat: 35.44, lng: 139.63 },
  ]);
});

test("listPrefectures: 出典つきで返り、cities.json を使い回す", async () => {
  let calls = 0;
  const geocoder = createGeocoder({
    fetcher: {
      async get(path) {
        calls += 1;
        if (path === "cities.json")
          return { generated: "test", source: "test", cities: RECORDS };
        throw new Error(`unexpected fetch: ${path}`);
      },
    },
  });
  const { prefectures, attribution } = await geocoder.listPrefectures();
  assert.deepEqual(
    prefectures.map((p) => p.name),
    ["東京都", "神奈川県"],
  );
  assert.deepEqual(attribution, ["デジタル庁 アドレス・ベース・レジストリ"]);

  // 市区町村一覧と同じ索引を共有する
  await geocoder.listMunicipalities(14);
  assert.equal(calls, 1);
});
