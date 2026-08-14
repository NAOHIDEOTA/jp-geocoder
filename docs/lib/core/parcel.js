/**
 * 地番（筆）の解決。DOC.md §8.4 / §12.1 / §12.2
 *
 * 配信物 parcel/{lg_code}.json は列指向 + 連続差分:
 *   { code, t: { <machiaza_id>: { o:[lat,lng], a:[], b:[], c:[], y:[], x:[], s:[] } } }
 *
 * 全国9,974万点。キー付きオブジェクトなら 0.54GB、差分なら 0.26GB（実測）。
 * 実行時に累積和を戻すが、1ファイル4万点でも 1ms 未満。
 */
/** 座標の精度。build-parcel.mjs の SCALE と一致させること */
const SCALE = 1e5;
/**
 * 縮尺から accuracy を決める。DOC.md §12.2
 * ABR は地図種別を持たない（rep_src_code が全件 "1"）ので縮尺だけで判断し、
 * 確実に測量済みと言える大縮尺のみ surveyed。残りは legacy に倒す。
 */
export function accuracyFromScale(scale) {
    return scale > 0 && scale <= 500 ? "surveyed" : "legacy";
}
/** 番地のトークンを地番の3要素に割り当てる。「1234-5-6」→ [1234, 5, 6] */
export function assignParcel(tokens) {
    const nums = tokens.filter((t) => t.unit !== "chome").map((t) => t.value);
    if (!nums.length)
        return null;
    return [nums[0], nums[1] ?? 0, nums[2] ?? 0];
}
/** machiaza_id がどのパートにあるかを境界表から決める */
function partName(code, bounds, machiazaId) {
    if (!bounds.length)
        return `parcel/${code}.json`;
    let part = 0;
    for (let i = 0; i < bounds.length; i++) {
        if (bounds[i] <= machiazaId)
            part = i + 1;
    }
    return `parcel/${code}_${part}.json`;
}
/**
 * 地番を引く。null なら呼び出し側が町字代表点にフォールバックする（§8.4）。
 * 座標充足率は実効42〜45%なので null のほうが多い。
 */
export async function lookupParcel(fetcher, code, bounds, machiazaId, nums) {
    let file;
    try {
        file = (await fetcher.get(partName(code, bounds, machiazaId)));
    }
    catch {
        return null;
    }
    // 京都の通り名つき町字は町字マスターと地番マスターで machiaza_id が食い違う
    // （町字 0328102 に対し地番は 0328000 のみ）。末尾000に落として引き直す
    let town = file.t?.[machiazaId];
    if (!town && !machiazaId.endsWith("000")) {
        town = file.t?.[`${machiazaId.slice(0, -3)}000`];
    }
    if (!town)
        return null;
    const [wantA, wantB, wantC] = nums;
    const n = town.a.length;
    // a は連続差分。地番順なので a を超えた時点で打ち切れる
    let acc = 0;
    let start = -1;
    for (let i = 0; i < n; i++) {
        acc += town.a[i];
        if (acc === wantA) {
            start = i;
            break;
        }
        if (acc > wantA)
            return null;
    }
    if (start < 0)
        return null;
    // 同じ a の中から b, c が一致するものを探す
    let hit = -1;
    for (let i = start; i < n; i++) {
        if (i > start && town.a[i] !== 0)
            break; // a が変わった
        if ((town.b[i] ?? 0) === wantB && (town.c[i] ?? 0) === wantC) {
            hit = i;
            break;
        }
    }
    // 枝番が無ければ親番で妥協する（「1234-5」を探して「1234」しか無い場合）
    if (hit < 0)
        hit = start;
    // y/x も連続差分。0..hit の累積和が求める点
    let dy = 0, dx = 0;
    for (let i = 0; i <= hit; i++) {
        dy += town.y[i];
        dx += town.x[i];
    }
    const scale = town.s?.[hit] ?? 0;
    return {
        lat: Number((town.o[0] + dy / SCALE).toFixed(6)),
        lng: Number((town.o[1] + dx / SCALE).toFixed(6)),
        parcel: [wantA, wantB, wantC],
        accuracy: accuracyFromScale(scale),
        scale,
    };
}
//# sourceMappingURL=parcel.js.map