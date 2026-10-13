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

# Print what the parser needs, since artifacts can't be read from the session.
t = open("probe/page1.html").read()
i = t.find('class="item-cell"')
print("=== ITEM CELL ===")
print(t[i:i + 6000])
j = t.find("list-tool-pagination-text")
print("=== PAGINATION ===")
print(t[j - 50:j + 300])
if os.path.exists("probe/state1.json"):
    s = json.load(open("probe/state1.json"))
    def walk(o, path="", depth=0):
        if depth > 4: return
        if isinstance(o, dict):
            for k, v in o.items():
                if isinstance(v, (dict, list)):
                    print(f"{path}/{k} {type(v).__name__} {len(v)}")
                    walk(v, f"{path}/{k}", depth + 1)
        elif isinstance(o, list) and o:
            walk(o[0], path + "[0]", depth + 1)
    print("=== STATE TREE ===")
    walk(s)
    txt = json.dumps(s)
    k = txt.find('"ItemCell"')
    print("=== FIRST ItemCell ===")
    print(txt[k:k + 5000])
