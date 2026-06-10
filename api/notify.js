// Daily 19:00 (Asia/Jerusalem) Web Push: reminds each subscribed woman the tracking diary is open.
// Triggered by Vercel cron (sends Authorization: Bearer <CRON_SECRET>) OR an external cron (?secret=<NOTIFY_SECRET>).
// Reads all subscriptions from Redis HASH `push:subs`, sends a push to each, prunes dead ones (404/410).
// Gated so it only actually sends during the 19:00 hour in Asia/Jerusalem (DST-safe), unless ?force=1.
//   Env: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT, CRON_SECRET, NOTIFY_SECRET
import webpush from "web-push";

async function redisCmd(base, token, cmd) {
  const r = await fetch(base, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const d = await r.json();
  return d.result;
}

function jerusalemHour() {
  const s = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", hour: "2-digit", hour12: false }).format(new Date());
  return parseInt(s, 10);
}

export default async function handler(req, res) {
  const auth = req.headers.authorization || "";
  const cronOk = process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
  const secretOk = process.env.NOTIFY_SECRET && req.query && req.query.secret === process.env.NOTIFY_SECRET;
  if (!cronOk && !secretOk) return res.status(401).json({ ok: false, reason: "unauthorized" });

  const force = req.query && (req.query.force === "1" || req.query.force === "true");
  if (!force && jerusalemHour() !== 19) return res.status(200).json({ ok: true, skipped: "not 19:00 Jerusalem" });

  const RU = process.env.UPSTASH_REDIS_REST_URL;
  const RT = process.env.UPSTASH_REDIS_REST_TOKEN;
  const PUB = process.env.VAPID_PUBLIC;
  const PRIV = process.env.VAPID_PRIVATE;
  if (!RU || !RT || !PUB || !PRIV) return res.status(200).json({ ok: false, reason: "not_configured" });

  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:hello@myprime.co.il", PUB, PRIV);

  const payload = JSON.stringify({
    title: "MyPrime מעקב",
    body: "יומן המעקב נפתח לך 💜 הקדישי רגע למלא את היום",
    url: "/",
    tag: "daily-diary",
  });

  let raw;
  try {
    raw = await redisCmd(RU, RT, ["HGETALL", "push:subs"]);
  } catch (e) {
    return res.status(200).json({ ok: false, reason: "read_failed" });
  }

  const entries = [];
  if (Array.isArray(raw)) {
    for (let i = 0; i < raw.length; i += 2) entries.push([raw[i], raw[i + 1]]);
  }

  let sent = 0, pruned = 0, failed = 0;
  for (const [endpoint, val] of entries) {
    let rec;
    try { rec = JSON.parse(val); } catch (e) { continue; }
    const sub = rec && rec.sub;
    if (!sub) continue;
    try {
      await webpush.sendNotification(sub, payload);
      sent++;
    } catch (err) {
      const code = err && err.statusCode;
      if (code === 404 || code === 410) {
        try { await redisCmd(RU, RT, ["HDEL", "push:subs", endpoint]); } catch (e) {}
        pruned++;
      } else {
        failed++;
      }
    }
  }
  return res.status(200).json({ ok: true, sent, pruned, failed, total: entries.length });
}
