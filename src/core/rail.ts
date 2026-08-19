/**
 * 駅・路線の索引。
 *
 * rail.json は1ファイルで全国分（駅 約1万件 / gzip 約330KB）。
 * 最寄り駅検索が全件の座標を要求するので分割しても得がなく、
 * 1回 fetch してメモリに置けば以降の問い合わせは fetch 0回で済む。
 */

import type { Line, Station } from "../types.js";

/** rail.json の生の形。stations は列順を固定した配列（build-rail.mjs 参照） */
export interface RailFile {
  generated: string;
  source: string;
  columns: string[];
  lines: { code: number; name: string; company: string }[];
  stations: (number | string)[][];
}

/** 地球を球とみなした2点間の距離[m]。駅の距離は数百m〜数kmなのでこれで十分 */
const EARTH_RADIUS = 6371000;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

export function distanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(a));
}

export class RailIndex {
  readonly stations: readonly Station[];
  readonly lines: readonly Line[];
  private readonly lineByCode = new Map<number, Line>();
  private readonly byCode = new Map<number, Station>();

  constructor(file: RailFile) {
    for (const l of file.lines) this.lineByCode.set(l.code, l);

    const stations: Station[] = [];
    for (const row of file.stations) {
      const lineCode = row[3] as number;
      const line = this.lineByCode.get(lineCode);
      const station: Station = {
        code: row[0] as number,
        groupCode: row[1] as number,
        name: row[2] as string,
        lineCode,
        lineName: line?.name ?? "",
        company: line?.company ?? "",
        pref: row[4] as number,
        postalCode: row[5] as string,
        address: row[6] as string,
        lat: row[7] as number,
        lng: row[8] as number,
      };
      stations.push(station);
      this.byCode.set(station.code, station);
    }
    this.stations = stations;
    this.lines = file.lines;
  }

  station(code: number): Station | undefined {
    return this.byCode.get(code);
  }

  line(code: number): Line | undefined {
    return this.lineByCode.get(code);
  }

  /**
   * 座標に近い順に駅を返す。
   *
   * 全件を総当たりする。1万件の距離計算は実測2ms程度で、
   * 空間索引を持つ価値より配信物が単純であることを取っている。
   *
   * @param groupBy true なら同一駅（乗換）を1件にまとめる。
   *   「東京駅」が路線の数だけ並ぶのを避けたいときに使う
   */
  nearest(
    lat: number,
    lng: number,
    limit: number,
    groupBy: boolean,
  ): { station: Station; distance: number }[] {
    const scored: { station: Station; distance: number }[] = [];
    for (const s of this.stations) {
      scored.push({ station: s, distance: distanceMeters(lat, lng, s.lat, s.lng) });
    }
    scored.sort((a, b) => a.distance - b.distance);

    if (!groupBy) return scored.slice(0, limit);

    const seen = new Set<number>();
    const out: { station: Station; distance: number }[] = [];
    for (const hit of scored) {
      if (seen.has(hit.station.groupCode)) continue;
      seen.add(hit.station.groupCode);
      out.push(hit);
      if (out.length >= limit) break;
    }
    return out;
  }
}
