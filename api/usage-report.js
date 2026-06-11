// Daily MORNING usage report (Asia/Jerusalem) for the MyPrime AI.
// Reads the usage counters that api/ai.js writes to Redis for the previous day,
// estimates the cost from tokens, and emails a short summary via Resend.
//
// Triggered by Vercel cron (sends Authorization: Bearer <CRON_SECRET>) OR an external cron (?secret=<NOTIFY_SECRET>).
// Runs once each morning (gated to ~07:00-08:00 Asia/Jerusalem, DST-safe) and is idempotent per day.
//
// Required env:
//   UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN  (same Redis as ai.js)
//   RESEND_API_KEY                                     (from resend.com)
//   CRON_SECRET and/or NOTIFY_SECRET                   (auth, same as notify.js)
// Optional env:
//   REPORT_TO       (default "Ron@myprime.co.il")
//   REPORT_FROM     (default "MyPrime <onboarding@resend.dev>" - use a verified sender once your domain is set up in Resend)
//   AI_DAILY_LIMIT  (default 30 - used to count how many women hit the cap)
//   AI_PRICE_IN     (USD per 1M input tokens,  default 3  = Sonnet 4.6)
//   AI_PRICE_OUT    (USD per 1M output tokens, default 15 = Sonnet 4.6)
//   USD_NIS         (USD->NIS rate, default 3.7)
// Manual test:  /api/usage-report?secret=<NOTIFY_SECRET>&force=1            (reports yesterday)
//               /api/usage-report?secret=<NOTIFY_SECRET>&force=1&day=2026-06-09

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

