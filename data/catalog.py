#!/usr/bin/env python3
"""ABR(アドレス・ベース・レジストリ)の配信ファイル一覧を ArcGIS Portal API から列挙する。

新カタログは ArcGIS Hub 上にあり、各データセットは "Document Link" item として
登録されている。item の url フィールドが data.address-br.digital.go.jp の実ファイル。
"""

import json
import sys
import time
import urllib.parse
import urllib.request

ORG_ID = "CYIQE8W499B0gG0e"
SEARCH = "https://www.arcgis.com/sharing/rest/search"
OUT = "abr_catalog.json"


def fetch(url: str, retries: int = 3) -> dict:
    for i in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            if i == retries - 1:
                raise
            print(f"  retry({i + 1}): {e}", file=sys.stderr)
            time.sleep(2)
    return {}


def main() -> None:
    items: dict[str, dict] = {}
    start = 1
    while True:
        q = urllib.parse.urlencode(
            {"q": f"orgid:{ORG_ID}", "num": 100, "start": start, "f": "json"}
        )
        d = fetch(f"{SEARCH}?{q}")
        results = d.get("results", [])
        for r in results:
            items[r["id"]] = {
                "id": r["id"],
                "title": r.get("title"),
                "type": r.get("type"),
                "url": r.get("url"),
                "modified": r.get("modified"),
            }
        total = d.get("total", 0)
        nxt = d.get("nextStart", -1)
        print(f"{len(items)}/{total}", file=sys.stderr)
        if nxt <= 0:
            break
        start = nxt

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(sorted(items.values(), key=lambda x: x["title"] or ""), f,
                  ensure_ascii=False, indent=1)
    print(f"wrote {OUT}: {len(items)} items")


if __name__ == "__main__":
    main()
