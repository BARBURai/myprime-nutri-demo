// Vercel serverless function: gates access to the app.
//  1) Verifies the email is on the program's registered list (a Google Sheet).
//  2) Reads that participant's program START DATE from the same sheet row.
//  3) Enforces a usage window: 10 weeks (70 days) + 3 months from the start date.
//  4) Optionally enforces a max of 2 concurrent devices per email.
//
// SETUP (no code needed):
//  A. Registered list - publish the Google Sheet to the web as CSV
//     (File -> Share -> Publish to web -> the sheet -> CSV), then in Vercel:
//     Settings -> Environment Variables -> ACCESS_SHEET_CSV_URL = <CSV link> -> Redeploy.
//     (While unset, the gate stays open = demo mode.)
//     Each row must contain the participant's email and her start date.
//     Date format: DD/MM/YYYY (e.g. 15/06/2026) or YYYY-MM-DD. Column order does
//     not matter; a header row is fine. The start date is snapped to its Sunday.
//  B. 2-device limit (optional) - create a free Upstash Redis database, then set:
//     UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in Vercel env -> Redeploy.

async function redis(base, token, ...args) {
  const path = args.map((a) => encodeURIComponent(String(a))).join("/");
  const r = await fetch(`${base}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const d = await r.json();
  return d.result;
}

function parseDateToSunday(s) {
  if (!s) return null;
  const t = String(s).trim().replace(/^["']|["']$/g, "");
  let y, m, d;
  const iso = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const dmy = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (iso) { y = +iso[1]; m = +iso[2]; d = +iso[3]; }
  else if (dmy) { d = +dmy[1]; m = +dmy[2]; y = +dmy[3]; }
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (isNaN(dt.getTime())) return null;
  dt.setUTCDate(dt.getUTCDate() - dt.getUTCDay()); // snap to Sunday (0 = Sun)
  return dt;
}

function ymd(dt) { return dt.toISOString().slice(0, 10); }

// Access window ends 70 days + 3 months after the (Sunday) start date, inclusive of the last day.
function isExpired(startSunday) {
  const exp = new Date(startSunday.getTime());
  exp.setUTCDate(exp.getUTCDate() + 70);
  exp.setUTCMonth(exp.getUTCMonth() + 3);
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return today.getTime() > exp.getTime();
}

export default async function handler(req, res) {
  const email = String((req.query && req.query.email) || "").trim().toLowerCase();
  const device = String((req.query && req.query.device) || "").trim();
  const sheetUrl = process.env.ACCESS_SHEET_CSV_URL;

  // 1) registration + start-date lookup
  if (!sheetUrl) return res.status(200).json({ allowed: true, reason: "not_configured", configured: false });
  if (!email) return res.status(200).json({ allowed: false, reason: "not_registered", configured: true });

  let startStr = null, found = false, cancelled = false;
  try {
    const r = await fetch(sheetUrl, { redirect: "follow" });
    const text = await r.text();
    text.split(/\r?\n/).forEach((line) => {
      const em = (line.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/) || [])[0];
      if (!em || em.toLowerCase() !== email) return;
      found = true;
      const dm = (line.match(/\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{4}/) || [])[0];
      if (dm) startStr = dm;
      if (/(^|,)\s*TRUE\s*(,|$)/i.test(line)) cancelled = true; // cancellation column = TRUE
    });
  } catch (e) {
    return res.status(200).json({ allowed: false, reason: "fetch_failed", configured: true });
  }
  if (!found) return res.status(200).json({ allowed: false, reason: "not_registered", configured: true });
  if (cancelled) return res.status(200).json({ allowed: false, reason: "cancelled", configured: true });

  // 2) usage window (only when a parseable start date exists for this participant)
  const startSunday = parseDateToSunday(startStr);
  const startDate = startSunday ? ymd(startSunday) : null;
  if (startSunday && isExpired(startSunday)) {
    return res.status(200).json({ allowed: false, reason: "expired", configured: true, startDate });
  }

  // 3) optional max-2-concurrent-devices check
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
        if (count >= 2) return res.status(200).json({ allowed: false, reason: "device_limit", configured: true, startDate });
      }
      await redis(RU, RT, "ZADD", key, now, device);
      await redis(RU, RT, "EXPIRE", key, TTL);
    } catch (e) { /* never lock a registered user out on a Redis hiccup */ }
  }

  return res.status(200).json({ allowed: true, reason: "ok", configured: true, startDate });
}
