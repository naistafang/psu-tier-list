"use strict";

const PAGE = 150;
const EFF_RANK = { T: 6, P: 5, G: 4, S: 3, B: 2, W: 1, N: 0 };
const EFF_NAME = { T: "Titanium", P: "Platinum", G: "Gold", S: "Silver", B: "Bronze", W: "White", N: "None" };
const MOD_NAME = { Full: "Full", Semi: "Semi", No: "No" };
const TOPOLOGY = { LLC: "LLC resonant", DF: "Double forward", ACRF: "Active clamp reset forward" };
const SECONDARY = { SR: "Synchronous", PR: "Passive" };
const REGULATION = { "DC-DC": "DC-DC", GR: "Group regulated" };
const STORES = [
  ["Best Buy", q => `https://www.bestbuy.ca/en-ca/search?search=${q}`],
  ["Amazon.ca", q => `https://www.amazon.ca/s?k=${q}`],
  ["Newegg.ca", q => `https://www.newegg.ca/p/pl?d=${q}`],
  ["Canada Computers", q => `https://www.canadacomputers.com/en/search?s=${q}`],
  ["Memory Express", q => `https://www.memoryexpress.com/Search/Products?Search=${q}`],
  ["PCPartPicker", q => `https://ca.pcpartpicker.com/search/?q=${q}`],
];

const $ = sel => document.querySelector(sel);
const money = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });

let DATA = [];
let TIERS = [];
let PRICES = {};
let STORE_INFO = {};
let HISTORY = {};
let historySince = null;
const shortlist = new Set(loadShortlist());
let view = [];
let shown = PAGE;
const open = new Set();

init();

