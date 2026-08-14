/**
 * 住居表示（番・号）の解決。DOC.md §4.4 / §8.4
 *
 * 配信物 rsdt/{lg_code}.json:
 *   { code, t: { <machiaza_id>: { <番>: { p:[lat,lng], r:{ <号>: [dLat,dLng] } } } } }
 *
 * 号は街区からの差分（1e-6度の整数）。全国2,200万点あり絶対値だと倍以上になる。
 */
/**
 * 住居表示のトークンを 番 / 号 に割り当てる。町字が解決済みである前提。
 * 明示された単位（「2番3号」）を優先し、無ければ順に詰める。
 */
export function assignBanGo(tokens) {
    const explicitBan = tokens.find((t) => t.unit === "ban");
    const explicitGo = tokens.find((t) => t.unit === "go");
    if (explicitBan || explicitGo) {
        const out = {};
        if (explicitBan)
            out.block = explicitBan.value;
        if (explicitGo)
            out.rsdt = explicitGo.value;
        return out;
    }
    // 単位が無いものだけを順に使う。丁目は町字側で消費済み
    const plain = tokens.filter((t) => t.unit === undefined || t.unit === "chome");
    const rest = plain.filter((t) => t.unit !== "chome");
    const out = {};
    if (rest[0])
        out.block = rest[0].value;
    if (rest[1])
        out.rsdt = rest[1].value;
    return out;
}
/** machiaza_id がどのパートにあるかを境界表から決める */
function partName(code, bounds, machiazaId) {
    if (!bounds.length)
        return `rsdt/${code}.json`;
    let part = 0;
    for (let i = 0; i < bounds.length; i++) {
        if (bounds[i] <= machiazaId)
            part = i + 1;
    }
    return `rsdt/${code}_${part}.json`;
}
/**
 * 番・号の座標を引く。
 *
 * 号が見つからなければ番の代表点へ、番も無ければ null を返す。
 * 呼び出し側は null のとき町字の代表点にフォールバックする（§8.4）。
 */
export async function lookupRsdt(fetcher, code, bounds, machiazaId, block, rsdt) {
    if (block === undefined)
        return null;
    let file;
    try {
        file = (await fetcher.get(partName(code, bounds, machiazaId)));
    }
    catch {
        return null;
    }
    const blocks = file.t?.[machiazaId];
    const blk = blocks?.[String(block)];
    if (!blk)
        return null;
    // 連番の街区は配列から直接引く
    if (rsdt !== undefined && blk.q) {
        const d = blk.q[rsdt - 1];
        if (d) {
            return {
                lat: Number((blk.p[0] + d[0] / 1e6).toFixed(6)),
                lng: Number((blk.p[1] + d[1] / 1e6).toFixed(6)),
                isRsdt: true,
                block,
                rsdt,
            };
        }
    }
    if (rsdt !== undefined && blk.r) {
        const exact = blk.r[String(rsdt)];
        if (exact) {
            return {
                lat: Number((blk.p[0] + exact[0] / 1e6).toFixed(6)),
                lng: Number((blk.p[1] + exact[1] / 1e6).toFixed(6)),
                isRsdt: true,
                block,
                rsdt,
            };
        }
        // 枝番つき（「32-1」）しか無いことがある。先頭が一致する最小の枝番を採る
        const branch = Object.keys(blk.r)
            .filter((k) => k.startsWith(`${rsdt}-`))
            .sort()[0];
        if (branch) {
            const d = blk.r[branch];
            return {
                lat: Number((blk.p[0] + d[0] / 1e6).toFixed(6)),
                lng: Number((blk.p[1] + d[1] / 1e6).toFixed(6)),
                isRsdt: true,
                block,
                rsdt,
                rsdtKey: branch,
            };
        }
    }
    // 号まで解決できない場合は番の代表点（§8.4）
    return { lat: blk.p[0], lng: blk.p[1], isRsdt: false, block };
}
//# sourceMappingURL=rsdt.js.map