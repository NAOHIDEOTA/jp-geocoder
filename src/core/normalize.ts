/**
 * 正規化キーの生成。DOC.md §5.2
 *
 * 索引側（ビルド時）と入力側（実行時）の両方に通し、同じキー空間に落とす。
 * 片方だけ変えると全データ再生成になる。
 */

import { unifyVariants } from "./variants.js";
import { kanjiNumeralsToArabic } from "./numbers.js";

/** 空白・区切り記号（住所の意味を持たないもの） */
const NOISE = /[\s　,、，．.·・･]/gu;

/**
 * 送り字は削除せず統一する（霞ヶ関/霞が関 → 霞ケ関）。
 * 削除すると 中島/中ノ島（19km）・岩崎/岩ケ崎（31km）が同じキーに落ちる。
 */
const UNIFY_KE = new Set(["ヶ", "ケ", "ヵ", "カ", "が", "ガ", "ゕ", "ゖ"]);
const UNIFY_NO = new Set(["の", "ノ", "之"]);

/** カタカナ語の一部にはなりえない小書き。文脈を見ずに寄せてよい */
const ALWAYS_KE = new Set(["ヶ", "ヵ", "ゕ", "ゖ"]);

const HAN_OR_DIGIT = /[\p{Script=Han}0-9]/u;

/**
 * 語中の「ヶ」類・「ノ」類を統一する。
 * 前後が漢字・数字のときだけ。でないとカタカナ地名を壊す（アカシア通 → アケシア通）。
 */
function unifyInterstitial(input: string): string {
  const chars = [...input];
  if (chars.length <= 2) return input;

  let out = chars[0] ?? "";
  for (let i = 1; i < chars.length - 1; i++) {
    const c = chars[i] as string;
    if (ALWAYS_KE.has(c)) {
      out += "ケ";
      continue;
    }
    if (UNIFY_KE.has(c) || UNIFY_NO.has(c)) {
      const prev = chars[i - 1] as string;
      const next = chars[i + 1] as string;
      if (HAN_OR_DIGIT.test(prev) && HAN_OR_DIGIT.test(next)) {
        out += UNIFY_KE.has(c) ? "ケ" : "ノ";
        continue;
      }
    }
    out += c;
  }
  return out + (chars[chars.length - 1] ?? "");
}

/**
 * 漢字キー（第1軸）。
 * 送り字の統一が漢数字変換より先。逆にすると「一ノ関」が「1ノ関」になり一致しなくなる。
 */
export function toKey(input: string): string {
  let s = input.normalize("NFKC");
  s = s.replace(NOISE, "");
  s = unifyVariants(s);
  s = unifyInterstitial(s);
  s = kanjiNumeralsToArabic(s);
  return s;
}

/**
 * 送り字を統一しないキー。候補が複数出たとき入力どおりの表記を優先するのに使う。
 * 統一すると同一市区町村内の別の町字を535件潰す（上戸町南方カ字 と 上戸町南方ケ字）。
 */
export function toExactKey(input: string): string {
  let s = input.normalize("NFKC");
  s = s.replace(NOISE, "");
  s = unifyVariants(s);
  s = kanjiNumeralsToArabic(s);
  return s;
}

/** 町字名の一部ではありえない接尾辞。番地の切り出しに使う */
export const ADDRESS_SUFFIX = /(丁目|丁|番地の|番地|番|号|地割|条|線)/u;

/** 番地の区切りを `-` に統一する（1丁目2番3号 / 1の2の3 → 1-2-3） */
export function normalizeBanchi(input: string): string {
  return kanjiNumeralsToArabic(input.normalize("NFKC"))
    .replace(/丁目|丁|番地の|番地|番|号|の|ノ|之/gu, "-")
    .replace(/[ー―‐−–—]/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "");
}