// Israel-local date string (YYYY-MM-DD), offset by N days back.
function israelDay(offsetDays) {
  const d = new Date(Date.now() - (offsetDays || 0) * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

const toInt = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };

export default async function handler(req, res) {
  const auth = req.headers.authorization || "";
  const cronOk = process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
  const secretOk = process.env.NOTIFY_SECRET && req.query && req.query.secret === process.env.NOTIFY_SECRET;
  if (!cronOk && !secretOk) return res.status(401).json({ ok: false, reason: "unauthorized" });

  const force = req.query && (req.query.force === "1" || req.query.force === "true");
  const h = jerusalemHour();
  // One daily cron at 05:00 UTC => 07:00 (winter) or 08:00 (summer) Jerusalem.
  if (!force && h !== 7 && h !== 8) return res.status(200).json({ ok: true, skipped: "not morning in Jerusalem" });

  const base = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!base || !token) return res.status(200).json({ ok: false, reason: "redis_not_configured" });

  const day = (req.query && req.query.day) ? String(req.query.day) : israelDay(1); // default: yesterday

  // Idempotency: only send once per report-day (unless forced).
  if (!force) {
    const setRes = await redisCmd(base, token, ["SET", `usage:rep:${day}`, "1", "NX", "EX", "172800"]);
    if (setRes !== "OK") return res.status(200).json({ ok: true, skipped: "already sent for " + day });
  }

  // Totals (written by api/ai.js).
  const calls = toInt(await redisCmd(base, token, ["GET", `usage:${day}:calls`]));
  const inTok = toInt(await redisCmd(base, token, ["GET", `usage:${day}:in`]));
  const outTok = toInt(await redisCmd(base, token, ["GET", `usage:${day}:out`]));
  const photos = toInt(await redisCmd(base, token, ["GET", `usage:${day}:photos`]));
  const cacheHits = toInt(await redisCmd(base, token, ["GET", `usage:${day}:cachehits`]));

  // Per-user distribution from the rate-limit counters ai:day:<id>:<day>.
  let counts = [];
  try {
    const keys = (await redisCmd(base, token, ["KEYS", `ai:day:*:${day}`])) || [];
    for (const k of keys) counts.push(toInt(await redisCmd(base, token, ["GET", k])));
  } catch (e) { /* keep counts as-is */ }
  const activeUsers = counts.length;
  const sumUserCalls = counts.reduce((a, b) => a + b, 0);
  const avg = activeUsers ? sumUserCalls / activeUsers : 0;
  const maxU = activeUsers ? Math.max.apply(null, counts) : 0;
  const limit = Number(process.env.AI_DAILY_LIMIT || 30);
  const hitLimit = counts.filter((v) => v >= limit).length;

  // Cost estimate.
  const priceIn = Number(process.env.AI_PRICE_IN || 3);   // USD / 1M input tokens
  const priceOut = Number(process.env.AI_PRICE_OUT || 15); // USD / 1M output tokens
  const usdNis = Number(process.env.USD_NIS || 3.7);
  const usd = (inTok / 1e6) * priceIn + (outTok / 1e6) * priceOut;
  const nis = usd * usdNis;
  const avgCallUsd = calls ? usd / calls : 0;
  const savedNis = cacheHits * avgCallUsd * usdNis;
  const nisPerUser = activeUsers ? nis / activeUsers : 0;
  const f2 = (x) => (Math.round(x * 100) / 100).toFixed(2);
  const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);

  const row = (label, value) => `<tr><td style="padding:7px 0;color:#6b6b72;font-size:15px">${label}</td><td style="padding:7px 0;text-align:left;font-weight:600;color:#1f1f24;font-size:15px">${value}</td></tr>`;
  const html = `<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:18px;color:#1f1f24">
    <h2 style="margin:0 0 2px;color:#D45D79;font-size:20px">דוח שימוש יומי · MyPrime</h2>
    <div style="color:#8a8a90;font-size:14px;margin-bottom:14px">ניתוחי ה-AI מתאריך ${day}</div>
    <table style="width:100%;border-collapse:collapse">
      ${row("סך ניתוחי AI", calls.toLocaleString())}
      ${row("מתוכם צילומי ארוחה", photos.toLocaleString())}
      ${row("נשים פעילות (שהשתמשו ב-AI)", activeUsers.toLocaleString())}
      ${row("ממוצע ניתוחים לאישה", f1(avg))}
      ${row("מקסימום לאישה", maxU.toLocaleString())}
      ${row(`הגיעו למכסה (${limit})`, hitLimit.toLocaleString())}
      <tr><td colspan="2" style="border-top:1px solid #eee;padding-top:6px"></td></tr>
      ${row("טוקנים (קלט)", inTok.toLocaleString())}
      ${row("טוקנים (פלט)", outTok.toLocaleString())}
      ${row("עלות מוערכת", `₪${f2(nis)} <span style="color:#8a8a90;font-weight:400">($${f2(usd)})</span>`)}
      ${row("עלות מוערכת לאישה", `₪${f2(nisPerUser)}`)}
      ${row("נחסך מה-cache (קריאות)", `${cacheHits.toLocaleString()} ≈ ₪${f2(savedNis)}`)}
    </table>
    <div style="color:#a0a0a6;font-size:12px;margin-top:14px;line-height:1.6">העלות מחושבת מהטוקנים בפועל לפי מחירי Sonnet ($${priceIn}/$${priceOut} למיליון, שער ${usdNis}). הערכה - לנתון הרשמי ראה את עמוד ה-Usage בקונסול.</div>
  </div>`;

  const RESEND = process.env.RESEND_API_KEY;
  const summary = { ok: true, day, calls, photos, cacheHits, activeUsers, avg: f1(avg), maxU, hitLimit, inTok, outTok, usd: f2(usd), nis: f2(nis), savedNis: f2(savedNis) };
  if (!RESEND) return res.status(200).json({ ...summary, emailed: false, reason: "no RESEND_API_KEY (preview only)" });

  const to = process.env.REPORT_TO || "Ron@myprime.co.il";
  const from = process.env.REPORT_FROM || "MyPrime <onboarding@resend.dev>";
  try {
    const er = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject: `MyPrime · דוח שימוש AI · ${day}`, html }),
    });
    const ed = await er.json().catch(() => ({}));
    if (!er.ok) return res.status(200).json({ ...summary, emailed: false, resend_status: er.status, resend: ed });
    return res.status(200).json({ ...summary, emailed: true, id: ed && ed.id });
  } catch (e) {
    return res.status(200).json({ ...summary, emailed: false, error: String(e) });
  }
}
