// דף המתנה בכנס: תיעוד אישור הצהרת הבריאות והפעלת האימון. v8.52.
//
// **רון, 15.11.2026:** "למה אני לא יכול לתעד את אותה בחורה שמצהירה על הצהרת הבריאות?"
// הדף (myprime.co.il/matana) הוא קובץ סטטי בלי שרת, ולכן הוא שולח לכאן. הקישור שמניצ'ט
// שולח נושא את המזהה של איש הקשר, `?u=<contact id>`, וזה כל מה שנשמר. בלי שם ובלי טלפון.
//
//   gift:hd     field = contact id, value = JSON({ at, ver })   האישור הראשון, לעולם לא נדרס
//   gift:play   field = contact id, value = JSON({ at })         הפעלת האימון הראשונה
//   gift:mcq    SET של מזהים שהתגית במניצ'ט עוד לא נכתבה להם
//   gift:mctry  field = contact id, value = מספר הניסיונות
//
// **התיעוד הוא ה-HSETNX ב-Upstash.** מניצ'ט בא אחריו: תגית ושדה תאריך. אם מניצ'ט דוחה או לא
// עונה, המזהה נכנס לתור, והסריקה של כל 5 דקות (paywatch) מנסה שוב. **אישור לא הולך לאיבוד.**
//
// הכתובת פתוחה בלי מפתח, כי הדף ציבורי. לכן: מזהה ספרות בלבד, אירוע מתוך רשימה, תקרה של
// 30 פניות לדקה לכל כתובת רשת, ורק מ-myprime.co.il כשהדפדפן שולח Origin.

export const GIFT_TAG = "אישרה הצהרת בריאות - מתנה";
export const GIFT_DATE_FIELD = "תאריך אישור הצהרת בריאות";
export const GIFT_ORIGINS = ["https://myprime.co.il", "https://www.myprime.co.il"];
const EVENTS = { hd: "gift:hd", play: "gift:play" };
const RATE = 30;
const MAX_TRIES = 30;

export function parseBody(body) {
  let b = body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  if (!b || typeof b !== "object") b = {};
  const u = String(b.u == null ? "" : b.u).trim();
  const ev = String(b.ev || "");
  const ver = String(b.ver || "").replace(/[^\w.-]/g, "").slice(0, 20);
  return { u, ev, ver };
}

export function originOk(origin) {
  if (!origin) return true;               // sendBeacon מדפדפן ישן, או קריאה מהשרת. נבדק בשאר
  return GIFT_ORIGINS.includes(String(origin).replace(/\/$/, ""));
}

// deps: { redis(cmd) -> result, tag(u, atIso) -> bool, writeMc: bool, now: Date }
export async function giftEvent(body, ip, origin, deps) {
  if (!originOk(origin)) return { status: 403, json: { ok: false, error: "origin" } };
  const { u, ev, ver } = parseBody(body);
  if (!/^\d{3,20}$/.test(u)) return { status: 400, json: { ok: false, error: "bad_id" } };
  if (!EVENTS[ev]) return { status: 400, json: { ok: false, error: "bad_event" } };
  const now = deps.now || new Date();
  const minute = Math.floor(now.getTime() / 60000);
  const rk = `gift:rl:${String(ip || "x").slice(0, 60)}:${minute}`;
  const n = await deps.redis(["INCR", rk]);
  if (n === 1) { try { await deps.redis(["EXPIRE", rk, 120]); } catch (e) {} }
  if (n > RATE) return { status: 429, json: { ok: false, error: "rate" } };
  const at = now.toISOString();
  const rec = ev === "hd" ? { at, ver: ver || "1" } : { at };
  const first = (await deps.redis(["HSETNX", EVENTS[ev], u, JSON.stringify(rec)])) === 1;
  let mc = "skip";
  if (first && ev === "hd" && deps.writeMc) {
    let okTag = false;
    try { okTag = await deps.tag(u, at); } catch (e) { okTag = false; }
    if (okTag) mc = "ok";
    else { mc = "queued"; try { await deps.redis(["SADD", "gift:mcq", u]); } catch (e) {} }
  }
  return { status: 200, json: { ok: true, first, mc } };
}

// מוורסל, בתוך הסריקה של כל 5 דקות. deps: { redis, tag }
export async function giftRetry(deps) {
  const ids = (await deps.redis(["SMEMBERS", "gift:mcq"])) || [];
  let done = 0, failed = 0, dropped = 0;
  for (const u of ids.slice(0, 40)) {
    let at = "";
    try { at = (JSON.parse((await deps.redis(["HGET", "gift:hd", u])) || "{}")).at || ""; } catch (e) {}
    let ok = false;
    try { ok = await deps.tag(u, at || new Date().toISOString()); } catch (e) { ok = false; }
    if (ok) { await deps.redis(["SREM", "gift:mcq", u]); await deps.redis(["HDEL", "gift:mctry", u]); done++; continue; }
    const t = await deps.redis(["HINCRBY", "gift:mctry", u, 1]);
    // מזהה שמניצ'ט דוחה 30 פעמים, כשעתיים וחצי, הוא כנראה לא קיים. התיעוד נשאר ב-gift:hd.
    if (t >= MAX_TRIES) { await deps.redis(["SREM", "gift:mcq", u]); dropped++; } else failed++;
  }
  return { pending: ids.length, done, failed, dropped };
}
