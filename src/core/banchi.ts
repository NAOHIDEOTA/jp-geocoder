/**
 * 番地のトークナイズと建物名・部屋番号の切り離し。DOC.md §5.2 / §5.4
 *
 * ここでは丁目/番/号の意味づけをしない。「1-2-3」の先頭が丁目か番かは
 * 町字が丁目を持つか（＝辞書）で決まるため（§5.1）。割り当ては呼び出し側の仕事。
 */

import { kanjiNumeralsToArabic } from "./numbers.js";

/** 明示的に書かれていた単位。無印は unit: undefined */
export type BanchiUnit = "chome" | "ban" | "go" | "jo" | "chiwari";

export interface BanchiToken {
  value: number;
  unit?: BanchiUnit;
}

export interface ParsedTail {
  tokens: BanchiToken[];
  /** 切り離した建物名・部屋番号（DOC.md §5.4）。無ければ undefined */
  building?: string;
  /** 番地として解釈しなかった残り（通常は空） */
  rest: string;
}

/** 住居表示は丁目-番-号の3階層、地番も prc_num1/2/3 の3つまで。4つ目以降は部屋番号 */
const MAX_TOKENS = 3;

const UNIT_MAP: Readonly<Record<string, BanchiUnit>> = {
  丁目: "chome",
  丁: "chome",
  番地: "ban",
  番: "ban",
  号: "go",
  条: "jo",
  地割: "chiwari",
};

/** 建物名の始まりを示す語。「3号」（住所）と「301号室」（建物内）を分ける */
const BUILDING_HINT =
  /(ビル|ビルヂング|マンション|ハイツ|コーポ|アパート|レジデンス|タワー|プラザ|パレス|メゾン|荘|棟|館|号室|階|F$|Ｆ|ハウス|テラス|ガーデン|コート|ヴィラ|パーク)/u;

/** 番地として読める連なり */
const RUN =
  /^[0-9]+(?:\s*(?:丁目|丁|番地の|番地|番|号|条|地割|の|ノ|之|[-ー―‐−–—])\s*[0-9]*)*/u;

/**
 * 町字を解決した残りを、番地トークン列と建物名に分ける。
 *   "1丁目2番3号"     → [1:chome, 2:ban, 3:go]
 *   "3-1-1○○ビル3F" → [3, 1, 1] + building "○○ビル3F"
 *   "5-5-5-301"      → [5, 5, 5] + building "301"（4つ目は部屋番号）
 */
export function parseTail(input: string): ParsedTail {
  const s = kanjiNumeralsToArabic(input.normalize("NFKC")).replace(
    /[\s　]/gu,
    "",
  );

  const m = RUN.exec(s);
  if (!m || !m[0]) {
    return { tokens: [], rest: "", ...(s ? { building: s } : {}) };
  }

  const run = m[0];
  let after = s.slice(run.length);

  // 数字と、その直後に書かれていた単位を拾う
  const tokens: BanchiToken[] = [];
  const re = /([0-9]+)\s*(丁目|丁|番地|番|号|条|地割)?/gu;
  let t: RegExpExecArray | null;
  while ((t = re.exec(run)) !== null) {
    const value = Number(t[1]);
    if (!Number.isFinite(value)) continue;
    const unit = t[2] ? UNIT_MAP[t[2]] : undefined;
    tokens.push(unit ? { value, unit } : { value });
  }

  // 4つ目以降は部屋番号として建物側へ回す（住所は3階層まで）
  const overflow = tokens.splice(MAX_TOKENS);
  if (overflow.length) {
    after = overflow.map((x) => x.value).join("-") + after;
  }

  const building = after.replace(/^[-ー―‐−–—の]/u, "").trim();
  return {
    tokens,
    rest: "",
    ...(building ? { building } : {}),
  };
}

/** parseTail が切り出した残りが本当に建物名かの確認（§5.4） */
export function looksLikeBuilding(s: string): boolean {
  if (!s) return false;
  if (BUILDING_HINT.test(s)) return true;
  // 数字のみなら部屋番号とみなす
  return /^[0-9]+$/u.test(s);
}
