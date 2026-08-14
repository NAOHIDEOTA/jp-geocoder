/**
 * 解決パイプラインの期待値（Step 2: 市区町村まで）。DOC.md §6.1 / §11
 *
 * fetcher を差し替えてデータ非依存でテストする（§3.3 の境界の効用）。
 */

import test from "node:test";
import assert from "node:assert/strict";

import { createGeocoder } from "../dist/index.js";
import { toKey } from "../dist/core/normalize.js";
import { toKanaKey } from "../dist/core/kana.js";

/** 最小の cities.json。実データの構造をそのまま縮めたもの */
const CITIES = {
  generated: "2026-08-11",
  source: "test",
  cities: [
    {
      code: "13",
      pref: "13",
      name: "東京都",
      level: "pref",
      k: [toKey("東京都")],
      kk: [toKanaKey("トウキョウト")],
      lat: 35.68,
      lng: 139.75,
    },
    {
      code: "11",
      pref: "11",
      name: "埼玉県",
      level: "pref",
      k: [toKey("埼玉県")],
      kk: [toKanaKey("サイタマケン")],
      lat: 35.85,
      lng: 139.64,
    },
    {
      code: "01",
      pref: "01",
      name: "北海道",
      level: "pref",
      k: [toKey("北海道")],
      kk: [toKanaKey("ホッカイドウ")],
      lat: 43.06,
      lng: 141.34,
    },

    {
      code: "131024",
      pref: "13",
      name: "中央区",
      level: "special_ward",
      k: [toKey("中央区")],
      kk: [toKanaKey("チュウオウク")],
      lat: 35.67,
      lng: 139.77,
      towns: 20,
    },
    {
      code: "271021",
      pref: "27",
      name: "大阪市中央区",
      level: "ward",
      k: [toKey("中央区"), toKey("大阪市中央区")],
      kk: [toKanaKey("チュウオウク")],
      parent: "271004",
      lat: 34.68,
      lng: 135.51,
      towns: 10,
    },
    {
      code: "131126",
      pref: "13",
      name: "世田谷区",
      level: "special_ward",
      k: [toKey("世田谷区")],
      kk: [toKanaKey("セタガヤク")],
      lat: 35.64,
      lng: 139.65,
      towns: 277,
    },
    {
      code: "111073",
      pref: "11",
      name: "さいたま市浦和区",
      level: "ward",
      k: [toKey("浦和区"), toKey("さいたま市浦和区")],
      kk: [toKanaKey("ウラワク"), toKanaKey("サイタマシウラワク")],
      parent: "111007",
      lat: 35.86,
      lng: 139.65,
      towns: 60,
    },
    {
      code: "013030",
      pref: "01",
      name: "当別町",
      level: "city",
      county: "石狩郡",
      k: [toKey("当別町"), toKey("石狩郡当別町")],
      kk: [toKanaKey("トウベツチョウ")],
      lat: 43.21,
      lng: 141.5,
      towns: 40,
    },
  ],
};

const fetcher = {
  async get(path) {
    if (path === "cities.json") return CITIES;
    throw new Error(`no ${path}`);
  },
};
const geo = createGeocoder({ baseUrl: "http://test/v1", fetcher });

test("都道府県 + 市区町村を解決する", async () => {
  const r = await geo.geocode("東京都世田谷区太子堂5-5-5");
  assert.equal(r.candidates[0].components.pref, "東京都");
  assert.equal(r.candidates[0].components.city, "世田谷区");
  assert.equal(r.candidates[0].matchLevel, "city");
  assert.equal(r.candidates[0].accuracy, "representative");
  assert.ok(r.attribution.includes("デジタル庁 アドレス・ベース・レジストリ"));
});

test("市区町村の代表点は representative（探した住所の点ではない）", async () => {
  const r = await geo.geocode("東京都世田谷区");
  assert.equal(r.candidates[0].lat, 35.64);
  assert.equal(r.candidates[0].accuracy, "representative");
});

