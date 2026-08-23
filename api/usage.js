// Progress numbers from a woman's device, for the office screen (public/admin.html).
//
// What arrives here is counts and nothing else: per programme day, how many lessons she
// finished out of how many exist; how many videos she completed; how many repeat views; and
// how many days she filled the tracker. Never what she ate, what she weighs, her measurements
// or anything she typed. Those stay on her device, and her backup stays encrypted with a key
// only she holds. Keep it that way: this endpoint must not grow into a data pipe.
//
// POST /api/usage   { email, days: {"1-1":[2,3], ...}, videosDone, videosTotal, views,
//                     trackerDays, glowDone, glowTotal, glowViews, glowStarted }
// Stored in the Redis HASH `admin:usage`, field = email.
//
// The same call also carries two small things about the notes bubble, because Vercel Hobby
// allows twelve serverless functions and we are on twelve. A file of its own would fail the
// whole deploy, so these ride here rather than becoming an endpoint:
//   note:     { screen, text }  - what she just wrote, filed under her address so the office
//                                 screen can answer it. It still goes to the Google Sheet too.
//   noteRead: "<id>"            - she read the answer and tapped "תודה, הבנתי".

const MAX_DAYS = 70;
const MAX_NOTES = 40;        // per woman, oldest dropped
const NOTE_CHARS = 1500;

