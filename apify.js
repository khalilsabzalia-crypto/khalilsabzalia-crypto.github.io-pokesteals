// Fetches Vinted listings through the Apify actor 123webdata/vinted-scraper (pay-per-result).
// Needs the Apify token in the APIFY_TOKEN secret. Never logs the token.
const TOKEN = (process.env.APIFY_TOKEN || "").replace(/\s+/g, "");
const PF = +process.env.VINTED_MIN_PRICE || 3; // skip $1-2 bulk commons
const PT = +process.env.VINTED_MAX_PRICE || 60; // only list items up to this price (saves paid results)
const URLS = (process.env.VINTED_URLS || [
  "https://www.vinted.com/catalog?search_text=pokemon%20base%20set&order=newest_first",
  "https://www.vinted.com/catalog?search_text=pokemon%20wotc&order=newest_first",
  "https://www.vinted.com/catalog?search_text=pokemon%201999&order=newest_first",
].map(u => `${u}&price_from=${PF}&price_to=${PT}`).join("|")).split("|").map(s => s.trim()).filter(Boolean);
const MAX = +process.env.VINTED_MAX_RESULTS || 7;      // listings per search URL
const CAP = +process.env.APIFY_MAX_USD || 0.06;        // hard spend cap per run (free plan = $5/month)
const ACT = "https://api.apify.com/v2/acts/123webdata~vinted-scraper/run-sync-get-dataset-items";
const auth = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

// Runs the actor. If the run fails midway (Apify answers 400 "run-failed"), keep what it already collected.
async function run(input, cap) {
  const r = await fetch(`${ACT}?maxTotalChargeUsd=${cap}`, { method: "POST", headers: auth, body: JSON.stringify(input) });
  if (r.ok) return { items: await r.json(), partial: false };
  const txt = await r.text(), id = (txt.match(/run ID: (\w+)/) || [])[1];
  if (id) {
    const d = await fetch(`https://api.apify.com/v2/actor-runs/${id}/dataset/items`, { headers: auth });
    if (d.ok) { const items = await d.json(); if (Array.isArray(items) && items.length) return { items, partial: true }; }
  }
  throw new Error(`Apify returned ${r.status}: ${txt.slice(0, 200)}`);
}

async function fetchApify() {
  const { items, partial } = await run({ categoryUrls: URLS, maxResultsPerScrape: MAX * URLS.length, usePagination: false, scrapeProductDetails: false }, CAP);
  const out = items.filter(d => d.product_id && d.name && typeof d.price === "number").map(d => ({
    id: d.product_id, title: d.name, price: d.price,
    shipping: Math.max(0, Math.round((((d.price_with_protection ?? d.price) - d.price) * 100)) / 100), // buyer-protection fee (shipping unknown)
    url: d.canonical_url || d.url, image: d.main_image || null,
    condition: d.condition || null, seller: null, seller_reviews: null, seller_rating: null, photos: d.main_image ? 1 : 0,
  }));
  out.partial = partial; // true = the run failed midway and this is only what it collected
  return out;
}
// Opens specific product pages (a few top deals only) to get "uploaded X ago", seller name and description.
async function fetchDetails(urls) {
  if (!urls.length) return {};
  const { items } = await run({ productUrls: urls, scrapeProductDetails: true }, 0.04);
  const out = {};
  for (const d of items)
    out[String(d.product_id)] = { uploaded: d.attributes?.uploaded || null, description: d.description || "", seller: d.seller_name || null, scraped_at: d.scraped_at };
  return out;
}
module.exports = { fetchApify, fetchDetails };
