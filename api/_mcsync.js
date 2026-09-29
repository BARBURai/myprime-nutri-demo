// ===== עדכון ישיר ממניצ'ט, שלב ההרצה במקביל. v7.65 =====
//
// **רון, 29 בספטמבר 2026: "לוקח זמן לעדכון של המערכת מהקובץ. אי אפשר לקבל עדכון ישר
// ממניצ'ט?"** זו עדיפות 2 שלו: להחליף את גיליון גוגל בשרת שמניצ'ט מזין ישירות.
//
// **מה שקורה כאן:** פעולת External Request באוטומציה של מניצ'ט שולחת את השורה של אישה,
// באותם שמות עמודות כמו בגיליון, ואנחנו שומרים אותה. **השער ממשיך לקבוע לפי הגיליון
// בלבד**, ורק רושם אם מה שהגיע ממניצ'ט היה נותן תשובה אחרת. **המעבר עצמו הוא החלטה נפרדת
// של רון, אחרי ימים של אפס פערים.**
//
// **המפתחות:**
//   mc:rows      שדה = הטלפון (עמודת ID), ערך = { cells: {עמודה: ערך}, t }
//   mc:byemail   שדה = המייל, ערך = { <טלפון>: {עמודה: ערך} }. קריאה אחת בשער
//   mc:stats     received, last
//   mc:shadow:<תאריך>  same · diff · onlySheet · onlyMc
//   mc:diffs     200 הפערים האחרונים, לבדיקה

export const MC_ROWS = "mc:rows";
export const MC_BYEMAIL = "mc:byemail";
export const MC_STATS = "mc:stats";
export const MC_DIFFS = "mc:diffs";
export const mcShadowKey = (day) => "mc:shadow:" + day;

const norm = (s) => String(s || "").replace(/^["']|["']$/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const EMAIL_IN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_KEYS = ["id", "טלפון", "phone"];
const EMAIL_KEYS = ["cf_email", "מייל", "email", "אימייל"];

function valueOf(cells, keys) {
  for (const k of Object.keys(cells || {})) if (keys.includes(norm(k))) return cells[k];
  return "";
}
export function phoneOf(cells) { return String(valueOf(cells, PHONE_KEYS) || "").replace(/[^\d]/g, ""); }
export function emailOf(cells) {
  const m = String(valueOf(cells, EMAIL_KEYS) || "").match(EMAIL_IN);
  return m ? m[0].toLowerCase() : "";
}

// הגוף שמניצ'ט שולח: אובייקט שטוח של עמודה ← ערך. **רק מה שנשלח מתעדכן**, וכל עמודה
// שלא נשלחה נשארת כמו שהייתה, כדי שרון יוכל לשלוח שורה שלמה או רק את השדה שהשתנה.
export function cleanBody(body) {
  let b = body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { return null; } }
  if (!b || typeof b !== "object" || Array.isArray(b)) return null;
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(b)) {
    const key = String(k).trim();
    if (!key || key.length > 80) continue;
    if (++n > 80) break;
    out[key] = v == null ? "" : String(v).slice(0, 500);
  }
  return out;
}

// ההשוואה בין מה שהגיליון קובע למה שמניצ'ט היה קובע. **אותם שדות שהשער מכריע לפיהם**,
// ולא הטלפון, שהוא המפתח עצמו.
export const COMPARE = ["start", "cancelled", "months", "solo", "glow", "glowFull", "glowPaid", "glowSolo", "glowM"];
export function diffFields(a, b) {
  const out = {};
  for (const f of COMPARE) {
    const x = a[f] == null ? null : a[f], y = b[f] == null ? null : b[f];
    if (String(x) !== String(y)) out[f] = [x, y];
  }
  return out;
}

