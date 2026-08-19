# jp-geocoder

[![npm version](https://img.shields.io/npm/v/jp-geocoder.svg)](https://www.npmjs.com/package/jp-geocoder)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![GitHub](https://img.shields.io/github/stars/NAOHIDEOTA/jp-geocoder?style=social)](https://github.com/NAOHIDEOTA/jp-geocoder)

日本の住所文字列を緯度経度に変換する **サーバ不要・DB不要・APIキー不要** のジオコーディングライブラリ。

国のオープンデータから生成した静的 JSON を CDN に置き、住所の階層に沿って 2〜5 回 fetch するだけで解決します。

**[Live Demo](https://naohideota.github.io/jp-geocoder/docs/)**

## Features

- **サーバレス** — DB も API サーバも持たない。静的 JSON への fetch だけで動く
- **軽い** — パッケージはコードのみでデータ非同梱。1検索で読むのは数十〜数百KB、CDNキャッシュ時 100〜200ms（実測）
- **住所の分割結果つき** — 都道府県・市区町村・大字・丁目・番・号を構造化して返す
- **市区町村の一覧が引ける** — 都道府県から市区町村を列挙できる（フォームの選択肢用）
- **最寄り駅が引ける** — 全国 10,465駅。住所を渡せば座標を経由して最寄り駅まで一気に出せる
- **表記揺れに強い** — 異体字・ヶケ・漢数字・カナ入力・タイポ・旧市町村名を吸収
- **正直な精度申告** — どこまで解決できたか（`matchLevel`）と座標の品質（`accuracy`）を必ず返す
- **TypeScript** — 完全な型定義付き
- Node.js 20+ / ブラウザ / Cloudflare Workers（`fetch` があれば動く）

> **状態**: npm 未公開（準備中）

## Installation

```bash
npm install jp-geocoder
```

## Quick Start

```ts
import { createGeocoder } from "jp-geocoder";

const geocoder = createGeocoder();
const result = await geocoder.geocode("東京都世田谷区太子堂5-5-5");
```

```json
{
  "candidates": [
    {
      "address": "東京都世田谷区太子堂五丁目5番5号",
      "lat": 35.646194,
      "lng": 139.668013,
      "matchLevel": "rsdt",
      "accuracy": "surveyed",
      "score": 1,
      "system": "residential",
      "machiazaId": "0038005",
      "components": {
        "pref": "東京都",
        "city": "世田谷区",
        "oaza": "太子堂",
        "chome": 5,
        "block": 5,
        "rsdt": 5
      }
    }
  ],
  "attribution": ["デジタル庁 アドレス・ベース・レジストリ", "..."]
}
```

### データの置き場

住所データ（全国約1億2,000万点・約2GB）は Cloudflare Pages 上の静的 JSON として
**`https://jp-geocoder.pages.dev/v1`** に置いてあり、既定でここを参照します。URL の指定は不要です。

ライブラリは住所の階層に沿って索引を辿るので、**全体をダウンロードすることはありません**。
1回の検索で取得するのは該当する索引ファイル 2〜5 個（数十〜数百KB）だけで、CDN と HTTP キャッシュがそのまま効きます。

## Examples

あえて難しい入力の例。すべて実測で確認済みです。

| 入力                                 | 結果                       | 対応している機構 |
| ------------------------------------ | -------------------------- | ---------------- |
| `太子堂5-5-5`                        | 世田谷区太子堂五丁目5番5号 | 市区町村の省略   |
| `世田ヶ谷区太子道5-5-5`              | 世田谷区太子堂五丁目5番5号 | タイポ（2箇所）  |
| `せたがやくたいしどう5-5-5`          | 世田谷区太子堂五丁目5番5号 | カナ入力         |
| `中央区銀座四丁目五番六号`           | 中央区銀座四丁目5番6号     | 漢数字           |
| `清水市旭町6-8`                      | 静岡市清水区旭町6番8号     | 消滅した市町村名 |
| `京都市下京区四条通烏丸東入長刀鉾町` | 長刀鉾町四条通烏丸東入     | 京都の通り名     |
| `札幌市北区北12条西3丁目1-1`         | 北12条西三丁目1番1号       | 条丁目           |
| `岩手県花巻市石鳥谷町好地第3地割20`  | 石鳥谷町好地第3地割20番地  | 岩手の地割       |
| `長野県茅野市湖東243`                | 湖東243番地                | 地番             |

タイポは編集距離1まで許容しますが、**数字は完全一致のみ**です（`1丁目` と `2丁目` を混同しません）。

## API Reference

### `createGeocoder(options?)`

| Option    | Default      | Description                                    |
| --------- | ------------ | ---------------------------------------------- |
| `baseUrl` | 公式の配信元 | 自分でデータを配信する場合だけ指定する         |
| `limit`   | `5`          | 返す候補の最大数                               |
| `fetcher` | HTTP fetch   | データ取得の差し替え口（テスト・オフライン用） |

### `geocoder.geocode(address)`

`Promise<GeocodeResult>` を返します。候補（`Candidate`）のフィールド:

| Field        | Type      | Description                                         |
| ------------ | --------- | --------------------------------------------------- |
| `address`    | `string`  | 正規化された住所表記                                |
| `lat` `lng`  | `number`  | 緯度経度（JGD2011）                                 |
| `matchLevel` | 下表      | **どこまで解決できたか**                            |
| `accuracy`   | 下表      | **その座標の品質**                                  |
| `score`      | `number`  | 一致率 0〜1（完全一致 1.0 / カナ 0.9 / タイポ 0.6） |
| `components` | 下表      | 住所の分割結果                                      |
| `building`   | `string?` | 切り離した建物名・部屋番号                          |
| `machiazaId` | `string?` | ABR の町字ID。住所文字列より安定した不変キー        |

### `geocoder.listPrefectures()`

都道府県47件を代表点の座標つきで返します。

```ts
const { prefectures } = await geocoder.listPrefectures();
// [{ code: "01", name: "北海道", lat: 43.063941, lng: 141.347907 }, …]
```

名称だけで足りる場合は、fetch の要らない `PREFECTURES` 定数を使えます。

```ts
import { PREFECTURES } from "jp-geocoder";
// [["01", "北海道"], ["02", "青森県"], …]
```

### `geocoder.listMunicipalities(pref, options?)`

都道府県に属する市区町村の一覧を返します（住所文字列の解決ではなく、選択肢を出すための機能）。

`pref` はコード（`14` / `"14"` / `"01"`）でも名称（`"神奈川県"` / `"神奈川"`）でも渡せます。
解決できない場合は例外ではなく空配列を返します。

```ts
const { municipalities } = await geocoder.listMunicipalities("神奈川県");
// [{ municipality: "横浜市", ward: ["鶴見区"], lat: 35.508398, lng: 139.682384 }, …]
```

| Option           | Default   | Description                        |
| ---------------- | --------- | ---------------------------------- |
| `designatedCity` | `"wards"` | 政令指定都市の行政区の並べ方       |

`designatedCity` は**政令指定都市20市の見せ方だけ**を切り替えます。特別区・郡部の町村・
通常の市はどちらのモードでも同じ形です。

| Mode       | 横浜市の出方                                        | 神奈川県の件数 |
| ---------- | --------------------------------------------------- | -------------- |
| `"wards"`  | `{municipality:"横浜市", ward:["鶴見区"]}` が18件   | 58             |
| `"nested"` | `{municipality:"横浜市", ward:[…18区]}` が1件       | 33             |

出力の約束:

- 並びは団体コード順
- 郡名は含めません（「三浦郡葉山町」ではなく `"葉山町"`）
- 東京23区は市と区に割らず単独で返します（`{municipality:"千代田区"}`）
- 政令指定都市の本体だけの単独エントリは作りません（必ず `ward` つきで現れます）
- `lat` / `lng` はその1件が指す団体の代表点です。`wards` なら行政区
  （横浜市鶴見区）、`nested` なら市そのもの（横浜市）の点になります

### 駅・路線

全国 10,465駅・602路線（廃止・移転した 497駅は除外済み）。データは `rail.json` 1ファイルで、
最初の呼び出しで1回だけ取得したあとはメモリ上で解決します（fetch 0回）。

```ts
// 住所から最寄り駅（geocode と nearestStations の合成）
const { candidate, stations } = await geocoder.nearestStationsByAddress(
  "東京都世田谷区太子堂5-5-5",
  { limit: 3, groupByStation: true },
);
// 235m 西太子堂（東急世田谷線） / 337m 三軒茶屋（東急田園都市線） …
```

| Method                                        | Returns              | Description                          |
| --------------------------------------------- | -------------------- | ------------------------------------ |
| `nearestStations(lat, lng, options?)`          | `NearbyStationsResult` | 座標に近い順                        |
| `nearestStationsByAddress(address, options?)`  | 上記 + `candidate`   | 住所から最寄り駅                     |
| `listStations(query?)`                         | `StationsResult`     | 都道府県・路線で絞り込み（路線順）   |
| `getStation(code)`                             | `StationsResult`     | 駅コードで1件                        |
| `listLines(pref)`                              | `LinesResult`        | その都道府県に乗り入れる路線         |

`NearestStationsOptions`:

| Option            | Default | Description                                              |
| ----------------- | ------- | -------------------------------------------------------- |
| `limit`           | `10`    | 返す件数                                                  |
| `groupByStation`  | `false` | 乗換駅を1件にまとめる。false だと「東京」が路線の数だけ並ぶ |
| `maxDistance`     | —       | この距離[m]より遠い駅を返さない                           |

「都道府県 → 路線 → 駅」の絞り込みはこの2つを繋ぐだけです。

```ts
const { lines } = await geocoder.listLines("東京都"); // 81路線
const { stations } = await geocoder.listStations({ pref: "東京都", line: 11302 });
// 大崎 → 五反田 → … → 田町 → 高輪ゲートウェイ → 品川
```

駅は**路線上の並び順**で返します（駅コード順ではありません。駅コードは登録順なので、
後からできた駅が末尾に付いてしまいます）。分岐を持つ路線（鶴見線の海芝浦支線、
丸ノ内線の方南町支線など25路線）は1本の列に並べられないため、分岐箇所だけ順序が飛びます。

距離は Haversine（球面近似）による直線距離[m]です。徒歩の経路距離ではありません。

> **新幹線の駅は入っていません。** 駅データ.jp の無料版に新幹線の駅データが含まれない
> ためで、新幹線11路線（東海道・山陽・東北・上越・山形・秋田・北陸・九州・北海道・西九州）は
> `lines` には現れますが駅が0件です。ただし新幹線駅の多くは在来線側の駅として
> 登録されているので、座標から引く限り取りこぼしはほぼありません
> （例: 武雄温泉はJR佐世保線、新大村はJR大村線として存在します）。

### `components`（住所の分割結果）

| Field    | Example      | Description                                      |
| -------- | ------------ | ------------------------------------------------ |
| `pref`   | `"東京都"`   | 入力で省略されても解決結果から補完される         |
| `city`   | `"世田谷区"` | 政令市は `"さいたま市浦和区"` のように区まで含む |
| `county` | `"石狩郡"`   | 郡（あれば）                                     |
| `oaza`   | `"太子堂"`   | 大字。丁目・小字は含まない                       |
| `chome`  | `5`          | 丁目（数値）                                     |
| `koaza`  | `"字美浜"`   | 小字（あれば）                                   |
| `block`  | `5`          | 番（住居表示）                                   |
| `rsdt`   | `5`          | 号（住居表示）                                   |
| `parcel` | `[243, 1]`   | 地番                                             |

名称は半角数字に統一済み、数値項目はすべて `number` です。

### `matchLevel` と `accuracy`（必ず確認してください）

| `matchLevel`    | 意味                            |
| --------------- | ------------------------------- |
| `rsdt`          | 号まで解決（例: 5番**5号**）    |
| `block`         | 番まで（例: 5**番**）           |
| `parcel`        | 筆＝地番まで（例: 243**番地**） |
| `oaza`          | 町字まで                        |
| `city` / `pref` | 市区町村 / 都道府県まで         |

| `accuracy`       | 意味                                                 |
| ---------------- | ---------------------------------------------------- |
| `surveyed`       | 実測点。その住所そのものの座標                       |
| `legacy`         | 公図由来。数十m ずれることがある                     |
| `representative` | 代表点。**その階層の中心であって目的地の点ではない** |

解決できなかった階層は1つ上に落として返します。近い点で代用して嘘をつくことはしません。

## Types

```ts
interface GeocodeResult {
  candidates: Candidate[];
  attribution: string[]; // 出典表示（表示義務あり）
}

interface Candidate {
  address: string;
  lat: number;
  lng: number;
  matchLevel: "rsdt" | "block" | "parcel" | "oaza" | "city" | "pref";
  system: "residential" | "parcel"; // 住居表示か地番か
  accuracy: "surveyed" | "legacy" | "representative";
  score: number;
  components: AddressComponents;
  building?: string;
  machiazaId?: string;
}

interface AddressComponents {
  pref?: string;
  city?: string;
  county?: string;
  oaza?: string;
  chome?: number;
  koaza?: string;
  block?: number;
  rsdt?: number;
  parcel?: number[];
}

interface MunicipalitiesResult {
  municipalities: Municipality[];
  attribution: string[];
}

interface Municipality {
  municipality: string; // 行政区の場合は市名（"横浜市"）
  ward?: string[]; // 政令指定都市のみ
  lat: number; // 代表点。この1件が指す団体のもの
  lng: number;
}

interface Prefecture {
  code: string; // "01"〜"47"
  name: string;
  lat: number;
  lng: number;
}

interface MunicipalityOptions {
  designatedCity?: "wards" | "nested"; // 既定 "wards"
}

interface Station {
  code: number; // 駅コード
  groupCode: number; // 乗換で結ばれる駅どうしで同じ値
  name: string;
  lineCode: number;
  lineName: string;
  company: string;
  pref: number; // 都道府県コード 1〜47
  postalCode: string; // ハイフンなし7桁
  address: string;
  lat: number;
  lng: number;
}

interface NearbyStation {
  station: Station;
  distance: number; // 直線距離[m]
}
```

## Limitations

元データに無いものは返せません（実測値）:

| 項目                               | 充足率                             |
| ---------------------------------- | ---------------------------------- |
| 住居表示地域で号まで解決できる町字 | 88.6%（残りは番または町字止まり）  |
| 地番の座標                         | 46.0%（残りは町字代表点に落ちる）  |
| 旧市町村名の対応づけ               | 78.6%                              |
| 部屋番号                           | 0%（日本の公開データに存在しない） |

だからこそ `matchLevel` と `accuracy` を確認してください。

## Self-hosting

通常は不要です。次のような場合だけ、データ一式を自前でビルドして配信できます。

- 公式の配信元（第三者のインフラ）に依存したくない
- 社内ネットワークなど閉じた環境で使いたい
- 元データの版を自分で固定・管理したい

```bash
make up          # コンテナ起動
make data-all    # 元データを取得（約3.6GB・数時間）
make build       # TypeScript をコンパイル
make build-data  # 配信データを生成（約2.0GB・gzip後 約426MB）
```

生成された `dist-data/v1` を任意の静的ホスティングに置き、
`/v1/*` に CORS（`Access-Control-Allow-Origin: *`）を付けたうえで、
`baseUrl` に自分の配信先を渡します。

```ts
createGeocoder({ baseUrl: "https://your-domain/v1" });
```

使った元データの版は `/v1/version.json` に記録されます。

## Development

```bash
make test       # 単体テスト（実データ不要）
make typecheck  # 型検査
make verify     # 実データでの検証（要 data-all + build-data）
make demo       # デモをローカルで確認
```

その他のターゲットは [Makefile](./Makefile) のコメントを参照してください。

## Data Sources

このライブラリは以下の公開データを加工して利用しています。**利用時は出典表示が必要です**
（レスポンスの `attribution` にそのまま使える文字列が入っています）。

- デジタル庁「アドレス・ベース・レジストリ」
- 国土交通省「位置参照情報」
- 『歴史的行政区域データセットβ版』（CODH作成）
- 駅データ.jp（駅・路線）

詳細は [DATA_LICENSE.md](./DATA_LICENSE.md)。

## Contributing

[GitHub Issues](https://github.com/NAOHIDEOTA/jp-geocoder/issues) でバグ報告・機能リクエストを受け付けています。

## License

コードは [MIT](./LICENSE) - Copyright (c) 2026 NAOHIDEOTA

データのライセンスは [Data Sources](#data-sources) のとおり別です。
