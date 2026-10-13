# Temporary: prints the structure of Newegg.ca's PSU listing page. Removed before merge.
import re, sys, time
sys.path.insert(0, "scripts")
from stores import get

for url in ["https://www.newegg.ca/Power-Supplies/SubCategory/ID-58", "https://www.newegg.ca/Power-Supplies/SubCategory/ID-58/Page-2"]:
    try:
        t = get(url)
    except Exception as e:
        print("FAIL", url, e); continue
    print("=====", url, len(t))
    for k in ["__initialState__", "item-cell", "item-title", "price-current", "price-was", "price-ship", "OUT OF STOCK", "list-tool-pagination-text", "9SIA", "N82E168", "Sold by", "captcha", "Are you a human"]:
        print(f"{k!r}: {t.count(k)}")
    i = t.find('class="item-cell"')
    print("--- first item cell ---")
    print(t[i:i + 4000] if i >= 0 else t[:2000])
    j = t.find("list-tool-pagination-text")
    print("--- pagination ---"); print(t[j - 100:j + 400])
    k = t.find("__initialState__")
    print("--- initial state ---"); print(t[k:k + 3000])
    time.sleep(3)
