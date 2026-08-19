/**
 * 市区町村一覧の組み立て。
 *
 * cities.json（ABR 由来）は政令指定都市の本体と行政区を別レコードで持ち、
 * 郡名も county フィールドに分けて持っている。ここではそれを
 * 「市区町村の一覧」という平坦な見せ方に畳む。
 *
 * 畳み方は政令指定都市の扱いだけが論点で、それを designatedCity で選ぶ。
 * それ以外（特別区・郡部の町村・通常の市）はどちらのモードでも同じ形になる。
 */

import type { CityRecord } from "./cities.js";
import type { DesignatedCityMode, Municipality, Prefecture } from "../types.js";

/**
 * その市区町村が政令指定都市の本体か（＝自分を親に持つ行政区があるか）。
 * level だけでは本体と通常の市を区別できないため、親子関係から判定する。
 */
function isDesignatedCity(record: CityRecord, records: readonly CityRecord[]): boolean {
  if (record.level !== "city") return false;
  return records.some((r) => r.parent === record.code);
}

/**
 * 行政区の名称から市名の部分を取り除く（「横浜市鶴見区」→「鶴見区」）。
 * cities.json の name は市名を含む前提だが、含まない配信でも壊れないようにする。
 */
function wardName(record: CityRecord, parentName: string): string {
  return record.name.startsWith(parentName)
    ? record.name.slice(parentName.length)
    : record.name;
}

/** 代表点。配信物に座標が無い場合に 0 を混ぜないよう、そのまま写す */
function pos(record: CityRecord): { lat: number; lng: number } {
  return { lat: record.lat as number, lng: record.lng as number };
}

/**
 * 指定した都道府県の市区町村一覧を作る。並びは団体コード順。
 *
 * @param records cities.json の全レコード（都道府県レコードを含んでよい）
 * @param prefCode 都道府県コード2桁
 */
export function buildMunicipalities(
  records: readonly CityRecord[],
  prefCode: string,
  mode: DesignatedCityMode = "wards",
): Municipality[] {
  const target = records
    .filter((r) => r.pref === prefCode && r.level !== "pref")
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

  const byCode = new Map(records.map((r) => [r.code, r]));
  const out: Municipality[] = [];
  // nested のときだけ、市名 → 生成済みエントリ を引いて区を足していく
  const merged = new Map<string, Municipality>();

  for (const record of target) {
    if (record.level === "ward") {
      const parent = record.parent ? byCode.get(record.parent) : undefined;
      // 親が引けない配信では区をそのまま1件として出す（情報を落とさない）
      if (!parent) {
        out.push({ municipality: record.name, ...pos(record) });
        continue;
      }
      const ward = wardName(record, parent.name);

      if (mode === "nested") {
        const hit = merged.get(parent.name);
        if (hit) {
          hit.ward?.push(ward);
          continue;
        }
        // まとめた側の代表点は市そのもののもの。行政区のものではない
        const entry: Municipality = {
          municipality: parent.name,
          ward: [ward],
          ...pos(parent),
        };
        merged.set(parent.name, entry);
        out.push(entry);
        continue;
      }

      out.push({ municipality: parent.name, ward: [ward], ...pos(record) });
      continue;
    }

    // 政令指定都市の本体は行政区の側から出すので、ここでは出さない
    if (isDesignatedCity(record, records)) continue;

    out.push({ municipality: record.name, ...pos(record) });
  }

  return out;
}

/**
 * 都道府県の一覧を作る。並びは都道府県コード順。
 *
 * 名称だけなら PREFECTURES（データ非依存の定数）で足りるが、
 * 代表点の座標が要る場合はこちらを使う。
 */
export function buildPrefectures(records: readonly CityRecord[]): Prefecture[] {
  return records
    .filter((r) => r.level === "pref")
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
    .map((r) => ({
      code: r.code,
      name: r.name,
      lat: r.lat as number,
      lng: r.lng as number,
    }));
}
