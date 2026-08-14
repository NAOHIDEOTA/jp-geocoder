/**
 * 前方一致で削り取る枠組み。DOC.md §5.1
 *
 * 「どこまでが町名でどこからが番地か」は辞書を引かないと決まらない。
 * 候補集合を渡して最長一致を取る形にし、候補の供給元（fetcher）と切り離す。
 */

import { toKey } from "./normalize.js";
import { toKanaKey, toKanaLooseKey } from "./kana.js";

/**
 * 辞書のエントリ。key / kana は正規化済みでなければならない（§5.2）。
 * 実行時に正規化すると候補件数ぶんの変換が毎回走り §6.2 の速度目標を壊す。
 */
export interface DictEntry<T> {
  /** 漢字キー（第1軸）。`toKey()` 済み */
  key: string;
  /** カナキー（第2軸）。`toKanaKey()` 済み。読みが無い場合は undefined */
  kana?: string;
  /** 直後が数字なら無効。「太子堂5」が「太子堂50番地」に当たるのを防ぐ */
  guard?: "nodigit";
  value: T;
}

/** 生の表記から辞書エントリを作る。ビルドとテスト専用（実行時に使わない） */
export function toEntry<T>(
  name: string,
  value: T,
  kana?: string,
  guard?: "nodigit",
): DictEntry<T> {
  const e: DictEntry<T> = { key: toKey(name), value };
  if (kana) e.kana = toKanaKey(kana);
  if (guard) e.guard = guard;
  return e;
}

/** 別名キーを展開して索引エントリ群を作る。aliases.ts と対で使う */
export function toEntries<T>(
  aliases: readonly { name: string; guard?: "nodigit" }[],
  value: T,
  kana?: string,
): DictEntry<T>[] {
  return aliases.map((a) => toEntry(a.name, value, kana, a.guard));
}

/** 一致の種類。スコアは DOC.md §7 */
export type MatchKind = "exact" | "kana" | "kanaLoose";

export const MATCH_SCORE: Readonly<Record<MatchKind, number>> = {
  exact: 1.0,
  kana: 0.9,
  kanaLoose: 0.7,
};

export interface ConsumeResult<T> {
  value: T;
  kind: MatchKind;
  score: number;
  /** 一致した長さ（正規化キー上） */
  matched: number;
  /** 残り（正規化キー） */
  rest: string;
}

/**
 * 前方一致するエントリのうち最長のものを返す。
 * 「一番町」と「一番町一丁目」で短い方を採ると残りが「一丁目」になり丁目解決を誤る。
 * 漢字 → カナ → 清音の順に落とす。
 */
export function consumeLongest<T>(
  input: string,
  entries: Iterable<DictEntry<T>>,
  kanaInput?: string,
): ConsumeResult<T> | null {
  const key = toKey(input);
  const kana = kanaInput === undefined ? undefined : toKanaKey(kanaInput);
  const loose =
    kana === undefined ? undefined : toKanaLooseKey(kanaInput as string);

  let best: ConsumeResult<T> | null = null;

  const better = (a: ConsumeResult<T>, b: ConsumeResult<T> | null): boolean =>
    b === null ||
    a.matched > b.matched ||
    (a.matched === b.matched && a.score > b.score);

  for (const e of entries) {
    let hit: { kind: MatchKind; matched: number; rest: string } | null = null;

    if (e.key && key.startsWith(e.key)) {
      const rest = key.slice(e.key.length);
      // 別名キーの直後が数字なら一致とみなさない
      if (!(e.guard === "nodigit" && /^[0-9]/u.test(rest))) {
        hit = { kind: "exact", matched: e.key.length, rest };
      }
    }
    if (!hit && e.kana && kana && kana.startsWith(e.kana)) {
      hit = {
        kind: "kana",
        matched: e.kana.length,
        rest: kana.slice(e.kana.length),
      };
    }
    if (!hit && e.kana && loose) {
      const el = toKanaLooseKey(e.kana);
      if (el && loose.startsWith(el)) {
        hit = {
          kind: "kanaLoose",
          matched: el.length,
          rest: loose.slice(el.length),
        };
      }
    }

    if (!hit) continue;
    const cand: ConsumeResult<T> = {
      value: e.value,
      kind: hit.kind,
      score: MATCH_SCORE[hit.kind],
      matched: hit.matched,
      rest: hit.rest,
    };
    if (better(cand, best)) best = cand;
  }

  return best;
}

/**
 * 前方一致するエントリをすべて返す（最長優先）。
 * 「中央区」が12市にあるようなケースで1件に絞らないため（§6.4）。
 */
export function consumeAll<T>(
  input: string,
  entries: Iterable<DictEntry<T>>,
): ConsumeResult<T>[] {
  const key = toKey(input);
  const list = [...entries];
  const out: ConsumeResult<T>[] = [];

  for (const e of list) {
    if (e.key && key.startsWith(e.key)) {
      if (e.guard === "nodigit" && /^[0-9]/u.test(key.slice(e.key.length)))
        continue;
      out.push({
        value: e.value,
        kind: "exact",
        score: MATCH_SCORE.exact,
        matched: e.key.length,
        rest: key.slice(e.key.length),
      });
    }
  }
  if (out.length) return out.sort((a, b) => b.matched - a.matched);

  // 漢字キーで1件も当たらなければカナに落とす（「せたがやくたいしどう5-5-5」）
  const kana = toKanaKey(key);
  for (const e of list) {
    if (!e.kana || !kana.startsWith(e.kana)) continue;
    const rest = restAfterKana(key, e.kana);
    if (rest === null) continue;
    out.push({
      value: e.value,
      kind: "kana",
      score: MATCH_SCORE.kana,
      matched: e.kana.length,
      rest,
    });
  }
  return out.sort((a, b) => b.matched - a.matched);
}

/** カナで一致したときの消費長。カナ化で文字数が変わるため一致長は使えない */
function restAfterKana(input: string, kanaKey: string): string | null {
  for (let i = input.length; i > 0; i--) {
    if (toKanaKey(input.slice(0, i)) === kanaKey) return input.slice(i);
  }
  return null;
}
