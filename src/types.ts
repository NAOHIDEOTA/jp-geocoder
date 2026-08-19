/**
 * 公開APIの型定義。DOC.md §8.5 で凍結済み。
 * フィールドの削除・意味変更は major バンプ必須。
 */

/** どこまで解決できたか（粒度）。DOC.md §8.3 */
export type MatchLevel =
  | "rsdt" // 号（住居表示）
  | "block" // 番（街区）
  | "parcel" // 筆（地番）
  | "oaza" // 町字
  | "city" // 市区町村
  | "pref"; // 都道府県

/** 住居表示系か地番系か。入力文字列では判別できず、町字の rsdtFlag で決まる */
export type AddressSystem = "residential" | "parcel";

/**
 * その座標がどれだけ信用できるか（品質）。DOC.md §8.3
 * - surveyed:       測量済み（法14条地図・住居表示の実測点）
 * - legacy:         公図（旧土地台帳附属地図）由来。数十m〜百mずれうる
 * - representative: 代表点。その階層の中心であって、探した対象の点ではない
 */
export type Accuracy = "surveyed" | "legacy" | "representative";

/**
 * 住所の分割結果。名称は半角数字に統一済み・数値項目はすべて number。
 * 入力に無かった階層も、解決結果から一意に定まるものは補完する（例: pref）。
 */
export interface AddressComponents {
  /** 都道府県。入力で省略されても解決した市区町村から補完される */
  pref?: string;
  city?: string;
  ward?: string;
  county?: string;
  /** 大字。丁目・小字は含まない（「太子堂五丁目」→ oaza: "太子堂", chome: 5） */
  oaza?: string;
  koaza?: string;
  /** 丁目（数値） */
  chome?: number;
  block?: number;
  rsdt?: number;
  /** 地番。ABR の prc_num1/2/3 に対応。枝番が無ければ省略 */
  parcel?: number[];
}

export interface Candidate {
  /** 正規化された表記の住所 */
  address: string;
  lat: number;
  lng: number;
  matchLevel: MatchLevel;
  system: AddressSystem;
  accuracy: Accuracy;
  /** 一致率 0.0〜1.0 */
  score: number;
  /** 切り離した建物名・部屋番号 */
  building?: string;
  components: AddressComponents;
  /** ABR の町字ID */
  machiazaId?: string;
}

export interface GeocodeResult {
  candidates: Candidate[];
  /** 出典表示。省略不可（DOC.md §2） */
  attribution: string[];
}

/**
 * データアクセスの唯一の境界。DOC.md §3.3
 * 静的fetch版 / D1版 / オフライン版をこの1点で差し替える。
 */
export interface Fetcher {
  get(path: string): Promise<unknown>;
}

/**
 * 政令指定都市の行政区をどう並べるか。政令市以外の出力は影響を受けない。
 * - "wards"  … 行政区ごとに1件（ward は常に1要素）。横浜市なら18件並ぶ
 * - "nested" … 市を1件にまとめ、ward に全区を並べる
 */
export type DesignatedCityMode = "wards" | "nested";

/** 市区町村一覧の1件 */
export interface Municipality {
  /** 市区町村名。行政区は市名（「横浜市」）になり、区名は ward に入る */
  municipality: string;
  /** 政令指定都市の行政区。政令市以外では省略される */
  ward?: string[];
}

export interface MunicipalityOptions {
  /** 政令指定都市の扱い。既定 "wards" */
  designatedCity?: DesignatedCityMode;
}

export interface MunicipalitiesResult {
  /** 団体コード順。該当する都道府県が無ければ空配列 */
  municipalities: Municipality[];
  /** 出典表示。省略不可（DOC.md §2） */
  attribution: string[];
}

export interface GeocoderOptions {
  /** 配信元。省略すると DEFAULT_BASE_URL（自前で配信する場合だけ指定する） */
  baseUrl?: string;
  fetcher?: Fetcher;
  /** 返す候補の最大数。既定 5 */
  limit?: number;
}

export interface Geocoder {
  geocode(address: string): Promise<GeocodeResult>;
  /**
   * 都道府県に属する市区町村の一覧を返す。
   * @param pref 都道府県コード（1〜47 / "01"〜"47"）または名称（"神奈川県" / "神奈川"）
   */
  listMunicipalities(
    pref: string | number,
    options?: MunicipalityOptions,
  ): Promise<MunicipalitiesResult>;
}
