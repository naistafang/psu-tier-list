# PSU Tier List

A searchable, filterable view of the [SPL's PSU tier list spreadsheet](https://docs.google.com/spreadsheets/d/1akCHL7Vhzk_EhrpIGkz8zTEvYfLDcaSpZRB6Xt6JWkc/edit?gid=931697732), with Canadian prices.

- Search by brand, series, model number (`RM850x`, `GX-750`), OEM, platform or notes
- Filter by tier, wattage, form factor, 80 Plus rating, modularity, ATX version, year and store
- Sort by tier, price, price per watt, wattage, brand or year
- Click a row for full specs, notes, prices from every store, price history, and search links for other Canadian stores
- Star PSUs to mark them as favorites (saved in your browser)
- Filters are saved in the URL, so any view can be bookmarked or shared; click the title to reset everything
- Keyboard: `/` jumps to search, Esc clears it
- Light and dark themes (follows your device until you pick one)

It's a static site (plain HTML/CSS/JS, no build step), so it runs on GitHub Pages.

## How the data is updated

A GitHub Action (`.github/workflows/update-data.yml`) runs daily and commits fresh data:

| Script | Writes | Source |
|---|---|---|
| `scripts/update_sheet.py` | `data/psus.json` | The Google Sheet's public CSV export |
| `scripts/update_prices.py` | `data/prices.json`, `data/history.json` | Every store in `scripts/stores.py` |

Current price sources are **Best Buy Canada**, **Canada Computers** and **Vuugo** (in-stock items only). None of them has an official API, so the scripts read their public product listings. If a store's site changes and its fetch fails, that store's previous prices are kept.

`data/history.json` records each model's lowest price across all stores, adding a point only when that price changes, so it grows slowly. The site uses it for the ▲/▼ markers and the price chart.

Listings are matched to tier list rows by brand, series name and wattage. The matching is approximate: several PSU generations often share a name, and the matcher assumes the newest one. Listings it couldn't match go to `data/unmatched_listings.txt`. To fix a wrong match, add it to `data/price_overrides.json`.

### Adding a store

Write a function in `scripts/stores.py` that returns the store's PSU listings as `{sku, name, price, regular, url, seller, marketplace}`, then add it to `STORES`. The site picks up new stores automatically.

## Editing the site

After changing `styles.css` or `app.js`, run `python3 scripts/stamp_versions.py` before committing. It puts a fingerprint of each file into its link in `index.html` (`app.js?v=1a2b3c4d`), so browsers load the new version right away instead of a copy saved up to 10 minutes earlier. The daily Action also runs it, to catch edits made on the GitHub website.

## Run locally

```sh
python3 scripts/update_sheet.py      # refresh the tier list
python3 scripts/update_prices.py     # refresh prices
python3 -m http.server 8000          # then open http://localhost:8000
```

## Publish on GitHub Pages

1. Create a GitHub repository and push this folder to it.
2. In the repository, open **Settings → Pages** and set **Source** to "Deploy from a branch", branch `main`, folder `/ (root)`.
3. In **Settings → Actions → General**, under **Workflow permissions**, choose **Read and write permissions** so the daily update can commit.
4. Optional: run the "Update tier list and prices" workflow from the **Actions** tab to test it.

## Credits

All tier ratings, specifications and notes come from the PSU tier list spreadsheet and its maintainers. This site only reformats that data.