test("都道府県が省略されても解決し、pref は解決結果から補完する（DOC.md §6.1）", async () => {
  const r = await geo.geocode("世田谷区太子堂1-1-1");
  assert.equal(r.candidates[0].components.city, "世田谷区");
  // 入力に無くても市区町村から一意に定まるので埋めて返す
  assert.equal(r.candidates[0].components.pref, "東京都");
});

test("政令市の行政区は区名単体で引ける（DOC.md §4.2）", async () => {
  const r = await geo.geocode("浦和区高砂1-1");
  assert.equal(r.candidates[0].components.city, "さいたま市浦和区");
});

test("政令市名つきでも引ける", async () => {
  const r = await geo.geocode("さいたま市浦和区高砂1-1");
  assert.equal(r.candidates[0].components.city, "さいたま市浦和区");
});

test("同名の区は候補を絞らず複数返す（中央区）", async () => {
  const r = await geo.geocode("中央区銀座1-1-1");
  const names = r.candidates.map((c) => c.components.city);
  assert.ok(names.includes("中央区"));
  assert.ok(names.includes("大阪市中央区"));
  // 規模の大きい方が先（§7 の tie-break）
  assert.equal(names[0], "中央区");
});

test("都道府県で絞れば同名の衝突は消える", async () => {
  // 「中央区」は12市にあるが、都道府県が付けば1件に決まる
  const r = await geo.geocode("東京都中央区銀座1-1-1");
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0].components.city, "中央区");

  const r2 = await geo.geocode("大阪府中央区");
  assert.equal(r2.candidates.length, 1);
  assert.equal(r2.candidates[0].components.city, "大阪市中央区");
  // 都道府県レコードが無くても、切り出した都道府県名は components に残す
  assert.equal(r2.candidates[0].components.pref, "大阪府");
});

test("郡は省略できる（DOC.md §4.2）", async () => {
  const a = await geo.geocode("北海道当別町");
  const b = await geo.geocode("北海道石狩郡当別町");
  assert.equal(a.candidates[0].components.city, "当別町");
  assert.equal(b.candidates[0].components.city, "当別町");
  assert.equal(a.candidates[0].components.county, "石狩郡");
});

test("建物名を切り離してレスポンスに載せる（DOC.md §5.4）", async () => {
  const r = await geo.geocode("東京都世田谷区1-2-3ハイツ太子堂201");
  assert.equal(r.candidates[0].building, "ハイツ太子堂201");
});

test("市区町村が解決できなければ都道府県まで落とす（§8.4）", async () => {
  const r = await geo.geocode("東京都存在しない市");
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0].matchLevel, "pref");
  assert.equal(r.candidates[0].components.pref, "東京都");
});

test("何も解決できなければ空配列（嘘をつかない）", async () => {
  const r = await geo.geocode("あいうえお");
  assert.deepEqual(r.candidates, []);
  assert.ok(r.attribution.length > 0);
});

test("limit で候補数を絞れる", async () => {
  const g = createGeocoder({ baseUrl: "http://test/v1", fetcher, limit: 1 });
  const r = await g.geocode("中央区");
  assert.equal(r.candidates.length, 1);
});

test("常駐インデックスの取得は1回だけ（§3.1）", async () => {
  const calls = {};
  const counting = {
    async get(p) {
      calls[p] = (calls[p] ?? 0) + 1;
      if (p === "cities.json") return CITIES;
      throw new Error("not found"); // shards.json 無し = Step 2 相当の配信
    },
  };
  const g = createGeocoder({ baseUrl: "http://test/v1", fetcher: counting });
  await g.geocode("東京都世田谷区");
  await g.geocode("東京都中央区");
  await g.geocode("浦和区");
  assert.equal(calls["cities.json"], 1, "cities.json は1回");
  assert.equal(
    calls["shards.json"],
    1,
    "shards.json も1回（失敗しても再取得しない）",
  );
});

test("shards.json が無くても市区町村までは動く（後方互換）", async () => {
  const noShards = {
    async get(p) {
      if (p === "cities.json") return CITIES;
      throw new Error("not found");
    },
  };
  const g = createGeocoder({ baseUrl: "http://test/v1", fetcher: noShards });
  const r = await g.geocode("東京都世田谷区太子堂5-5-5");
  assert.equal(r.candidates[0].matchLevel, "city");
});
