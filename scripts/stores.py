"""One fetcher per store. Each returns every in-stock PSU listing the store has, in a common shape:

    {"sku", "name", "price", "regular", "url", "seller", "marketplace"}

To add a store, write a fetch function and register it in STORES at the bottom.
"""
import html
import http.cookiejar
import json
import re
import sys
import time
import urllib.parse
import urllib.request

# Seconds to wait between page requests to the same store. Vuugo's robots.txt asks for at
# least 2; the same gap is used everywhere to keep the daily run light on every store.
PAGE_DELAY = 2.5

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


def best_buy_in_stock(skus):
    """SKUs Best Buy can ship now or has in a store. Search results carry no stock info, so this
    asks the endpoint product pages use, 50 SKUs at a time (100 is refused). Backorders don't count."""
    in_stock = set()
    for i in range(0, len(skus), 50):
        qs = urllib.parse.urlencode({
            "accept": "application/vnd.bestbuy.simpleproduct.v1+json", "accept-language": "en-CA",
            "locations": "", "postalCode": "M5V", "skus": "|".join(skus[i:i + 50]),
        })
        data = json.loads(get(f"https://www.bestbuy.ca/ecomm-api/availability/products?{qs}", accept="application/json"))
        for a in data.get("availabilities", []):
            if (a.get("shipping") or {}).get("status", "").startswith("InStock") or (a.get("pickup") or {}).get("status") == "InStock":
                in_stock.add(str(a.get("sku")))
        time.sleep(PAGE_DELAY)
    return in_stock


def best_buy():
    """Best Buy Canada. No official API; its website loads search results from this JSON endpoint.
    Out-of-stock items are skipped."""
    listings = best_buy_all()
    in_stock = best_buy_in_stock([l["sku"] for l in listings])
    print(f"  Best Buy: {len(in_stock)} of {len(listings)} listings in stock", file=sys.stderr)
    return [l for l in listings if l["sku"] in in_stock]


def best_buy_all():
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
        time.sleep(PAGE_DELAY)


def canada_computers():
    """Canada Computers. Parses the power supply category pages (96 products per page). Items sold out
    both online and in every store are skipped; in-store-only stock counts, since it can be picked up."""
    listings, page = [], 1
    while True:
        text = get(f"https://www.canadacomputers.com/en/1346/power-supplies?page={page}&resultsPerPage=96")
        for card in re.findall(r'<article class="product-miniature.*?</article>', text, re.S):
            sku = re.search(r'data-id-product="(\d+)"', card)
            title = re.search(r'product-title[^>]*>\s*<a href="([^"]+)"[^>]*>(.*?)</a>', card, re.S)
            price = re.search(r'data-final_price="([^"]*)"', card)
            if not (sku and title and price):
                continue
            online = re.search(r'data-stock_availability_online="([^"]*)"', card)
            retail = re.search(r'data-stock_availability_retail="([^"]*)"', card)
            if not ((online and online.group(1) == "1") or (retail and retail.group(1) == "1")):
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
        time.sleep(PAGE_DELAY)


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
        time.sleep(PAGE_DELAY)


def shoprbc_stock(opener, pids):
    """shopRBC warehouse quantity for each product id. The category pages say "Usually Ships in
    24-48 Hours" for everything; the real count ("Quantity: 0 (backorder available)") comes from
    the request the product page makes, which takes a PHP-serialized list of ids."""
    items = "".join(f'i:{i};a:1:{{s:2:"pi";i:{pid};}}' for i, pid in enumerate(pids))
    body = f'a:2:{{s:5:"items";a:{len(pids)}:{{{items}}}s:4:"mode";s:7:"details";}}'
    text = opener.open("https://www.shoprbc.com/ca/shop/requests/searchResultsAvailability.php",
                       urllib.parse.urlencode({"JINN_HTTP_REQUEST_DATA": body}).encode(), timeout=60)
    text = text.read().decode("utf-8", "replace")
    stock = {}
    for i, brief in re.findall(r'\[(\d+)\]\["brief"\] = "(.*?)";', text):
        qty = re.search(r"Quantity:\s*(\d+)", brief)
        stock[pids[int(i)]] = int(qty.group(1)) if qty else 0
    if pids and not stock:
        raise RuntimeError("shopRBC availability request returned nothing")
    return stock


def shoprbc():
    """shopRBC. Parses the power supply category pages (30 products per page); out-of-stock items are skipped."""
    listings, page = [], 1
    row_re = re.compile(
        r'product_details\.php\?pid=(\d+)"[^>]*>([^<]+)</a>.*?'
        r'nowrap="nowrap" style="text-align: right;">\s*(?:<[^>]+>\s*)*\$([\d,]+\.\d\d)', re.S)
    # The availability request only answers a session that has opened a product page.
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    opener.addheaders = [("User-Agent", BROWSER_UA), ("Accept-Language", "en-CA,en;q=0.9")]
    session_started = False
    while True:
        text = opener.open(f"https://www.shoprbc.com/ca/shop/categoryProducts.php?category=179&rx=&page={page}",
                           timeout=60).read().decode("utf-8", "replace")
        rows = row_re.findall(text)
        if rows and not session_started:
            time.sleep(PAGE_DELAY)
            opener.open(f"https://www.shoprbc.com/ca/shop/product_details.php?pid={rows[0][0]}", timeout=60).read()
            session_started = True
        time.sleep(PAGE_DELAY)
        stock = shoprbc_stock(opener, [pid for pid, _, _ in rows])
        for pid, name, price in rows:
            if not stock.get(pid):
                continue
            listings.append({
                "sku": pid,
                "name": html.unescape(re.sub(r"\s+", " ", name)).strip(),
                "price": money(price),
                "regular": None,
                "url": f"https://www.shoprbc.com/ca/shop/product_details.php?pid={pid}",
                "seller": "shopRBC",
                "marketplace": False,
            })
        print(f"  shopRBC page {page}: {len(listings)} in-stock listings", file=sys.stderr)
        if f"page={page + 1}" not in text or page >= 40:
            return listings
        page += 1
        time.sleep(PAGE_DELAY)


# key -> (display name, fetch function, minimum listings for a fetch to count as successful)
STORES = {
    "bestbuy": ("Best Buy", best_buy, 100),
    "canadacomputers": ("Canada Computers", canada_computers, 50),
    "vuugo": ("Vuugo", vuugo, 30),
    "shoprbc": ("shopRBC", shoprbc, 50),
}
