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

// Drawn as an icon rather than the "★" character, which some systems render as a colour emoji.
const STAR_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.8 5.8 6.4.8-4.7 4.4 1.2 6.3L12 17l-5.7 3.1 1.2-6.3-4.7-4.4 6.4-.8z"/></svg>`;

const $ = sel => document.querySelector(sel);
const money = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });

let DATA = [];
let TIERS = [];
let PRICES = {};
let STORE_INFO = {};
let HISTORY = {};
let historySince = null;
const favorites = new Set(loadFavorites());
let view = [];
let shown = PAGE;
const open = new Set();

init();

// The data files change daily. "no-cache" makes the browser check for a newer copy each visit
// (a quick "not modified" reply when nothing changed) instead of reusing it for 10 minutes.
function fetchData(url) {
  return fetch(url, { cache: "no-cache" });
}

async function init() {
  const [psus, prices, history] = await Promise.all([
    fetchData("data/psus.json").then(r => r.json()),
    fetchData("data/prices.json").then(r => (r.ok ? r.json() : null)).catch(() => null),
    fetchData("data/history.json").then(r => (r.ok ? r.json() : null)).catch(() => null),
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
    p.label = wattageName(p);
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
  for (const id of ["sort", "tier", "watts", "size", "eff", "modular", "atx", "year", "priced", "confident", "market", "starred"]) {
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
  $("#rows").addEventListener("pointermove", chartPointer);
  $("#rows").addEventListener("pointerdown", chartPointer);
  $("#rows").addEventListener("pointerout", chartLeave);
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
    market: $("#market").checked,
    starred: $("#starred").checked,
    stores: new Set([...document.querySelectorAll("#stores input:checked")].map(i => i.value)),
  };
}

function offerAllowed(o, f) {
  return f.stores.has(o.store) && (f.market || !o.marketplace);
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
    if (f.starred && !favorites.has(p.key)) continue;
    if (f.watts && !(p.wattage >= f.watts)) continue;
    if (f.size && p.size !== f.size) continue;
    if (f.eff && !(EFF_RANK[p.eff] >= EFF_RANK[f.eff])) continue;
    if (f.modular && p.modular !== f.modular) continue;
    if (f.atx && p.atx !== f.atx) continue;
    if (f.year && !(p.year >= f.year)) continue;
    // The compact form ("rm850x" vs "RM-x 850W") only helps for terms with letters or digits;
    // a term of only symbols ("★") would compact to "" and match everything.
    if (terms.length && !terms.every(t => p.haystack.includes(t) || (compact(t) && p.compact.includes(compact(t))))) continue;
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
  // Whatever the sort, PSUs you can buy (a price at the selected stores) come first.
  const chosen = sorters[f.sort] || sorters.tier;
  view.sort((a, b) => !a.offer - !b.offer || chosen(a, b));

  for (const th of document.querySelectorAll("th button[data-sort]")) {
    const s = th.dataset.sort;
    th.classList.toggle("active", f.sort === s || (s === "price-asc" && f.sort === "price-desc"));
  }
  $("#q-clear").hidden = !f.q;
  $("#star-count").textContent = favorites.size;
  const active = ["tier", "watts", "size", "eff", "modular", "atx", "year"].filter(k => f[k]).length
    + ["priced", "confident", "market", "starred"].filter(k => f[k]).length
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

// How manufacturers write the wattage into a model name. Most put it after the model and before any
// revision notes ("Hydro PTM Pro 1000W ATX 3.0", "Pure Power 12 M 850W"); these brands do it differently.
const WATTAGE_STYLE = {
  "ASUS": { ratingAfter: true },                   // ROG Thor 1000W Platinum II
  "Thermaltake": { ratingAfter: true },            // Toughpower Grand RGB 850W Gold
  "EVGA": { before: true },                        // SuperNOVA 850 G6
  "Seasonic": { code: "-" },                       // Focus GX-850, Prime TX-1000
  "AZZA": { code: "-" },                           // PSAZ-850
  "Corsair": { code: "" },                         // CX650, SF750
  "Antec/Atom": { code: "" },                      // HCG850, NE750
  "DeepCool (GamerStorm)": { code: "" },           // PQ850G, PX1300P
  "Lian Li": { code: "" },                         // SP750, EG1000
  "Cooler Master": {                               // MWE Gold 850 V2, V850 Gold V2, XG850 Plus Platinum
    unit: "",
    lines: {
      'V-Series "Vanguard"': "V{w}", "XG": "XG{w}", "G Gold": "G{w} Gold", "B V2": "B{w} V2",
      // Elite NEX N500, PN600 Peak, W500; the plain Elite NEX falls through to "Elite NEX 500".
      "Elite NEX": (parts, w) => parts.length > 1 &&
        parts.map(s => s.replace(/^(N|PN)\b/, `$1${w}`).replace(/\(W\)/, `W${w}`)),
    },
  },
  "NZXT": { lines: { "C Series": "C{w}", "E Series": "E{w}" } },  // C850 Gold
};
// Words that begin the part of a name after the model: revisions, years, ATX versions, regions, colours.
const TAIL_WORD = /^(?:[("].*|v\d.*|ver\.?|version|rev\.?|revision|(?:19|20)\d\d.*|atx\d.*|230v|eu|us|global|asia|north|retail|oem|swap|original|old|new|standard|premium|white|black|snow|gr[ae]y|green|label|gen\d|full|fully|non|semi|modular|mod\.?|non-modular|semi-modular|fully-modular)$/i;
const RATING_WORD = /^(?:bronze|silver|gold|platinum|titanium)$/i;
// Upper-case words that look like model codes but aren't.
const NOT_A_CODE = new Set(["ATX", "SFX", "RGB", "ARGB", "OEM", "SI", "EU", "US", "II", "III", "IV", "VI", "VII", "VIII",
  "IX", "PC", "PRO", "MAX", "IO", "LED", "SE", "PSU", "EVO"]);

// The series parts with the wattage written in the manufacturer's style: "Focus · GX-850 · V4 ATX 3.1".
function wattageName(p) {
  const parts = p.display, w = p.wattage;
  if (!w || !parts.length || parts.some(s => s.includes(String(w)))) return parts;
  const style = WATTAGE_STYLE[p.brand] || {};
  const line = style.lines?.[parts[0]];
  if (typeof line === "string") return [line.replace("{w}", w), ...parts.slice(1)];
  const custom = line && line(parts, w);
  if (custom) return custom;
  // "WD · -K" is the sheet's way of writing WD600K: the wattage goes where the hyphen is.
  const hyphen = parts.findIndex((s, i) => i > 0 && /^-[A-Z]+\b/.test(s) && /^[A-Z]{1,4}$/.test(parts[i - 1]));
  if (hyphen > 0) {
    const [suffix, ...rest] = parts[hyphen].split(" ");
    return [...parts.slice(0, hyphen - 1), [parts[hyphen - 1] + w + suffix.slice(1), ...rest].join(" "),
      ...parts.slice(hyphen + 1)];
  }

  const tokens = parts.map(s => s.split(" "));
  const isTail = (t, next) => TAIL_WORD.test(t.replace(/,$/, "")) || (/^atx$/i.test(t) && /^\d/.test(next || "")) ||
    (style.ratingAfter && RATING_WORD.test(t));
  // The model name ends at the first tail word. The first part is the series name ("MWE V2",
  // "Power Zone 2"), so when there are more parts the search starts after it, except for a
  // note in brackets ("S (H1 Case Included PSU)").
  let end = null;
  search: for (let i = 0; i < parts.length; i++) {
    for (let j = i === 0 ? 1 : 0; j < tokens[i].length; j++) {
      const t = tokens[i][j];
      const tail = i === 0 && parts.length > 1 ? /^\([^)]*$/.test(t) : isTail(t, tokens[i][j + 1]);
      if (tail) { end = [i, j]; break search; }
    }
  }
  if (!end) end = [parts.length - 1, tokens[parts.length - 1].length];
  else if (end[1] === 0) end = [end[0] - 1, tokens[end[0] - 1].length];
  const join = () => tokens.map(ts => ts.join(" ")).filter(Boolean);

  if (style.code != null) {
    // The last model code in the name, or one given in brackets: "Prime · Titanium (TX)".
    let at = null;
    tokens.forEach((ts, i) => ts.forEach((t, j) => {
      const inName = i < end[0] || (i === end[0] && j < end[1]);
      const m = t.match(/^\(?([A-Z][A-Z0-9]{1,5})\)?$/) || t.match(/^\(([A-Z])\)$/);
      if (m && !NOT_A_CODE.has(m[1]) && (inName || /^\(.*\)$/.test(t))) at = [i, j, m[1]];
    }));
    if (at) {
      const [i, j, code] = at;
      // A one-letter part right after the code is its suffix: "PQ · G" is the PQ850G.
      let suffix = "";
      const next = tokens[i + 1];
      if (j === tokens[i].length - 1 && next && /^-?[A-Z]$/.test(next[0])) {
        suffix = next.shift().replace("-", "");
        // What's left of that part ("(Platinum)") stays with the model: "SP850P (Platinum)".
        if (/^\(/.test(next[0] || "")) tokens[i].push(...next.splice(0));
      }
      tokens[i][j] = `${code}${style.code}${w}${suffix}`;
      return join();
    }
  }
  const [i, j] = end;
  if (style.before) tokens[i].unshift(String(w));
  else tokens[i].splice(j, 0, `${w}${style.unit ?? "W"}`);
  return join();
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
      <td class="c-name"><button class="star" type="button" data-key="${esc(p.key)}" aria-pressed="${favorites.has(p.key)}" aria-label="${favorites.has(p.key) ? "Remove from" : "Add to"} favorites" title="Favorite">${STAR_ICON}</button><span class="brand">${esc(p.brand)}</span> <span class="series">${esc(p.label.join(" · ") || "—")}</span>${p.showOdm ? ` <span class="muted small">(made by ${esc(p.odm)})</span>` : ""}</td>
      <td class="c-watts" data-label="Wattage"><b>${p.wattage ? `${p.wattage}W` : "—"}</b>${p.estimated ? `<span class="est" title="Inferred from the range ${esc(p.watts)} on the tier list">?</span>` : ""}${effBadge(p, "m-only")}</td>
      <td class="c-year" data-label="Year">${p.year ?? "—"}</td>
      <td class="c-spec" data-label="Size">${esc(p.size || "—")}</td>
      <td class="c-spec" data-label="80+">${effBadge(p)}</td>
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

// 80 Plus letter as a coloured badge. The phone layout hides the 80+ column,
// so a second copy ("m-only") sits next to the wattage there.
function effBadge(p, extra = "") {
  if (!p.eff) return extra ? "" : "—";
  const name = p.eff === "N" ? "No 80 Plus rating" : EFF_NAME[p.eff] ? `80 Plus ${EFF_NAME[p.eff]}` : p.eff;
  return `<span class="eff eff-${esc(p.eff)} ${extra}" title="${esc(name)}">${esc(p.eff)}</span>`;
}

function priceCell(p, offer, f) {
  if (!offer) return `<span class="muted">—</span>`;
  const stores = new Set(p.offers.filter(o => offerAllowed(o, f)).map(o => o.store)).size;
  const more = stores > 1 ? ` · ${stores} stores` : "";
  return `<span class="price">${trendBadge(p, offer.price)}${money.format(offer.price)}</span><span class="muted small">${esc(storeName(offer.store))}${more}</span>`;
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
          <td class="o-price">${httpsUrl(o.url) ? `<a href="${esc(o.url)}" target="_blank" rel="noopener">${money.format(o.price)}</a>` : money.format(o.price)}
            ${o.regular && o.regular > o.price ? `<s class="muted small">${money.format(o.regular)}</s>` : ""}</td>
        </tr>
        <tr class="o-name"><td colspan="2">${esc(o.name)}</td></tr>`).join("")}</tbody></table>
        <p class="muted small">Matched by name. Check that the listing's model is the same revision before you buy.</p>`
    : !f.market && p.offers.some(o => f.stores.has(o.store) && o.marketplace)
    ? `<h3>Prices</h3><p class="muted">Only third-party marketplace sellers list this one. Turn on "Include third-party marketplace sellers" in Filters to see them.</p>`
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

// Store links come from the stores' pages; only https ones are linked, so a
// javascript: or data: URL in scraped data can't run on this site.
function httpsUrl(u) {
  try { return new URL(u).protocol === "https:"; } catch (e) { return false; }
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
// across the stores themselves changed (null = no store listed it).

const DAY = 864e5;
const dayOf = iso => Date.parse(iso) / DAY;
const today = () => Math.floor(Date.now() / DAY);

function pricedPoints(p) {
  return (HISTORY[p.key] || []).filter(([, price]) => price != null);
}

function lowestSeen(p) {
  const pts = pricedPoints(p);
  return pts.length ? pts.reduce((a, b) => (b[1] < a[1] ? b : a)) : null;
}

// The latest change, but only if it is recent and big enough to matter:
// within the last week, and at least $5 or 2% of the old price.
function recentChange(p) {
  const pts = pricedPoints(p);
  if (pts.length < 2) return null;
  const [date, now] = pts.at(-1);
  const before = pts.at(-2)[1];
  const diff = now - before;
  if (today() - dayOf(date) > 7) return null;
  if (Math.abs(diff) < Math.max(5, before * 0.02)) return null;
  return { diff, date };
}

// Whole dollars for the list badge; it only needs to show the size of the move.
const wholeMoney = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });

// One small marker before the list price: "Lowest" when the shown price ties the lowest seen
// (once the price has actually moved), otherwise the size of a recent move.
function trendBadge(p, shownPrice) {
  const low = lowestSeen(p);
  const c = recentChange(p);
  const moved = c ? `Lowest price ${c.diff < 0 ? "dropped" : "rose"} ${money.format(Math.abs(c.diff))} on ${fmtDate(c.date)}` : "";
  if (low && shownPrice <= low[1] + 0.5 && new Set(pricedPoints(p).map(([, v]) => v)).size > 1) {
    const title = [`Lowest price seen since ${fmtDate(historySince)}`, moved].filter(Boolean).join(". ");
    return `<span class="low-tag" title="${title}">Lowest</span>`;
  }
  if (!c) return "";
  const down = c.diff < 0;
  return `<span class="trend ${down ? "down" : "up"}" title="${moved}">${down ? "▼" : "▲"}${wholeMoney.format(Math.abs(c.diff))}</span>`;
}

// Price a month ago (or at the first point, if tracking started later) against the latest price.
function monthChange(p) {
  const all = HISTORY[p.key] || [];
  const now = all.at(-1)?.[1];
  if (now == null) return null;
  const cutoff = today() - 30;
  let base = null, since = null;
  for (const [date, price] of all) {
    if (dayOf(date) <= cutoff) { base = price; since = null; }
    else if (base == null && price != null && since == null) { base = price; since = date; }
  }
  return base == null ? null : { diff: now - base, since };
}

function historyHtml(p) {
  const all = HISTORY[p.key] || [];
  const low = lowestSeen(p);
  if (!low) return "";
  const now = all.at(-1)[1];
  const m = monthChange(p);
  const mHtml = !m ? "—"
    : Math.abs(m.diff) < 0.5 ? "No change"
    : `<span class="trend ${m.diff < 0 ? "down" : "up"}">${m.diff < 0 ? "▼" : "▲"} ${money.format(Math.abs(m.diff))}</span>`;
  const stat = (label, value, sub) =>
    `<div><dt>${label}</dt><dd>${value}${sub ? `<span class="muted small">${sub}</span>` : ""}</dd></div>`;
  return `<h3>Price history</h3>
    <dl class="hist-stats">
      ${stat("Now", now == null ? `<span class="muted">Not listed</span>` : money.format(now))}
      ${stat("Lowest seen", money.format(low[1]), fmtDate(low[0]))}
      ${stat("Change", mHtml, m?.since ? `since ${fmtDate(m.since)}` : "last 30 days")}
    </dl>
    ${priceChart(p)}
    <p class="muted small">Lowest price from the stores themselves (marketplace sellers excluded), checked daily since ${fmtDate(historySince)}.</p>`;
}

// A day number (days since 1970, UTC) as "Oct 6".
const shortDay = d => new Date(d * DAY).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
const dayLabel = d => new Date(d * DAY).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

// Chart scale for a model's history: the time span, and a price range padded so that a small
// move doesn't fill the whole height (at least 10% of the price), snapped to round tick values.
function chartScale(pts) {
  const priced = pts.filter(([, v]) => v != null).map(([, v]) => v);
  const lo = Math.min(...priced), hi = Math.max(...priced);
  const span = Math.max(hi - lo, hi * 0.1);
  const mid = (hi + lo) / 2;
  const rawLo = Math.max(0, mid - span * 0.6), rawHi = mid + span * 0.6;
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500].find(t => (rawHi - rawLo) / t <= 4) || 1000;
  const bottom = Math.floor(rawLo / step) * step, top = Math.ceil(rawHi / step) * step;
  const yTicks = [];
  for (let v = bottom; v <= top + 1e-9; v += step) yTicks.push(v);

  const start = dayOf(pts[0][0]);
  const end = Math.max(Date.now() / DAY, dayOf(pts.at(-1)[0]) + 1);
  const xStep = [1, 2, 7, 14, 28].find(t => (end - start) / t <= 6) || 56;
  const xTicks = [];
  for (let d = start; d <= end; d += xStep) xTicks.push(d);
  return { start, end, lo, hi, bottom, top, yTicks, xTicks };
}

// A step line of the lowest price from the first point until today, with gaps where no store
// listed it, a marker at each price change, and labelled price and date axes. Labels are HTML
// on top of the SVG so they don't stretch with it.
function priceChart(p) {
  const pts = HISTORY[p.key] || [];
  if (pricedPoints(p).length < 2) return "";
  const s = chartScale(pts);
  const W = 100, H = 100;
  const x = d => ((d - s.start) / (s.end - s.start)) * W;
  const y = v => (1 - (v - s.bottom) / (s.top - s.bottom)) * H;
  const f = n => n.toFixed(2);

  let path = "";
  pts.forEach(([date, price], i) => {
    if (price == null) return;
    const until = i + 1 < pts.length ? dayOf(pts[i + 1][0]) : s.end;
    const joined = i > 0 && pts[i - 1][1] != null;
    path += `${joined ? `V${f(y(price))}` : `M${f(x(dayOf(date)))} ${f(y(price))}`}H${f(x(until))}`;
  });
  const marks = pts.filter(([, v]) => v != null).map(([date, v]) =>
    `<span class="pchart-pt" style="left:${f(x(dayOf(date)))}%;top:${f(y(v))}%" title="${fmtDate(date)} · ${money.format(v)}"></span>`).join("");
  const [lastDate, last] = pts.at(-1);
  const now = last != null ? `<span class="pchart-dot" style="left:100%;top:${f(y(last))}%"></span>` : "";
  const dollars = v => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(v);

  return `<figure class="pchart" data-key="${esc(p.key)}">
    <div class="pchart-ytitle">Price (CAD)</div>
    <div class="pchart-axis">${s.yTicks.map(v => `<span class="pchart-y" style="top:${f(y(v))}%">${dollars(v)}</span>`).join("")}</div>
    <div class="pchart-plot">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
        aria-label="Lowest price went from ${money.format(pts.find(([, v]) => v != null)[1])} on ${fmtDate(pts[0][0])} to ${last == null ? "not listed" : money.format(last)} on ${fmtDate(lastDate)}">
        ${s.yTicks.map(v => `<line class="grid" x1="0" x2="${W}" y1="${f(y(v))}" y2="${f(y(v))}"/>`).join("")}
        ${s.xTicks.map(d => `<line class="grid" y1="0" y2="${H}" x1="${f(x(d))}" x2="${f(x(d))}"/>`).join("")}
        <line class="grid low" x1="0" x2="${W}" y1="${f(y(s.lo))}" y2="${f(y(s.lo))}"/>
        <path d="${path}"/>
      </svg>
      <span class="pchart-lowlabel" style="top:${f(y(s.lo))}%">Lowest ${money.format(s.lo)}</span>
      ${marks}${now}
      <span class="pchart-guide" hidden></span>
      <span class="pchart-hit" hidden></span>
      <span class="pchart-tip" hidden></span>
    </div>
    <div class="pchart-x">${s.xTicks.map(d => `<span style="left:${f(x(d))}%">${shortDay(d)}</span>`).join("")}</div>
    <div class="pchart-xtitle">Date</div>
  </figure>`;
}

// Hover or drag across a chart to read the date and price at that point.
function chartPointer(e) {
  const plot = e.target.closest?.(".pchart-plot");
  if (!plot) return;
  const pts = HISTORY[plot.parentElement.dataset.key] || [];
  if (!pts.length) return;
  const s = chartScale(pts);
  const r = plot.getBoundingClientRect();
  const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  const d = s.start + frac * (s.end - s.start);
  let at = pts[0];
  for (const pt of pts) if (dayOf(pt[0]) <= d) at = pt;
  const when = d >= today() ? "Today" : dayLabel(Math.floor(d));
  const guide = plot.querySelector(".pchart-guide"), tip = plot.querySelector(".pchart-tip"), hit = plot.querySelector(".pchart-hit");
  guide.hidden = tip.hidden = false;
  guide.style.left = tip.style.left = hit.style.left = `${(frac * 100).toFixed(2)}%`;
  hit.hidden = at[1] == null;
  if (at[1] != null) hit.style.top = `${((1 - (at[1] - s.bottom) / (s.top - s.bottom)) * 100).toFixed(2)}%`;
  tip.classList.toggle("flip", frac > 0.6);
  tip.textContent = `${when} · ${at[1] == null ? "not listed" : money.format(at[1])}`;
}

function chartLeave(e) {
  const plot = e.target.closest?.(".pchart-plot");
  if (plot && !plot.contains(e.relatedTarget)) plot.querySelectorAll(".pchart-guide, .pchart-tip, .pchart-hit").forEach(el => (el.hidden = true));
}

// ---- Favorites (kept in this browser only) ---------------------------------

// Also reads "shortlist", the key used before the rename, so earlier stars aren't lost.
function loadFavorites() {
  try {
    return JSON.parse(localStorage.getItem("favorites") || localStorage.getItem("shortlist") || "[]");
  } catch {
    return [];
  }
}

function toggleStar(key) {
  favorites.has(key) ? favorites.delete(key) : favorites.add(key);
  try { localStorage.setItem("favorites", JSON.stringify([...favorites])); } catch { /* private mode: keep it for this visit */ }
  if ($("#starred").checked) update(); else { render(); $("#star-count").textContent = favorites.size; }
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
  for (const k of ["priced", "confident", "market", "starred"]) if (f[k]) h.set(k, "1");
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
  for (const k of ["priced", "confident", "market", "starred"]) $("#" + k).checked = h.get(k) === "1";
  const off = new Set((h.get("nostore") || "").split(","));
  for (const el of document.querySelectorAll("#stores input")) el.checked = !off.has(el.value);
}
