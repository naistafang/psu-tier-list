#!/usr/bin/env python3
"""Fetch Canadian PSU prices from several stores and match them to tier list rows.

Each store in stores.py returns its whole power supply catalogue. Every listing
is matched to a row of data/psus.json by brand, series name and wattage.

Matching is heuristic. Several generations of a PSU often share a name
(e.g. the Corsair RM850x from 2015, 2018, 2021 and 2024); when a listing does
not say which one it is, we assume the newest, since that is almost always
what's being sold. data/price_overrides.json lets you fix bad matches by hand.

If a store can't be reached, its prices from the previous run are kept.

Output: data/prices.json, plus data/history.json (see update_history)
  { "updated": ..., "stores": {key: {name, updated, count}},
    "prices": { "<psu id>": [ {store, watts, price, regular, name, url, seller, marketplace}, ... ] } }
"""
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from stores import STORES

DATA = Path(__file__).resolve().parent.parent / "data"

# Listings to ignore entirely.
SKIP_RE = re.compile(r"refurb|open box|open-box|used|pre-owned|renewed|\bcable\b.*\bkit\b|sleeved cable|extension|tester", re.I)

# Words in a series name that describe a revision rather than name a product.
# A listing doesn't have to contain them, but gets a small bonus if it does.
OPTIONAL_WORDS = {
    "black", "white", "gray", "grey", "green", "label", "snow", "atx", "3.0", "3.1", "2.x", "3.x",
    "new", "old", "standard", "rev", "revision", "version", "edition", "gen", "v1", "v2", "v3", "v4",
    "gold", "bronze", "silver", "platinum", "titanium", "plus", "80", "modular", "non", "semi", "full",
    "fully", "mod", "non-mod", "230v", "sfx", "sfx-l", "original", "refresh", "asia", "full range",
}
# Words that carry no meaning at all.
STOP_WORDS = {"series", "power", "supply", "psu", "the", "and", "with", "of", "-", "+"}

# Store listings that use a different brand spelling than the tier list.
EXTRA_BRAND_ALIASES = {"ASUS": {"rog", "tuf"}, "Lian Li": {"lian-li"}, "Antec/Atom": {"antec"}}

def norm(s):
    s = s.lower().replace("™", "").replace("®", "")
    s = re.sub(r"pcie\s+(\d)", r"pcie\1", s)
    s = re.sub(r"atx(\d)", r"atx \1", s)
    return re.sub(r"[^a-z0-9.+\-]+", " ", s).strip()


def brand_aliases(brand):
    parts = re.split(r"[/()]", brand)
    aliases = {norm(p) for p in parts if len(norm(p)) >= 2} | {norm(re.sub(r"[()/]", " ", brand))}
    aliases |= {a.replace(" ", "") for a in aliases}  # "Super Flower" -> "superflower"
    aliases |= EXTRA_BRAND_ALIASES.get(brand, set())
    return {a for a in aliases if a}


def word_re(word):
    """Regex for one series word. 'RM-x' also matches RMx / RM850x / RM 850x;
    'GX' also matches GX-750 / GX750."""
    if re.fullmatch(r"(19|20)\d\d", word):
        return re.compile(rf"(?<![a-z0-9]){word}(?![a-z0-9])")
    w = re.escape(word)
    if "\\-" in w:
        pre, _, post = w.partition("\\-")
        return re.compile(rf"(?<![a-z0-9]){pre}[\s\-]?(?:\d{{3,4}}\s?)?{post}(?![a-z0-9])")
    return re.compile(rf"(?<![a-z0-9]){w}(?:[\s\-]?\d{{3,4}}[a-z]?)?(?![a-z0-9])")


def words(text):
    return [w.strip(".") for w in re.findall(r"[a-z0-9][a-z0-9.+\-]*", norm(text)) if w not in STOP_WORDS]


def part_alternatives(part):
    """'Cuprum Strike (CSK)' -> [['cuprum', 'strike'], ['csk']]. Stores use either spelling."""
    base = re.sub(r"\(.*?\)", " ", part)
    alts = [words(base)] + [words(x) for x in re.findall(r"\((.*?)\)", part)]
    return [[(w, word_re(w), w in OPTIONAL_WORDS) for w in alt] for alt in alts if alt]