async function redis(base, token, ...args) {
  const r = await fetch(`${base}/${args.map(encodeURIComponent).join("/")}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error("redis " + r.status);
  return (await r.json()).result;
}

const num = (v, max) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : 0;
};

// ── התיוג של מי שצפתה בשיעורי הבונוס ─────────────────────────────────────
// שם התג נקבע על ידי רון. **מדויק כלשונו**, כי תג שלא אותר במניצ'ט אינו שגיאה
// שם אלא כתיבה שנוחתת בשום מקום. זה בדיוק מה שקרה ב-v5.43.
const MC = "https://api.manychat.com";
const MC_WA_PHONE_FIELD = 11510562;   // WA_PHONE, וזו עמודת ID בגיליון
const GLOW_WATCH_TAG = "GLOW-DEMO-WATCH";

// **חד כיווני בכוונה.** צפתה זה צפתה, והתג לעולם אינו מוסר. אחרת האוטומציה
// במניצ'ט הייתה יכולה לירות שוב על אותה אישה.
async function tagWatched(RU, RT, email, phone) {
  const token = process.env.MANYCHAT_TOKEN;
  const p = String(phone || "").replace(/[^\d]/g, "");
  if (!token || !p) return;
  // הסימון נתפס לפני הקריאה ולא אחריה, כדי ששתי טעינות במקביל לא ישלחו פעמיים.
  // בלי תפוגה: זה אירוע של פעם אחת בחיים ואין לו סיבה לחזור.
  const first = await redis(RU, RT, "SET", `glowtag:${email}`, "1", "NX");
  if (first !== "OK") return;
  try {
    const call = async (path, body) => {
      const r = await fetch(MC + path, {
        method: body ? "POST" : "GET",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      let j = null; try { j = await r.json(); } catch (e) {}
      // מניצ'ט עונה 200 עם גוף שאומר שזה נכשל, ולכן קוד ה-HTTP לבדו אינו התשובה.
      const said = j && typeof j.status === "string" ? j.status : "";
      return { ok: r.ok && said !== "error", j };
    };
    const found = await call(`/fb/subscriber/findByCustomField?field_id=${MC_WA_PHONE_FIELD}&field_value=${encodeURIComponent(p)}`);
    const d = found.ok && found.j && found.j.data;
    const sub = Array.isArray(d) ? d[0] : d;
    if (!sub || !sub.id) throw new Error("not_found");
    const put = await call("/fb/subscriber/addTagByName", { subscriber_id: sub.id, tag_name: GLOW_WATCH_TAG });
    if (!put.ok) throw new Error("tag_failed");
  } catch (e) {
    // נכשל, ולכן משחררים את הסימון כדי שהטעינה הבאה שלה תנסה שוב.
    try { await redis(RU, RT, "DEL", `glowtag:${email}`); } catch (e2) {}
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const email = String((body && body.email) || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return res.status(400).json({ ok: false, error: "missing_email" });

  // Rebuild the payload rather than storing what was posted: this is an unauthenticated
  // endpoint, so nothing reaches Redis that was not shaped and bounded here.
  const daysIn = (body && body.days) || {};
  const days = {};
  Object.keys(daysIn).slice(0, MAX_DAYS).forEach((k) => {
    if (!/^\d{1,2}-\d{1,2}$/.test(k)) return;
    const pair = daysIn[k];
    if (!Array.isArray(pair)) return;
    const total = num(pair[1], 20);
    if (!total) return;
    days[k] = [Math.min(num(pair[0], 20), total), total];
  });

  const rec = {
    days,
    videosDone: num(body && body.videosDone, 500),
    videosTotal: num(body && body.videosTotal, 500),
    views: num(body && body.views, 100000),
    trackerDays: num(body && body.trackerDays, 400),
    // The מיי פריים Glow bonus, kept in fields of its own and never merged into the counts
    // above. Folded in, it would grow the denominator of "how much of the programme she
    // watched" and every woman holding the bonus would read as behind the rest. Asked so
    // the full Glow course can be offered to exactly the women who are watching it.
    glowDone: num(body && body.glowDone, 50),
    glowTotal: num(body && body.glowTotal, 50),
    glowViews: num(body && body.glowViews, 10000),
    glowStarted: !!(body && body.glowStarted),
    at: new Date().toISOString(),
  };

  const RU = process.env.UPSTASH_REDIS_REST_URL;
  const RT = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!RU || !RT) return res.status(200).json({ ok: true, stored: false });

  // The bubble posts a note on its own, with no counters in it. Writing the record anyway
  // would overwrite her real progress with a row of zeros until her next app load rebuilt
  // it. `days` is present on every genuine usage call and on none of the note-only ones,
  // so its presence is what decides.
  const hasUsage = !!(body && body.days && typeof body.days === "object");

  // מי שהתחילה לצפות בשיעורי הבונוס מתויגת במניצ'ט, כדי שאפשר יהיה לפנות אליה
  // שם בנפרד ממי שלא צפתה. **פעם אחת בחיים לכל אישה**: סימון ב-Redis חוסם כל
  // קריאה נוספת, והנקודה הזאת נקראת בכל טעינה של האפליקציה.
  if (hasUsage && rec.glowStarted) { tagWatched(RU, RT, email, body && body.phone).catch(() => {}); }

  try {
    if (hasUsage) await redis(RU, RT, "HSET", "admin:usage", email, JSON.stringify(rec));
    // "She finished today's tasks", so tonight's reminder can skip her. One day only: it
    // expires on its own, and tomorrow she is back in the list unless she finishes again.
    // A note she just wrote. Bounded and rebuilt here like everything else, because this
    // endpoint is unauthenticated. The sheet stays the record; this copy exists so the
    // office screen can reply to her inside the app.
    const note = body && body.note;
    if (note && String(note.text || "").trim()) {
      const one = {
        id: "n" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36),
        screen: String(note.screen || "").slice(0, 40),
        text: String(note.text).trim().slice(0, NOTE_CHARS),
        at: new Date().toISOString(),
      };
      try {
        await redis(RU, RT, "LPUSH", `notes:${email}`, JSON.stringify(one));
        await redis(RU, RT, "LTRIM", `notes:${email}`, "0", String(MAX_NOTES - 1));
        // One counter per woman, so the office screen learns who is waiting in a single
        // read instead of one call per name.
        await redis(RU, RT, "HINCRBY", "notes:pending", email, "1");
      } catch (e) {}
    }

    // She opened the bubble and tapped "תודה, הבנתי". Marking it read is what takes the dot
    // off her bubble and tells the office she saw it.
    const readId = String((body && body.noteRead) || "").slice(0, 40);
    if (readId) {
      try {
        const raw = await redis(RU, RT, "HGET", "notes:replies", email);
        const list = raw ? JSON.parse(raw) : [];
        let hit = false;
        list.forEach((r) => { if (r.id === readId && !r.read) { r.read = new Date().toISOString(); hit = true; } });
        if (hit) await redis(RU, RT, "HSET", "notes:replies", email, JSON.stringify(list));
      } catch (e) {}
    }

    if (body && body.doneToday) {
      const day = String(body.day || "").match(/^\d{4}-\d{2}-\d{2}$/) ? body.day : null;
      if (day) { try { await redis(RU, RT, "SET", `trk:${day}:${email}`, "1", "EX", 172800); } catch (e) {} }
    }
    return res.status(200).json({ ok: true, stored: true });
  } catch (e) {
    // Never worth surfacing to a participant: this runs in the background on app load.
    return res.status(200).json({ ok: true, stored: false });
  }
}
