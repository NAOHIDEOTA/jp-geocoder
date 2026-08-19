/**
 * 駅・路線の期待値。
 *
 * 既存の鉄道APIから移植したもの。特に効くのは次の2点:
 *   - e_status で廃止・移転駅を落とすこと（ビルド側の責務だが索引の前提）
 *   - 乗換駅のまとめ方（1駅1路線で持つので「東京」が何件も出る）
 */

import test from "node:test";
import assert from "node:assert/strict";

import { RailIndex, distanceMeters } from "../dist/core/rail.js";
import { createGeocoder } from "../dist/geocode.js";

/** rail.json の部分集合。東京駅まわりを乗換つきで、県外に1駅置く */
const FILE = {
  generated: "test",
  source: "test",
  columns: [
    "code", "groupCode", "name", "lineCode", "pref",
    "postalCode", "address", "lat", "lng",
  ],
  lines: [
    { code: 11302, name: "JR東海道本線", company: "JR東日本" },
    { code: 99336, name: "東京メトロ丸ノ内線", company: "東京メトロ" },
    { code: 11301, name: "JR東北本線", company: "JR東日本" },
  ],
  stations: [
    // 東京駅（JR東海道本線）と（丸ノ内線）は同じ groupCode
    [1130101, 1130101, "東京", 11302, 13, "1000005", "千代田区丸の内1-9-1", 35.681391, 139.766103],
    [9933601, 1130101, "東京", 99336, 13, "1000005", "千代田区丸の内1-9-1", 35.681994, 139.76608],
    [1130102, 1130102, "有楽町", 11302, 13, "1000006", "千代田区有楽町2-9-19", 35.675069, 139.763328],
    [1110101, 1110101, "大宮", 11301, 11, "3300853", "さいたま市大宮区錦町", 35.906239, 139.623697],
  ],
};

const index = new RailIndex(FILE);

test("駅は路線名・事業者名を解決して持つ", () => {
  const s = index.station(1130101);
  assert.equal(s.name, "東京");
  assert.equal(s.lineName, "JR東海道本線");
  assert.equal(s.company, "JR東日本");
  assert.equal(s.postalCode, "1000005");
  assert.equal(s.pref, 13);
});

test("距離は Haversine（東京駅〜有楽町は約700m）", () => {
  const d = distanceMeters(35.681391, 139.766103, 35.675069, 139.763328);
  assert.ok(d > 600 && d < 800, `${d}m`);
  // 同一地点は0
  assert.equal(distanceMeters(35, 139, 35, 139), 0);
});

test("最寄り駅は近い順。乗換駅は既定では路線ごとに出る", () => {
  const hits = index.nearest(35.6812, 139.7671, 3, false);
  assert.deepEqual(
    hits.map((h) => h.station.lineName),
    ["JR東海道本線", "東京メトロ丸ノ内線", "JR東海道本線"],
  );
  assert.deepEqual(
    hits.map((h) => h.station.name),
    ["東京", "東京", "有楽町"],
  );
  // 距離は単調増加
  assert.ok(hits[0].distance <= hits[1].distance);
  assert.ok(hits[1].distance <= hits[2].distance);
});

test("groupByStation で乗換駅を1件にまとめる", () => {
  const hits = index.nearest(35.6812, 139.7671, 3, true);
  assert.deepEqual(
    hits.map((h) => h.station.name),
    ["東京", "有楽町", "大宮"],
  );
});

function geocoder() {
  return createGeocoder({
    fetcher: {
      async get(path) {
        if (path === "rail.json") return FILE;
        throw new Error(`unexpected fetch: ${path}`);
      },
    },
  });
}

test("listStations: 都道府県で絞る", async () => {
  const { stations, attribution } = await geocoder().listStations({ pref: "東京都" });
  assert.equal(stations.length, 3);
  assert.ok(stations.every((s) => s.pref === 13));
  assert.deepEqual(attribution, ["駅データ.jp"]);
});

test("listStations: 路線で絞る / 都道府県と併用できる", async () => {
  const g = geocoder();
  assert.equal((await g.listStations({ line: 11302 })).stations.length, 2);
  assert.equal(
    (await g.listStations({ pref: 13, line: 11302 })).stations.length,
    2,
  );
  assert.equal(
    (await g.listStations({ pref: 11, line: 11302 })).stations.length,
    0,
  );
});

test("listStations: 条件なしは全件", async () => {
  assert.equal((await geocoder().listStations()).stations.length, 4);
});

test("listStations: 解決できない都道府県は空（全件を返さない）", async () => {
  assert.deepEqual(
    (await geocoder().listStations({ pref: "存在しない県" })).stations,
    [],
  );
});

test("getStation: 駅コードで1件。無ければ空", async () => {
  const g = geocoder();
  assert.equal((await g.getStation(1130101)).stations[0].name, "東京");
  assert.deepEqual((await g.getStation(9999999)).stations, []);
});

test("listLines: その県に駅がある路線だけ返す", async () => {
  const g = geocoder();
  assert.deepEqual(
    (await g.listLines(13)).lines.map((l) => l.name),
    ["JR東海道本線", "東京メトロ丸ノ内線"],
  );
  assert.deepEqual(
    (await g.listLines("埼玉県")).lines.map((l) => l.name),
    ["JR東北本線"],
  );
});

test("nearestStations: limit と maxDistance が効く", async () => {
  const g = geocoder();
  const near = await g.nearestStations(35.6812, 139.7671, { limit: 2 });
  assert.equal(near.stations.length, 2);

  const capped = await g.nearestStations(35.6812, 139.7671, {
    limit: 10,
    maxDistance: 1000,
  });
  assert.ok(capped.stations.every((h) => h.distance <= 1000));
  assert.ok(capped.stations.length < 4, "大宮(約30km)は落ちる");
});

test("nearestStations: 不正な座標は空", async () => {
  const g = geocoder();
  assert.deepEqual((await g.nearestStations(NaN, 139)).stations, []);
  assert.deepEqual((await g.nearestStations(35, Infinity)).stations, []);
});

test("rail.json は1回しか取りに行かない", async () => {
  let calls = 0;
  const g = createGeocoder({
    fetcher: {
      async get(path) {
        calls += 1;
        if (path === "rail.json") return FILE;
        throw new Error(path);
      },
    },
  });
  await g.listStations({ pref: 13 });
  await g.listLines(13);
  await g.nearestStations(35.68, 139.76);
  assert.equal(calls, 1);
});