async function init() {
  const [psus, prices, history] = await Promise.all([
    fetch("data/psus.json").then(r => r.json()),
    fetch("data/prices.json").then(r => (r.ok ? r.json() : null)).catch(() => null),
    fetch("data/history.json").then(r => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  HISTORY = history?.prices || {};
  historySince = history?.since || null;
  TIERS = psus.tiers;
  PRICES = prices?.prices || {};
  STORE_INFO = prices?.stores || {};
  // One entry per wattage: the sheet's "Corsair RM-x 750/850W" row becomes RM750x and RM850x.
  DATA = psus.psus.flatMap(p => {
    const rowOffers = PRICES[p.id] || [];
    const list = wattageList(p, rowOffers);
    // A few rows (e.g. "All PSUs" of a brand) have no wattage; they stay a single entry.
    return (list.length ? list : [{ w: null, estimated: false }]).map(({ w, estimated }) => {
      const offers = w ? rowOffers.filter(o => o.watts === w) : [];
      const text = [p.brand, ...p.series, w ? `${w}w` : "",  p.odm, p.platform, p.notes, p.size, p.atx, p.tier,
        ...offers.map(o => o.name)].join(" ").toLowerCase();
      return {
        ...p,
        key: `${p.id}@${w}`,
        wattage: w,
        estimated,
        name: [p.brand, ...p.series].join(" "),
        haystack: text,
        compact: compact(text + " " + (w ? modelNames(p, w).join(" ") : "")),
        offers,
      };
    });
  });
  for (const p of DATA) {
    p.display = displaySeries(p);
    p.name = [p.brand, ...p.display].join(" ");
  }
  // Double-sourced units (same model, different factory) get their OEM shown to tell them apart.
  const seen = new Map();
  for (const p of DATA) seen.set(`${p.name}@${p.wattage}`, (seen.get(`${p.name}@${p.wattage}`) || 0) + 1);
  for (const p of DATA) p.showOdm = seen.get(`${p.name}@${p.wattage}`) > 1 && !!p.odm;

  for (const el of document.querySelectorAll("#source-link, .source-link")) el.href = psus.source;
  $("#updated").textContent = [
    `Tier list synced ${fmtDate(psus.updated)}`,
    prices && `prices updated ${fmtDate(prices.updated)}`,
  ].filter(Boolean).join(" · ");

  buildControls();
  readHash();
  update();
}

function buildControls() {
  for (const t of TIERS) $("#tier").add(new Option(t, t));

  $("#theme").addEventListener("click", toggleTheme);
  syncThemeButton();

  // Search: "/" jumps to the box, Esc clears it, the × button clears it too.
  document.addEventListener("keydown", e => {
    if (e.key === "/" && !e.target.closest("input, select, textarea") && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      $("#q").focus();
      $("#q").select();
    }
  });
  $("#q").addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    if ($("#q").value) { $("#q").value = ""; update(); } else $("#q").blur();
  });
  $("#q-clear").addEventListener("click", () => { $("#q").value = ""; update(); $("#q").focus(); });

  $("#filters-toggle").addEventListener("click", () => {
    const open = $("#more-filters").classList.toggle("open");
    $("#filters-toggle").setAttribute("aria-expanded", String(open));
  });

  const names = Object.values(STORE_INFO).map(s => s.name);
  if (names.length) $("#store-names").textContent = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
  for (const [key, info] of Object.entries(STORE_INFO)) {
    const label = document.createElement("label");
    label.className = "check";
    label.innerHTML = `<input type="checkbox" value="${esc(key)}" checked> ${esc(info.name)}`;
    label.querySelector("input").addEventListener("change", update);
    $("#stores").append(label);
  }
  if (!names.length) $(".store-row").hidden = true;

  const sizes = [...new Set(DATA.map(p => p.size).filter(Boolean))].sort();
  for (const s of sizes) $("#size").add(new Option(s, s));
  const years = [...new Set(DATA.map(p => p.year).filter(Boolean))].sort((a, b) => b - a);
  for (const y of years) $("#year").add(new Option(`${y} or later`, y));

  let timer;
  $("#q").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(update, 120); });
  for (const id of ["sort", "tier", "watts", "size", "eff", "modular", "atx", "year", "priced", "confident", "nomarket", "starred"]) {
    $("#" + id).addEventListener("change", update);
  }
  for (const b of document.querySelectorAll("th button[data-sort]")) {
    b.addEventListener("click", () => {
      const s = b.dataset.sort;
      $("#sort").value = s === "price-asc" && $("#sort").value === "price-asc" ? "price-desc" : s;
      update();
    });
  }
  $("#reset").addEventListener("click", resetAll);
  $("#home").addEventListener("click", e => {
    // Plain left click resets in place; ctrl/cmd/shift/middle click still opens the link normally.
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    resetAll();
    window.scrollTo({ top: 0 });
  });
  $("#more").addEventListener("click", () => { shown += PAGE; render(); });
  $("#rows").addEventListener("click", e => {
    const star = e.target.closest("button.star");
    if (star) {
      toggleStar(star.dataset.key);
      return;
    }
    const tr = e.target.closest("tr.psu");
    if (!tr || e.target.closest("a")) return;
    open.has(tr.dataset.id) ? open.delete(tr.dataset.id) : open.add(tr.dataset.id);
    render();
  });
  $("#rows").addEventListener("keydown", e => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("tr.psu") && !e.target.closest("button")) {
      e.preventDefault();
      e.target.click();
    }
  });
  window.addEventListener("hashchange", () => { readHash(); update(false); });
}

// Search, filters, sort and store choices back to their defaults, and every row collapsed.
function resetAll() {
  for (const el of document.querySelectorAll(".controls select, .controls input")) {
    if (el.type === "checkbox") el.checked = !!el.closest("#stores"); else el.value = el.tagName === "SELECT" ? el.options[0].value : "";
  }
  open.clear();
  update();
}

function filters() {
  return {
    q: $("#q").value.trim().toLowerCase(),
    sort: $("#sort").value,
    tier: $("#tier").value,
    watts: +$("#watts").value || 0,
    size: $("#size").value,
    eff: $("#eff").value,
    modular: $("#modular").value,
    atx: $("#atx").value,
    year: +$("#year").value || 0,
    priced: $("#priced").checked,
    confident: $("#confident").checked,
    nomarket: $("#nomarket").checked,
    starred: $("#starred").checked,
    stores: new Set([...document.querySelectorAll("#stores input:checked")].map(i => i.value)),
  };
}

