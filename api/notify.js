// Daily Web Push, two jobs from one function:
//   Anyone who already finished today's tasks gets a congratulation instead of the reminder,
//   at the same hour: api/usage.js sets trk:<day>:<email> the moment the day is marked
//   complete, and that flag expires by itself the next day.
//   evening (default) - 19:00 Asia/Jerusalem, "did you fill the diary today?", same text for
//     everyone, on programme days 3 to 70. On FRIDAY it aims for 18:00 instead, so it lands
//     before Shabbat comes in; vercel.json has a Friday-only 15:00 UTC cron for that, and the
//     regular 16:00 UTC one covers the same hour in winter.
// Neither one ever fires on a Saturday.
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

// The windows each push is allowed to fire in, decided by Ron on 10 August 2026.
// The tracker opens on program day 3 (CHECKIN_UNLOCK = { week: 1, day: 3 } in src/App.jsx),
// so before that the card does not exist and there is nothing to fill in.
const TRACKER_DAYS = { first: 3, last: 70 };
const CONTENT_DAYS = { first: 1, last: 69 };

// Saturday silences BOTH pushes for everyone, whatever day of the programme she is on.
// This is checked before the start date is, so a registration with no start date is quiet
// on Saturday too.
function isSaturday(today) {
  return new Date(today).getUTCDay() === 6;
}
function isFriday(today) {
  return new Date(today).getUTCDay() === 5;
}

// Each woman picks the hour her evening reminder lands, from a short fixed list, in
// profile > העדפות אפליקציה. A subscription written before this existed carries no hour
// and stays on 19:00, exactly as it was. FRIDAY overrides every choice: fixed at 18:00 for
// everyone, so it lands well before Shabbat comes in instead of arriving as she sits down.
const REMINDER_HOURS = [19, 20, 21, 22];
const FRIDAY_HOUR = 18;
const DEFAULT_HOUR = 19;
function reminderHourOf(rec, today) {
  if (isFriday(today)) return FRIDAY_HOUR;
  const h = Number(rec && rec.hour);
  return REMINDER_HOURS.includes(h) ? h : DEFAULT_HOUR;
}
// Which groups a run starting at Jerusalem hour h may serve: its own, plus the previous
// hour's as a second chance. Vercel starts a scheduled job somewhere inside its hour, so a
// run that slips past the hour would otherwise deliver nothing at all that day. This is the
// same two-chance protection the single 19:00 reminder always had, now applied per group.
function groupsForHour(h) {
  const last = REMINDER_HOURS[REMINDER_HOURS.length - 1];
  return [h, h - 1].filter((g) => g >= FRIDAY_HOUR && g <= last);
}

// Day number within the program, day 1 being her start Sunday.
function programDayNumber(startDate, onDate) {
  return Math.floor((new Date(onDate) - new Date(startDate)) / 86400000) + 1;
}

// Does she have new content today? Nothing new opens on Saturday, and from day 70 on
// everything already unlocked simply stays available. On those days the morning push says
// nothing at all, because a headline promising new content would be false.
function hasNewContent(startDate, today) {
  if (isSaturday(today)) return false;
  if (!startDate) return true; // unknown start date: send rather than go silent
  const day = programDayNumber(startDate, today);
  return day >= CONTENT_DAYS.first && day <= CONTENT_DAYS.last;
}

