/**
 * 都道府県の切り出し。47件は固定なのでデータ非依存で持てる（Step 1 の範囲）。
 * 市区町村以下は fetcher 経由の辞書で解く。
 */

import { toKey } from "./normalize.js";

/** コード順。`都/道/府/県` を含む正式名 */
export const PREFECTURES: readonly (readonly [string, string])[] = [
  ["01", "北海道"],
  ["02", "青森県"],
  ["03", "岩手県"],
  ["04", "宮城県"],
  ["05", "秋田県"],
  ["06", "山形県"],
  ["07", "福島県"],
  ["08", "茨城県"],
  ["09", "栃木県"],
  ["10", "群馬県"],
  ["11", "埼玉県"],
  ["12", "千葉県"],
  ["13", "東京都"],
  ["14", "神奈川県"],
  ["15", "新潟県"],
  ["16", "富山県"],
  ["17", "石川県"],
  ["18", "福井県"],
  ["19", "山梨県"],
  ["20", "長野県"],
  ["21", "岐阜県"],
  ["22", "静岡県"],
  ["23", "愛知県"],
  ["24", "三重県"],
  ["25", "滋賀県"],
  ["26", "京都府"],
  ["27", "大阪府"],
  ["28", "兵庫県"],
  ["29", "奈良県"],
  ["30", "和歌山県"],
  ["31", "鳥取県"],
  ["32", "島根県"],
  ["33", "岡山県"],
  ["34", "広島県"],
  ["35", "山口県"],
  ["36", "徳島県"],
  ["37", "香川県"],
  ["38", "愛媛県"],
  ["39", "高知県"],
  ["40", "福岡県"],
  ["41", "佐賀県"],
  ["42", "長崎県"],
  ["43", "熊本県"],
  ["44", "大分県"],
  ["45", "宮崎県"],
  ["46", "鹿児島県"],
  ["47", "沖縄県"],
];

interface Entry {
  code: string;
  name: string;
  /** 正式名（都/道/府/県つき）で登録されたか */
  full: boolean;
}

/** 正規化キー → Entry。「東京」のような接尾辞なしも引けるようにする */
const INDEX = new Map<string, Entry>();
for (const [code, name] of PREFECTURES) {
  INDEX.set(toKey(name), { code, name, full: true });
  // 「北海道」以外は接尾辞を落とした形も登録（東京 / 大阪 / 神奈川 …）
  if (name !== "北海道")
    INDEX.set(toKey(name.slice(0, -1)), { code, name, full: false });
}

/** 「京都市中京区」を「京都府 + 市中京区」と切らないためのガード */
const CITY_SUFFIX = /^[市区町村郡]/u;

export interface PrefMatch {
  code: string;
  name: string;
  /** 都道府県を取り除いた残り */
  rest: string;
}

/**
 * 先頭から都道府県を1つ削り取る。無ければ null（省略は正常。DOC.md §6.1）。
 * 最長一致を取る（「京都府」を「京都」で切らない）。
 */
export function consumePref(input: string): PrefMatch | null {
  const key = toKey(input);
  let best: { entry: Entry; len: number } | null = null;

  for (const [k, entry] of INDEX) {
    if (!key.startsWith(k)) continue;
    // 接尾辞なしの一致は、直後が市区町村の接尾辞なら採用しない
    if (!entry.full && CITY_SUFFIX.test(key.slice(k.length))) continue;
    if (best === null || k.length > best.len) best = { entry, len: k.length };
  }
  if (!best) return null;

  return {
    code: best.entry.code,
    name: best.entry.name,
    rest: key.slice(best.len),
  };
}

/**
 * 都道府県そのものを1つに解決する（consumePref と違い、残りがあれば不成立）。
 *
 * 受け付ける形:
 *   - コード … 1〜47 / "01"〜"47"（全角数字も可）
 *   - 名称   … "神奈川県" / "神奈川"（接尾辞の有無どちらも）
 *
 * 解決できなければ null。「東京都渋谷区」のように都道府県より下が続くものは
 * 都道府県の指定ではないので null を返す。
 */
export function resolvePref(
  input: string | number,
): { code: string; name: string } | null {
  const raw = String(input).normalize("NFKC").trim();
  if (!raw) return null;

  if (/^\d{1,2}$/.test(raw)) {
    const code = raw.padStart(2, "0");
    const found = PREFECTURES.find(([c]) => c === code);
    return found ? { code: found[0], name: found[1] } : null;
  }

  const match = consumePref(raw);
  if (!match || match.rest !== "") return null;
  return { code: match.code, name: match.name };
}