def build_matchers(psus):
    by_brand = {}
    for p in psus:
        levels = [part_alternatives(part) for part in p["series"]]
        by_brand.setdefault(p["brand"], []).append({
            "psu": p,
            "levels": [l for l in levels if l],
            "words": set(words(" ".join(p["series"]))),
        })
    return by_brand


def score(matcher, n):
    """Score how well a listing name fits a tier list row, or None if it doesn't fit.
    Each distinctive series word found counts for the row, each one missing counts
    against it; revision words (colours, years, ATX version) only break ties."""
    levels = []
    for alts in matcher["levels"]:
        best = None
        for alt in alts:
            hits = [(w, strongest(r, n)) for w, r, opt in alt if not opt]
            hit = [m for w, m in hits if m]
            # A model code with the wattage inside it (RM850x, PN750M, GX-750) is strong evidence.
            strong = sum(1 for m in hit if re.search(r"\d{3}", m.group(0)))
            cand = {
                "points": 3 * len(hit) + 3 * strong,
                "miss": len(hits) - len(hit),
                "chars": sum(len(w) for w, m in hits if m),
                "bonus": sum(1 for w, r, opt in alt if opt and r.search(n)),
                "found": len(hit),
                "strong": strong,
            }
            if best is None or (cand["points"] - 2 * cand["miss"], cand["chars"]) > (best["points"] - 2 * best["miss"], best["chars"]):
                best = cand
        levels.append(best)
    if not any(l["found"] for l in levels):
        return None
    # Missing a word of the main series name ("Core" in Core GX) costs more than missing a sub-series word.
    total = sum(l["points"] - (5 if i == 0 else 2) * l["miss"] for i, l in enumerate(levels))
    if total < 1:
        return None
    # "Leadex VIII" or "Pure Power 13" must not match a row that lacks that generation.
    for alt in matcher["levels"][0]:
        for w, r, opt in alt:
            for m in r.finditer(n):
                nxt = n[m.end():].split(maxsplit=1)
                if nxt and nxt[0] != "80" and GENERATION_RE.fullmatch(nxt[0]) and nxt[0] not in matcher["words"]:
                    return None
    return (total, sum(l["chars"] for l in levels), sum(l["bonus"] for l in levels), matcher["psu"]["year"] or 0)


def strongest(regex, n):
    """The match with a wattage in it if there is one (RM850x beats a bare RMx), else the first."""
    matches = list(regex.finditer(n))
    return next((m for m in matches if re.search(r"\d{3}", m.group(0))), matches[0] if matches else None)


GENERATION_RE = re.compile(r"ii|iii|iv|vi|vii|viii|ix|xi|xii|\d{1,2}")


def listing_watts(name):
    n = name.lower()
    m = re.search(r"(\d{3,4})\s?-?\s?(?:w\b|watts?\b)", n)
    if m:
        return int(m.group(1))
    # Model numbers like RM850x, GX-750, SF750
    for m in re.finditer(r"[a-z]{1,4}-?(\d{3,4})[a-z]{0,2}\b", n):
        w = int(m.group(1))
        if 250 <= w <= 3000 and w % 50 == 0:
            return w
    return None


def watts_ok(psu, w):
    spec = psu["w"]
    if w in spec["list"]:
        return True
    return any(lo <= w <= hi for lo, hi in spec["ranges"])


def match(product, brands, matchers):
    name = product["name"]
    n = norm(name)
    padded = f" {n} "
    brand = next((b for b, aliases in brands if any(f" {a} " in padded or n.startswith(a + " ") for a in aliases)), None)
    if not brand:
        return None, None
    w = listing_watts(name)
    if not w:
        return None, None
    best, best_key = None, None
    for m in matchers.get(brand, []):
        if not watts_ok(m["psu"], w):
            continue
        key = score(m, n)
        if key and (best_key is None or key > best_key):
            best, best_key = m["psu"], key
    return best, w


def fetch_store(key, fetch, minimum, cache_dir):
    """Returns the store's listings, or None if the fetch failed."""
    cache = cache_dir / f"{key}.json" if cache_dir else None
    if cache and cache.exists():
        return json.loads(cache.read_text())
    try:
        listings = fetch()
    except Exception as e:
        print(f"{key}: fetch failed: {e}", file=sys.stderr)
        return None
    if len(listings) < minimum:
        print(f"{key}: only {len(listings)} listings, treating as a failed fetch", file=sys.stderr)
        return None
    if cache:
        cache.write_text(json.dumps(listings))
    return listings


