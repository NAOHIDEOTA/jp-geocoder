FROM node:24-bookworm-slim

ENV TZ=Asia/Tokyo

# python3 は data/ 配下の取得・実測スクリプト（DOC.md §13）用
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 ca-certificates curl unzip git \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

WORKDIR /workspace
