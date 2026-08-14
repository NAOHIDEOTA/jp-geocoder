# Cloudflare Pages への配信（管理者専用・git 追跡外）。
# ルートの Makefile が -include で読み込む。利用者のクローンにはこのファイルが無いので、
# pages-* ターゲットはそもそも存在しない。
#
# 認証は .env の CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID。
# .env は env_file なのでコンテナ作成時にしか読まれない。書き換えたら make up し直すこと。

.PHONY: pages-dev pages-create pages-deploy

# 本番と同じ挙動（_headers 込み）でローカル配信して確認する
pages-dev:
	cp scripts/deploy/_headers dist-data/_headers
	docker exec -it jp-geocoder pnpm exec wrangler pages dev dist-data --port 8080 --ip 0.0.0.0

# Pages プロジェクトを作る（初回のみ。wrangler 4 は deploy 時に自動作成しない）
pages-create:
	docker exec jp-geocoder pnpm exec wrangler pages project create $(or $(PAGES_PROJECT),jp-geocoder) --production-branch main

# デプロイする。差分はハッシュ判定で自動スキップ。戻すときは Pages のロールバック
pages-deploy:
	cp scripts/deploy/_headers dist-data/_headers
	docker exec jp-geocoder pnpm exec wrangler pages deploy dist-data --project-name $(or $(PAGES_PROJECT),jp-geocoder) --branch main
