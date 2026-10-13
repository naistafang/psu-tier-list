# SPL's Tier List with Price

A searchable, filterable view of [SPL's tier list spreadsheet](https://docs.google.com/spreadsheets/d/1akCHL7Vhzk_EhrpIGkz8zTEvYfLDcaSpZRB6Xt6JWkc/edit?gid=931697732), with Canadian prices.

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
| `scripts/fetch_newegg.py` | `data/newegg_listings.json` | Newegg.ca, from a computer at home (see below) |

Current price sources are **Best Buy Canada**, **Canada Computers**, **Vuugo**, **shopRBC** and **Newegg.ca** (see below). Only in-stock items are listed: backorders and sold-out items are skipped, and at Canada Computers an item available for in-store pickup counts as in stock. None of them has an official API, so the scripts read their public product listings. If a store's site changes and its fetch fails, that store's previous prices are kept.

Best Buy also lists third-party marketplace sellers, whose prices often run far above retail. The site hides them unless you turn on "Include third-party marketplace sellers" in Filters, and they never count toward the price history. Regional versions that don't suit Canadian outlets (EU plugs, 240V-only units, Brazil SKUs) are skipped.

`data/history.json` records each model's lowest price across all stores (marketplace sellers excluded), adding a point only when that price changes, so it grows slowly. The site uses it for the ▲/▼ markers and the price chart.

Listings are matched to tier list rows by brand, series name and wattage. The matching is approximate: several PSU generations often share a name. When a listing fits more than one row, the matcher prefers the row whose specs agree with what the listing states (80 Plus rating, including a model code suffix like the G in PQ750G; modularity; ATX version; SFX or ATX), then the North American version over EU or 230V-only units, then the newest one. Listings it couldn't match go to `data/unmatched_listings.txt`. To fix a wrong match, add it to `data/price_overrides.json`.

### Newegg prices (self-hosted runner)

Newegg.ca shows GitHub's servers a CAPTCHA instead of its pages, so its listings are fetched from a computer at home that's registered as a GitHub Actions runner. The **Fetch Newegg prices** workflow (`.github/workflows/fetch-newegg.yml`) runs there daily at 01:47 UTC and commits `data/newegg_listings.json`; the daily update then matches those listings like any other store's. Newegg's own listings and its marketplace sellers are told apart by item number, and a real shipping charge is added to the price. If the computer is off, the job waits for it for up to a day. Listings older than 36 hours aren't used, and Newegg's previous prices are kept until then.

To set it up:

1. On the computer, make sure Python 3 and Git are installed.
2. In the repository, open **Settings → Actions → Runners → New self-hosted runner**, pick the computer's OS and run the commands it shows. When `config` asks for additional labels, enter `newegg`.
3. Keep the runner running in the background: on Windows, answer yes when `config` offers to run it as a service; on macOS or Linux, run `sudo ./svc.sh install` and then `sudo ./svc.sh start` in the runner folder.
4. Because this repository is public, open **Settings → Actions → General** and under **Approval for running fork pull request workflows from contributors** choose **Require approval for all external contributors**. Otherwise someone could open a pull request whose workflow runs on your computer.
5. On the **Actions** tab, open **Fetch Newegg prices** and click **Run workflow** to test it.

### Adding a store

Write a function in `scripts/stores.py` that returns the store's in-stock PSU listings as `{sku, name, price, regular, url, seller, marketplace}`, then add it to `STORES`. The site picks up new stores automatically.

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

All tier ratings, specifications and notes come from SPL's tier list spreadsheet and its maintainers. This site only reformats that data.
