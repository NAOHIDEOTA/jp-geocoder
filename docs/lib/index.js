export { createGeocoder, ATTRIBUTION, CITY_ATTRIBUTION, DEFAULT_BASE_URL, } from "./geocode.js";
export { createHttpFetcher } from "./fetcher/httpFetcher.js";
// 正規化まわりは索引ビルドや利用側の前処理でも使うため公開する
export { toKey, normalizeBanchi } from "./core/normalize.js";
export { toKanaKey, toKanaLooseKey } from "./core/kana.js";
export { expandAliases } from "./core/aliases.js";
// 都道府県の解決（コード・名称どちらからでも引ける）
export { resolvePref, PREFECTURES } from "./core/pref.js";
//# sourceMappingURL=index.js.map