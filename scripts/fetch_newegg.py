#!/usr/bin/env python3
"""Fetch Newegg.ca's in-stock PSU listings into data/newegg_listings.json.

Newegg.ca shows GitHub's servers a CAPTCHA instead of its pages, so this runs on a
self-hosted runner at home (.github/workflows/fetch-newegg.yml). update_prices.py then
matches these listings like any other store's. If the fetch fails, the file is left
as it was, and update_prices.py keeps Newegg's previous prices until it is 36 hours old.
"""
import json
import sys
from datetime import datetime, timezone

from stores import NEWEGG_FILE, STORES, newegg_live


def main():
    try:
        listings = newegg_live()
    except Exception as e:
        sys.exit(f"Newegg fetch failed: {e}")
    minimum = STORES["newegg"][2]
    if len(listings) < minimum:
        sys.exit(f"Only {len(listings)} Newegg listings (expected at least {minimum}); leaving {NEWEGG_FILE.name} unchanged.")
    NEWEGG_FILE.write_text(json.dumps({
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "listings": listings,
    }, ensure_ascii=False, separators=(",", ":")))
    print(f"Saved {len(listings)} Newegg listings")


if __name__ == "__main__":
    main()
