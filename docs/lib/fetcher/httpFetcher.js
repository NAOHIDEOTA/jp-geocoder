/**
 * 既定の Fetcher。CDN 上の静的JSONを取りに行くだけ。
 * fetch さえあれば Node / ブラウザ / Workers のどこでも動く（DOC.md §1.2）。
 * 圧縮は配信側（Pages）が行い、ランタイムが透過的に解凍する。
 */
export function createHttpFetcher(baseUrl) {
    const base = baseUrl.replace(/\/$/, "");
    const cache = new Map();
    return {
        get(path) {
            const key = path.replace(/^\//, "");
            let hit = cache.get(key);
            if (!hit) {
                hit = fetch(`${base}/${key}`).then((res) => {
                    if (!res.ok)
                        throw new Error(`fetch ${key} -> ${res.status}`);
                    return res.json();
                });
                cache.set(key, hit);
            }
            return hit;
        },
    };
}
//# sourceMappingURL=httpFetcher.js.map