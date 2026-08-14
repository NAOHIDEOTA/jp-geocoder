/**
 * 索引側のキー展開。DOC.md §5.2
 *
 * ABR の格納順と実際の住所表記がずれるため、前方一致だけでは解けない。
 * 実行時に候補を作ると爆発するのでビルド時に別名を焼き込む。
 *
 *   丁目の省略 … oaza="太子堂" chome="５丁目" → 「太子堂5」
 *   京都の通り名 … oaza="相之町" koaza="綾小路通柳馬場西入"（表記と逆順）
 *                  → 「綾小路通柳馬場西入相之町」
 */
/** 京都の通り名らしさ。「〇〇通△△(上る|下る|東入|西入)」の形 */
const KYOTO_STREET = /通.*(上る|下る|上ル|下ル|東入|西入|東入る|西入る|東入ル|西入ル)/u;
/** 方向語の表記ゆれ。どちらで入力されても当たるよう両方展開する */
const DIRECTION_VARIANTS = [
    [/上る/gu, "上ル"],
    [/下る/gu, "下ル"],
    [/東入る/gu, "東入"],
    [/西入る/gu, "西入"],
    [/東入ル/gu, "東入"],
    [/西入ル/gu, "西入"],
];
/** 丁目（漢数字は toKey で数字化されるのでここでは両方受ける） */
const CHOME = /^([0-9０-９〇零一壱二弐三参四五六七八九十百千]+)丁目$/u;
/** 索引に載せるキーを返す。先頭が正式表記、以降が別名 */
export function expandAliases(parts) {
    const oaza = parts.oaza ?? "";
    const chome = parts.chome ?? "";
    const koaza = parts.koaza ?? "";
    const out = [];
    const seen = new Set();
    const push = (name, guard) => {
        if (!name || seen.has(name))
            return;
        seen.add(name);
        out.push(guard ? { name, guard } : { name });
    };
    // 1. 正式表記（ABR の格納順）
    push(`${oaza}${chome}${koaza}`);
    // 2. 丁目の省略「太子堂5」
    const m = CHOME.exec(chome);
    if (m?.[1] && !koaza)
        push(`${oaza}${m[1]}`, "nodigit");
    // 3. 京都の通り名: 「通り名 + 町名」の順に組み替える
    if (koaza && KYOTO_STREET.test(koaza)) {
        const forms = new Set([koaza]);
        for (const [re, to] of DIRECTION_VARIANTS) {
            for (const f of [...forms])
                if (re.test(f))
                    forms.add(f.replace(re, to));
        }
        for (const f of forms) {
            push(`${f}${oaza}${chome}`);
            // 町名を省いて通り名だけで入力されることもある
            push(f);
        }
    }
    return out;
}
//# sourceMappingURL=aliases.js.map