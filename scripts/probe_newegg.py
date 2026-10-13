# Temporary: saves Newegg.com PSU listing pages (same layout as newegg.ca) for parser work. Removed before merge.
import gzip, json, os, re, time, urllib.request
os.makedirs("probe", exist_ok=True)
H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
     "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9", "Accept-Encoding": "gzip"}
for n, url in [(1, "https://www.newegg.com/Power-Supplies/SubCategory/ID-58"), (2, "https://www.newegg.com/Power-Supplies/SubCategory/ID-58/Page-2")]:
    r = urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=60)
    b = r.read()
    if r.headers.get("Content-Encoding") == "gzip":
        b = gzip.decompress(b)
    t = b.decode("utf-8", "replace")
    open(f"probe/page{n}.html", "w").write(t)
    m = re.search(r"window\.__initialState__\s*=\s*", t)
    if m:
        s, _ = json.JSONDecoder().raw_decode(t[m.end():])
        json.dump(s, open(f"probe/state{n}.json", "w"))
        print("state keys", list(s)[:40])
    print(n, len(t))
    time.sleep(3)

# Print the item fields the parser needs.
s = json.load(open("probe/state1.json"))
print("PageInfo", s.get("PageInfo"), "Total", s.get("TotalItemCount"))
c = s["Products"][0]["ItemCell"]
print("KEYS", sorted(k for k, v in c.items() if not isinstance(v, (dict, list))))
for k in ["Seller", "ItemPriceRange", "Feature"]:
    print(k, json.dumps(c.get(k))[:1500])
for pr in s["Products"][:12]:
    c = pr["ItemCell"]
    small = {k: v for k, v in c.items() if not isinstance(v, (dict, list)) and v not in (None, "", 0, False)}
    print("ITEM", json.dumps({**small, "Title": c["Description"]["Title"][:60], "Url": c["Description"].get("UrlKeywords"), "SellerName": (c.get("Seller") or {}).get("SellerName")})[:1500])
