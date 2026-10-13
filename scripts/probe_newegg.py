# Temporary: runs the Newegg fetcher against newegg.com (same layout as newegg.ca, which blocks
# GitHub's servers) and checks how many listings the matcher places. Removed before merge.
import json, sys
sys.path.insert(0, "scripts")
import update_prices as u
from stores import newegg_live

listings = newegg_live("https://www.newegg.com")
print("listings", len(listings), "marketplace", sum(l["marketplace"] for l in listings))
psus = json.load(open("data/psus.json"))["psus"]
brands = sorted(((b, u.brand_aliases(b)) for b in {p["brand"] for p in psus}), key=lambda x: -max(len(a) for a in x[1]))
matchers = u.build_matchers(psus)
matched = 0
for l in listings:
    if u.SKIP_RE.search(l["name"]) or u.REGIONAL_RE.search(l["name"]):
        continue
    psu, w = u.match(l, brands, matchers)
    matched += bool(psu)
    if l is listings[0] or len(listings) and listings.index(l) < 25:
        print(("OK  " + psu["id"] + f"@{w}") if psu else "--  unmatched", "|", l["seller"], l["price"], l["regular"], "|", l["name"][:80], "|", l["url"][:90])
print("matched", matched, "of", len(listings))
