/**
 * 住居表示（番・号）の期待値。DOC.md §4.4 / §8.4 / Step 4
 */

import test from "node:test";
import assert from "node:assert/strict";

import { assignBanGo, lookupRsdt } from "../dist/core/rsdt.js";

test("番・号を割り当てる（明示された単位を優先）", () => {
  assert.deepEqual(assignBanGo([{ value: 5 }, { value: 6 }]), { block: 5, rsdt: 6 });
  assert.deepEqual(
    assignBanGo([{ value: 2, unit: "ban" }, { value: 3, unit: "go" }]),
    { block: 2, rsdt: 3 }
  );
  // 丁目は町字側で消費済みなので番・号には使わない
  assert.deepEqual(
    assignBanGo([{ value: 1, unit: "chome" }, { value: 2 }, { value: 3 }]),
    { block: 2, rsdt: 3 }
  );
  // 番だけ
  assert.deepEqual(assignBanGo([{ value: 5 }]), { block: 5 });
  assert.deepEqual(assignBanGo([]), {});
});

/** 号は街区からの差分（1e-6度単位）で持つ */
const FILE = {
  code: "131126",
  t: {
    "0012000": {
      5: {
        p: [35.6443, 139.6669],
        r: { 5: [-106, 113], "32-1": [200, -200] },
      },
      6: { p: [35.645, 139.667] }, // 号データが無い街区
    },
  },
};
const fetcher = { async get(p) { if (p === "rsdt/131126.json") return FILE; throw new Error("404"); } };

test("号の座標は街区からの差分を戻して返す", async () => {
  const hit = await lookupRsdt(fetcher, "131126", [], "0012000", 5, 5);
  assert.equal(hit.isRsdt, true);
  assert.equal(hit.lat, 35.644194);
  assert.equal(hit.lng, 139.667013);
});

test("号が無ければ番の代表点に落とす（§8.4）", async () => {
  const hit = await lookupRsdt(fetcher, "131126", [], "0012000", 6, 1);
  assert.equal(hit.isRsdt, false);
  assert.deepEqual([hit.lat, hit.lng], [35.645, 139.667]);
});

test("指定した号が無ければ番どまり", async () => {
  const hit = await lookupRsdt(fetcher, "131126", [], "0012000", 5, 99);
  assert.equal(hit.isRsdt, false);
  assert.equal(hit.block, 5);
});

test("枝番しか無い号は枝番で拾う", async () => {
  const hit = await lookupRsdt(fetcher, "131126", [], "0012000", 5, 32);
  assert.equal(hit.isRsdt, true);
  assert.equal(hit.rsdtKey, "32-1");
});

test("街区が無ければ null（町字代表点にフォールバックする）", async () => {
  assert.equal(await lookupRsdt(fetcher, "131126", [], "0012000", 99, 1), null);
  assert.equal(await lookupRsdt(fetcher, "131126", [], "9999999", 1, 1), null);
  // 番が読み取れない入力
  assert.equal(await lookupRsdt(fetcher, "131126", [], "0012000", undefined, undefined), null);
});

test("配信ファイルが無くても落ちない", async () => {
  assert.equal(await lookupRsdt(fetcher, "999999", [], "0012000", 1, 1), null);
});
