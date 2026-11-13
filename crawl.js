// Free local crawler (Crawlee + Playwright). Run it from your own PC: node scan.js with VINTED_CRAWL=1.
// Polite by design: one page at a time, a pause between pages, only a few search pages, no proxies or stealth tricks.
const { PlaywrightCrawler } = require("crawlee");
const URLS = (process.env.VINTED_URLS || [
  "https://www.vinted.com/catalog?search_text=pokemon%20elite%20trainer%20box&order=newest_first",
  "https://www.vinted.com/catalog?search_text=pokemon%20booster%20box&order=newest_first",
  "https://www.vinted.com/catalog?search_text=pokemon%20card&order=newest_first",
].join("|")).split("|").map(s => s.trim()).filter(Boolean);
const MAX = +process.env.VINTED_MAX_RESULTS || 48; // listings kept per search page

async function crawlVinted() {
  const items = new Map();
  let blocked = null;
  const crawler = new PlaywrightCrawler({
    maxConcurrency: 1, sameDomainDelaySecs: 6, maxRequestRetries: 1, maxRequestsPerCrawl: URLS.length,
    headless: process.env.CRAWL_HEADFUL !== "1", // set CRAWL_HEADFUL=1 to watch the browser
    async requestHandler({ page, response }) {
      const st = response?.status();
      if (st === 403 || st === 429) { blocked = st; return; } // stop politely; never try to get around a block
      try { await page.click("#onetrust-accept-btn-handler", { timeout: 3000 }); } catch {} // cookie banner, if shown
      await page.waitForSelector('a[href*="/items/"]', { timeout: 20000 });
      const rows = await page.$$eval('a[href*="/items/"]', as => as.map(a => {
        const card = a.closest('[data-testid*="product-item"]') || a.parentElement;
        return { href: a.href, title: a.getAttribute("title") || "", text: card?.innerText || "", img: card?.querySelector("img")?.src || null };
      }));
      let n = 0;
      for (const r of rows) {
        const m = r.href.match(/\/items\/(\d+)/);
        if (!m || items.has(m[1])) continue;
        const prices = [...(r.title + " " + r.text).matchAll(/\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g)].map(x => +x[1].replace(/,/g, ""));
        if (!prices.length) continue;
        const name = (r.title.split(/, (?:brand|condition):/i)[0] || r.text.split("\n")[0] || "").trim();
        if (!name) continue;
        items.set(m[1], { id: m[1], title: name, price: prices[0],
          shipping: prices[1] > prices[0] ? Math.round((prices[1] - prices[0]) * 100) / 100 : 0, // buyer-protection fee if shown
          url: r.href.split("?")[0], image: r.img, seller: null, seller_reviews: null, seller_rating: null, photos: r.img ? 1 : 0 });
        if (++n >= MAX) break;
      }
    },
  });
  await crawler.run(URLS);
  if (blocked) throw new Error(`Vinted blocked/limited the request (${blocked}). Stopping.`);
  if (!items.size) throw new Error("No listings found: Vinted may have shown a verification page or changed its layout.");
  console.log("sample:", [...items.values()].slice(0, 3));
  return [...items.values()];
}
module.exports = { crawlVinted };
