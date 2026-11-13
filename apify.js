// Fetches Vinted listings through the Apify actor 123webdata/vinted-scraper (pay-per-result, ~$0.0009/listing).
const TOKEN = (process.env.APIFY_TOKEN || "").replace(/\s+/g, "");
const PF = +process.env.VINTED_MIN_PRICE || 3; // skip $1-2 bulk commons
const PT = +process.env.VINTED_MAX_PRICE || 60; // only list items up to this price (saves paid results)
const URLS = (process.env.VINTED_URLS || [
  "https://www.vinted.com/catalog?search_text=pokemon%20base%20set&order=newest_first",
  "https://www.vinted.com/catalog?search_text=pokemon%20wotc&order=newest_first",
  "https://www.vinted.com/catalog?search_text=pokemon%201999&order=newest_first",
].map(u => `${u}&price_from=${PF}&price_to=${PT}`).join("|")).split("|").map(s => s.trim()).filter(Boolean);
const MAX = +process.env.VINTED_MAX_RESULTS || 7;      // listings per search URL (5 scans/day must fit the free $5/month)
const CAP = +process.env.APIFY_MAX_USD || 0.06;        // hard spend cap per run (free plan = $5/month)

async function fetchApify() {
  const r = await fetch(`https://api.apify.com/v2/acts/123webdata~vinted-scraper/run-sync-get-dataset-items?maxTotalChargeUsd=${CAP}&memory=1024`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ categoryUrls: URLS, maxResultsPerScrape: MAX * URLS.length, usePagination: false, scrapeProductDetails: false }),
  });
  if (!r.ok) throw new Error(`Apify returned ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  return data.filter(d => d.product_id && d.name && typeof d.price === "number").map(d => ({
    id: d.product_id, title: d.name, price: d.price,
    shipping: Math.max(0, Math.round((((d.price_with_protection ?? d.price) - d.price) * 100)) / 100), // buyer-protection fee (shipping unknown)
    url: d.canonical_url || d.url, image: d.main_image || null,
    condition: d.condition || null, seller: null, seller_reviews: null, seller_rating: null, photos: d.main_image ? 1 : 0,
  }));
}
// Opens specific product pages (a few top deals only) to get "uploaded X ago", seller name and description. ~$0.002 each.
async function fetchDetails(urls) {
  if (!urls.length) return {};
  const r = await fetch(`https://api.apify.com/v2/acts/123webdata~vinted-scraper/run-sync-get-dataset-items?maxTotalChargeUsd=0.04&memory=1024`, {
    method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ productUrls: urls, scrapeProductDetails: true }),
  });
  if (!r.ok) throw new Error(`Apify details returned ${r.status}`);
  const out = {};
  for (const d of await r.json())
    out[String(d.product_id)] = { uploaded: d.attributes?.uploaded || null, description: d.description || "", seller: d.seller_name || null, scraped_at: d.scraped_at };
  return out;
}
module.exports = { fetchApify, fetchDetails };
