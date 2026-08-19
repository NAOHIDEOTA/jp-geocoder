# jp-geocoder

[![npm version](https://img.shields.io/npm/v/jp-geocoder.svg)](https://www.npmjs.com/package/jp-geocoder)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![GitHub](https://img.shields.io/github/stars/NAOHIDEOTA/jp-geocoder?style=social)](https://github.com/NAOHIDEOTA/jp-geocoder)

日本の住所を扱うための、**サーバ不要・DB不要・APIキー不要**の JavaScript ライブラリ。
国のオープンデータから生成した静的 JSON を CDN から読むだけで動きます。

**[Live Demo](https://naohideota.github.io/jp-geocoder/docs/)** — ブラウザだけで全機能を試せます

```ts
import { createGeocoder } from "jp-geocoder";

const geocoder = createGeocoder();

// 住所 → 緯度経度
const { candidates } = await geocoder.geocode("世田ヶ谷区太子道5-5-5");
candidates[0]; // → 東京都世田谷区太子堂五丁目5番5号 / 35.646194, 139.668013

// 住所 → 最寄り駅
const { stations } = await geocoder.nearestStationsByAddress(
  "東京都世田谷区太子堂5-5-5",
  { limit: 3, groupByStation: true },
);
// → 235m 西太子堂（東急世田谷線） / 337m 三軒茶屋（東急田園都市線） …
```

> **状態**: npm 未公開（準備中）

## 目次

- [なぜ](#なぜ)
- [Installation](#installation)
- [できること](#できること)
- [API](#api)
  - [`createGeocoder(options?)`](#creategeocoderoptions)
  - [`geocode(address)`](#geocodeaddress)
  - [`listPrefectures()`](#listprefectures)
  - [`listMunicipalities(pref, options?)`](#listmunicipalitiespref-options)
  - [`nearestStations(lat, lng, options?)`](#neareststationslat-lng-options)
  - [`nearestStationsByAddress(address, options?)`](#neareststationsbyaddressaddress-options)
  - [`listLines(pref)` / `listStations(query?)` / `getStation(code)`](#listlinespref--liststationsquery--getstationcode)
- [返り値の読み方](#返り値の読み方)
- [Types](#types)
- [Limitations](#limitations)
- [Self-hosting](#self-hosting)
- [Development](#development)
- [Data Sources](#data-sources)
- [License](#license)

## なぜ

**サーバを持たない。** 住所データ（全国約1億2,000万点・約2GB）は CDN 上の静的 JSON です。
ライブラリは住所の階層に沿って索引を辿るので、1回の検索で読むのは該当ファイル 2〜5 個
（数十〜数百KB）だけ。全体をダウンロードすることはありません。DB も API サーバも要らず、
CDN と HTTP キャッシュがそのまま効きます。

**精度を偽らない。** どこまで解決できたか（`matchLevel`）と、その座標の品質（`accuracy`）を
必ず返します。番地まで解けなければ町字の代表点を返し、それを代表点だと明示します。
近い点で代用して「それらしい座標」を返すことはしません。

**住所以外も引ける。** 都道府県・市区町村の一覧（フォームの選択肢用）と、全国 10,465駅・
602路線を同じパッケージで扱えます。住所から座標を経由して最寄り駅まで1関数で出せます。

動作環境は Node.js 20+ / ブラウザ / Cloudflare Workers（`fetch` があれば動きます）。
TypeScript の型定義つきです。

## Installation

```bash
npm install jp-geocoder
```

配信元の URL 指定は不要です。`createGeocoder()` は既定で公式の配信元を見ます。

## できること

あえて難しい入力の例。すべて実測で確認済みです。

| 入力                                 | 結果                       | 効いている機構   |
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

## API

すべてのメソッドは `attribution`（出典表示の文字列）を一緒に返します。表示義務があります。

### `createGeocoder(options?)`

```ts
const geocoder = createGeocoder();
```

| Option    | Type      | Default      | Description                                    |
| --------- | --------- | ------------ | ---------------------------------------------- |
| `baseUrl` | `string`  | 公式の配信元 | 自分でデータを配信する場合だけ指定する         |
| `limit`   | `number`  | `5`          | `geocode` が返す候補の最大数                   |
| `fetcher` | `Fetcher` | HTTP fetch   | データ取得の差し替え口（テスト・オフライン用） |

### `geocode(address)`

住所文字列を緯度経度にします。

```ts
const { candidates } = await geocoder.geocode("東京都世田谷区太子堂5-5-5");
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

`Candidate` のフィールド:

| Field        | Type      | Description                                         |
| ------------ | --------- | --------------------------------------------------- |
| `address`    | `string`  | 正規化された住所表記                                |
| `lat` `lng`  | `number`  | 緯度経度（JGD2011）                                 |
| `matchLevel` | 下表      | **どこまで解決できたか**                            |
| `accuracy`   | 下表      | **その座標の品質**                                  |
| `score`      | `number`  | 一致率 0〜1（完全一致 1.0 / カナ 0.9 / タイポ 0.6） |
| `system`     | `string`  | `"residential"`（住居表示）/ `"parcel"`（地番）     |
| `components` | 下表      | 住所の分割結果                                      |
| `building`   | `string?` | 切り離した建物名・部屋番号                          |
| `machiazaId` | `string?` | 町字ID。住所文字列より安定した不変キー              |

候補は解決の深さとスコアの順に並びます。

### `listPrefectures()`

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

### `listMunicipalities(pref, options?)`

都道府県に属する市区町村を返します。フォームの選択肢に使えます。

```ts
const { municipalities } = await geocoder.listMunicipalities("神奈川県");
// [{ municipality: "横浜市", ward: ["鶴見区"], lat: 35.508398, lng: 139.682384 }, …]
```

`pref` はコード（`14` / `"14"` / `"01"`）でも名称（`"神奈川県"` / `"神奈川"`）でも渡せます。
解決できない場合は例外ではなく空配列を返します。

| Option           | Type                    | Default   | Description                  |
| ---------------- | ----------------------- | --------- | ---------------------------- |
| `designatedCity` | `"wards"` \| `"nested"` | `"wards"` | 政令指定都市の行政区の並べ方 |

`designatedCity` が変えるのは**政令指定都市20市だけ**です。特別区・郡部の町村・通常の市は
どちらのモードでも同じ形になります。

| Mode       | 横浜市の出方                                      | 神奈川県の件数 |
| ---------- | ------------------------------------------------- | -------------- |
| `"wards"`  | `{municipality:"横浜市", ward:["鶴見区"]}` が18件 | 58             |
| `"nested"` | `{municipality:"横浜市", ward:[…18区]}` が1件     | 33             |

出力の約束:

- 並びは団体コード順
- 郡名は含めません（「三浦郡葉山町」ではなく `"葉山町"`）
- 東京23区は市と区に割らず単独で返します（`{municipality:"千代田区"}`）
- 政令指定都市の本体だけの単独エントリは作りません（必ず `ward` つきで現れます）
- `lat` / `lng` はその1件が指す団体の代表点です。`"wards"` なら行政区（横浜市鶴見区）、
  `"nested"` なら市そのもの（横浜市）の点になります

### `nearestStations(lat, lng, options?)`

座標に近い順に駅を返します。

```ts
const { stations } = await geocoder.nearestStations(35.681236, 139.767125, {
  limit: 5,
  groupByStation: true,
});
// [{ station: { name: "東京", lineName: "JR東海道本線(東京～熱海)", … }, distance: 94 }, …]
```

| Option           | Type      | Default | Description                                                |
| ---------------- | --------- | ------- | ---------------------------------------------------------- |
| `limit`          | `number`  | `10`    | 返す件数                                                   |
| `groupByStation` | `boolean` | `false` | 乗換駅を1件にまとめる。false だと「東京」が路線の数だけ並ぶ |
| `maxDistance`    | `number?` | —       | この距離[m]より遠い駅を返さない                            |

距離は Haversine（球面近似）による直線距離[m]です。徒歩の経路距離ではありません。

### `nearestStationsByAddress(address, options?)`

住所を座標に変換してから最寄り駅を返します。`geocode` と `nearestStations` の合成です。

```ts
const { candidate, stations } = await geocoder.nearestStationsByAddress(
  "東京都世田谷区太子堂5-5-5",
  { limit: 3, groupByStation: true },
);
// candidate → 解決した住所と座標（解決できなければ null）
// stations  → 235m 西太子堂 / 337m 三軒茶屋 / 733m 若林
```

オプションは `nearestStations` と同じです。

### `listLines(pref)` / `listStations(query?)` / `getStation(code)`

全国 10,465駅・602路線（廃止・移転した 497駅は除外済み）。データは `rail.json` 1ファイルで、
最初の呼び出しで1回だけ取得したあとはメモリ上で解決します（以降 fetch 0回）。

「都道府県 → 路線 → 駅」の絞り込みはこの2つを繋ぐだけです。

```ts
const { lines } = await geocoder.listLines("東京都"); // 81路線
const { stations } = await geocoder.listStations({ pref: "東京都", line: 11302 });
// 大崎 → 五反田 → … → 田町 → 高輪ゲートウェイ → 品川
```

| Method                      | Returns          | Description                          |
| --------------------------- | ---------------- | ------------------------------------ |
| `listLines(pref)`           | `LinesResult`    | その都道府県に駅がある路線           |
| `listStations(query?)`      | `StationsResult` | 都道府県・路線で絞り込み（路線順）   |
| `getStation(code)`          | `StationsResult` | 駅コードで1件。無ければ空配列        |

`listStations` の `query` は `{ pref?, line? }` です。どちらも省略すると全国の全駅を返します。

駅は**路線上の並び順**で返します（駅コード順ではありません。駅コードは登録順なので、
後からできた駅が末尾に付いてしまいます）。分岐を持つ路線（鶴見線の海芝浦支線、
丸ノ内線の方南町支線など25路線）は1本の列に並べられないため、分岐箇所だけ順序が飛びます。

> **新幹線の駅は入っていません。** 駅データ.jp の無料版に新幹線の駅データが含まれない
> ためで、新幹線11路線（東海道・山陽・東北・上越・山形・秋田・北陸・九州・北海道・西九州）は
> `lines` には現れますが駅が0件です。ただし新幹線駅の多くは在来線側の駅として
> 登録されているので、座標から引く限り取りこぼしはほぼありません
> （例: 武雄温泉はJR佐世保線、新大村はJR大村線として存在します）。

## 返り値の読み方

### `matchLevel` — どこまで解決できたか

| Value           | 意味                            |
| --------------- | ------------------------------- |
| `rsdt`          | 号まで解決（例: 5番**5号**）    |
| `block`         | 番まで（例: 5**番**）           |
| `parcel`        | 筆＝地番まで（例: 243**番地**） |
| `oaza`          | 町字まで                        |
| `city` / `pref` | 市区町村 / 都道府県まで         |

### `accuracy` — その座標の品質

| Value            | 意味                                                 |
| ---------------- | ---------------------------------------------------- |
| `surveyed`       | 実測点。その住所そのものの座標                       |
| `legacy`         | 公図由来。数十m ずれることがある                     |
| `representative` | 代表点。**その階層の中心であって目的地の点ではない** |

解決できなかった階層は1つ上に落として返します。近い点で代用して嘘をつくことはしません。

### `components` — 住所の分割結果

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

## Types

```ts
interface GeocodeResult {
  candidates: Candidate[];
  attribution: string[];
}

interface Candidate {
  address: string;
  lat: number;
  lng: number;
  matchLevel: "rsdt" | "block" | "parcel" | "oaza" | "city" | "pref";
  accuracy: "surveyed" | "legacy" | "representative";
  system: "residential" | "parcel";
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

interface Prefecture {
  code: string; // "01"〜"47"
  name: string;
  lat: number;
  lng: number;
}

interface Municipality {
  municipality: string; // 行政区の場合は市名（"横浜市"）
  ward?: string[]; // 政令指定都市のみ
  lat: number;
  lng: number;
}

interface Station {
  code: number;
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

生成された `dist-data/v1` を任意の静的ホスティングに置き、`/v1/*` に CORS
（`Access-Control-Allow-Origin: *`）を付けたうえで、`baseUrl` に自分の配信先を渡します。

```ts
createGeocoder({ baseUrl: "https://your-domain/v1" });
```

使った元データの版は `/v1/version.json` に記録されます。

なお駅データは取得に会員登録が必要で自動取得できません。手順は
[Makefile](./Makefile) の `data-part-ekidata` を参照してください。

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
