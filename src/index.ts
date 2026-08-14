export type {
  Accuracy,
  AddressComponents,
  AddressSystem,
  Candidate,
  Fetcher,
  Geocoder,
  GeocoderOptions,
  GeocodeResult,
  MatchLevel,
} from "./types.js";

export type { CityLevel, CityRecord, CitiesFile } from "./core/cities.js";

export { createGeocoder, ATTRIBUTION, DEFAULT_BASE_URL } from "./geocode.js";
export { createHttpFetcher } from "./fetcher/httpFetcher.js";

// 正規化まわりは索引ビルドや利用側の前処理でも使うため公開する
export { toKey, normalizeBanchi } from "./core/normalize.js";
export { toKanaKey, toKanaLooseKey } from "./core/kana.js";
export { expandAliases } from "./core/aliases.js";
