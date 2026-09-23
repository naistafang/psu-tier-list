"""One fetcher per store. Each returns every PSU listing the store has, in a common shape:

    {"sku", "name", "price", "regular", "url", "seller", "marketplace"}

To add a store, write a fetch function and register it in STORES at the bottom.
"""
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request

BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"


def get(url, accept="text/html"):
    req = urllib.request.Request(url, headers={
        "User-Agent": BROWSER_UA,
        "Accept": accept,
        "Accept-Language": "en-CA,en;q=0.9",
    })
    return urllib.request.urlopen(req, timeout=60).read().decode("utf-8", "replace")


def money(text):
    """'$1,099.00' -> 1099.0"""
    m = re.search(r"[\d,]+(?:\.\d+)?", text or "")
    return float(m.group(0).replace(",", "")) if m else None


def best_buy():
    """Best Buy Canada. No official API; its website loads search results from this JSON endpoint."""
    listings, page = [], 1
    while True:
        qs = urllib.parse.urlencode({"categoryid": "20380", "lang": "en-CA", "pageSize": 100, "page": page})
        data = json.loads(get(f"https://www.bestbuy.ca/api/v2/json/search?{qs}", accept="application/json"))
        for p in data.get("products", []):
            seller = (p.get("seller") or {}).get("name")
            listings.append({
                "sku": str(p.get("sku")),
                "name": p.get("name", ""),
                "price": p.get("salePrice"),
                "regular": p.get("regularPrice"),
                "url": "https://www.bestbuy.ca" + p.get("productUrl", ""),
                "seller": seller if p.get("isMarketplace") and seller else "Best Buy",
                "marketplace": bool(p.get("isMarketplace")),
            })
        print(f"  Best Buy page {page}/{data.get('totalPages')}: {len(listings)} listings", file=sys.stderr)
        if page >= (data.get("totalPages") or 1) or page >= 50:
            return listings
        page += 1
        time.sleep(1.5)


def canada_computers():
    """Canada Computers. Parses the power supply category pages (96 products per page)."""
    listings, page = [], 1
    while True:
        text = get(f"https://www.canadacomputers.com/en/1346/power-supplies?page={page}&resultsPerPage=96")
        for card in re.findall(r'<article class="product-miniature.*?</article>', text, re.S):
            sku = re.search(r'data-id-product="(\d+)"', card)
            title = re.search(r'product-title[^>]*>\s*<a href="([^"]+)"[^>]*>(.*?)</a>', card, re.S)
            price = re.search(r'data-final_price="([^"]*)"', card)
            if not (sku and title and price):
                continue
            regular = re.search(r'data-regular_price="([^"]*)"', card)
            listings.append({
                "sku": sku.group(1),
                "name": html.unescape(re.sub(r"\s+", " ", title.group(2))).strip(),
                "price": money(price.group(1)),
                "regular": money(regular.group(1)) if regular else None,
                "url": html.unescape(title.group(1)),
                "seller": "Canada Computers",
                "marketplace": False,
            })
        print(f"  Canada Computers page {page}: {len(listings)} listings", file=sys.stderr)
        if 'rel="next"' not in text or page >= 20:
            return listings
        page += 1
        time.sleep(1.5)


def vuugo():
    """Vuugo. Parses the power supply category pages (32 products per page); out-of-stock items are skipped."""
    listings, page = [], 1
    card_re = re.compile(
        r'<h3 class="product-name">\s*<a href="([^"]+)" title="([^"]*)".*?'
        r'<ins class="new-price">([^<]*)</ins>(.*?)product-availability">\s*<div class="([^"]+)"', re.S)
    while True:
        text = get(f"https://www.vuugo.com/category/power-supplies-560/?page={page}")
        for url, name, price, between, stock in card_re.findall(text):
            if stock != "in-stock":
                continue
            regular = re.search(r'<del class="old-price">([^<]*)</del>', between)
            listings.append({
                "sku": url.strip("/").split("/")[-1],
                "name": html.unescape(name).strip(),
                "price": money(price),
                "regular": money(regular.group(1)) if regular else None,
                "url": "https://www.vuugo.com" + url,
                "seller": "Vuugo",
                "marketplace": False,
            })
        print(f"  Vuugo page {page}: {len(listings)} in-stock listings", file=sys.stderr)
        if f'href="?page={page + 1}"' not in text or page >= 40:
            return listings
        page += 1
        time.sleep(1.5)


# key -> (display name, fetch function, minimum listings for a fetch to count as successful)
STORES = {
    "bestbuy": ("Best Buy", best_buy, 100),
    "canadacomputers": ("Canada Computers", canada_computers, 50),
    "vuugo": ("Vuugo", vuugo, 30),
}
