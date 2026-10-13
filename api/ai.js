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
//    AI_DAILY_LIMIT  = max AI calls per user per day        (default 30)
//    AI_BURST_LIMIT  = max AI calls per user per minute     (default 10)
//    AI_PHOTO_LIMIT  = max meal PHOTOS per user (program)   (default 70)
//  While the Upstash vars are unset, the limit is simply OFF (the app still works).
//  The photo budget is a hard server-side cap (per email) so it cannot be reset by clearing the browser.

import { normName } from "../lib/foodcheck.js";
import { SUB_HASH, SUB_PHOTO_LIMIT, subOpen, subPhotoKey, parseRec as parseSubRec } from "./_sub.js";

export const DEFAULT_MODEL = "claude-sonnet-4-6";
export const DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT || 30);
const BURST_LIMIT = Number(process.env.AI_BURST_LIMIT || 10);
export const PHOTO_LIMIT = Number(process.env.AI_PHOTO_LIMIT || 70);
// **פניות נסתרות אינן נספרות ב-30 היומיות. v8.17.** האפליקציה מריצה שתיים בלי שהאישה
// שלחה דבר: חילוץ ההעדפות במסך "מה כדאי לאכול", ותרגום לאנגלית בחיפוש שלא מצא. הן
// מסומנות `x-ai-kind: aux`, ונחשבות ככאלה רק כשהן נראות כמו הן: טקסט, תור אחד, ותשובה
// קצרה. **מונה משלהן ותקרה משלהן**, כדי שהכותרת לא תהפוך לדלת אחורית, והמגבלה לדקה חלה.
export const AUX_LIMIT = Number(process.env.AI_AUX_LIMIT || 60);
const AUX_MAX_TOKENS = 300;
// ההודעה למנויה שסיימה את 30 הצילומים של החודש. v8.10.
export const SUB_PHOTO_MSG = "סיימת את 30 צילומי הארוחה של החודש 💜 הם מתחדשים בחיוב הבא של המנוי. עד אז תמיד אפשר לתאר לי בטקסט מה אכלת ואני אעריך עבורך את הערכים.";

