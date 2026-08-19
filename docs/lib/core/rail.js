/**
 * 駅・路線の索引。
 *
 * rail.json は1ファイルで全国分（駅 約1万件 / gzip 約330KB）。
 * 最寄り駅検索が全件の座標を要求するので分割しても得がなく、
 * 1回 fetch してメモリに置けば以降の問い合わせは fetch 0回で済む。
 */
/** 地球を球とみなした2点間の距離[m]。駅の距離は数百m〜数kmなのでこれで十分 */
const EARTH_RADIUS = 6371000;
const toRad = (deg) => (deg * Math.PI) / 180;
export function distanceMeters(lat1, lng1, lat2, lng2) {
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(a));
}
export class RailIndex {
    stations;
    lines;
    lineByCode = new Map();
    byCode = new Map();
    constructor(file) {
        for (const l of file.lines)
            this.lineByCode.set(l.code, l);
        const stations = [];
        for (const row of file.stations) {
            const lineCode = row[3];
            const line = this.lineByCode.get(lineCode);
            const station = {
                code: row[0],
                groupCode: row[1],
                name: row[2],
                lineCode,
                lineName: line?.name ?? "",
                company: line?.company ?? "",
                pref: row[4],
                postalCode: row[5],
                address: row[6],
                lat: row[7],
                lng: row[8],
            };
            stations.push(station);
            this.byCode.set(station.code, station);
        }
        this.stations = stations;
        this.lines = file.lines;
    }
    station(code) {
        return this.byCode.get(code);
    }
    line(code) {
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
    nearest(lat, lng, limit, groupBy) {
        const scored = [];
        for (const s of this.stations) {
            scored.push({ station: s, distance: distanceMeters(lat, lng, s.lat, s.lng) });
        }
        scored.sort((a, b) => a.distance - b.distance);
        if (!groupBy)
            return scored.slice(0, limit);
        const seen = new Set();
        const out = [];
        for (const hit of scored) {
            if (seen.has(hit.station.groupCode))
                continue;
            seen.add(hit.station.groupCode);
            out.push(hit);
            if (out.length >= limit)
                break;
        }
        return out;
    }
}
//# sourceMappingURL=rail.js.map