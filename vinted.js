// Low-volume Vinted US fetcher. Uses Vinted's undocumented web endpoint, so the response shape
// may change; if so, scan.js logs the error to the `scans` table and the dashboard banner.
const BASE = "https://www.vinted.com";
const UA = process.env.VINTED_UA || "PokeSteals/1.0 (contact: YOUR_EMAIL)";
const QUERIES = (process.env.VINTED_QUERIES || "pokemon card,pokemon elite trainer box,pokemon booster box,pokemon collection").split(",");
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchVinted() {
  const home = await fetch(BASE + "/", { headers: { "user-agent": UA } });
  const cookie = (home.headers.getSetCookie?.() || []).map(c => c.split(";")[0]).join("; ");
  const seen = new Map();
  for (const q of QUERIES) {
    await sleep(3000); // be gentle: one request every few seconds
    const r = await fetch(`${BASE}/api/v2/catalog/items?search_text=${encodeURIComponent(q.trim())}&order=newest_first&per_page=96&page=1`,
      { headers: { "user-agent": UA, cookie, accept: "application/json" } });
    if (r.status === 401 || r.status === 403 || r.status === 429)
      throw new Error(`Vinted blocked/limited the request (${r.status}). Stopping. Try a different network or ask Vinted for a feed.`);
    if (!r.ok) throw new Error(`Vinted returned ${r.status}`);
    for (const it of (await r.json()).items || []) {
      const price = +(it.price?.amount ?? it.price);
      if (!it.id || !it.title || !isFinite(price)) continue;
      seen.set(String(it.id), { id: it.id, title: it.title, price, shipping: 0,
        url: it.url?.startsWith("http") ? it.url : BASE + (it.path || ""), image: it.photo?.url || null,
        seller: it.user?.login || null, seller_reviews: null, seller_rating: null, photos: it.photo ? 1 : 0 });
    }
  }
  return [...seen.values()];
}
module.exports = { fetchVinted };
