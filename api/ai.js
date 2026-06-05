// Vercel serverless function: proxies requests to the Anthropic API.
// The API key lives ONLY here (server side) - never in the client.
//
// SETUP (no code needed):
//  - ANTHROPIC_API_KEY (required) in Vercel env.
//  - AI_MODEL (optional) e.g. "claude-haiku-4-5" to use the cheaper model for cost control.
//
// PER-USER RATE LIMIT (protects against runaway token costs):
//  Reuses the SAME Upstash Redis used by the access gate. Set in Vercel env:
//    UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
//  Optional tuning (defaults in code):
//    AI_DAILY_LIMIT  = max AI calls per user per day        (default 25)
//    AI_BURST_LIMIT  = max AI calls per user per minute     (default 10)
//  While the Upstash vars are unset, the limit is simply OFF (the app still works).

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT || 25);
const BURST_LIMIT = Number(process.env.AI_BURST_LIMIT || 10);

async function redis(base, token, ...args) {
  const path = args.map((a) => encodeURIComponent(String(a))).join("/");
  const r = await fetch(`${base}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const d = await r.json();
  return d.result;
}

// Date key in Israel time, so the daily quota resets at local midnight.
function israelDay() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: "missing ANTHROPIC_API_KEY" });

  // --- per-user rate limit (server side) ---
  const base = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (base && token) {
    try {
      const uid = String(req.headers["x-user-id"] || "").trim().toLowerCase();
      const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
      const id = uid || (fwd ? "ip:" + fwd : "anon");

      const dayKey = `ai:day:${id}:${israelDay()}`;
      const dayCount = await redis(base, token, "INCR", dayKey);
      if (dayCount === 1) await redis(base, token, "EXPIRE", dayKey, 172800); // ~48h
      if (dayCount > DAILY_LIMIT) {
        return res.status(429).json({ error: "limit", scope: "day", message: "הגעת למכסת הפעולות להיום. נתראה מחר 💜" });
      }

      const minKey = `ai:min:${id}:${Math.floor(Date.now() / 60000)}`;
      const minCount = await redis(base, token, "INCR", minKey);
      if (minCount === 1) await redis(base, token, "EXPIRE", minKey, 120);
      if (minCount > BURST_LIMIT) {
        return res.status(429).json({ error: "limit", scope: "burst", message: "רגע, יותר מדי בקשות בבת אחת. נסי שוב עוד דקה." });
      }
    } catch (e) {
      // If the limiter itself errors, do not block the user - just log.
      console.warn("rate-limit error:", String(e));
    }
  } else {
    console.warn("AI rate limit OFF - set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN in Vercel to enable.");
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    body.model = process.env.AI_MODEL || DEFAULT_MODEL; // always use a current, valid model
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
