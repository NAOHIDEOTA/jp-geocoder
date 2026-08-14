#!/usr/bin/env python3
"""abr_catalog.json の url を種別ごとにダウンロードする。

使い方:
  python3 download.py pref     # 全国マスター + 都道府県単位（町字・住居表示）
  python3 download.py parcel   # 地番マスター（市区町村単位・約3,700ファイル）
  python3 download.py town     # 町字マスター（市区町村単位・約3,900ファイル）

既に同じサイズで存在するファイルはスキップする（再実行可能）。
"""

import json
import os
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

DEST = "abr"
CATALOG = "abr_catalog.json"

GROUPS = {
    # 全国一括 + 都道府県単位。これだけで Step 1〜4 は動く
    "pref": (
        r"/(mt_pref|mt_pref_pos|mt_city|mt_city_pos)/[^/]+\.csv\.zip$",
        r"/(mt_town|mt_town_fullset)/mt_\w+_all\.csv\.zip$",
        r"/(mt_town_pos|mt_rsdtdsp_blk|mt_rsdtdsp_blk_pos|mt_rsdtdsp_rsdt|mt_rsdtdsp_rsdt_pos)/pref/",
    ),
    "parcel": (r"/(mt_parcel|mt_parcel_pos)/city/",),
    "town": (r"/(mt_town|mt_town_fullset)/city/",),
}


def targets(group: str) -> list[tuple[str, str]]:
    pats = [re.compile(p) for p in GROUPS[group]]
    out = []
    for it in json.load(open(CATALOG, encoding="utf-8")):
        u = it.get("url") or ""
        if any(p.search(u) for p in pats):
            out.append((u, os.path.basename(u)))
    return sorted(set(out))


def size_of(url: str) -> int:
    req = urllib.request.Request(url, method="HEAD")
    with urllib.request.urlopen(req, timeout=60) as r:
        return int(r.headers.get("Content-Length") or 0)


def get(job: tuple[str, str]) -> tuple[str, str]:
    url, name = job
    path = os.path.join(DEST, name)
    for attempt in range(3):
        try:
            remote = size_of(url)
            if os.path.exists(path) and os.path.getsize(path) == remote:
                return name, "skip"
            urllib.request.urlretrieve(url, path)
            return name, f"ok {os.path.getsize(path)}"
        except Exception as e:  # noqa: BLE001
            if attempt == 2:
                return name, f"FAIL {e}"
            time.sleep(2 * (attempt + 1))
    return name, "FAIL"


def main() -> None:
    group = sys.argv[1] if len(sys.argv) > 1 else "pref"
    os.makedirs(DEST, exist_ok=True)
    jobs = targets(group)
    print(f"[{group}] {len(jobs)} files", flush=True)
    done = fail = 0
    with ThreadPoolExecutor(max_workers=8) as ex:
        for name, status in ex.map(get, jobs):
            done += 1
            if status.startswith("FAIL"):
                fail += 1
                print(f"  {status}  {name}", flush=True)
            if done % 100 == 0 or done == len(jobs):
                print(f"  {done}/{len(jobs)} (fail={fail})", flush=True)
    print(f"[{group}] complete: {done} files, {fail} failed")


if __name__ == "__main__":
    main()
