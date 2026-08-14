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

import type { Fetcher } from "../types.js";
import { toKey } from "./normalize.js";
import { toKanaKey } from "./kana.js";
import { fuzzyPrefix } from "./distance.js";
import { numberToKanji } from "./numbers.js";

/**
 * [lg_code, machiaza_id, 大字, 丁目(数値・0なら無し), 小字, lat, lng, flags]
 * 大字・丁目・小字を分けて持つ（components で分割して返すため）。数字は半角に統一済み。
 */
export type TownEntry = [
  string,
  string,
  string,
  number,
  string,
  number | null,
  number | null,
  number,
];

export const TOWN_RSDT = 1; // 住居表示実施（§4.4）
export const TOWN_INHERITED = 2; // 座標が親の大字・丁目からの継承（§8.4）

export const townCode = (e: TownEntry): string => e[0];
export const townId = (e: TownEntry): string => e[1];
export const townOaza = (e: TownEntry): string => e[2];
export const townChome = (e: TownEntry): number => e[3];
export const townKoaza = (e: TownEntry): string => e[4];
export const townLat = (e: TownEntry): number | null => e[5];
export const townLng = (e: TownEntry): number | null => e[6];
export const isResidential = (e: TownEntry): boolean =>
  (e[7] & TOWN_RSDT) !== 0;
export const isInherited = (e: TownEntry): boolean =>
  (e[7] & TOWN_INHERITED) !== 0;

/** 表示名。丁目は郵便慣例どおり漢数字で組み立てる（§12.5） */
export const townName = (e: TownEntry): string =>
  `${e[2]}${e[3] ? `${numberToKanji(e[3])}丁目` : ""}${e[4]}`;

export interface ShardSet {
  size: number;
  bounds: string[];
}

/** shards.json */
export interface ShardsFile {
  oaza: ShardSet;
  kana: ShardSet;
  /** lg_code -> 住居表示の分割パートの先頭 machiaza_id（単一なら空配列） */
  rsdt?: Record<string, string[]>;
  /** lg_code -> 地番の分割パートの先頭 machiaza_id（単一なら空配列） */
  parcel?: Record<string, string[]>;
}

export type MatchAxis = "exact" | "kana" | "typo";

export interface TownHit {
  /** 索引上の一致キー */
  key: string;
  entries: TownEntry[];
  axis: MatchAxis;
  /** 入力から一致部分を取り除いた残り */
  rest: string;
  /** typo 軸のときの編集距離 */
  distance?: number;
}

