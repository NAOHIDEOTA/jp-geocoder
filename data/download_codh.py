#!/usr/bin/env python3
"""CODH 歴史的行政区域データセットβ版をダウンロードする（DOC.md §12.3）。

旧自治体名エイリアス（build-alias.mjs）の入力。
  geoshape_city_id.csv : 1970年以降に存在した市区町村の一覧
  code_gci.csv         : 標準地域コード ↔ Geoshape市区町村ID の対応

ライセンスは CC BY 4.0。出典表示が必須（DATA_LICENSE.md 参照）:
  『歴史的行政区域データセットβ版』（CODH作成）doi:10.20676/00000447

既に存在するファイルはスキップする（再実行可能）。
"""

import os
import urllib.request

BASE = "https://geoshape.ex.nii.ac.jp/city/dataset"
DEST = "codh"
FILES = ["geoshape_city_id.csv", "code_gci.csv"]


def main() -> None:
    os.makedirs(DEST, exist_ok=True)
    for name in FILES:
        path = os.path.join(DEST, name)
        if os.path.exists(path) and os.path.getsize(path) > 0:
            print(f"skip {name} ({os.path.getsize(path):,}B)")
            continue
        req = urllib.request.Request(
            f"{BASE}/{name}", headers={"User-Agent": "jp-geocoder/0.1"}
        )
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read()
        # 取得失敗を空ファイルとして残さない
        if not body:
            raise SystemExit(f"{name}: 空のレスポンス")
        with open(path, "wb") as f:
            f.write(body)
        print(f"ok   {name} ({len(body):,}B)")


if __name__ == "__main__":
    main()
