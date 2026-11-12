// PokéSteals scanner. Runs in GitHub Actions (Node 20, no dependencies). Never invents listings.
const { SUPABASE_URL: SB, SUPABASE_SERVICE_KEY: KEY, VINTED_FEED_URL, VINTED_FEED_TOKEN, POKEMONTCG_KEY } = process.env;
const H = { apikey: KEY, ...(KEY && KEY.startsWith("eyJ") ? { authorization: `Bearer ${KEY}` } : {}), "content-type": "application/json" };
const rest = (path, opts = {}) => fetch(`${SB}/rest/v1/${path}`, { ...opts, headers: { ...H, ...(opts.headers || {}) } });

const CATS = [["etb", /elite trainer|\betb\b/i], ["box", /booster box|display box/i],
  ["collection", /collection|\btin\b|premium|bundle|binder/i], ["sealed", /sealed|booster pack|blister|\bpack\b/i]];
const BAD = /\b(fake|proxy|replica|custom|orica|unofficial|reprint|counterfeit|not real|read desc)/i;
const categorize = t => (CATS.find(([, r]) => r.test(t)) || ["card"])[0];

async function log(ok, found, added, message) {
  await rest("scans", { method: "POST", body: JSON.stringify({ ok, found, added, message }) });
  console.log({ ok, found, added, message });
}

async function main() {
  let items;
  if (process.env.VINTED_DIRECT === "1") items = await require("./vinted.js").fetchVinted();
  else {
    if (!VINTED_FEED_URL) return log(false, 0, 0, "Scanner not connected: set VINTED_DIRECT=1 or VINTED_FEED_URL");
    const fr = await fetch(VINTED_FEED_URL, { headers: VINTED_FEED_TOKEN ? { authorization: `Bearer ${VINTED_FEED_TOKEN}` } : {} });
    if (!fr.ok) throw new Error(`Feed returned ${fr.status}`);
    items = await fr.json(); // [{id,title,price,shipping,url,image,seller,seller_reviews,seller_rating,photos}]
    if (!Array.isArray(items)) throw new Error("Feed must be a JSON array");
  }

  const prices = await (await rest("market_prices?select=keyword,price,updated")).json();
  const fresh = Date.now() - 3 * 864e5;
  const newCardPrices = [];

  async function cardMarket(title) {
    const m = title.match(/(\d{1,3})\s*\/\s*(\d{1,3})/); if (!m) return null;
    const [n, t] = [+m[1], +m[2]], low = title.toLowerCase();
    const hit = prices.find(p => p.keyword.startsWith("card:") && p.keyword.endsWith(`|${n}/${t}`)
      && low.includes(p.keyword.slice(5).split("|")[0]) && Date.parse(p.updated) > fresh);
    if (hit) return { price: +hit.price, src: "cache" };
    const r = await fetch(`https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(`number:${n} printedTotal:${t}`)}&select=name,tcgplayer`,
      { headers: POKEMONTCG_KEY ? { "X-Api-Key": POKEMONTCG_KEY } : {} });
    if (!r.ok) return null;
    for (const c of (await r.json()).data || []) {
      const name = c.name.toLowerCase();
      if (!low.includes(name.split(" ")[0])) continue;
      const vals = Object.values(c.tcgplayer?.prices || {}).map(p => p.market).filter(Boolean);
      if (!vals.length) continue;
      const price = Math.min(...vals); // conservative: lowest variant
      const row = { keyword: `card:${name}|${n}/${t}`, price, updated: new Date().toISOString() };
      prices.push(row); newCardPrices.push(row);
      return { price, src: "tcgplayer via pokemontcg.io" };
    }
    return null;
  }
  const sealedMarket = title => {
    const low = title.toLowerCase();
    const h = prices.filter(p => !p.keyword.startsWith("card:") && low.includes(p.keyword.toLowerCase()))
      .sort((a, b) => b.keyword.length - a.keyword.length)[0];
    return h ? { price: +h.price, src: "your price table" } : null;
  };

  const rows = [];
  for (const i of items) {
    if (!i.id || !i.title || typeof i.price !== "number") continue;
    const category = categorize(i.title);
    const mk = category === "card" ? await cardMarket(i.title) : sealedMarket(i.title);
    const total = i.price + (i.shipping || 0), flags = [];
    if (BAD.test(i.title)) flags.push("Suspicious wording (fake/proxy/custom)");
    if (i.photos === 0) flags.push("No photos");
    if (i.seller_reviews === 0) flags.push("Seller has no reviews");
    else if (i.seller_rating && i.seller_rating < 4) flags.push("Low seller rating");
    let discount = null, score = null;
    if (mk) {
      discount = (mk.price - total) / mk.price;
      if (i.price < mk.price * 0.35) flags.push("Price far below market (too good to be true?)");
      score = Math.round(Math.max(0, Math.min(discount, 0.8)) / 0.8 * 100);
      if (flags.length) score = Math.min(score, 40);
    }
    rows.push({ source: "vinted", external_id: String(i.id), title: i.title, price: i.price, shipping: i.shipping || 0,
      url: i.url || null, image: i.image || null, seller: i.seller || null, seller_reviews: i.seller_reviews ?? null,
      seller_rating: i.seller_rating ?? null, photos: i.photos ?? 1, category, market: mk?.price ?? null,
      market_src: mk?.src ?? null, discount, score, flags, suspicious: flags.length > 0, last_seen: new Date().toISOString() });
  }

  // Dedupe: count genuinely new, then upsert on (source, external_id). first_seen is untouched on update.
  let added = 0;
  if (rows.length) {
    const ids = rows.map(r => r.external_id);
    const ex = await (await rest(`listings?select=external_id&source=eq.vinted&external_id=in.(${ids.map(encodeURIComponent).join(",")})`)).json();
    added = rows.length - ex.length;
    const up = await rest("listings?on_conflict=source,external_id", { method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(rows) });
    if (!up.ok) throw new Error("Upsert failed: " + await up.text());
  }
  if (newCardPrices.length) await rest("market_prices?on_conflict=keyword", { method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(newCardPrices) });
  await log(true, items.length, added, "ok");
}
main().catch(e => log(false, 0, 0, String(e.message || e)).then(() => process.exit(1)));
