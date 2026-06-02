// Vercel serverless function: gates access to the app.
//  1) Verifies the email is on the program's registered list (a Google Sheet).
//  2) Optionally enforces a max of 2 concurrent devices per email.
//
// SETUP (no code needed):
//  A. Registered list — publish the Google Sheet to the web as CSV
//     (File -> Share -> Publish to web -> the sheet -> CSV), then in Vercel:
//     Settings -> Environment Variables -> ACCESS_SHEET_CSV_URL = <CSV link> -> Redeploy.
//     (While unset, the gate stays open = demo mode.)
//  B. 2-device limit (optional) — create a free Upstash Redis database, then set:
//     UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in Vercel env -> Redeploy.
//     (While unset, the device limit is simply not enforced.)

async function redis(base, token, ...args) {
  const path = args.map((a) => encodeURIComponent(String(a))).join("/");
  const r = await fetch(`${base}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const d = await r.json();
  return d.result;
}

export default async function handler(req, res) {
  const email = String((req.query && req.query.email) || "").trim().toLowerCase();
  const device = String((req.query && req.query.device) || "").trim();
  const sheetUrl = process.env.ACCESS_SHEET_CSV_URL;

  // 1) registration check
  if (!sheetUrl) return res.status(200).json({ allowed: true, reason: "not_configured", configured: false });
  if (!email) return res.status(200).json({ allowed: false, reason: "not_registered", configured: true });
  try {
    const r = await fetch(sheetUrl, { redirect: "follow" });
    const text = await r.text();
    const list = (text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).map((e) => e.toLowerCase());
    if (!list.includes(email)) return res.status(200).json({ allowed: false, reason: "not_registered", configured: true });
  } catch (e) {
    return res.status(200).json({ allowed: false, reason: "fetch_failed", configured: true });
  }

  // 2) optional max-2-concurrent-devices check
  const RU = process.env.UPSTASH_REDIS_REST_URL;
  const RT = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (RU && RT && device) {
    const TTL = 60 * 60 * 24; // a device counts as "active" for 24h since last seen
    const now = Date.now();
    const key = `devices:${email}`;
    try {
      await redis(RU, RT, "ZREMRANGEBYSCORE", key, "-inf", now - TTL * 1000);
      const known = await redis(RU, RT, "ZSCORE", key, device);
      if (known === null || known === undefined) {
        const count = Number(await redis(RU, RT, "ZCARD", key)) || 0;
        if (count >= 2) return res.status(200).json({ allowed: false, reason: "device_limit", configured: true });
      }
      await redis(RU, RT, "ZADD", key, now, device);
      await redis(RU, RT, "EXPIRE", key, TTL);
    } catch (e) { /* never lock a registered user out on a Redis hiccup */ }
  }

  return res.status(200).json({ allowed: true, reason: "ok", configured: true });
}
