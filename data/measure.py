#!/usr/bin/env python3
"""Step 0（§13）の実測。zip を展開せずストリームで集計する。

1. 号レベル座標の充足率（全国）
2. 町字の件数と座標充足率
3. シャーディング後のサイズ見積り
"""

import csv
import io
import json
import os
import re
import zipfile
from collections import Counter, defaultdict

ABR = "abr"


def rows(name: str):
    """abr/{name} の zip 内 CSV を dict で流す。"""
    path = os.path.join(ABR, name)
    with zipfile.ZipFile(path) as z:
        inner = [n for n in z.namelist() if n.endswith(".csv")][0]
        with z.open(inner) as f:
            yield from csv.DictReader(io.TextIOWrapper(f, encoding="utf-8"))


def prefs() -> list[str]:
    pat = re.compile(r"mt_rsdtdsp_rsdt_pref(\d+)\.csv\.zip$")
    return sorted(pat.match(f).group(1) for f in os.listdir(ABR) if pat.match(f))


def main() -> None:
    out: dict = {}

    # --- 1. 住居表示（号）レベル ---
    total = withpos = 0
    per_pref = {}
    for pp in prefs():
        k = lambda r: (r["lg_code"], r["machiaza_id"], r["blk_id"], r["rsdt_id"], r["rsdt2_id"])  # noqa: E731
        base = {k(r) for r in rows(f"mt_rsdtdsp_rsdt_pref{pp}.csv.zip")}
        pos = {k(r) for r in rows(f"mt_rsdtdsp_rsdt_pos_pref{pp}.csv.zip")}
        hit = len(base & pos)
        per_pref[pp] = {"base": len(base), "pos": hit,
                        "rate": round(hit / len(base) * 100, 2) if base else None}
        total += len(base)
        withpos += hit
        print(f"  pref{pp}: {len(base):>9,} / pos {hit:>9,} = {per_pref[pp]['rate']}%", flush=True)
    out["rsdt"] = {"total": total, "with_pos": withpos,
                   "rate": round(withpos / total * 100, 2), "per_pref": per_pref}
    print(f"[号レベル] 全国 {total:,}件 / 座標あり {withpos:,}件 = {out['rsdt']['rate']}%")

    # --- 2. 町字 ---
    town = list(rows("mt_town_all.csv.zip"))
    tkey = lambda r: (r["lg_code"], r["machiaza_id"])  # noqa: E731
    tpos: set = set()
    for pp in prefs():
        f = f"mt_town_pos_pref{pp}.csv.zip"
        if os.path.exists(os.path.join(ABR, f)):
            tpos |= {tkey(r) for r in rows(f)}
    tset = {tkey(r) for r in town}
    rsdt_flag = Counter(r.get("rsdt_addr_flg") for r in town)
    out["town"] = {"total": len(tset), "with_pos": len(tset & tpos),
                   "rate": round(len(tset & tpos) / len(tset) * 100, 2),
                   "rsdt_addr_flg": dict(rsdt_flag),
                   "columns": list(town[0].keys())}
    print(f"[町字] {len(tset):,}件 / 座標あり {len(tset & tpos):,}件 = {out['town']['rate']}%")
    print(f"[町字] rsdt_addr_flg(住居表示実施): {dict(rsdt_flag)}")

    # --- 3. 町字名の先頭文字シャード分布（§4.2 の検証）---
    shard: dict[str, int] = defaultdict(int)
    for r in town:
        nm = r.get("oaza_cho") or ""
        if nm:
            shard[nm[0]] += 1
    top = sorted(shard.items(), key=lambda x: -x[1])[:15]
    out["shard"] = {"distinct_first_chars": len(shard),
                    "max": top[0][1] if top else 0,
                    "top15": top}
    print(f"[シャード] 先頭文字 {len(shard)}種 / 最大 {top[0][0]}={top[0][1]:,}件")
    print(f"          top15: {top}")

    with open("measure_result.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print("wrote measure_result.json")


if __name__ == "__main__":
    main()
