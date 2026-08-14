-include .env
export

.PHONY: up down build test typecheck demo \
        build-data build-part-version build-part-cities build-part-towns build-part-rsdt \
        build-part-parcel build-part-alias validate \
        verify verify-accuracy \
        data-all data-part-catalog data-part-abr data-part-isj data-part-codh \
        measure-source \
        publish-patch publish-minor

# ---- 開発環境 -------------------------------------------------------------

up:
	docker compose up -d --build

down:
	docker compose down

build:
	docker exec jp-geocoder pnpm run build

test:
	docker exec jp-geocoder pnpm test

typecheck:
	docker exec jp-geocoder pnpm run typecheck

# デモ（docs/）をローカルで開く。本番（GitHub Pages が /docs をそのまま配信）と同じ構成。
# docs/lib はコンパイル結果のコピーで、コミットする（GitHub Pages が配信するため）。
# src/ を変えたらこれを実行して docs/lib を更新すること
demo: build
	docker exec jp-geocoder sh -c "rm -rf docs/lib && cp -r dist docs/lib"
	docker exec -d jp-geocoder pnpm dlx http-server /workspace/docs -p 8080 --cors
	@echo "http://localhost:$(or $(DEMO_PORT),8081)/"


# ---- ビルド入力データの取得（DOC.md §2 / §13） -----------------------------
# 元データを全部取得する。
data-all: data-part-catalog data-part-abr data-part-isj data-part-codh
	@echo "取得完了。次は make build-data"

# ABR の配信ファイル一覧を ArcGIS Portal API から列挙し data/abr_catalog.json に書く。
data-part-catalog:
	docker exec jp-geocoder sh -c "cd data && python3 catalog.py"

# ABR 本体（約3.5GB）。pref=全国+都道府県 / town=町字(約3,900) / parcel=地番(約3,700)
data-part-abr:
	docker exec jp-geocoder sh -c "cd data && python3 download.py pref"
	docker exec jp-geocoder sh -c "cd data && python3 download.py town"
	docker exec jp-geocoder sh -c "cd data && python3 download.py parcel"

# 国交省 位置参照情報（約126MB）。町字座標の補完と、精度検証(verify-accuracy)の正解データ
data-part-isj:
	docker exec jp-geocoder sh -c "cd data && python3 download_isj.py"

# CODH 歴史的行政区域データセット（約1.3MB）。旧自治体名エイリアスの入力
data-part-codh:
	docker exec jp-geocoder sh -c "cd data && python3 download_codh.py"

# data/ を読んで件数・座標充足率などを集計する。
measure-source:
	docker exec jp-geocoder sh -c "cd data && python3 measure.py && python3 measure_parcel.py"


# ---- 索引ビルド（data/ → dist-data/v1） -------------------------------------
# 配信物（dist-data/v1、約2.0GB）を生成し、最後に検証ゲートを通す
build-data: build-part-version build-part-cities build-part-towns build-part-rsdt \
            build-part-parcel build-part-alias validate

# 元データの版（version.json）。dist-data は git に入れないので、
# 「配信中のものがどの版で作られたか」の唯一の記録になる
build-part-version:
	docker exec jp-geocoder node scripts/build/build-version.mjs

# 都道府県・市区町村の索引（cities.json）。他のすべてが参照する
build-part-cities:
	docker exec jp-geocoder node scripts/build/build-cities.mjs

# 町字の索引（oaza/ kana/ shards.json）。ABR に座標が無いものを ISJ で補完する
build-part-towns:
	docker exec jp-geocoder node --max-old-space-size=6144 scripts/build/build-towns.mjs

# 住居表示（番・号）の索引（rsdt/）。号は番からの差分で持つ
build-part-rsdt:
	docker exec jp-geocoder node --max-old-space-size=8192 scripts/build/build-rsdt.mjs

# 地番（筆）の索引（parcel/）。列指向＋累積差分で符号化する
build-part-parcel:
	docker exec jp-geocoder node --max-old-space-size=8192 scripts/build/build-parcel.mjs

# 旧自治体名のエイリアス（alias.json）。町字索引を読むので towns の後に実行する
build-part-alias:
	docker exec jp-geocoder node --max-old-space-size=6144 scripts/build/build-alias.mjs

# 配信物の検証ゲート。日本の範囲内か等の絶対検査＋前回ビルド(metrics.json)との回帰比較
validate:
	docker exec jp-geocoder node --max-old-space-size=8192 scripts/build/validate.mjs


# ---- 実装の検証 -------------------------------------------------------------
# 正規化・住所分解・検索の挙動を実データで確認する（キー / 解析 / 検索 / 町字 / 番号）
verify:
	docker exec jp-geocoder node scripts/verify/verify-keys.mjs
	docker exec jp-geocoder node scripts/verify/verify-parse.mjs
	docker exec jp-geocoder node scripts/verify/verify-geocode.mjs
	docker exec jp-geocoder node scripts/verify/verify-town.mjs
	docker exec jp-geocoder node scripts/verify/verify-rsdt.mjs

# 返した座標を外部データ（国交省 位置参照情報）と突き合わせて距離を測る。
verify-accuracy:
	docker exec jp-geocoder node --max-old-space-size=6144 scripts/verify/verify-accuracy.mjs $(or $(N),3000)


# ---- 配信 ------------------------------------------------------
-include scripts/deploy/Makefile


# ---- npm 公開 -------------------------------------------------------------
publish-patch:
	pnpm version patch --no-git-tag-version
	docker exec jp-geocoder pnpm run build
	pnpm publish --ignore-scripts --no-git-checks

publish-minor:
	pnpm version minor --no-git-tag-version
	docker exec jp-geocoder pnpm run build
	pnpm publish --ignore-scripts --no-git-checks