def main():
    psus = json.loads((DATA / "psus.json").read_text())["psus"]
    by_id = {p["id"]: p for p in psus}
    overrides_path = DATA / "price_overrides.json"
    overrides = json.loads(overrides_path.read_text()) if overrides_path.exists() else {}
    sku_overrides = overrides.get("sku", {})
    ignored = set(overrides.get("ignore", []))
    prices_path = DATA / "prices.json"
    previous = json.loads(prices_path.read_text()) if prices_path.exists() else {}

    # Optional: `update_prices.py some/dir` caches each store's download there, handy when tuning the matcher.
    cache_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    if cache_dir:
        cache_dir.mkdir(parents=True, exist_ok=True)

    brands = sorted(((b, brand_aliases(b)) for b in {p["brand"] for p in psus}),
                    key=lambda x: -max(len(a) for a in x[1]))
    matchers = build_matchers(psus)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")

    prices, stores, unmatched, fetched_any = {}, {}, [], False
    for key, (store_name, fetch, minimum) in STORES.items():
        listings = fetch_store(key, fetch, minimum, cache_dir)
        if listings is None:
            # Keep this store's offers from the last successful run.
            if key in previous.get("stores", {}):
                stores[key] = previous["stores"][key]
                for pid, offers in previous.get("prices", {}).items():
                    if pid in by_id:
                        prices.setdefault(pid, []).extend(o for o in offers if o.get("store") == key)
            continue
        fetched_any = True
        matched = 0
        for item in listings:
            override_key = f"{key}:{item['sku']}"
            if override_key in ignored or SKIP_RE.search(item["name"]) or not item["price"]:
                continue
            if override_key in sku_overrides:
                psu = by_id.get(sku_overrides[override_key]["id"])
                w = sku_overrides[override_key].get("watts") or listing_watts(item["name"])
            else:
                psu, w = match(item, brands, matchers)
            if not psu:
                unmatched.append(f"{store_name}: {item['name']}")
                continue
            matched += 1
            prices.setdefault(psu["id"], []).append({"store": key, "watts": w, **item})
        stores[key] = {"name": store_name, "updated": now, "count": matched}
        print(f"{store_name}: {len(listings)} listings, {matched} matched")

    if not fetched_any:
        sys.exit("No store could be fetched; leaving prices.json unchanged.")

    for offers in prices.values():
        for o in offers:
            o.pop("sku", None)
        offers.sort(key=lambda o: (o["watts"] or 0, o["price"]))

    prices_path.write_text(json.dumps({
        "currency": "CAD",
        "updated": now,
        "stores": stores,
        "prices": prices,
    }, ensure_ascii=False, separators=(",", ":")))
    (DATA / "unmatched_listings.txt").write_text("\n".join(sorted(unmatched)) + "\n")
    update_history(prices, now[:10])
    print(f"{sum(map(len, prices.values()))} offers across {len(prices)} tier list rows")


def update_history(prices, today):
    """Append today's lowest price per model to data/history.json.

    Each model ("<psu id>@<watts>") keeps a list of [date, price] points, but a point is
    only added when the price changes, so the file grows slowly. null means no store
    listed it. Running twice on the same day overwrites that day's point.
    """
    path = DATA / "history.json"
    history = json.loads(path.read_text()) if path.exists() else {"since": today, "prices": {}}
    lows = {}
    for pid, offers in prices.items():
        for o in offers:
            key = f"{pid}@{o['watts']}"
            lows[key] = min(lows.get(key, o["price"]), o["price"])

    for key in set(history["prices"]) | set(lows):
        points = history["prices"].setdefault(key, [])
        if points and points[-1][0] == today:
            points.pop()
        price = lows.get(key)
        if not points or points[-1][1] != price:
            points.append([today, price])
        if points == [[today, None]]:
            del history["prices"][key]

    path.write_text(json.dumps(history, separators=(",", ":"), sort_keys=True))


if __name__ == "__main__":
    main()
