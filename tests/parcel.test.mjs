/**
 * 地番（筆）の期待値。DOC.md §8.4 / §12.1 / §12.2 / Step 5
 */

import test from "node:test";
import assert from "node:assert/strict";

import { assignParcel, lookupParcel, accuracyFromScale } from "../dist/core/parcel.js";

test("番地のトークンを地番の3要素に割り当てる", () => {
  assert.deepEqual(assignParcel([{ value: 1234 }]), [1234, 0, 0]);
  assert.deepEqual(assignParcel([{ value: 1234 }, { value: 5 }]), [1234, 5, 0]);
  assert.deepEqual(
    assignParcel([{ value: 1234 }, { value: 5 }, { value: 6 }]),
    [1234, 5, 6]
  );
  // 丁目は町字側で消費済みなので使わない
  assert.deepEqual(
    assignParcel([{ value: 1, unit: "chome" }, { value: 1234 }]),
    [1234, 0, 0]
  );
  assert.equal(assignParcel([]), null);
});

/**
 * 縮尺から accuracy を決める。ABR は地図種別を持たないので、
 * 確実に測量済みと言える大縮尺だけ surveyed にし、残りは legacy に倒す（§12.2）。
 */
test("縮尺から accuracy を決める（過大に申告しない）", () => {
  assert.equal(accuracyFromScale(250), "surveyed");
  assert.equal(accuracyFromScale(500), "surveyed");
  assert.equal(accuracyFromScale(600), "legacy", "公図に典型的な1/600");
  assert.equal(accuracyFromScale(1000), "legacy", "法14条とも公図ともいえない");
  assert.equal(accuracyFromScale(2500), "legacy");
  assert.equal(accuracyFromScale(0), "legacy", "不明なら legacy");
});

/**
 * 列指向 + 連続差分の配信形式。
 * 地番 1, 1-2, 1-3, 5, 100 の5筆を持つ町字を組み立てる。
 */
const FILE = {
  code: "242021",
  t: {
    "0001000": {
      o: [34.96, 136.63],
      //    1     1-2   1-3    5    100   ← 連続差分
      a: [1, 0, 0, 4, 95],
      b: [0, 2, 3, 0, 0],
      c: [0, 0, 0, 0, 0],
      y: [100, 10, 10, -50, 200],
      x: [-100, 5, 5, 30, -80],
      s: [500, 500, 600, 1000, 0],
    },
  },
};
const fetcher = {
  async get(p) {
    if (p === "parcel/242021.json") return FILE;
    throw new Error("404");
  },
};

test("地番を引いて座標を戻す（連続差分の累積和）", async () => {
  const h = await lookupParcel(fetcher, "242021", [], "0001000", [1, 0, 0]);
  assert.equal(h.lat, 34.961);
  assert.equal(h.lng, 136.629);
  assert.deepEqual(h.parcel, [1, 0, 0]);
  assert.equal(h.accuracy, "surveyed");
});

test("枝番つきの地番を引く", async () => {
  const h = await lookupParcel(fetcher, "242021", [], "0001000", [1, 2, 0]);
  // 1 の位置に 10/5 を足した点
  assert.equal(h.lat, 34.9611);
  assert.equal(h.lng, 136.62905);
  assert.equal(h.accuracy, "surveyed");
});

test("縮尺が大きい筆は legacy になる", async () => {
  const h = await lookupParcel(fetcher, "242021", [], "0001000", [1, 3, 0]);
  assert.equal(h.scale, 600);
  assert.equal(h.accuracy, "legacy");
});

test("飛んだ地番も引ける（100番）", async () => {
  const h = await lookupParcel(fetcher, "242021", [], "0001000", [100, 0, 0]);
  assert.deepEqual(h.parcel, [100, 0, 0]);
  assert.equal(h.scale, 0);
  assert.equal(h.accuracy, "legacy");
});

test("枝番が無ければ親番で妥協する", async () => {
  // 5-9 は存在しないが 5 はある
  const h = await lookupParcel(fetcher, "242021", [], "0001000", [5, 9, 0]);
  assert.notEqual(h, null);
  assert.equal(h.scale, 1000);
});

test("存在しない地番・町字・ファイルは null", async () => {
  assert.equal(await lookupParcel(fetcher, "242021", [], "0001000", [9999, 0, 0]), null);
  assert.equal(await lookupParcel(fetcher, "242021", [], "9999999", [1, 0, 0]), null);
  assert.equal(await lookupParcel(fetcher, "999999", [], "0001000", [1, 0, 0]), null);
});