function offerAllowed(o, f) {
  return f.stores.has(o.store) && !(f.nomarket && o.marketplace);
}

// Cheapest listing that satisfies the store/seller filters.
function bestOffer(p, f) {
  let best = null;
  for (const o of p.offers) {
    if (!offerAllowed(o, f)) continue;
    if (!best || o.price < best.price) best = o;
  }
  return best;
}

function update(writeUrl = true) {
  const f = filters();
  const terms = f.q.split(/\s+/).filter(Boolean);
  view = [];
  for (const p of DATA) {
    if (f.tier && !(p.rank <= TIERS.indexOf(f.tier))) continue;
    if (f.confident && p.limited) continue;
    if (f.starred && !shortlist.has(p.key)) continue;
    if (f.watts && !(p.wattage >= f.watts)) continue;
    if (f.size && p.size !== f.size) continue;
    if (f.eff && !(EFF_RANK[p.eff] >= EFF_RANK[f.eff])) continue;
    if (f.modular && p.modular !== f.modular) continue;
    if (f.atx && p.atx !== f.atx) continue;
    if (f.year && !(p.year >= f.year)) continue;
    if (terms.length && !terms.every(t => p.haystack.includes(t) || p.compact.includes(compact(t)))) continue;
    const offer = bestOffer(p, f);
    if (f.priced && !offer) continue;
    view.push({ p, offer });
  }

  const byTier = (a, b) => a.p.rank - b.p.rank || a.p.limited - b.p.limited;
  const byName = (a, b) => a.p.name.localeCompare(b.p.name) || (a.p.wattage || 0) - (b.p.wattage || 0);
  const priceOf = x => (x.offer ? x.offer.price : null);
  const nullsLast = (a, b, cmp) => (a == null) - (b == null) || (a != null && b != null ? cmp(a, b) : 0);
  const sorters = {
    tier: (a, b) => byTier(a, b) || (b.p.year || 0) - (a.p.year || 0) || byName(a, b),
    "price-asc": (a, b) => nullsLast(priceOf(a), priceOf(b), (x, y) => x - y) || byTier(a, b),
    "price-desc": (a, b) => nullsLast(priceOf(a), priceOf(b), (x, y) => y - x) || byTier(a, b),
    ppw: (a, b) => nullsLast(ppw(a), ppw(b), (x, y) => x - y) || byTier(a, b),
    watts: (a, b) => nullsLast(a.p.wattage, b.p.wattage, (x, y) => x - y) || byTier(a, b) || byName(a, b),
    brand: (a, b) => byName(a, b) || byTier(a, b),
    year: (a, b) => (b.p.year || 0) - (a.p.year || 0) || byTier(a, b),
  };
  view.sort(sorters[f.sort] || sorters.tier);

  for (const th of document.querySelectorAll("th button[data-sort]")) {
    const s = th.dataset.sort;
    th.classList.toggle("active", f.sort === s || (s === "price-asc" && f.sort === "price-desc"));
  }
  $("#q-clear").hidden = !f.q;
  $("#star-count").textContent = shortlist.size;
  const active = ["tier", "watts", "size", "eff", "modular", "atx", "year"].filter(k => f[k]).length
    + ["priced", "confident", "nomarket", "starred"].filter(k => f[k]).length
    + Object.keys(STORE_INFO).filter(k => !f.stores.has(k)).length;
  $("#filters-toggle").textContent = active ? `Filters (${active})` : "Filters";
  if (writeUrl) writeHash(f);
  shown = PAGE;
  render();
}

