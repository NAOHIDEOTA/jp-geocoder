/**
 * 漢数字 ↔ アラビア数字の相互変換。DOC.md §5.2
 * 「五十六」（位取り）と「五六」（桁並べ）の両方が住所に現れる。
 */
const DIGITS = {
    〇: 0,
    零: 0,
    一: 1,
    壱: 1,
    二: 2,
    弐: 2,
    三: 3,
    参: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
};
const UNITS = { 十: 10, 百: 100, 千: 1000 };
const KANJI_NUM_RE = /[〇零一壱二弐三参四五六七八九十百千]+/gu;
/**
 * 漢数字の連なり1つを数値に変換する。
 * 「二十三」→23、「十」→10、「三百」→300、「二三」→23（位取りなし）
 */
export function kanjiToNumber(kanji) {
    if (!kanji)
        return null;
    const hasUnit = [...kanji].some((c) => c in UNITS);
    if (!hasUnit) {
        // 位取り記号なし: 桁の並びとして読む（〇一二 → 012 → 12）
        let out = "";
        for (const c of kanji) {
            const d = DIGITS[c];
            if (d === undefined)
                return null;
            out += String(d);
        }
        return out === "" ? null : Number(out);
    }
    let total = 0;
    let current = 0;
    for (const c of kanji) {
        const d = DIGITS[c];
        const u = UNITS[c];
        if (d !== undefined) {
            current = current * 10 + d;
        }
        else if (u !== undefined) {
            total += (current === 0 ? 1 : current) * u;
            current = 0;
        }
        else {
            return null;
        }
    }
    return total + current;
}
/** 文字列中の漢数字をすべてアラビア数字に置き換える */
export function kanjiNumeralsToArabic(input) {
    return input.replace(KANJI_NUM_RE, (m) => {
        const n = kanjiToNumber(m);
        return n === null ? m : String(n);
    });
}
const KANJI_DIGITS = [
    "〇",
    "一",
    "二",
    "三",
    "四",
    "五",
    "六",
    "七",
    "八",
    "九",
];
/**
 * アラビア数字 → 漢数字。表示用。
 * ABR の chome は全角数字と漢数字が混在するので、慣例の漢数字に寄せる。
 */
export function numberToKanji(n) {
    if (!Number.isFinite(n) || n < 0)
        return String(n);
    if (n === 0)
        return "〇";
    if (n < 10)
        return KANJI_DIGITS[n];
    if (n < 100) {
        const t = Math.floor(n / 10);
        const o = n % 10;
        return `${t === 1 ? "" : KANJI_DIGITS[t]}十${o ? KANJI_DIGITS[o] : ""}`;
    }
    if (n < 1000) {
        const h = Math.floor(n / 100);
        const r = n % 100;
        return `${h === 1 ? "" : KANJI_DIGITS[h]}百${r ? numberToKanji(r) : ""}`;
    }
    return String(n);
}
/** 「５丁目」「5丁目」→「五丁目」。丁目以外は触らない */
export function normalizeChomeDisplay(chome) {
    if (!chome)
        return chome;
    const m = /^([0-9０-９]+)(丁目|丁)$/u.exec(chome
        .normalize("NFKC")
        .replace(/[０-９]/gu, (c) => String(c.charCodeAt(0) - 0xff10)));
    if (!m)
        return chome;
    return `${numberToKanji(Number(m[1]))}${m[2]}`;
}
//# sourceMappingURL=numbers.js.map