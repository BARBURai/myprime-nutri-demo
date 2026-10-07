// POST /api/create  { p, firstName, lastName, phone, email, tz, mkt, terms, biz? }
//   -> { url }  הכתובת של טופס התשלום של קארדקום, שהדף משבץ בתוכו.
//
// הסכום נלקח מ-lib/products.js ולעולם לא מהבקשה.
import { productOf } from "../lib/products.js";
import { parseBuyer } from "../lib/buyer.js";
import { creds, buildCreate, createPage } from "../lib/cardcom.js";
import { redis, redisOn } from "../lib/redis.js";

const ORDER_TTL = 14 * 24 * 3600;

export function originOf(req) {
  if (process.env.PAY_ORIGIN) return process.env.PAY_ORIGIN.replace(/\/+$/, "");
  return `https://${req.headers.host}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  const body = typeof req.body === "string" ? safeJson(req.body) : req.body || {};

  const product = productOf(body.p);
  if (!product) return res.status(404).json({ error: "not_found" });

  const parsed = parseBuyer(body, product.maxPayments || 1);
  if (parsed.missing) return res.status(400).json({ error: "missing", missing: parsed.missing });
  const buyer = parsed.buyer;

  const c = creds();
  if (!c) {
    console.error("pay: CARDCOM_TERMINAL / CARDCOM_API_NAME missing");
    return res.status(503).json({ error: "config" });
  }

  const order = `${product.slug}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  // נשמר כדי שהדיווח מקארדקום ידע מי היא ולאיזו רשימה להכניס אותה, וכדי
  // שמי שלא השלימה תגיע לרשימת "רכישה נכשלה". תקלה כאן אינה עוצרת תשלום.
  if (redisOn()) {
    try {
      await redis(["SET", `pay:ord:${order}`, JSON.stringify({ slug: product.slug, buyer, ts: Date.now() }), "EX", ORDER_TTL]);
      await redis(["ZADD", "pay:pending", Date.now(), order]);
    } catch (e) {
      console.error("pay: redis save failed", order, e.message);
    }
  }

  let r;
  try {
    r = await createPage(buildCreate({ c, product, order, buyer, origin: originOf(req) }));
  } catch (e) {
    console.error("pay: cardcom create failed", order, e.message);
    return res.status(502).json({ error: "cardcom" });
  }
  if (!r || r.ResponseCode !== 0 || !r.Url) {
    console.error("pay: cardcom refused", order, r && r.ResponseCode, r && r.Description);
    return res.status(502).json({ error: "cardcom" });
  }
  return res.status(200).json({ url: r.Url });
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
