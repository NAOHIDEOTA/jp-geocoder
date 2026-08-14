/**
 * カナキー（第2軸）の生成。DOC.md §5.5 / §7
 *
 * タイポの大半は IME 誤変換なので、漢字より読みのほうが当たる（世田谷/瀬田谷）。
 *
 * キーは2段階。濁点まで潰すと別地点を取り違えるため（新川町/陣川町が8.5km）:
 *   toKanaKey      … 濁点を保持。スコア 0.90
 *   toKanaLooseKey … 濁点も潰す。最後の手段
 */
const SEION = {
    が: "か",
    ぎ: "き",
    ぐ: "く",
    げ: "け",
    ご: "こ",
    ざ: "さ",
    じ: "し",
    ず: "す",
    ぜ: "せ",
    ぞ: "そ",
    だ: "た",
    ぢ: "ち",
    づ: "つ",
    で: "て",
    ど: "と",
    ば: "は",
    び: "ひ",
    ぶ: "ふ",
    べ: "へ",
    ぼ: "ほ",
    ぱ: "は",
    ぴ: "ひ",
    ぷ: "ふ",
    ぺ: "へ",
    ぽ: "ほ",
    ゔ: "う",
};
const SMALL = {
    ぁ: "あ",
    ぃ: "い",
    ぅ: "う",
    ぇ: "え",
    ぉ: "お",
    っ: "つ",
    ゃ: "や",
    ゅ: "ゆ",
    ょ: "よ",
    ゎ: "わ",
};
const ARCHAIC = {
    ゐ: "い",
    ゑ: "え",
    を: "お",
};
/** カタカナ（U+30A1–U+30F6）をひらがなに落とす */
function katakanaToHiragana(input) {
    return input.replace(/[ァ-ヶ]/gu, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}
/**
 * カナキー（第2軸）。ABR の `*_kana` 列を通して索引に載せる。
 * 潰す: カタカナ→ひらがな / 長音 / 促音 / 拗音 / ヶヵ / 旧仮名。濁点は潰さない。
 */
export function toKanaKey(input) {
    let s = katakanaToHiragana(input.normalize("NFKC"));
    s = s.replace(/[ー―‐−–—・･\s　]/gu, ""); // 長音・区切り
    s = s.replace(/[ヶヵゕゖ]/gu, ""); // ケ・カの小書き
    let out = "";
    for (const c of s) {
        out += ARCHAIC[c] ?? SMALL[c] ?? c;
    }
    return out;
}
/** 清音キー（第3軸）。第2軸で当たらないときだけ使い、スコアを下げること */
export function toKanaLooseKey(input) {
    let out = "";
    for (const c of toKanaKey(input))
        out += SEION[c] ?? c;
    return out;
}
//# sourceMappingURL=kana.js.map