async function rpost(RU, RT, cmd) {
  const r = await fetch(RU, {
    method: "POST",
    headers: { Authorization: `Bearer ${RT}`, "content-type": "application/json" },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error("redis " + r.status);
  return (await r.json()).result;
}

function parseJson(raw, dflt) { try { return raw ? JSON.parse(raw) || dflt : dflt; } catch (e) { return dflt; } }

// קליטת שורה אחת ממניצ'ט.
export async function ingest(body, RU, RT, now = Date.now()) {
  const inc = cleanBody(body);
  if (!inc) return { status: 400, json: { ok: false, error: "bad_body" } };
  const phone = phoneOf(inc);
  if (!phone) return { status: 400, json: { ok: false, error: "no_phone" } };
  const prev = parseJson(await rpost(RU, RT, ["HGET", MC_ROWS, phone]), null);
  const cells = Object.assign({}, prev && prev.cells, inc);
  const oldEmail = prev ? emailOf(prev.cells) : "";
  const email = emailOf(cells);
  await rpost(RU, RT, ["HSET", MC_ROWS, phone, JSON.stringify({ cells, t: now })]);
  // אם המייל שלה השתנה, השורה עוברת מהכתובת הישנה לחדשה, **כדי שכתובת שכבר אינה שלה לא
  // תמשיך להחזיק את הנתונים שלה.**
  if (oldEmail && oldEmail !== email) {
    const map = parseJson(await rpost(RU, RT, ["HGET", MC_BYEMAIL, oldEmail]), {});
    delete map[phone];
    if (Object.keys(map).length) await rpost(RU, RT, ["HSET", MC_BYEMAIL, oldEmail, JSON.stringify(map)]);
    else await rpost(RU, RT, ["HDEL", MC_BYEMAIL, oldEmail]);
  }
  if (email) {
    const map = parseJson(await rpost(RU, RT, ["HGET", MC_BYEMAIL, email]), {});
    map[phone] = cells;
    await rpost(RU, RT, ["HSET", MC_BYEMAIL, email, JSON.stringify(map)]);
  }
  try {
    await rpost(RU, RT, ["HINCRBY", MC_STATS, "received", 1]);
    await rpost(RU, RT, ["HSET", MC_STATS, "last", String(now)]);
  } catch (e) { /* הספירה היא תצוגה בלבד */ }
  return { status: 200, json: { ok: true, phone, email } };
}

// הסיסמה של הכתובת. **בלי המשתנה בוורסל הכתובת אינה פתוחה בכלל**, בדיוק כמו מסך הניהול.
export function secretOk(req) {
  const want = process.env.MC_SYNC_SECRET || "";
  if (!want) return false;
  const h = req.headers || {};
  const got = String(h["x-mc-secret"] || h["X-MC-Secret"] || (req.query && req.query.secret) || "");
  return got.length === want.length && got === want;
}

// מסך הניהול: כמה הגיעו, ומה ההשוואה אמרה בשבעת הימים האחרונים.
export async function status(RU, RT, days) {
  const out = { rows: 0, received: 0, last: null, days: [], diffs: [] };
  out.rows = Number(await rpost(RU, RT, ["HLEN", MC_ROWS])) || 0;
  const st = await rpost(RU, RT, ["HGETALL", MC_STATS]);
  const flat = {};
  if (Array.isArray(st)) for (let i = 0; i < st.length; i += 2) flat[st[i]] = st[i + 1];
  out.received = Number(flat.received) || 0;
  out.last = flat.last ? Number(flat.last) : null;
  for (const d of days) {
    const r = await rpost(RU, RT, ["HGETALL", mcShadowKey(d)]);
    const m = {};
    if (Array.isArray(r)) for (let i = 0; i < r.length; i += 2) m[r[i]] = Number(r[i + 1]) || 0;
    out.days.push({ day: d, same: m.same || 0, diff: m.diff || 0, onlySheet: m.onlySheet || 0, onlyMc: m.onlyMc || 0 });
  }
  const list = await rpost(RU, RT, ["LRANGE", MC_DIFFS, "0", "49"]);
  out.diffs = (Array.isArray(list) ? list : []).map((x) => parseJson(x, null)).filter(Boolean);
  return out;
}
