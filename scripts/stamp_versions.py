#!/usr/bin/env python3
"""Tag the stylesheet and script links in index.html with a fingerprint of their contents.

GitHub Pages lets browsers reuse a saved copy of each file for 10 minutes. With the
fingerprint in the link (styles.css?v=1a2b3c4d), a changed file gets a new link, so
browsers fetch it straight away instead of showing the old version.

Run it after editing styles.css or app.js. Prints what changed; does nothing if
everything is already up to date.
"""
import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / "index.html"
ASSETS = ["styles.css", "app.js"]


def fingerprint(name):
    return hashlib.sha256((ROOT / name).read_bytes()).hexdigest()[:8]


def main():
    html = PAGE.read_text()
    updated = html
    for name in ASSETS:
        pattern = re.compile(rf'(["\']){re.escape(name)}(?:\?v=[0-9a-f]*)?\1')
        if not pattern.search(updated):
            raise SystemExit(f"{name} is not linked from index.html")
        updated = pattern.sub(rf"\g<1>{name}?v={fingerprint(name)}\g<1>", updated)
    if updated == html:
        print("index.html: versions already up to date")
        return
    PAGE.write_text(updated)
    for name in ASSETS:
        print(f"index.html: {name}?v={fingerprint(name)}")


if __name__ == "__main__":
    main()