function compact(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const HIGH_WATTAGES = [1000, 1200, 1300, 1500, 1600];

// The sheet writes a model family with a hyphen where the wattage goes ("RM-x" = RM750x, RM850x...).
// Brands place the wattage differently; this is the usual style for each.
const MODEL_FORMAT = {
  "ASRock": (a, w, b) => `${a}-${w}${b}`,                // CL-750B
  "Chieftec/Chieftronic": (a, w, b) => `${a}-${w}${b}`,  // GDP-650C
  "SilverStone": (a, w, b) => `${a}${w}-${b}`,           // SX700-LPT
  "Thermalright": (a, w, b) => `${a}-${b}${w}`,          // TR-TG850
};
// Hyphenated words that are not wattage placeholders.
const NOT_A_MODEL = new Set(["non-modular", "semi-modular", "fully-modular", "a-series", "v-series", "sfx-l",
  "dc-dc", "i-arena", "ii-a", "gd-ii"]);

// "RM-x" at 850W -> "RM850x"; anything else is returned unchanged.
function modelWord(p, word, w) {
  const m = word.match(/^([A-Za-z]{1,4})-([A-Za-z]{1,4})$/);
  if (!m || !w || p.brand === "Thermaltake" || NOT_A_MODEL.has(word.toLowerCase())) return null;
  return (MODEL_FORMAT[p.brand] || ((a, w, b) => `${a}${w}${b}`))(m[1], w, m[2]);
}

// Series parts with the wattage written into the model name where the sheet uses a placeholder.
function displaySeries(p) {
  return p.series.map(part => part.replace(/(?<![A-Za-z-])[A-Za-z]{1,4}-[A-Za-z]{1,4}(?![A-Za-z-])/g,
    word => modelWord(p, word, p.wattage) || word));
}

// Wattages for one sheet row. Listed ones ("650/750W") are exact. For a range ("550-850W") the
// sheet doesn't say which models exist, so we take the ends, the usual 100W steps up to 850W,
// the usual sizes above that, and any wattage a store actually sells; the guesses are marked estimated.
function wattageList(p, offers) {
  const out = new Map(p.w.list.map(w => [w, false]));
  for (const [lo, hi] of p.w.ranges) {
    const guesses = [];
    for (let w = lo; w <= Math.min(hi, 850); w += 100) guesses.push(w);
    guesses.push(...HIGH_WATTAGES.filter(w => w > lo && w < hi));
    for (const w of guesses) if (!out.has(w)) out.set(w, true);
    out.set(lo, false);
    out.set(hi, false);
    for (const o of offers) if (o.watts >= lo && o.watts <= hi) out.set(o.watts, false);
  }
  return [...out].sort((a, b) => a[0] - b[0]).map(([w, estimated]) => ({ w, estimated }));
}

// The sheet writes models as patterns ("RM-x" at 850W); people search for "RM850x" or "GX-850".
function modelNames(p, w) {
  const names = [];
  const words = p.series.join(" ").replace(/[()"]/g, " ").split(/\s+/);
  for (const word of words) {
    const model = modelWord(p, word, w);
    if (model) names.push(model, word.replace("-", "") + w);
    else if (/^[a-z]{1,4}$/i.test(word)) names.push(word + w);
  }
  return names;
}

function ppw({ p, offer }) {
  return offer && p.wattage ? offer.price / p.wattage : null;
}

function render() {
  const f = filters();
  const rows = $("#rows");
  const frag = document.createDocumentFragment();
  for (const { p, offer } of view.slice(0, shown)) {
    const tr = document.createElement("tr");
    tr.className = "psu";
    tr.dataset.id = p.key;
    tr.tabIndex = 0;
    tr.setAttribute("aria-expanded", String(open.has(p.key)));
    tr.innerHTML = `
      <td class="c-tier"><span class="tier tier-${tierGroup(p.grade)}" title="${p.limited ? "Limited confidence rating" : ""}">${esc(p.tier)}</span></td>
      <td class="c-name"><button class="star" type="button" data-key="${esc(p.key)}" aria-pressed="${shortlist.has(p.key)}" aria-label="${shortlist.has(p.key) ? "Remove from" : "Add to"} shortlist" title="Shortlist">★</button><span class="brand">${esc(p.brand)}</span> <span class="series">${esc(p.display.join(" · ") || "—")}</span>${p.showOdm ? ` <span class="muted small">(made by ${esc(p.odm)})</span>` : ""}</td>
      <td class="c-watts" data-label="Wattage"><b>${p.wattage ? `${p.wattage}W` : "—"}</b>${p.estimated ? `<span class="est" title="Inferred from the range ${esc(p.watts)} on the tier list">?</span>` : ""}</td>
      <td class="c-year" data-label="Year">${p.year ?? "—"}</td>
      <td class="c-spec" data-label="Size">${esc(p.size || "—")}</td>
      <td class="c-spec" data-label="80+"><span class="eff eff-${esc(p.eff)}" title="${EFF_NAME[p.eff] || ""}">${esc(p.eff || "—")}</span></td>
      <td class="c-spec" data-label="Modular">${esc(MOD_NAME[p.modular] || p.modular || "—")}</td>
      <td class="c-spec" data-label="ATX">${esc(p.atx.replace("ATX ", "") || "—")}</td>
      <td class="c-price" data-label="Price">${priceCell(p, offer, f)}</td>`;
    frag.append(tr);
    if (open.has(p.key)) frag.append(detailRow(p, f));
  }
  rows.replaceChildren(frag);

  const n = view.length;
  $("#count").textContent = `${n.toLocaleString()} of ${DATA.length.toLocaleString()} PSUs`;
  $("#empty").hidden = n > 0;
  $("#more").hidden = shown >= n;
  $("#more").textContent = `Show more (${(n - shown).toLocaleString()} left)`;
}

function priceCell(p, offer, f) {
  if (!offer) return `<span class="muted">—</span>`;
  const stores = new Set(p.offers.filter(o => offerAllowed(o, f)).map(o => o.store)).size;
  const more = stores > 1 ? ` · ${stores} stores` : "";
  return `<span class="price">${trendBadge(p)}${money.format(offer.price)}</span><span class="muted small">${esc(storeName(offer.store))}${more}</span>`;
}

function storeName(key) {
  return STORE_INFO[key]?.name || key;
}

function detailRow(p, f) {
  const tr = $("#detail-tpl").content.firstElementChild.cloneNode(true);
  const spec = (label, value, full) =>
    value ? `<div><dt>${label}</dt><dd>${esc(value)}${full && full !== value ? ` <span class="muted">(${esc(full)})</span>` : ""}</dd></div>` : "";
  tr.querySelector(".specs").innerHTML =
    spec("Rating", p.tier + (p.limited ? " (limited confidence)" : "")) +
    spec("Wattage", p.wattage && `${p.wattage}W`) +
    spec("Series wattages", p.watts) +
    spec("Released", p.year) +
    spec("Form factor", p.size) +
    spec("ATX version", p.atx) +
    spec("Modular", p.modular === "No" ? "Non-modular" : p.modular) +
    spec("OEM / ODM", p.odm) +
    spec("Platform", p.platform) +
    spec("Input range", p.input === "230V" ? "230V only" : p.input) +
    spec("Efficiency", EFF_NAME[p.eff] || p.eff) +
    spec("Topology", p.topology, TOPOLOGY[p.topology]) +
    spec("Rectification", p.secondary, SECONDARY[p.secondary]) +
    spec("Regulation", p.regulation, REGULATION[p.regulation]);
  const estNote = p.estimated
    ? `<p class="muted small">The tier list gives this series as ${esc(p.watts)} without listing each model, so a ${p.wattage}W version may not exist.</p>`
    : "";
  tr.querySelector(".notes").innerHTML = (p.notes
    ? `<h3>Notes</h3><p>${esc(p.notes)}</p>`
    : `<h3>Notes</h3><p class="muted">No notes.</p>`) + estNote;

  const offers = p.offers.filter(o => offerAllowed(o, f)).sort((a, b) => a.price - b.price);
  tr.querySelector(".offers").innerHTML = offers.length
    ? `<h3>Prices</h3><table class="offer-table"><tbody>${offers.map(o => `
        <tr>
          <td class="o-store">${esc(storeName(o.store))}${o.marketplace ? `<span class="muted small"> via ${esc(o.seller)}</span>` : ""}</td>
          <td class="o-price"><a href="${esc(o.url)}" target="_blank" rel="noopener">${money.format(o.price)}</a>
            ${o.regular && o.regular > o.price ? `<s class="muted small">${money.format(o.regular)}</s>` : ""}</td>
        </tr>
        <tr class="o-name"><td colspan="2">${esc(o.name)}</td></tr>`).join("")}</tbody></table>
        <p class="muted small">Matched by name. Check that the listing's model is the same revision before you buy.</p>`
    : `<h3>Prices</h3><p class="muted">No matching listing found at the selected stores.</p>`;

  tr.querySelector(".history").innerHTML = historyHtml(p);

  const q = encodeURIComponent(searchName(p));
  tr.querySelector(".stores").innerHTML =
    `<h3>Search other stores</h3><p>${STORES.map(([n, u]) => `<a href="${u(q)}" target="_blank" rel="noopener">${n}</a>`).join("")}</p>`;
  return tr;
}

// A store-friendly search string: first brand alias plus the series without annotations.
function searchName(p) {
  const brand = p.brand.split(/[/(]/)[0].trim();
  const series = p.display[0] ? p.display[0].replace(/\(.*?\)|".*?"/g, "").trim() : "";
  const sub = (p.display[1] || "").replace(/\(.*?\)|".*?"|\b(19|20)\d\d\b/g, "").trim();
  return [brand, series, sub.length <= 12 ? sub : "", p.wattage ? `${p.wattage}W` : "power supply"].filter(Boolean).join(" ");
}

function tierGroup(t) {
  const g = t[0];
  return g === "A" ? "a" : g === "B" ? "b" : g === "C" ? "c" : g === "D" || g === "E" ? "d" : "f";
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function fmtDate(iso) {
  if (!iso) return "";
  // A bare "2026-09-23" is a calendar date: read it as local midnight, not UTC, or it shows a day early.
  const day = /^(\d{4})-(\d\d)-(\d\d)$/.exec(iso);
  const date = day ? new Date(+day[1], day[2] - 1, +day[3]) : new Date(iso);
  return date.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

// ---- Price history -------------------------------------------------------
// history.json keeps, per model, a [date, lowest price] point each time the lowest price
// across all stores changed (null = no store listed it).

function priceChange(p) {
  const pts = (HISTORY[p.key] || []).filter(([, price]) => price != null);
  if (pts.length < 2) return null;
  const [date, now] = pts.at(-1);
  const before = pts.at(-2)[1];
  return { diff: now - before, date };
}

function trendBadge(p) {
  const c = priceChange(p);
  if (!c || Math.abs(c.diff) < 0.5) return "";
  const down = c.diff < 0;
  return `<span class="trend ${down ? "down" : "up"}" title="Lowest price ${down ? "dropped" : "rose"} ${money.format(Math.abs(c.diff))} on ${fmtDate(c.date)}">${down ? "▼" : "▲"}</span>`;
}

function historyHtml(p) {
  const pts = HISTORY[p.key] || [];
  const priced = pts.filter(([, price]) => price != null);
  if (!priced.length) return "";
  const low = priced.reduce((a, b) => (b[1] < a[1] ? b : a));
  const c = priceChange(p);
  const change = c && Math.abs(c.diff) >= 0.5
    ? ` Last change: <span class="trend ${c.diff < 0 ? "down" : "up"}">${c.diff < 0 ? "▼" : "▲"} ${money.format(Math.abs(c.diff))}</span> on ${fmtDate(c.date)}.`
    : "";
  return `<h3>Price history</h3>${sparkline(pts)}
    <p>Lowest seen: <b>${money.format(low[1])}</b> on ${fmtDate(low[0])}.${change}</p>
    <p class="muted small">Lowest price across all stores, tracked daily since ${fmtDate(historySince)}.</p>`;
}

// A step line of the lowest price from the first point until today; gaps where no store listed it.
function sparkline(pts) {
  const day = d => Date.parse(d) / 864e5;
  const priced = pts.filter(([, price]) => price != null).map(([, price]) => price);
  if (priced.length < 2) return "";
  const start = day(pts[0][0]);
  const end = Math.max(Date.now() / 864e5, day(pts.at(-1)[0]) + 1);
  const lo = Math.min(...priced), hi = Math.max(...priced);
  const W = 360, H = 60, pad = 4;
  const x = d => (pad + ((d - start) / (end - start)) * (W - 2 * pad)).toFixed(1);
  const y = v => (hi === lo ? H / 2 : pad + (1 - (v - lo) / (hi - lo)) * (H - 2 * pad)).toFixed(1);

  let path = "";
  pts.forEach(([date, price], i) => {
    if (price == null) return;
    const until = i + 1 < pts.length ? day(pts[i + 1][0]) : end;
    const joined = i > 0 && pts[i - 1][1] != null;
    path += `${joined ? `V${y(price)}` : `M${x(day(date))} ${y(price)}`}H${x(until)}`;
  });
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
    aria-label="Lowest price went from ${money.format(priced[0])} to ${money.format(priced.at(-1))}"><path d="${path}"/></svg>`;
}

// ---- Shortlist (kept in this browser only) ---------------------------------

function loadShortlist() {
  try { return JSON.parse(localStorage.getItem("shortlist") || "[]"); } catch { return []; }
}

function toggleStar(key) {
  shortlist.has(key) ? shortlist.delete(key) : shortlist.add(key);
  try { localStorage.setItem("shortlist", JSON.stringify([...shortlist])); } catch { /* private mode: keep it for this visit */ }
  if ($("#starred").checked) update(); else { render(); $("#star-count").textContent = shortlist.size; }
}

// ---- Theme ------------------------------------------------------------------

function currentTheme() {
  return document.documentElement.dataset.theme
    || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

function toggleTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("theme", next); } catch { /* not saved; still switches for this visit */ }
  syncThemeButton();
}

function syncThemeButton() {
  const label = `Switch to ${currentTheme() === "dark" ? "light" : "dark"} theme`;
  $("#theme").setAttribute("aria-label", label);
  $("#theme").title = label;
}

// Filters live in the URL hash, so a filtered view can be bookmarked or shared.
function writeHash(f) {
  const h = new URLSearchParams();
  if (f.q) h.set("q", f.q);
  for (const k of ["sort", "tier", "watts", "size", "eff", "modular", "atx", "year"]) {
    if (f[k] && !(k === "sort" && f[k] === "tier")) h.set(k, f[k]);
  }
  for (const k of ["priced", "confident", "nomarket", "starred"]) if (f[k]) h.set(k, "1");
  const off = Object.keys(STORE_INFO).filter(k => !f.stores.has(k));
  if (off.length) h.set("nostore", off.join(","));
  const s = h.toString();
  if (s !== location.hash.slice(1)) history.replaceState(null, "", s ? `#${s}` : location.pathname + location.search);
}

function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  $("#q").value = h.get("q") || "";
  for (const k of ["sort", "tier", "watts", "size", "eff", "modular", "atx", "year"]) {
    const el = $("#" + k);
    const v = h.get(k) || el.options[0].value;
    if ([...el.options].some(o => o.value === v)) el.value = v;
  }
  for (const k of ["priced", "confident", "nomarket", "starred"]) $("#" + k).checked = h.get(k) === "1";
  const off = new Set((h.get("nostore") || "").split(","));
  for (const el of document.querySelectorAll("#stores input")) el.checked = !off.has(el.value);
}
