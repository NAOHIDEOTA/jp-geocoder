#!/usr/bin/env python3
"""国土交通省 位置参照情報をダウンロードする（DOC.md §12.4）。

ABR の町字代表点は 27% しか埋まっていないため、これで補完する。

  大字・町丁目レベル 19.0b : https://nlftp.mlit.go.jp/isj/dls/data/19.0b/{PP}000-19.0b.zip
  街区レベル         24.0a : https://nlftp.mlit.go.jp/isj/dls/data/24.0a/{PP}000-24.0a.zip

いずれも 2026-08 時点で最新（25.0a / 20.0b は未公開＝404）。
"""

import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

DEST = "isj"
VERSIONS = {"oaza": "19.0b", "gaiku": "24.0a"}
BASE = "https://nlftp.mlit.go.jp/isj/dls/data"


def get(job):
    url, path = job
    for attempt in range(3):
        try:
            if os.path.exists(path) and os.path.getsize(path) > 0:
                return path, "skip"
            urllib.request.urlretrieve(url, path)
            return path, f"ok {os.path.getsize(path)}"
        except Exception as e:  # noqa: BLE001
            if attempt == 2:
                return path, f"FAIL {e}"
            time.sleep(2 * (attempt + 1))
    return path, "FAIL"


def main() -> None:
    kind = sys.argv[1] if len(sys.argv) > 1 else "oaza"
    ver = VERSIONS[kind]
    os.makedirs(DEST, exist_ok=True)

    jobs = []
    for pp in range(1, 48):
        name = f"{pp:02d}000-{ver}.zip"
        jobs.append((f"{BASE}/{ver}/{name}", os.path.join(DEST, name)))

    print(f"[{kind} {ver}] {len(jobs)} files", flush=True)
    fail = 0
    with ThreadPoolExecutor(max_workers=6) as ex:
        for path, status in ex.map(get, jobs):
            if status.startswith("FAIL"):
                fail += 1
                print(f"  {status}  {path}", flush=True)
    total = sum(os.path.getsize(p) for _, p in jobs if os.path.exists(p))
    print(f"[{kind}] complete: {len(jobs) - fail} files, {total / 1048576:.1f} MB, {fail} failed")


if __name__ == "__main__":
    main()