async function redis(base, token, ...args) {
  const path = args.map((a) => encodeURIComponent(String(a))).join("/");
  const r = await fetch(`${base}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const d = await r.json();
  return d.result;
}

// POST form - use for commands with large/arbitrary values (e.g. caching a JSON response).
async function redisPost(base, token, cmd) {
  const r = await fetch(base, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(cmd) });
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

  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; } catch (e) { return res.status(400).json({ error: "bad body" }); }
  // A "photo" call is one whose NEWEST user message carries an image. v8.15: the photo chat
  // keeps the image in its history, so every follow-up reply ("כן", "חצי מנה") resent it, and
  // checking all messages counted each reply as another photo. Follow-ups still count daily.
  const isPhoto = (() => {
    const all = Array.isArray(body && body.messages) ? body.messages : [];
    for (let i = all.length - 1; i >= 0; i--) {
      const m = all[i];
      if (m && m.role === "user") return Array.isArray(m.content) && m.content.some((c) => c && c.type === "image");
    }
    return false;
  })();

  const base = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  // --- AI result cache: identical first-turn TEXT queries skip the AI call entirely ---
  // Saves cost and keeps answers consistent. Photos and multi-turn refinements are never cached.
  const msgs = Array.isArray(body && body.messages) ? body.messages : [];
  const userMsgs = msgs.filter((m) => m && m.role === "user");
  const asstMsgs = msgs.filter((m) => m && m.role === "assistant");
  const firstTurn = userMsgs.length === 1 && asstMsgs.length === 0;
  const isAux = String((req.headers && req.headers["x-ai-kind"]) || "") === "aux" && !isPhoto && msgs.length === 1 && firstTurn
    && Number(body && body.max_tokens) > 0 && Number(body && body.max_tokens) <= AUX_MAX_TOKENS;
  const lastUserText = (() => { const m = userMsgs[userMsgs.length - 1]; if (!m) return ""; if (typeof m.content === "string") return m.content; if (Array.isArray(m.content)) return m.content.filter((c) => c && c.type === "text").map((c) => c.text).join(" "); return ""; })();
  const normQuery = normName(lastUserText);
  const cacheable = !isPhoto && firstTurn && normQuery.length >= 2 && normQuery.length <= 200;
  const cacheKey = `aicache:${normQuery}`;
  if (base && token && cacheable) {
    try {
      const hit = await redis(base, token, "GET", cacheKey);
      if (hit) {
        const day = israelDay();
        redis(base, token, "INCR", `usage:${day}:cachehits`).then((c) => { if (c === 1) redis(base, token, "EXPIRE", `usage:${day}:cachehits`, 691200); }).catch(() => {});
        res.setHeader("x-ai-cache", "hit");
        return res.status(200).json(JSON.parse(hit));
      }
    } catch (e) { console.warn("ai-cache read error:", String(e)); }
  }

  // --- per-user rate limit (server side) ---
  //
  // **קוראים לפני, סופרים אחרי שהצליח.** v7.36
  //
  // עד כאן שלושת המונים עשו INCR לפני שהבינה נקראה בכלל, ולא היה בשום מקום
  // DECR. **כלומר כל ניסיון שנכשל גזל מהאישה מכסה**, גם כשלא קיבלה שום תשובה.
  //
  // **נילי קוניאק, 22 בספטמבר 2026:** "אני רואה שהאפליקציה כבר מגבילה אותי במספר
  // המנות שאני מצלמת, אבל בוודאות לא הגעתי ל-70 תמונות." היא צדקה.
  //
  // **הגבולות לא זזו באף כיוון.** קודם היה INCR ואחריו `> LIMIT`, ועכשיו GET ואחריו
  // `>= LIMIT`. שתי הצורות מחזירות בדיוק את אותה תשובה על כל מספר, ובדיקה נועלת את זה.
  //
  // **ושום מונה קיים אינו נגע ואינו מתאפס.** מה שכבר נספר לאשה נשאר כפי שהוא, כי אין לנו
  // שום רישום שאומר אילו מהניסיונות הישנים נכשלו. **השבה לאחור היא החלטה של רון,
  // והיא נפרדת מהתיקון הזה.**
  let counters = null;
  if (base && token) {
    try {
      const uid = String(req.headers["x-user-id"] || "").trim().toLowerCase();
      const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
      const id = uid || (fwd ? "ip:" + fwd : "anon");
      const dayKey = isAux ? `ai:aux:${id}:${israelDay()}` : `ai:day:${id}:${israelDay()}`;
      const dayLimit = isAux ? AUX_LIMIT : DAILY_LIMIT;
      const minKey = `ai:min:${id}:${Math.floor(Date.now() / 60000)}`;
      const photoKey = `ai:photos:${id}`;

      const dayHad = Number(await redis(base, token, "GET", dayKey)) || 0;
      if (dayHad >= dayLimit) {
        if (isAux) return res.status(429).json({ error: "limit", scope: "aux" });
        return res.status(429).json({ error: "limit", scope: "day", message: "הגעת למכסת ניתוחי ה-AI להיום 💜 אפשר להמשיך לתעד ארוחות דרך חיפוש או ברקוד, ומחר המכסה מתאפסת." });
      }
      const minHad = Number(await redis(base, token, "GET", minKey)) || 0;
      if (minHad >= BURST_LIMIT) {
        return res.status(429).json({ error: "limit", scope: "burst", message: "רגע, יותר מדי בקשות בבת אחת. נסי שוב עוד דקה." });
      }
      let photoHad = 0;
      let photoCounter = photoKey;
      if (isPhoto) {
        // **מנויה חודשית: 30 צילומים בחודש, ומתחילים מחדש בכל חיוב.** החלטת רון, 12 באוקטובר
        // 2026. המונה של התוכנית אינו נגע ואינו נספר בזמן המנוי. v8.10, ראה api/_sub.js.
        let sub = null;
        if (uid) { try { const rec = parseSubRec(await redis(base, token, "HGET", SUB_HASH, uid)); if (subOpen(rec, israelDay())) sub = rec; } catch (e) { sub = null; } }
        if (sub) {
          photoCounter = subPhotoKey(uid, sub);
          photoHad = Number(await redis(base, token, "GET", photoCounter)) || 0;
          if (photoHad >= SUB_PHOTO_LIMIT) {
            res.setHeader("x-photo-count", String(photoHad));
            return res.status(429).json({ error: "limit", scope: "photos", message: SUB_PHOTO_MSG });
          }
        } else {
          photoHad = Number(await redis(base, token, "GET", photoKey)) || 0;
          if (photoHad >= PHOTO_LIMIT) {
            res.setHeader("x-photo-count", String(photoHad));
            return res.status(429).json({ error: "limit", scope: "photos", message: "סיימת את צילומי הארוחה לתקופת הליווי 💜 מכאן תמיד אפשר לתאר לי בטקסט מה אכלת ואני אעריך עבורך את הערכים." });
          }
        }
      }
      counters = { id, dayKey, minKey, photoKey: photoCounter, dayHad, photoHad, subPhotos: photoCounter !== photoKey };
    } catch (e) {
      // If the limiter itself errors, do not block the user - just log.
      console.warn("rate-limit error:", String(e));
    }
  } else {
    console.warn("AI rate limit OFF - set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN in Vercel to enable.");
  }

  try {
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

    // **עכשיו, ורק עכשיו, זה נספר.** הבינה ענתה, ולכן האישה קיבלה משהו תמורת
    // מה שנגרע לה. קריאה שנכשלה אצל אנתרופיק אינה עולה לה בכלום.
    //
    // **וניסיון חוזר על אותה תמונה נספר פעם אחת בלבד.** האפליקציה שולחת מזהה
    // לכל תמונה, ומשתמשת באותו מזהה כשהיא שולחת שוב אחרי שהקשר נפל.
    // בלי זה, הניסיון החוזר היה גובה ממנה תמונה שנייה על אותה צלחת.
    if (counters && r.ok) {
      try {
        let fresh = true;
        const rid = String(req.headers["x-request-id"] || "").trim().slice(0, 64);
        if (rid) {
          const claimed = await redis(base, token, "SET", `ai:req:${rid}`, "1", "NX", "EX", 900);
          fresh = claimed === "OK";
        }
        if (fresh) {
          const dayNow = await redis(base, token, "INCR", counters.dayKey);
          if (dayNow === 1) await redis(base, token, "EXPIRE", counters.dayKey, 172800); // ~48h
          if (!isAux && dayNow === DAILY_LIMIT) res.setHeader("x-ai-limit", "soft"); // her last one for today
          const minNow = await redis(base, token, "INCR", counters.minKey);
          if (minNow === 1) await redis(base, token, "EXPIRE", counters.minKey, 120);
          if (isPhoto) {
            const photoNow = await redis(base, token, "INCR", counters.photoKey);
            if (photoNow === 1) await redis(base, token, "EXPIRE", counters.photoKey, counters.subPhotos ? 5184000 : 18144000); // ~60 days a month of a sub, ~210 days the programme
            res.setHeader("x-photo-count", String(photoNow));
          }
        } else if (isPhoto) {
          res.setHeader("x-photo-count", String(counters.photoHad));
        }
      } catch (e) { console.warn("counter error:", String(e)); }
    }

    // Best-effort usage logging for the daily morning report (never blocks the response).
    if (base && token && r.ok && data && data.usage) {
      try {
        const day = israelDay();
        const inTok = Number(data.usage.input_tokens) || 0;
        const outTok = Number(data.usage.output_tokens) || 0;
        // Prompt caching: Anthropic reports the cached part of the prompt in its OWN fields
        // and EXCLUDES it from input_tokens, so a report that reads input_tokens alone is
        // blind to it and understates the bill. Reads are billed at about a tenth of the
        // input price and writes at about a quarter above it, so they need separate counters.
        const cReadTok = Number(data.usage.cache_read_input_tokens) || 0;
        const cWriteTok = Number(data.usage.cache_creation_input_tokens) || 0;
        const c = await redis(base, token, "INCR", `usage:${day}:calls`);
        await redis(base, token, "INCRBY", `usage:${day}:in`, inTok);
        await redis(base, token, "INCRBY", `usage:${day}:out`, outTok);
        await redis(base, token, "INCRBY", `usage:${day}:cread`, cReadTok);
        await redis(base, token, "INCRBY", `usage:${day}:cwrite`, cWriteTok);
        if (c === 1) { for (const sfx of ["calls", "in", "out", "cread", "cwrite"]) await redis(base, token, "EXPIRE", `usage:${day}:${sfx}`, 691200); } // ~8 days
        if (isPhoto) { const pc = await redis(base, token, "INCR", `usage:${day}:photos`); if (pc === 1) await redis(base, token, "EXPIRE", `usage:${day}:photos`, 691200); }
      } catch (e) { console.warn("usage-log error:", String(e)); }
    }
    // Cache the result for identical first-turn text queries (only when it produced real items).
    if (base && token && r.ok && cacheable) {
      try {
        const txt = (data.content || []).filter((b) => b && b.type === "text").map((b) => b.text).join("\n");
        const mm = txt.replace(/```json|```/g, "").match(/\{[\s\S]*\}/);
        const obj = mm ? JSON.parse(mm[0]) : null;
        const items = obj && Array.isArray(obj.items) ? obj.items : [];
        if (items.length) await redisPost(base, token, ["SET", cacheKey, JSON.stringify(data), "EX", "2592000"]); // 30 days
      } catch (e) { console.warn("ai-cache write error:", String(e)); }
    }
    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