/** bounds[i] <= key となる最大の i */
export function findShard(bounds: readonly string[], key: string): number {
  let lo = 0;
  let hi = bounds.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((bounds[mid] as string) <= key) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

type Shard = Record<string, TownEntry[]>;
/** カナ索引のシャード。値は漢字キーの配列 */
type KanaShard = Record<string, string[]>;

/** 入力の先頭に前方一致するキーを長い順に返す */
function prefixMatches(
  shard: Shard,
  key: string,
): { key: string; entries: TownEntry[] }[] {
  const out: { key: string; entries: TownEntry[] }[] = [];
  for (const k of Object.keys(shard)) {
    if (k && key.startsWith(k)) {
      out.push({ key: k, entries: shard[k] as TownEntry[] });
    }
  }
  return out.sort((a, b) => b.key.length - a.key.length);
}

/**
 * 索引を1本引く。前方一致するキーは入力キー以下に並ぶので通常は1 fetch。
 * シャード先頭キー自体が前方一致のときだけ、より短いキーを求めて前のシャードも引く。
 */
async function lookupIndex(
  fetcher: Fetcher,
  dir: string,
  set: ShardSet | undefined,
  key: string,
  maxBack = 2,
): Promise<{ key: string; entries: TownEntry[] }[]> {
  if (!key || !set?.bounds?.length) return [];
  const idx = findShard(set.bounds, key);
  const out: { key: string; entries: TownEntry[] }[] = [];

  for (let back = 0; back <= maxBack && idx - back >= 0; back++) {
    const n = idx - back;
    let shard: Shard;
    try {
      shard = (await fetcher.get(`${dir}/${n}.json`)) as Shard;
    } catch {
      break;
    }
    out.push(...prefixMatches(shard, key));
    const first = set.bounds[n] as string;
    if (!(first && key.startsWith(first))) break;
  }
  return out.sort((a, b) => b.key.length - a.key.length);
}

/**
 * カナ索引で当たったとき、入力のどこまでを消費したかを求める。
 * カナ化で文字数が変わるため索引上の一致長は使えない。接頭辞を長い順に試す。
 */
function restAfterKana(input: string, kanaKey: string): string | null {
  for (let i = input.length; i > 0; i--) {
    if (toKanaKey(input.slice(0, i)) === kanaKey) return input.slice(i);
  }
  return null;
}

/**
 * 町字の一致が住所の構造に合っているかを見る。残りは番地か空のはず。
 * これが無いと「浦和くの太子道1-1」に長岡市「浦」が1文字一致し、
 * 残りを無視したまま score 1.0 で返る。
 */
function explainsInput(matched: string, rest: string): boolean {
  if (!rest) return true;
  if (/^[0-9\-ー―‐−–—の]/u.test(rest)) return true;
  // 3文字以上なら直後が建物名でも一致とみなす
  return matched.length >= 3;
}

/**
 * 町字を引く。漢字 → カナ → タイポの順に落とす（§5.5 / §7）。
 * 返り値は長い一致から順。呼び出し側が市区町村との積集合を取りながら試す。
 */
export async function lookupTown(
  fetcher: Fetcher,
  shards: ShardsFile,
  input: string,
): Promise<TownHit[]> {
  const key = toKey(input);
  if (!key) return [];

  const kanji = await lookupIndex(fetcher, "oaza", shards.oaza, key);
  const exact = kanji
    .map((h) => ({
      key: h.key,
      entries: h.entries,
      axis: "exact" as const,
      rest: key.slice(h.key.length),
    }))
    .filter((h) => explainsInput(h.key, h.rest));
  if (exact.length) return exact;

  // 第2軸: カナ入力（「たいしどう」）
  const kanaKey = toKanaKey(key);
  const out: TownHit[] = [];
  if (shards.kana?.bounds?.length) {
    const idxK = findShard(shards.kana.bounds, kanaKey);
    let kshard: KanaShard | null = null;
    try {
      kshard = (await fetcher.get(`kana/${idxK}.json`)) as KanaShard;
    } catch {
      kshard = null;
    }
    if (kshard) {
      const hits = Object.keys(kshard)
        .filter((k) => k && kanaKey.startsWith(k))
        .sort((a, b) => b.length - a.length);

      for (const kk of hits) {
        const rest = restAfterKana(key, kk);
        if (rest === null || !explainsInput(kk, rest)) continue;
        // 実体は漢字索引にしかないので参照を解決する
        const entries: TownEntry[] = [];
        for (const ref of kshard[kk] ?? []) {
          const n = findShard(shards.oaza.bounds, ref);
          try {
            const oshard = (await fetcher.get(`oaza/${n}.json`)) as Shard;
            entries.push(...(oshard[ref] ?? []));
          } catch {
            /* シャードが取れなければその参照は諦める */
          }
        }
        if (entries.length) out.push({ key: kk, entries, axis: "kana", rest });
      }
    }
  }
  if (out.length) return out;

  // 第3軸: タイポ許容（§6.2）。同じシャード内しか見ない割り切り。
  // 先頭文字が違うタイポ（瀬田谷）は別シャードなので拾えない
  const idx = findShard(shards.oaza.bounds, key);
  let shard: Shard;
  try {
    shard = (await fetcher.get(`oaza/${idx}.json`)) as Shard;
  } catch {
    return [];
  }
  const cands = Object.keys(shard).map((k) => ({
    key: k,
    value: shard[k] as TownEntry[],
  }));
  return fuzzyPrefix(key, cands)
    .filter((m) => explainsInput(m.key, m.rest))
    .map((m) => ({
      key: m.key,
      entries: m.value,
      axis: "typo" as const,
      rest: m.rest,
      distance: m.distance,
    }));
}