// Does she have a tracker to fill in tonight? Reported by a participant on week 1 day 2:
// the evening push asked whether she had filled in her daily report while the tracker had
// not opened yet, so the question had no answer and no screen behind it.
function hasTracker(startDate, today) {
  if (isSaturday(today)) return false;
  if (!startDate) return true; // unknown start date: send rather than go silent
  const day = programDayNumber(startDate, today);
  return day >= TRACKER_DAYS.first && day <= TRACKER_DAYS.last;
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
  const h = jerusalemHour();
  // Morning is one time for everyone and keeps the plain two-hour window. Evening is per
  // woman now, so instead of one window there are hour groups, and this run serves the
  // group due now plus the previous one. ?hour=22 forces a single group, for testing.
  const askedHour = Number((req.query && req.query.hour) || 0);
  let groups = morning ? [] : (askedHour ? [askedHour] : groupsForHour(h));
  if (morning && !force && (h < 7 || h > 8)) {
    return res.status(200).json({ ok: true, skipped: "outside 7:00-8:59 Jerusalem" });
  }
  if (!morning && !groups.length) {
    if (!force) return res.status(200).json({ ok: true, skipped: `no reminder group at ${h}:00 Jerusalem` });
    groups = [FRIDAY_HOUR, ...REMINDER_HOURS]; // a forced manual run reaches everyone
  }

  const RU = process.env.UPSTASH_REDIS_REST_URL;
  const RT = process.env.UPSTASH_REDIS_REST_TOKEN;
  const PUB = process.env.VAPID_PUBLIC;
  const PRIV = process.env.VAPID_PRIVATE;
  if (!RU || !RT || !PUB || !PRIV) return res.status(200).json({ ok: false, reason: "not_configured" });

  // Claim before sending. SET NX succeeds for exactly one run, so the second cron in the
  // window finds the day taken and stops. The evening claims PER HOUR GROUP: with one claim
  // for the whole evening, the 19:00 run would take the day and nobody who chose 22:00
  // would ever be served.
  let serve = groups;
  if (!force) {
    if (morning) {
      try {
        const claimed = await redisCmd(RU, RT, ["SET", `push:sent:morning:${israelDay(0)}`, "1", "NX", "EX", "172800"]);
        if (claimed !== "OK") return res.status(200).json({ ok: true, skipped: "already sent today (morning)" });
      } catch (e) { /* a Redis hiccup must not silence the day; better a rare duplicate */ }
    } else {
      const got = [];
      for (const g of groups) {
        try {
          const claimed = await redisCmd(RU, RT, ["SET", `push:sent:evening:${g}:${israelDay(0)}`, "1", "NX", "EX", "172800"]);
          if (claimed === "OK") got.push(g);
        } catch (e) { got.push(g); /* same rule: a hiccup must not silence the hour */ }
      }
      serve = got;
      if (!serve.length) return res.status(200).json({ ok: true, skipped: "already sent today (evening)" });
    }
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
  // Who already finished today's tasks. Asking a woman whether she filled the tracker after
  // she just filled it is noise, and noise is what makes her switch notifications off, which
  // costs her the reminders that do help. One MGET for everyone, same as above.
  const doneToday = new Set();
  if (!morning) {
    const emails = [...new Set(entries.map(([, v]) => { try { return (JSON.parse(v).email || "").trim().toLowerCase(); } catch (e) { return ""; } }).filter(Boolean))];
    if (emails.length) {
      try {
        const vals = await redisCmd(RU, RT, ["MGET", ...emails.map((e) => `trk:${today}:${e}`)]);
        emails.forEach((e, i) => { if (Array.isArray(vals) && vals[i]) doneToday.add(e); });
      } catch (e) { /* unknown: send the reminder rather than silence someone who needs it */ }
    }
  }
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

  // Women on a freeze hear nothing at all, morning or evening. A reminder to fill a tracker
  // she cannot reach is the fastest way to make her switch notifications off for good. One
  // read of the office overrides for everyone, not one per woman.
  const frozen = new Set();
  try {
    const raw2 = await redisCmd(RU, RT, ["HGETALL", "admin:overrides"]);
    const flat = {};
    if (Array.isArray(raw2)) { for (let i = 0; i < raw2.length; i += 2) flat[raw2[i]] = raw2[i + 1]; }
    else if (raw2 && typeof raw2 === "object") Object.assign(flat, raw2);
    Object.keys(flat).forEach((em) => {
      let o = null;
      try { o = JSON.parse(flat[em]); } catch (e) { return; }
      if (o && o.blocked === "1") { frozen.add(em.toLowerCase()); return; }
      if (o && o.freeze && (!o.freeze.back || today < o.freeze.back)) frozen.add(em.toLowerCase());
    });
  } catch (e) { /* unreadable: send as usual rather than silence everyone */ }

  let sent = 0, pruned = 0, failed = 0, quiet = 0;
  for (const [endpoint, val] of entries) {
    let rec;
    try { rec = JSON.parse(val); } catch (e) { continue; }
    const sub = rec && rec.sub;
    if (!sub) continue;
    if (only && (rec.email || "").trim().toLowerCase() !== only) continue;

    let payload = eveningPayload;
    // A woman who already finished everything today gets nothing tonight. Asking her whether
    // she filled the tracker she just filled is noise, and the congratulation is not sent from
    // here: it is on the celebration screen inside the app, the moment she closes the day.
    // That reaches her at any hour, including long after this reminder has gone out, and it
    // reaches her even if she has notifications turned off.
    if (frozen.has((rec.email || "").trim().toLowerCase())) { quiet++; continue; }
    if (!morning && doneToday.has((rec.email || "").trim().toLowerCase())) { quiet++; continue; }
    if (!morning && !hasTracker(rec.startDate, today)) { quiet++; continue; }
    if (!morning && !serve.includes(reminderHourOf(rec, today))) { quiet++; continue; }
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
  return res.status(200).json({ ok: true, kind: morning ? "morning" : "evening", hours: morning ? null : serve, sent, pruned, failed, quiet, total: entries.length });
}
