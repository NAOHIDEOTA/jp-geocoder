/**
 * 町字の解決。DOC.md §4.1 / §5.5 / §6.1
 *
 * 転置インデックスを正規化キーの辞書順で分割してある。shards.json の境界表を
 * 二分探索して1シャードだけ取りに行く。索引は2本:
 *   oaza/  漢字キー（スコア 1.00）。町字の実体を持つ
 *   kana/  カナキー（スコア 0.90）。漢字キーへの参照だけを持つ（実体複製で 11.3MB → 6.3MB）
 *
 * 実体を索引に持たせるのは、市区町村コードだけだと市区町村省略時に各市の詳細を
 * 引くことになり fetch が28回に達したため（§1.2 の目標は2〜3回）。
 */
import { toKey } from "./normalize.js";
import { toKanaKey } from "./kana.js";
import { fuzzyPrefix } from "./distance.js";
import { numberToKanji } from "./numbers.js";
export const TOWN_RSDT = 1; // 住居表示実施（§4.4）
export const TOWN_INHERITED = 2; // 座標が親の大字・丁目からの継承（§8.4）
export const townCode = (e) => e[0];
export const townId = (e) => e[1];
export const townOaza = (e) => e[2];
export const townChome = (e) => e[3];
export const townKoaza = (e) => e[4];
export const townLat = (e) => e[5];
export const townLng = (e) => e[6];
export const isResidential = (e) => (e[7] & TOWN_RSDT) !== 0;
export const isInherited = (e) => (e[7] & TOWN_INHERITED) !== 0;
/** 表示名。丁目は郵便慣例どおり漢数字で組み立てる（§12.5） */
export const townName = (e) => `${e[2]}${e[3] ? `${numberToKanji(e[3])}丁目` : ""}${e[4]}`;
/** bounds[i] <= key となる最大の i */
export function findShard(bounds, key) {
    let lo = 0;
    let hi = bounds.length - 1;
    let ans = 0;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (bounds[mid] <= key) {
            ans = mid;
            lo = mid + 1;
        }
        else
            hi = mid - 1;
    }
    return ans;
}
/** 入力の先頭に前方一致するキーを長い順に返す */
function prefixMatches(shard, key) {
    const out = [];
    for (const k of Object.keys(shard)) {
        if (k && key.startsWith(k)) {
            out.push({ key: k, entries: shard[k] });
        }
    }
    return out.sort((a, b) => b.key.length - a.key.length);
}
/**
 * 索引を1本引く。前方一致するキーは入力キー以下に並ぶので通常は1 fetch。
 * シャード先頭キー自体が前方一致のときだけ、より短いキーを求めて前のシャードも引く。
 */
async function lookupIndex(fetcher, dir, set, key, maxBack = 2) {
    if (!key || !set?.bounds?.length)
        return [];
    const idx = findShard(set.bounds, key);
    const out = [];
    for (let back = 0; back <= maxBack && idx - back >= 0; back++) {
        const n = idx - back;
        let shard;
        try {
            shard = (await fetcher.get(`${dir}/${n}.json`));
        }
        catch {
            break;
        }
        out.push(...prefixMatches(shard, key));
        const first = set.bounds[n];
        if (!(first && key.startsWith(first)))
            break;
    }
    return out.sort((a, b) => b.key.length - a.key.length);
}
/**
 * カナ索引で当たったとき、入力のどこまでを消費したかを求める。
 * カナ化で文字数が変わるため索引上の一致長は使えない。接頭辞を長い順に試す。
 */
function restAfterKana(input, kanaKey) {
    for (let i = input.length; i > 0; i--) {
        if (toKanaKey(input.slice(0, i)) === kanaKey)
            return input.slice(i);
    }
    return null;
}
/**
 * 町字の一致が住所の構造に合っているかを見る。残りは番地か空のはず。
 * これが無いと「浦和くの太子道1-1」に長岡市「浦」が1文字一致し、
 * 残りを無視したまま score 1.0 で返る。
 */
function explainsInput(matched, rest) {
    if (!rest)
        return true;
    if (/^[0-9\-ー―‐−–—の]/u.test(rest))
        return true;
    // 3文字以上なら直後が建物名でも一致とみなす
    return matched.length >= 3;
}
/**
 * 町字を引く。漢字 → カナ → タイポの順に落とす（§5.5 / §7）。
 * 返り値は長い一致から順。呼び出し側が市区町村との積集合を取りながら試す。
 */
export async function lookupTown(fetcher, shards, input) {
    const key = toKey(input);
    if (!key)
        return [];
    const kanji = await lookupIndex(fetcher, "oaza", shards.oaza, key);
    const exact = kanji
        .map((h) => ({
        key: h.key,
        entries: h.entries,
        axis: "exact",
        rest: key.slice(h.key.length),
    }))
        .filter((h) => explainsInput(h.key, h.rest));
    if (exact.length)
        return exact;
    // 第2軸: カナ入力（「たいしどう」）
    const kanaKey = toKanaKey(key);
    const out = [];
    if (shards.kana?.bounds?.length) {
        const idxK = findShard(shards.kana.bounds, kanaKey);
        let kshard = null;
        try {
            kshard = (await fetcher.get(`kana/${idxK}.json`));
        }
        catch {
            kshard = null;
        }
        if (kshard) {
            const hits = Object.keys(kshard)
                .filter((k) => k && kanaKey.startsWith(k))
                .sort((a, b) => b.length - a.length);
            for (const kk of hits) {
                const rest = restAfterKana(key, kk);
                if (rest === null || !explainsInput(kk, rest))
                    continue;
                // 実体は漢字索引にしかないので参照を解決する
                const entries = [];
                for (const ref of kshard[kk] ?? []) {
                    const n = findShard(shards.oaza.bounds, ref);
                    try {
                        const oshard = (await fetcher.get(`oaza/${n}.json`));
                        entries.push(...(oshard[ref] ?? []));
                    }
                    catch {
                        /* シャードが取れなければその参照は諦める */
                    }
                }
                if (entries.length)
                    out.push({ key: kk, entries, axis: "kana", rest });
            }
        }
    }
    if (out.length)
        return out;
    // 第3軸: タイポ許容（§6.2）。同じシャード内しか見ない割り切り。
    // 先頭文字が違うタイポ（瀬田谷）は別シャードなので拾えない
    const idx = findShard(shards.oaza.bounds, key);
    let shard;
    try {
        shard = (await fetcher.get(`oaza/${idx}.json`));
    }
    catch {
        return [];
    }
    const cands = Object.keys(shard).map((k) => ({
        key: k,
        value: shard[k],
    }));
    return fuzzyPrefix(key, cands)
        .filter((m) => explainsInput(m.key, m.rest))
        .map((m) => ({
        key: m.key,
        entries: m.value,
        axis: "typo",
        rest: m.rest,
        distance: m.distance,
    }));
}
//# sourceMappingURL=towns.js.map