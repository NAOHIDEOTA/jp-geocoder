/**
 * 市区町村インデックス。DOC.md §4.2 / §6.1
 * cities.json は唯一メモリ常駐する索引（約1,965件）。キーは配信物に焼き込み済み。
 */
/** cities.json を consumeLongest に渡せる DictEntry の形に包む */
export class CityIndex {
    records;
    entries = [];
    index = new Map();
    constructor(file) {
        this.records = file.cities;
        for (const c of file.cities)
            this.index.set(c.code, c);
        for (const c of file.cities) {
            if (c.level === "pref")
                continue; // 都道府県は pref.ts が担当する
            // 漢字とカナは同じエントリに持たせる。別エントリ（key:""）だと
            // consumeAll が key しか見ず、cities.json の23.7%が死にデータになる
            const kana = c.kk?.[0];
            for (const key of c.k) {
                this.entries.push(kana ? { key, kana, value: c } : { key, value: c });
            }
            for (const extra of (c.kk ?? []).slice(1)) {
                this.entries.push({ key: "", kana: extra, value: c });
            }
        }
    }
    /** 都道府県で絞った候補（未指定なら全件） */
    candidates(prefCode) {
        if (!prefCode)
            return this.entries;
        return this.entries.filter((e) => e.value.pref === prefCode);
    }
    /** 都道府県レコード（座標を返すために使う）。都道府県はコード2桁 */
    pref(code) {
        const c = this.index.get(code);
        return c?.level === "pref" ? c : undefined;
    }
    byCode(code) {
        return this.index.get(code);
    }
}
//# sourceMappingURL=cities.js.map