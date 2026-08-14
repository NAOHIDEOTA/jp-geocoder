#!/usr/bin/env python3
"""地番マスターの全国件数・座標充足率を実測する（§13-3）。

行数だけ数えれば足りるので CSV パースはせずバイト単位で改行を数える。
"""

import json
import os
import re
import zipfile
from concurrent.futures import ProcessPoolExecutor

ABR = "abr"
CHUNK = 1 << 22


def count(fname: str) -> tuple[str, int]:
    path = os.path.join(ABR, fname)
    n = 0
    with zipfile.ZipFile(path) as z:
        inner = [x for x in z.namelist() if x.endswith(".csv")][0]
        with z.open(inner) as f:
            while buf := f.read(CHUNK):
                n += buf.count(b"\n")
    return fname, max(n - 1, 0)  # ヘッダ行を除く


def group(prefix: str) -> list[str]:
    pat = re.compile(rf"^{prefix}_city(\d+)\.csv\.zip$")
    return sorted(f for f in os.listdir(ABR) if pat.match(f))


def main() -> None:
    out = {}
    for prefix in ("mt_parcel", "mt_parcel_pos"):
        files = group(prefix)
        per_city = {}
        with ProcessPoolExecutor() as ex:
            for fname, n in ex.map(count, files, chunksize=8):
                per_city[re.search(r"city(\d+)", fname).group(1)] = n
        total = sum(per_city.values())
        out[prefix] = {"files": len(files), "rows": total, "per_city": per_city}
        print(f"{prefix}: {len(files)} files / {total:,} rows", flush=True)

    base = out["mt_parcel"]["per_city"]
    pos = out["mt_parcel_pos"]["per_city"]
    covered = {c: pos.get(c, 0) for c in base}
    rate = sum(covered.values()) / sum(base.values()) * 100
    out["coverage"] = {
        "rate_pct": round(rate, 2),
        "cities_with_parcel": len(base),
        "cities_with_pos": len([c for c in base if pos.get(c)]),
        "worst10": sorted(
            ((c, base[c], pos.get(c, 0)) for c in base if base[c] > 10000),
            key=lambda x: x[2] / x[1],
        )[:10],
        "best10": sorted(
            ((c, base[c], pos.get(c, 0)) for c in base if base[c] > 10000),
            key=lambda x: -x[2] / x[1],
        )[:10],
    }
    print(f"[地番] 全国 {sum(base.values()):,}筆 / 座標あり {sum(covered.values()):,}筆 = {rate:.2f}%")
    print(f"[地番] 提供自治体 {len(base)} / うち座標ありは {out['coverage']['cities_with_pos']}")

    with open("measure_parcel.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print("wrote measure_parcel.json")


if __name__ == "__main__":
    main()
