// PokéSteals scanner. Runs in GitHub Actions or on your PC (Node 20+, no dependencies). Never invents listings.
const clean = k => (process.env[k] || "").replace(/\s+/g, ""); // secrets pasted with stray newlines/spaces
const SB = clean("SUPABASE_URL").replace(/\/+$/, ""), KEY = clean("SUPABASE_SERVICE_KEY"), VINTED_FEED_URL = clean("VINTED_FEED_URL"),
  VINTED_FEED_TOKEN = clean("VINTED_FEED_TOKEN"), POKEMONTCG_KEY = clean("POKEMONTCG_KEY");
const H = { apikey: KEY, ...(KEY.startsWith("eyJ") ? { authorization: `Bearer ${KEY}` } : {}), "content-type": "application/json" };
const rest = (path, opts = {}) => fetch(`${SB}/rest/v1/${path}`, { ...opts, headers: { ...H, ...(opts.headers || {}) } });

// ---- Deal rules (override with GitHub secrets / env vars) ----
const MAX_PCT = +process.env.MAX_PCT_OF_VALUE || 0.5; // keep only if you pay <= 50% of the card's value in its condition
const MIN_PROFIT = +process.env.MIN_PROFIT || 5;      // ...and the estimated profit is at least this many dollars
const MIN_VALUE = +process.env.MIN_VALUE || 10, FEE = 0.13; // ignore cards worth less than $10
const DETAIL_MAX = process.env.DETAIL_MAX === "0" ? 0 : (+process.env.DETAIL_MAX || 2); // product pages opened per scan (0 = off)
const DETAIL_MIN = +process.env.DETAIL_MIN_SCORE || 70; // ...only for deals scoring at least this
const MULT = { nm: 1, lp: 0.85, mp: 0.7, hp: 0.5, dmg: 0.35 }; // ESTIMATES: TCGplayer's free data only has Near Mint
const TIER = { "new with tags": "nm", "new without tags": "nm", "very good": "lp", good: "mp", satisfactory: "hp" };
const SKIP = /\b(lots?|bulk|bundles?|mystery|random|collections?|binder|sealed|etb|elite trainer|booster|blister|tin|box|sleeves?|dividers?|playmat|toploader|top loader|plush|keychain|stickers?|figure|psa|bgs|cgc|sgc|graded|slab|proxy|custom|fake|replica|orica|reprint|counterfeit|metal card|fan ?made|unofficial|jumbo|oversized|art card)\b/i;
const RARE = /holo|rare|reverse|full art|alt art|secret|illustration|promo|1st|first edition|shadowless|vmax|vstar|\bex\b|\bgx\b/i;
const INFORMED = /tcgplayer|market (price|value)|price ?charting|price guide|sold listings|\bcomps?\b/i;
const UNAWARE = /no idea|don'?t know|not sure|found (these|this|them)|old collection|my (kid|son|daughter|child|brother)|cleaning|declutter|moving|clearing|need(s)? gone|make an offer|\bobo\b/i;

function ago(txt, ref) { // "2 minutes ago" -> ISO time
  const t = (txt || "").toLowerCase(); if (!t) return null;
  if (/just now|moment|second/.test(t)) return new Date(ref).toISOString();
  const m = t.match(/(\d+|an?)\s*(minute|hour|day|week|month)/); if (!m) return null;
  const ms = { minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6 }[m[2]];
  return new Date(ref - (/^an?$/.test(m[1]) ? 1 : +m[1]) * ms).toISOString();
}

