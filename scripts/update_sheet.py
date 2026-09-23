#!/usr/bin/env python3
"""Download the PSU tier list spreadsheet and write data/psus.json.

The sheet uses an outline layout: brand and series cells are left blank
when they repeat the row above, and the series name is split across three
columns (series / sub-series / variant). This script fills those blanks in
so every row stands on its own.
"""
import csv
import io
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

SHEET_ID = "1akCHL7Vhzk_EhrpIGkz8zTEvYfLDcaSpZRB6Xt6JWkc"
GID = "931697732"
CSV_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:csv&gid={GID}"
OUT = Path(__file__).resolve().parent.parent / "data" / "psus.json"

# Column positions in the sheet.
BRAND, S1, S2, S3, WATTS, TIER, YEAR, SIZE, ATX, INPUT, MODULAR, EFF, TOPO, SEC, REG, ODM, PLATFORM, NOTES = range(18)

TIER_ORDER = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D", "D-", "E", "F"]


def clean(s):
    return re.sub(r"\s+", " ", s or "").strip()


def parse_watts(text):
    """'650/750W' -> [650, 750]; '700-1200W' -> {'min': 700, 'max': 1200}."""
    t = re.sub(r"[W?\s]", "", text.upper())
    out, ranges = [], []
    for part in re.split(r"[/,]", t):
        m = re.fullmatch(r"(\d+)-(\d+)", part)
        if m:
            ranges.append([int(m.group(1)), int(m.group(2))])
        elif re.fullmatch(r"\d+", part):
            out.append(int(part))
    lo = min([*out, *(r[0] for r in ranges)], default=None)
    hi = max([*out, *(r[1] for r in ranges)], default=None)
    return {"list": out, "ranges": ranges, "min": lo, "max": hi}


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def fetch_rows():
    req = urllib.request.Request(CSV_URL, headers={"User-Agent": "Mozilla/5.0"})
    text = urllib.request.urlopen(req, timeout=60).read().decode("utf-8")
    return list(csv.reader(io.StringIO(text)))


def main():
    rows = fetch_rows()
    if len(rows) < 100 or len(rows[0]) < 18:
        sys.exit(f"Unexpected sheet shape: {len(rows)} rows, {len(rows[0]) if rows else 0} columns")

    psus, seen_ids = [], {}
    brand = s1 = s2 = s3 = watts = ""
    for r in rows[1:]:
        r = [clean(c) for c in r] + [""] * (18 - len(r))
        if not any(r):
            continue
        # Fill in blanks from the row above; a new value at one level resets the levels below it.
        if r[BRAND]:
            brand, s1, s2, s3 = r[BRAND], "", "", ""
        if r[S1]:
            s1, s2, s3 = r[S1], "", ""
        if r[S2]:
            s2, s3 = r[S2], ""
        if r[S3]:
            s3 = r[S3]
        # Blank wattage means "same as above", but only within the same series.
        if r[BRAND] or r[S1] or r[S2] or r[S3]:
            watts = ""
        if r[WATTS]:
            watts = r[WATTS]
        tier = r[TIER].replace(" ", "")
        if not brand or not tier:
            continue

        series_parts = [p for p in (s1, s2, s3) if p and p != "-"]
        base = slug(" ".join([brand, *series_parts, watts])) or "psu"
        n = seen_ids.get(base, 0)
        seen_ids[base] = n + 1
        grade = tier.rstrip("*")
        psus.append({
            "id": base if n == 0 else f"{base}-{n + 1}",
            "brand": brand,
            "series": series_parts,
            "watts": watts,
            "w": parse_watts(watts),
            "tier": tier,
            "grade": grade,
            "rank": TIER_ORDER.index(grade) if grade in TIER_ORDER else len(TIER_ORDER),
            "limited": tier.endswith("*"),
            "year": int(r[YEAR]) if r[YEAR].isdigit() else None,
            "size": r[SIZE],
            "atx": r[ATX].replace(".X", ".x"),
            "input": r[INPUT],
            "modular": r[MODULAR],
            "eff": r[EFF],
            "topology": r[TOPO],
            "secondary": r[SEC],
            "regulation": r[REG],
            "odm": r[ODM],
            "platform": r[PLATFORM],
            "notes": r[NOTES],
        })

    OUT.write_text(json.dumps({
        "source": f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit?gid={GID}",
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "tiers": TIER_ORDER,
        "psus": psus,
    }, ensure_ascii=False, separators=(",", ":")))
    print(f"Wrote {len(psus)} PSUs to {OUT}")


if __name__ == "__main__":
    main()
