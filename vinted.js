// PokéSteals Vinted connector.
// Uses ONLY the Vinted-approved feed/API endpoint configured in GitHub Actions.
// It deliberately does not call undocumented catalog endpoints or attempt to bypass 403 responses.

const FEED_URL = (process.env.VINTED_FEED_URL || "").trim();
const FEED_TOKEN = (process.env.VINTED_FEED_TOKEN || "").trim();

function first(...values) {
  return values.find(v => v !== undefined && v !== null && v !== "");
}

function normalize(item) {
  const id = first(item.id, item.item_id, item.external_id);
  const title = first(item.title, item.name);
  const rawPrice = first(item.price, item.amount, item.price?.amount);
  const price = Number(typeof rawPrice === "object" ? rawPrice.amount : rawPrice);
  if (id == null || !title || !Number.isFinite(price)) return null;

  const image = first(item.image, item.photo?.url, item.photos?.[0]?.url, item.images?.[0]?.url);
  const rawUrl = first(item.url, item.web_url, item.path);
  return {
    id: String(id),
    title: String(title),
    price,
    shipping: Number(first(item.shipping, item.shipping_price, 0)) || 0,
    url: rawUrl ? (String(rawUrl).startsWith("http") ? String(rawUrl) : null) : null,
    image: image ? String(image) : null,
    seller: first(item.seller, item.user?.login, item.seller?.username) ?? null,
    seller_reviews: Number.isFinite(Number(first(item.seller_reviews, item.user?.feedback_count)))
      ? Number(first(item.seller_reviews, item.user?.feedback_count)) : null,
    seller_rating: Number.isFinite(Number(first(item.seller_rating, item.user?.rating)))
      ? Number(first(item.seller_rating, item.user?.rating)) : null,
    photos: Number(first(item.photos_count, item.photo_count, item.photos?.length, item.images?.length, image ? 1 : 0))
  };
}

async function fetchVinted() {
  if (!FEED_URL) {
    throw new Error("No approved Vinted feed configured. Add the feed URL supplied/approved by Vinted as the VINTED_FEED_URL GitHub Actions secret.");
  }

  let parsed;
  try {
    const response = await fetch(FEED_URL, {
      headers: FEED_TOKEN ? { authorization: `Bearer ${FEED_TOKEN}`, accept: "application/json" } : { accept: "application/json" }
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error(`The approved Vinted feed denied access (HTTP ${response.status}). Verify the feed URL/token with Vinted; the scanner stopped without retrying.`);
      }
      if (response.status === 429) {
        throw new Error("The approved Vinted feed rate-limited the scan (HTTP 429). Respect its published limits and retry schedule.");
      }
      throw new Error(`The approved Vinted feed returned HTTP ${response.status}.`);
    }
    parsed = await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("The approved Vinted feed did not return valid JSON.");
    throw error;
  }

  const sourceItems = Array.isArray(parsed) ? parsed
    : Array.isArray(parsed.items) ? parsed.items
    : Array.isArray(parsed.data) ? parsed.data
    : null;
  if (!sourceItems) {
    throw new Error("Feed format not recognized. Expected a JSON array or an object containing an items[] or data[] array.");
  }
  return sourceItems.map(normalize).filter(Boolean);
}

module.exports = { fetchVinted };