// ---- Prices: pokemontcg.io (TCGplayer market prices). EXACT matches only: no guessing from names ----
const VINTAGE_BEFORE = +process.env.VINTAGE_BEFORE || 2008; // keep only sets released before this year (WOTC 1999-2003, EX era to 2007)
let prices = [], newPrices = [];
const save = (k, v) => { const r = { keyword: k, price: v, updated: new Date().toISOString() }; prices.push(r); newPrices.push(r); };
const nameIn = (low, name) => (name.match(/[a-zé]{3,}/g) || []).some(w => w !== "the" && w !== "and" && low.includes(w));
function cardPrice(c) { // conservative Near Mint price (lower of market/mid, never 1st Edition), or null if missing or stale
  const t = c.tcgplayer; if (!t?.prices) return null;
  const age = Date.now() - Date.parse(String(t.updatedAt || "").replace(/\//g, "-"));
  if (!(age < 14 * 864e5)) return null; // price data older than 14 days (or undated): don't trust it
  const v = Object.entries(t.prices).filter(([k]) => !/^1stEdition/i.test(k))
    .map(([, p]) => Math.min(...[p.market, p.mid].filter(x => x > 0))).filter(isFinite);
  return v.length ? Math.min(...v) : null;
}
async function tcg(q) {
  try {
    const r = await fetch(`https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}&pageSize=250&select=name,number,set,tcgplayer`,
      { headers: POKEMONTCG_KEY ? { "X-Api-Key": POKEMONTCG_KEY } : {} });
    return r.ok ? (await r.json()).data || [] : null;
  } catch { return null; }
}
// cache key: v2:<card name>|<number>/<total>|<set year>|<set name>
async function lookup(title) {
  const low = title.toLowerCase(), m = low.match(/(\d{1,3})\s*\/\s*(\d{1,3})/);
  if (!m) return null; // no set number: can't identify the exact card, so don't price it
  const tag = `|${+m[1]}/${+m[2]}|`, fresh = Date.now() - 3 * 864e5;
  const cached = () => prices.filter(p => p.keyword.startsWith("v2:") && p.keyword.includes(tag) && Date.parse(p.updated) > fresh);
  if (!cached().length) {
    const cards = await tcg(`number:${+m[1]} printedTotal:${+m[2]}`);
    if (cards === null) return null; // lookup failed: unknown, not a verdict
    for (const c of cards) { const v = cardPrice(c); if (v) save(`v2:${c.name.toLowerCase()}${tag}${String(c.set?.releaseDate || "").slice(0, 4)}|${c.set?.name || ""}`, v); }
  }
  const named = cached().filter(p => nameIn(low, p.keyword.slice(3).split("|")[0]));
  if (!named.length) return { unverified: true }; // set number matches no real, currently-priced card of that name
  const old = named.filter(p => +p.keyword.split("|")[2] < VINTAGE_BEFORE);
  if (!old.length) return null; // a real card, but not vintage: skip quietly
  const best = old.reduce((a, b) => (+a.price <= +b.price ? a : b)); // if several match, take the cheapest
  const [, , year, set] = best.keyword.split("|");
  return { nm: +best.price, match: "number", set, year };
}

// ---- Deal evaluation. Returns null if the seller looks price-aware ----
function evaluate(i, mk, d) {
  const total = i.price + (i.shipping || 0), tier = TIER[(i.condition || "").toLowerCase().trim()] || "mp";
  const val = mk.nm * MULT[tier], pct = total / val, profit = val * (1 - FEE) - total;
  if (total < val * 0.25 && mk.nm >= 30) return null; // priced under 25% of a $30+ card: almost always fake, custom, or mislabeled
  const flags = [], hints = [];
  if (!i.photos) flags.push("No photos");
  if (i.title.trim().split(/\s+/).length < 4) hints.push("Very short title");
  if (!RARE.test(i.title)) hints.push("No rarity mentioned");
  if (mk.match === "name") hints.push("No set number given");
  if (i.price % 1 === 0 && i.price <= 10) hints.push("Round, low price");
  if (d?.description) {
    if (INFORMED.test(d.description)) return null;
    if (UNAWARE.test(d.description)) hints.push("Seller doesn't seem to know the value");
  }
  const unaware = hints.length >= 2;
  let score = Math.min(100, Math.round(Math.max(0, Math.min(1 - pct, 0.8)) / 0.8 * 100) + (unaware ? 8 : 0));
  if (mk.match === "name") score = Math.min(score, 60);
  if (flags.length) score = Math.min(score, 40);
  const r2 = x => Math.round(x * 100) / 100;
  const row = { source: "vinted", external_id: String(i.id), title: i.title, price: i.price, shipping: i.shipping || 0, url: i.url || null,
    image: i.image || null, photos: i.photos ?? 1, category: "card", market: mk.nm, market_src: `TCGplayer market · ${mk.set} (${mk.year})`,
    match: mk.match, condition: i.condition || null, cond_tier: tier, prices: Object.fromEntries(Object.entries(MULT).map(([k, m]) => [k, r2(mk.nm * m)])),
    discount: 1 - pct, profit: r2(profit), score, flags, suspicious: flags.length > 0, hints, unaware, last_seen: new Date().toISOString() };
  if (d) Object.assign(row, { seller: d.seller || null, listed_at: ago(d.uploaded, Date.parse(d.scraped_at) || Date.now()),
    description: (d.description || "").slice(0, 300), detailed: true });
  return { row, keep: mk.nm >= MIN_VALUE && pct <= MAX_PCT && profit >= MIN_PROFIT };
}

async function apifyLeft() { // dollars of Apify credit left this month, or null if unknown
  try {
    const r = await fetch("https://api.apify.com/v2/users/me/limits", { headers: { authorization: `Bearer ${clean("APIFY_TOKEN")}` } });
    const d = (await r.json()).data, u = d?.current?.monthlyUsageUsd, m = d?.limits?.maxMonthlyUsageUsd;
    return typeof u === "number" && typeof m === "number" ? m - u : null;
  } catch { return null; }
}
async function updateUsage() { // saves remaining Apify credit so the dashboard can show it
  const t = clean("APIFY_TOKEN"); if (!t) return;
  try {
    const r = await fetch("https://api.apify.com/v2/users/me/limits", { headers: { authorization: `Bearer ${t}` } });
    if (!r.ok) return console.error("Could not read Apify usage:", r.status);
    const d = (await r.json()).data, used = d?.current?.monthlyUsageUsd, max = d?.limits?.maxMonthlyUsageUsd;
    if (typeof used !== "number" || typeof max !== "number") return console.error("Unexpected Apify usage response");
    const u = await rest("usage?on_conflict=id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ id: 1, used, limit_usd: max, cycle_end: d.monthlyUsageCycle?.endAt || null, updated: new Date().toISOString() }) });
    if (!u.ok) console.error("Could not save usage:", u.status, await u.text());
  } catch (e) { console.error("Usage check failed:", e.message); }
}
async function log(ok, found, added, message) {
  console.log({ ok, found, added, message });
  await updateUsage();
  try {
    const r = await rest("scans", { method: "POST", body: JSON.stringify({ ok, found, added, message }) });
    if (!r.ok) console.error("COULD NOT SAVE TO SUPABASE:", r.status, await r.text());
  } catch (e) { console.error("COULD NOT REACH SUPABASE (check SUPABASE_URL secret):", e.message); }
}
const upsert = async rows => {
  if (!rows.length) return;
  const r = await rest("listings?on_conflict=source,external_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(rows) });
  if (!r.ok) throw new Error("Upsert failed: " + await r.text());
};

async function main() {
  if (process.env.GITHUB_EVENT_NAME === "schedule") { // paused = skip automatic runs; manual runs still work
    const s = await (await rest("settings?select=paused&id=eq.1")).json().catch(() => []);
    if (Array.isArray(s) && s[0]?.paused) return console.log("Auto-scan is paused. Skipping this scheduled run.");
  }
  const ps = await (await rest("scans?select=at&ok=eq.true&found=gt.0&order=at.desc&limit=1")).json().catch(() => []);
  const prevScan = Array.isArray(ps) && ps[0]?.at ? new Date(Date.parse(ps[0].at) - 3 * 6e4).toISOString() : null; // start of the "listed between" window
  let items, apify = false;
  if (process.env.VINTED_CRAWL === "1") items = await require("./crawl.js").crawlVinted();
  else if (clean("APIFY_TOKEN")) {
    const left = await apifyLeft();
    if (left !== null && left < 0.12) return log(false, 0, 0, `Skipped: only $${left.toFixed(2)} of Apify credit left this month`);
    items = await require("./apify.js").fetchApify(); apify = true;
  } else if (process.env.VINTED_DIRECT === "1") items = await require("./vinted.js").fetchVinted();
  else {
    if (!VINTED_FEED_URL) return log(false, 0, 0, "Scanner not connected: set APIFY_TOKEN, VINTED_CRAWL=1 or VINTED_FEED_URL");
    const fr = await fetch(VINTED_FEED_URL, { headers: VINTED_FEED_TOKEN ? { authorization: `Bearer ${VINTED_FEED_TOKEN}` } : {} });
    if (!fr.ok) throw new Error(`Feed returned ${fr.status}`);
    items = await fr.json(); if (!Array.isArray(items)) throw new Error("Feed must be a JSON array");
  }
  prices = await (await rest("market_prices?select=keyword,price,updated")).json();
  if (!Array.isArray(prices)) prices = [];

  // 1) price every card, keep only real bargains
  let cands = [], unverified = 0;
  for (const i of items) {
    if (!i.id || !i.title || typeof i.price !== "number" || SKIP.test(i.title)) continue;
    const mk = await lookup(i.title); if (!mk) continue;
    if (mk.unverified) { unverified++; continue; }
    const e = evaluate(i, mk); if (e?.keep) cands.push({ i, mk, row: e.row });
  }
  const ids = cands.map(c => String(c.i.id));
  const ex = ids.length ? await (await rest(`listings?select=external_id,detailed&source=eq.vinted&external_id=in.(${ids.map(encodeURIComponent).join(",")})`)).json() : [];
  const have = new Map((Array.isArray(ex) ? ex : []).map(e => [e.external_id, e.detailed]));

  // 2) open the product page of the best NEW deals: gets "listed X ago", seller and description (costs Apify credit)
  if (apify) {
    const pick = cands.filter(c => !have.get(String(c.i.id)) && c.row.score >= DETAIL_MIN).sort((a, b) => b.row.score - a.row.score).slice(0, DETAIL_MAX);
    if (pick.length && (await apifyLeft() ?? 1) > 0.06) {
      try {
        const det = await require("./apify.js").fetchDetails(pick.map(c => c.i.url).filter(Boolean));
        for (const c of pick) {
          const d = det[String(c.i.id)]; if (!d) continue;
          const e = evaluate(c.i, c.mk, d);
          if (!e || !e.keep) c.drop = true; else c.row = e.row;
        }
      } catch (e) { console.error("Detail lookup failed (continuing without):", e.message); }
    }
  }
  cands = cands.filter(c => !c.drop);
  const basic = cands.filter(c => !c.row.detailed), isOld = c => have.has(String(c.i.id));
  await upsert(basic.filter(c => isOld(c) && !have.get(String(c.i.id))).map(c => c.row)); // seen before: keep their listing-time fields
  await upsert(basic.filter(c => !isOld(c)).map(c => ({ ...c.row, listed_after: prevScan }))); // new: listed after the previous scan (estimate)
  await upsert(cands.filter(c => c.row.detailed).map(c => c.row));
  if (newPrices.length) await rest("market_prices?on_conflict=keyword", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(newPrices) });
  await log(true, items.length, cands.filter(c => !have.has(String(c.i.id))).length, `ok: ${cands.length} deals, ${unverified} skipped (could not verify the card or its price)`);
}
main().catch(e => log(false, 0, 0, String(e.message || e)).then(() => process.exit(1)));
