// GET /api/sweep?secret=...  - מי שמילאה פרטים ולא שילמה תוך 30 דקות נכנסת
// לרשימת "רכישה נכשלה" של המוצר ברב מסר, פעם אחת.
//
// נקרא מ-cron-job.org כל 10 דקות, כמו ההתראות של האפליקציה. PAY_SWEEP_SECRET בוורסל.
//
// מי ששילמה בניסיון אחר (אותו מייל, אותו מוצר) אינה נכנסת, אחרת אישה שהכרטיס
// שלה נדחה פעם אחת ושילמה בשנייה הייתה מקבלת מייל "חזרי לקנות".
import { productOf } from "../lib/products.js";
import { redis, redisOn } from "../lib/redis.js";
import { responderOn, addToList } from "../lib/responder.js";

export const WAIT_MS = 30 * 60 * 1000;
const BATCH = 50;

export default async function handler(req, res) {
  const secret = process.env.PAY_SWEEP_SECRET;
  if (!secret || (req.query && req.query.secret) !== secret) return res.status(401).send("no");
  if (!redisOn()) return res.status(200).json({ skipped: "no redis" });

  const due = await redis(["ZRANGEBYSCORE", "pay:pending", 0, Date.now() - WAIT_MS, "LIMIT", 0, BATCH]);
  const out = { checked: 0, failedList: 0, paid: 0, gone: 0, errors: 0 };

  for (const order of due || []) {
    out.checked++;
    try {
      if (await redis(["GET", `pay:paid:${order}`])) { out.paid++; await redis(["ZREM", "pay:pending", order]); continue; }
      const rec = JSON.parse((await redis(["GET", `pay:ord:${order}`])) || "null");
      const product = rec && productOf(rec.slug);
      if (!rec || !product) { out.gone++; await redis(["ZREM", "pay:pending", order]); continue; }
      if (await redis(["GET", `pay:paidmail:${product.slug}:${rec.buyer.email}`])) { out.paid++; await redis(["ZREM", "pay:pending", order]); continue; }
      if (product.rmFailedList && responderOn()) {
        await addToList(product.rmFailedList, rec.buyer);
        out.failedList++;
      }
      await redis(["ZREM", "pay:pending", order]);
    } catch (e) {
      // נשאר ברשימה ויטופל בסבב הבא.
      out.errors++;
      console.error("pay: sweep failed", order, e.message);
    }
  }
  return res.status(200).json(out);
}
