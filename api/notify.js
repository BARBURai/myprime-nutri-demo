// Daily Web Push, two jobs from one function:
//   evening (default) - 19:00 Asia/Jerusalem, "did you fill the diary today?", same text for
//     everyone, but silent until her tracker opens on program day 3.
//   morning (?kind=morning) - 07:00 Asia/Jerusalem, "new content today", and for a woman who
//     was not in the app yesterday one extra line inviting her to catch up.
// Triggered by Vercel cron (sends Authorization: Bearer <CRON_SECRET>) OR an external cron (?secret=<NOTIFY_SECRET>).
// Reads all subscriptions from Redis HASH `push:subs`, sends a push to each, prunes dead ones (404/410).
// Vercel runs a scheduled job somewhere INSIDE its hour, not on the hour, so demanding an
// exact hour meant a late run sent nothing at all that day. Each job therefore accepts a
// two-hour window and claims a once-per-day marker in Redis, so a late run still delivers
// and two runs can never both send. ?force=1 bypasses both, for manual testing, and
// ?only=<email> sends to that woman's devices alone - without it a manual run reaches
// every registered phone.
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

// Israel-local date, matching the activity flag written by api/access.js.
function israelDay(offsetDays) {
  const d = new Date(Date.now() - (offsetDays || 0) * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

const PROGRAM_DAYS = 70;
// The daily tracker opens on program day 3 (CHECKIN_UNLOCK = { week: 1, day: 3 } in
// src/App.jsx). Before that the card does not exist and there is nothing to fill in.
const TRACKER_OPENS_ON_DAY = 3;

// Day number within the program, day 1 being her start Sunday.
function programDayNumber(startDate, onDate) {
  return Math.floor((new Date(onDate) - new Date(startDate)) / 86400000) + 1;
}

// Does she have new content today? Saturday is a rest day with none, and after the 70 days
// nothing new opens - everything already unlocked simply stays available. On those days the
// morning push says nothing at all, because a headline promising new content would be false.
function hasNewContent(startDate, today) {
  if (!startDate) return true; // unknown start date: behave as before rather than go silent
  const day = programDayNumber(startDate, today);
  if (day < 1 || day > PROGRAM_DAYS) return false;
  return new Date(today).getUTCDay() !== 6; // 6 = Saturday
}

// Does she have a tracker to fill in tonight? Reported by a participant on week 1 day 2:
// the evening push asked whether she had filled in her daily report while the tracker had
// not opened yet, so the question had no answer and no screen behind it. The tracker stays
// available after day 70, so this only ever guards the opening days.
function hasTracker(startDate, today) {
  if (!startDate) return true; // unknown start date: behave as before rather than go silent
  return programDayNumber(startDate, today) >= TRACKER_OPENS_ON_DAY;
}

export default async function handler(req, res) {
  const auth = req.headers.authorization || "";
  const cronOk = process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
  const secretOk = process.env.NOTIFY_SECRET && req.query && req.query.secret === process.env.NOTIFY_SECRET;
  if (!cronOk && !secretOk) return res.status(401).json({ ok: false, reason: "unauthorized" });

  const force = req.query && (req.query.force === "1" || req.query.force === "true");
  const morning = !!(req.query && req.query.kind === "morning");
  // Manual runs are for seeing the message on your own phone. Left unset, everyone gets it.
  const only = String((req.query && req.query.only) || "").trim().toLowerCase();
  const kind = morning ? "morning" : "evening";
  const startHour = morning ? 7 : 19;
  const h = jerusalemHour();
  if (!force && (h < startHour || h > startHour + 1)) {
    return res.status(200).json({ ok: true, skipped: `outside ${startHour}:00-${startHour + 1}:59 Jerusalem` });
  }

  const RU = process.env.UPSTASH_REDIS_REST_URL;
  const RT = process.env.UPSTASH_REDIS_REST_TOKEN;
  const PUB = process.env.VAPID_PUBLIC;
  const PRIV = process.env.VAPID_PRIVATE;
  if (!RU || !RT || !PUB || !PRIV) return res.status(200).json({ ok: false, reason: "not_configured" });

  // Claim the day. SET NX succeeds for exactly one run, so the second cron in the window
  // finds the day taken and stops before sending anything.
  if (!force) {
    try {
      const claimed = await redisCmd(RU, RT, ["SET", `push:sent:${kind}:${israelDay(0)}`, "1", "NX", "EX", "172800"]);
      if (claimed !== "OK") return res.status(200).json({ ok: true, skipped: `already sent today (${kind})` });
    } catch (e) { /* a Redis hiccup must not silence the day; better a rare duplicate */ }
  }

  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:hello@myprime.co.il", PUB, PRIV);

  const eveningPayload = JSON.stringify({
    title: "MyPrime מעקב",
    body: "תזכורת קטנה 💜 מילאת היום את דוח המעקב היומי שלך?",
    url: "/",
    tag: "daily-diary",
  });
  const MORNING_TITLE = "תוכן יומי חדש באפליקציה 🎉";
  const MORNING_BODY = "קחי רגע לעצמך - זה הזמן שלך! ענת 🌺";
  // Only ever an invitation. It never claims she did nothing, so it does no harm on the
  // day the flag is wrong for some other reason.
  const CATCHUP_LINE = "אם לא הספקת להיכנס אתמול לאפליקציה, ממליצה לך למצוא כמה דקות ולהשלים את הימים החסרים 🙏";

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

  const today = israelDay(0);

  // Who was NOT in the app yesterday. One MGET for everyone rather than a round trip per
  // woman, which at 1,300 subscriptions is the difference between one call and 1,300.
  const wasActive = new Map();
  if (morning) {
    const emails = [...new Set(entries.map(([, v]) => { try { return (JSON.parse(v).email || "").trim().toLowerCase(); } catch (e) { return ""; } }).filter(Boolean))];
    if (emails.length) {
      try {
        const y = israelDay(1);
        const vals = await redisCmd(RU, RT, ["MGET", ...emails.map((e) => `act:${y}:${e}`)]);
        emails.forEach((e, i) => wasActive.set(e, !!(Array.isArray(vals) && vals[i])));
      } catch (e) { /* unknown activity: send the plain message, never a wrong accusation */ }
    }
  }

  let sent = 0, pruned = 0, failed = 0, quiet = 0;
  for (const [endpoint, val] of entries) {
    let rec;
    try { rec = JSON.parse(val); } catch (e) { continue; }
    const sub = rec && rec.sub;
    if (!sub) continue;
    if (only && (rec.email || "").trim().toLowerCase() !== only) continue;

    let payload = eveningPayload;
    if (!morning && !hasTracker(rec.startDate, today)) { quiet++; continue; }
    if (morning) {
      if (!hasNewContent(rec.startDate, today)) { quiet++; continue; }
      const email = (rec.email || "").trim().toLowerCase();
      // Only add the catch-up line when we positively know she was away. An unknown email
      // or a failed lookup gets the plain message.
      const away = email && wasActive.has(email) && wasActive.get(email) === false;
      payload = JSON.stringify({
        title: MORNING_TITLE,
        body: away ? `${MORNING_BODY}\n\n${CATCHUP_LINE}` : MORNING_BODY,
        url: "/",
        tag: "daily-content",
      });
    }

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
  return res.status(200).json({ ok: true, kind: morning ? "morning" : "evening", sent, pruned, failed, quiet, total: entries.length });
}
