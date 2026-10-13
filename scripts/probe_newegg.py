# Temporary: checks whether Newegg.ca answers a GitHub runner. Removed before merge.
import gzip, time, urllib.request, urllib.error

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
FULL = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-CA,en;q=0.9",
    "Accept-Encoding": "gzip",
    "Sec-Ch-Ua": '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
    "Sec-Ch-Ua-Mobile": "?0", "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "none", "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
}
tries = [
    ("full headers, listing", "https://www.newegg.ca/Power-Supplies/SubCategory/ID-58", FULL),
    ("full headers, home", "https://www.newegg.ca/", FULL),
    ("curl UA, listing", "https://www.newegg.ca/Power-Supplies/SubCategory/ID-58", {"User-Agent": "curl/8.5.0", "Accept": "*/*"}),
    ("product realtime api", "https://www.newegg.ca/product/api/ProductRealtime?ItemNumber=17-139-336", {**FULL, "Accept": "application/json"}),
    ("newegg.com listing", "https://www.newegg.com/Power-Supplies/SubCategory/ID-58", FULL),
]
for label, url, h in tries:
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=30)
        body = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            body = gzip.decompress(body)
        t = body.decode("utf-8", "replace")
        print(f"OK {r.status} {label} len={len(t)} item-cell={t.count('item-cell')} initialState={t.count('__initialState__')}")
        print("   ", t[:300].replace("\n", " "))
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code} {label} server={e.headers.get('Server')} body={e.read()[:200]!r}")
    except Exception as e:
        print(f"FAIL {label} {e}")
    time.sleep(3)
