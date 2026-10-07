// POST /api/webhook  - קארדקום מדווחת כאן אחרי כל עסקה.
//
// מה שמגיע בבקשה אינו נחשב ראיה. לוקחים ממנו רק את מספר העסקה, ושואלים את
// קארדקום ישירות מה קרה (GetLpResult). זו ההוראה המפורשת במדריך שלהם.
//
// תשובה שאינה 200 גורמת לקארדקום לנסות שוב עד שבע פעמים. לכן תקלה ברב מסר
// מחזירה 500, ודיווח חוזר על עסקה שכבר טופלה מחזיר 200 בלי לעשות כלום.
import { productOf } from "../lib/products.js";
import { creds, getResult, isPaid } from "../lib/cardcom.js";
import { redis, redisOn } from "../lib/redis.js";
import { responderOn, addToList } from "../lib/responder.js";

const KEEP = 30 * 24 * 3600;

export function lowProfileIdOf(req) {
  const pools = [req.body, req.query].filter((x) => x && typeof x === "object");
  for (const o of pools) {
    for (const k of Object.keys(o)) {
      if (/^low ?profile(id|code)$/i.test(k) && o[k]) return String(o[k]).slice(0, 80);
    }
  }
  return null;
}

export default async function handler(req, res) {
  if (typeof req.body === "string") {
    try { req.body = JSON.parse(req.body); } catch { req.body = Object.fromEntries(new URLSearchParams(req.body)); }
  }
  const lpId = lowProfileIdOf(req);
  if (!lpId) return res.status(400).send("no id");

  const c = creds();
  if (!c) return res.status(503).send("config");

  let r;
  try {
    r = await getResult(c, lpId);
  } catch (e) {
    console.error("pay: GetLpResult failed", lpId, e.message);
    return res.status(500).send("retry");
  }

  const order = String(r && r.ReturnValue || "");
  let rec = null;
  if (redisOn() && order) {
    try { rec = JSON.parse((await redis(["GET", `pay:ord:${order}`])) || "null"); } catch {}
  }
  // ההזמנה בנויה כ-<מוצר>-<זמן>-<אקראי>, ולכן המוצר הוא כל מה שלפני שני המקפים האחרונים.
  const product = productOf(rec ? rec.slug : order.split("-").slice(0, -2).join("-"));
  if (!product) {
    console.error("pay: unknown product", lpId, order);
    return res.status(200).send("ignored");
  }
  if (!isPaid(r, c, product)) {
    console.log("pay: not paid", order, r && r.ResponseCode, r && r.TranzactionInfo && r.TranzactionInfo.ResponseCode);
    return res.status(200).send("not paid");
  }

  const buyer = rec ? rec.buyer : buyerFromResult(r);

  if (redisOn()) {
    try {
      if (await redis(["GET", `pay:done:${order}`])) return res.status(200).send("already");
      await redis(["SET", `pay:paid:${order}`, "1", "EX", KEEP]);
      if (buyer.email) await redis(["SET", `pay:paidmail:${product.slug}:${buyer.email}`, "1", "EX", KEEP]);
      await redis(["ZREM", "pay:pending", order]);
    } catch (e) {
      console.error("pay: redis mark failed", order, e.message);
    }
  }

  console.log("pay: paid", order, product.slug, r.TranzactionInfo && r.TranzactionInfo.TranzactionId);

  if (product.rmList && responderOn() && buyer.email) {
    try {
      await addToList(product.rmList, buyer);
    } catch (e) {
      console.error("pay: responder failed", order, e.message);
      return res.status(500).send("retry");
    }
  }

  if (redisOn()) {
    try { await redis(["SET", `pay:done:${order}`, "1", "EX", KEEP]); } catch {}
  }
  return res.status(200).send("ok");
}

// גיבוי למקרה ש-Redis לא החזיק את ההזמנה: הפרטים שהיא מסרה, כפי שקארדקום שמרה.
function buyerFromResult(r) {
  const u = r.UIValues || {};
  const [firstName, ...rest] = String(u.CardOwnerName || "").trim().split(/\s+/);
  return {
    firstName: firstName || "",
    lastName: rest.join(" "),
    email: String(u.CardOwnerEmail || "").trim().toLowerCase(),
    phone: String(u.CardOwnerPhone || "").trim(),
  };
}
