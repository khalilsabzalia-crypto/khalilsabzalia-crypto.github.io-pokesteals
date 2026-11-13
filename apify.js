// Fetches Vinted listings through the Apify actor 123webdata/vinted-scraper (pay-per-result, ~$0.0009/listing).
const TOKEN = (process.env.APIFY_TOKEN || "").replace(/\s+/g, "");
const URLS = (process.env.VINTED_URLS || [
  "https://www.vinted.com/catalog?search_text=pokemon%20elite%20trainer%20box&order=newest_first",
  "https://www.vinted.com/catalog?search_text=pokemon%20booster%20box&order=newest_first",
  "https://www.vinted.com/catalog?search_text=pokemon%20card&order=newest_first",
].join("|")).split("|").map(s => s.trim()).filter(Boolean);
const MAX = +process.env.VINTED_MAX_RESULTS || 15;     // listings per search URL
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
    seller: null, seller_reviews: null, seller_rating: null, photos: d.main_image ? 1 : 0,
  }));
}
module.exports = { fetchApify };
