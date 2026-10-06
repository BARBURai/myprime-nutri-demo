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

import { findCol, parseDateToSunday } from "./_sheet.js";

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

// **כל השורות בשרת, בעמודים ולא בבקשה אחת. v7.84.** ב-06.10.2026 `mc:rows` עבר את 10MB
// (11,206,739 בתים, 3,495 שורות), ו-Upstash ענה על HGETALL ב-200 עם שגיאה בפנים. `rpost` קרא
// את זה כ"אין שורות", **והייבוא היה דורס את כל 964 השורות שהגיעו ממניצ'ט.** כאן כל תשובה
// שאינה תקינה זורקת, והייבוא נכשל לפני שהוא כותב משהו.
export async function scanHash(RU, RT, key) {
  const out = {};
  let cursor = "0", guard = 0;
  do {
    const r = await fetch(RU, {
      method: "POST",
      headers: { Authorization: `Bearer ${RT}`, "content-type": "application/json" },
      body: JSON.stringify(["HSCAN", key, cursor, "COUNT", "500"]),
    });
    if (!r.ok) throw new Error("redis " + r.status);
    const d = await r.json();
    if (!d || d.error || !Array.isArray(d.result) || !Array.isArray(d.result[1])) throw new Error("redis scan " + ((d && d.error) || "bad"));
    cursor = String(d.result[0]);
    const a = d.result[1];
    for (let i = 0; i < a.length; i += 2) out[a[i]] = a[i + 1];
    if (++guard > 10000) throw new Error("redis scan loop");
  } while (cursor !== "0");
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

// ===== "Add Full Contact Data" של מניצ'ט. v7.66 =====
//
// **רון: "תן לי את הכל מסודר, אני לא רוצה לרשום שום דבר, אני רוצה להעתיק ולהדביק."**
// לכן אותה בקשה בדיוק יושבת בכל אוטומציה, עם כל נתוני איש הקשר, ואנחנו מפרקים אותם כאן:
// כל שדה מותאם לפי השם שלו, וכל תגית כעמודה עם TRUE.
//
// **הצורה המדויקת שמניצ'ט שולח לא נבדקה מול בקשה אמיתית.** לכן היא נקראת בסבלנות
// (שדות כאובייקט או כרשימה, תגיות כמחרוזות או כאובייקטים, בשורש או בתוך full_contact),
// **וחמש הבקשות האחרונות נשמרות כמו שהן ב-mc:samples**, כדי ללמוד ממנה ולא לנחש.
//
// **ו-`id` של מניצ'ט אינו הטלפון.** זה מספר המנוי אצלם, ולכן במצב הזה הטלפון נלקח רק
// מ-WA_PHONE או מ-whatsapp_phone, ולעולם לא מ-id.
export const MC_SAMPLES = "mc:samples";
const CONTACT_WRAP = ["full_contact", "full_contact_data", "contact", "subscriber", "data"];
function unwrap(b) {
  if (b && typeof b === "object" && !Array.isArray(b)) {
    for (const k of CONTACT_WRAP) {
      let v = b[k];
      if (typeof v === "string") { try { v = JSON.parse(v); } catch (e) { v = null; } }
      if (v && typeof v === "object" && !Array.isArray(v) && (v.custom_fields || v.whatsapp_phone || v.tags)) return Object.assign({}, b, v);
    }
  }
  return b;
}
export function isFullContact(b) {
  return !!(b && typeof b === "object" && !Array.isArray(b) && (b.custom_fields !== undefined || (b.whatsapp_phone !== undefined && b.tags !== undefined)));
}
// **השמות במניצ'ט אינם תמיד שמות העמודות בגיליון.** נלקח מצילום מסך של רון, 29.09.2026,
// מתוך פעולת הגיליון באחת האוטומציות שלו. ההשוואה מתעלמת מסדר המילים ומאמוג'י, כי
// שם של תגית עם 360 ו-❌ מוצג בסדר אחר בכל מסך.
const MC_ALIASES = {
  "360 אישרה מועד התחלת": "אישור תאריך התחלה",
  "360 התקינה": "הורידה אפליקציה",
  "360 ביטלה ❌❌❌": "ביטלה",
  "360-WEEK": "שבוע בתוכנית",
  "צמיד - קארדקום 🎁": "צמיד",
  "מועד הרשמה לתוכנית 2": "מועד הרשמה לתוכנית",
  "WhatsApp ID": "ID",
  // **מצילום של פעולת הגיליון, 30.09.2026.** התגית נקראת אחרת מהעמודה שהיא ממלאת.
  "GLOW- DEMO 💄": "בונוס איפור",
  // **ומה שהתגיות האמיתיות הראו, 30.09.2026:** "אפליקציה" ולא "אפליקציית".
  "אפליקציה תזונה": "אפליקציית תזונה",
};
export const aliasKey = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(Boolean).sort().join(" ");
const ALIAS = Object.fromEntries(Object.entries(MC_ALIASES).map(([k, v]) => [aliasKey(k), v]));
const sheetName = (name) => ALIAS[aliasKey(name)] || String(name).trim();
// עמודות של כן או לא. **כשרשימת התגיות ידועה**, עמודה כזאת שאין לה תגית ואין לה שדה
// פירושה שהתגית אינה עליה.
const FLAG_COLS = ["ביטלה", "הורידה אפליקציה", "אישור תאריך התחלה", "צמיד", "בונוס איפור", "אפליקציית תזונה",
  "SOLO6", "SOLO12", "SOLO10WEEK", "SMART", "GLOW-FULL", "GLOW-PAID", "GLOW-SOLO"];
// **תגית ששמה הוא שם העמודה עם קישוט**, למשל "GLOW-FULL💄💄💄", נכנסת לעמודה עצמה. v7.79.
// נמצא בהשוואה של 04.10.2026: 46 פערים של GLOW-FULL, כולם מהתגית הזאת. **לתגיות בלבד**,
// ו-"GLOW-FULL-M" נשארת נפרדת כי יש בה אות נוספת.
const FLAG_ALIAS = Object.fromEntries(FLAG_COLS.map((c) => [aliasKey(c), c]));
const tagCol = (name) => ALIAS[aliasKey(name)] || FLAG_ALIAS[aliasKey(name)] || String(name).trim();
// תגית שנשמרה בשם של עמודת כן או לא עם קישוט עוברת לעמודה עצמה. TRUE גובר, ושום עמודה אחרת
// אינה נוגעת. מחזיר null כשאין מה לסדר, כדי שהייבוא לא יכתוב שורה שלא השתנתה. v7.84.
export function normalizeFlagKeys(cells) {
  let out = null;
  for (const k of Object.keys(cells)) {
    const col = FLAG_ALIAS[aliasKey(k)];
    if (!col || col === k) continue;
    out = out || { ...cells };
    if (isTrueCell(out[k]) || !(col in out)) out[col] = isTrueCell(out[k]) ? "TRUE" : (out[col] || "");
    delete out[k];
  }
  return out;
}
const flatVal = (v) => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)).slice(0, 500);
export function fromFullContact(b) {
  const cells = {};
  const cf = b.custom_fields;
  if (Array.isArray(cf)) { for (const f of cf) if (f && f.name) cells[sheetName(f.name)] = flatVal(f.value); }
  else if (cf && typeof cf === "object") { for (const [k, v] of Object.entries(cf)) cells[sheetName(k)] = flatVal(v); }
  // **"Add Full Contact Data" אינו כולל תגיות בכלל.** נמדד על שתי בקשות אמיתיות,
  // 30.09.2026. לכן בלי רשימה לא נוגעים בעמודות של כן או לא, ומה שהיה שם נשאר,
  // ולעולם לא נקרא "לא הגיעה תגית" כ"התגית הוסרה".
  if (!Array.isArray(b.tags)) return finishCells(cells, b, null);
  const tags = [];
  for (const t of b.tags) {
    const name = String(t && typeof t === "object" ? t.name || "" : t || "").trim();
    if (name && name.length <= 80) { const col = tagCol(name); tags.push(col); cells[col] = "TRUE"; }
  }
  for (const c of FLAG_COLS) if (cells[c] === undefined) cells[c] = "";
  return finishCells(cells, b, tags);
}
function finishCells(cells, b, tags) {
  if (!cells.F_NAME && b.first_name) cells.F_NAME = flatVal(b.first_name);
  if (!cells.L_NAME && b.last_name) cells.L_NAME = flatVal(b.last_name);
  // הטלפון: WA_PHONE, שהוא בדיוק עמודת ID בגיליון, ואחריו הטלפון של הוואטסאפ.
  const wa = Object.keys(cells).find((k) => norm(k) === "wa_phone");
  const phone = String((wa && cells[wa]) || cells.ID || b.whatsapp_phone || b.phone || "").replace(/[^\d]/g, "");
  delete cells.ID; delete cells.id;
  if (phone) cells.ID = phone;
  if (!emailOf(cells) && b.email) cells.CF_EMAIL = flatVal(b.email);
  return { cells, tags };
}

// ===== התגיות, ישירות ממניצ'ט. v7.72 =====
//
// הבקשה של מניצ'ט אומרת **מתי** משהו השתנה אצלה, ולא מביאה את התגיות. לכן שואלים את
// מניצ'ט עצמו, **בקריאה בלבד**, לפי מספר המנוי שהגיע בבקשה. **כל תקלה מחזירה null**,
// ואז העמודות של כן או לא נשארות כמו שהיו.
//
// **4 שניות:** נמדד 30.09.2026 חמש פעמים, 0.98 בפעם הראשונה ואז 0.21 עד 0.23.
// `MC_TAGS_TIMEOUT_MS` קיים לבדיקות בלבד.
const MC_API = "https://api.manychat.com";
export async function fetchTags(id) {
  const token = process.env.MANYCHAT_TOKEN;
  const sid = String(id || "").replace(/[^\d]/g, "");
  if (!token || !sid) return null;
  const ms = Number(process.env.MC_TAGS_TIMEOUT_MS) || 4000;
  let timer;
  try {
    const call = fetch(`${MC_API}/fb/subscriber/getInfo?subscriber_id=${sid}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    }).then(async (r) => {
      if (!r.ok) return null;
      const j = await r.json();
      if (!j || j.status !== "success" || !j.data || !Array.isArray(j.data.tags)) return null;
      return j.data.tags.map((t) => String(t && typeof t === "object" ? t.name || "" : t || ""));
    });
    const stop = new Promise((res) => { timer = setTimeout(() => res(null), ms); });
    return await Promise.race([call, stop]);
  } catch (e) { return null; }
  finally { clearTimeout(timer); }
}

// קליטת שורה אחת ממניצ'ט.
export async function ingest(body, RU, RT, now = Date.now()) {
  let raw = body;
  if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch (e) { return { status: 400, json: { ok: false, error: "bad_body" } }; } }
  raw = unwrap(raw);
  const full = isFullContact(raw);
  try {
    await rpost(RU, RT, ["LPUSH", MC_SAMPLES, JSON.stringify({ t: now, full, body: raw }).slice(0, 20000)]);
    await rpost(RU, RT, ["LTRIM", MC_SAMPLES, "0", "4"]);
  } catch (e) { /* הדוגמאות הן ללמידה בלבד */ }
  let inc, tags = null;
  if (full && !Array.isArray(raw.tags) && raw.id) {
    const got = await fetchTags(raw.id);
    if (got) raw = Object.assign({}, raw, { tags: got });
  }
  if (full) ({ cells: inc, tags } = fromFullContact(raw));
  else inc = cleanBody(raw);
  if (!inc) return { status: 400, json: { ok: false, error: "bad_body" } };
  const phone = phoneOf(inc);
  if (!phone) return { status: 400, json: { ok: false, error: "no_phone" } };
  const prev = parseJson(await rpost(RU, RT, ["HGET", MC_ROWS, phone]), null);
  const cells = Object.assign({}, prev && prev.cells, inc);
  // בנתונים המלאים כל התגיות מגיעות, ולכן תגית שהייתה ואינה עכשיו הוסרה במניצ'ט.
  if (tags && prev && Array.isArray(prev.tags)) for (const t of prev.tags) if (!tags.includes(t)) cells[t] = "";
  const oldEmail = prev ? emailOf(prev.cells) : "";
  const email = emailOf(cells);
  const rec = { cells, t: now, src: "mc" };
  if (tags) rec.tags = tags;
  else if (prev && Array.isArray(prev.tags)) rec.tags = prev.tags;
  await rpost(RU, RT, ["HSET", MC_ROWS, phone, JSON.stringify(rec)]);
  if (!prev || prev.src !== "mc") { try { await rpost(RU, RT, ["HINCRBY", MC_STATS, "fromMc", 1]); } catch (e) {} }
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
  out.fromMc = Number(flat.fromMc) || 0;
  out.imported = Number(flat.imported) || 0;
  out.importedAt = flat.importedAt ? Number(flat.importedAt) : null;
  for (const d of days) {
    const r = await rpost(RU, RT, ["HGETALL", mcShadowKey(d)]);
    const m = {};
    if (Array.isArray(r)) for (let i = 0; i < r.length; i += 2) m[r[i]] = Number(r[i + 1]) || 0;
    out.days.push({ day: d, same: m.same || 0, diff: m.diff || 0, onlySheet: m.onlySheet || 0, onlyMc: m.onlyMc || 0 });
  }
  const list = await rpost(RU, RT, ["LRANGE", MC_DIFFS, "0", "49"]);
  out.diffs = (Array.isArray(list) ? list : []).map((x) => parseJson(x, null)).filter(Boolean);
  try {
    const sm = await rpost(RU, RT, ["LRANGE", MC_SAMPLES, "0", "4"]);
    out.samples = (Array.isArray(sm) ? sm : []).map((x) => parseJson(x, null)).filter(Boolean);
  } catch (e) { out.samples = []; }
  return out;
}

// ===== ייבוא הגיליון לשרת, פעם אחת. v7.66 =====
//
// **רון: "ומה עם כל הקובץ הקיים, ניתן יהיה להעביר לסרבר?"** מניצ'ט שולח רק כשמשהו
// משתנה, ולכן בלי זה אישה שלא השתנה אצלה דבר הייתה נספרת לנצח כחסרה במניצ'ט.
//
// **שורה שכבר הגיעה ממניצ'ט לעולם אינה נדרסת**, כי היא חדשה מהגיליון. שורה שיובאה קודם
// מתעדכנת מהגיליון של היום. **שום דבר מחוץ ל-mc: אינו נכתב**, והשער ממשיך לקבוע לפי
// הגיליון. mc:byemail נבנה מחדש בצד ומוחלף בפקודה אחת (RENAME), כדי שהשער לעולם לא
// יראה אותו חצי בנוי.
export function rowsFromSheet(text, parseCsvLine) {
  const lines = String(text || "").split(/\r?\n/);
  const header = parseCsvLine(lines[0] || "").map((h) => String(h).trim());
  const col = (names) => { const i = findCol(header, names); return i === -1 ? "" : header[i]; };
  const startCol = col(["360 - FINAL PERSONAL START", "FINAL PERSONAL START", "PERSONAL START"]);
  const ANY_COLS = [col(["ביטלה"]), col(["GLOW-PAID"]), col(["GLOW-SOLO"])];
  const out = {};
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = parseCsvLine(lines[i]);
    const cells = {};
    header.forEach((h, j) => { if (h) cells[h] = vals[j] == null ? "" : String(vals[j]); });
    const phone = phoneOf(cells);
    if (!phone) continue;
    const prev = out[phone];
    if (!prev) { out[phone] = cells; continue; }
    // **אותו טלפון פעמיים: אותו כלל של השער** (`summarize` ב-`api/access.js`). v7.80.
    // עד כאן נשמרה השורה התחתונה בקובץ, ובהשוואה של 04.10.2026 שש נשים נראו בשרת
    // עם השורה הישנה. **המנצחת היא תאריך ההתחלה המאוחר, ובתיקו הראשונה**, וביטול,
    // GLOW-PAID ו-GLOW-SOLO נספרים מכל השורות, כמו בשער.
    const win = laterStart(sunOf(cells, startCol), sunOf(prev, startCol)) ? Object.assign({}, cells) : prev;
    const lose = win === prev ? cells : prev;
    for (const c of ANY_COLS) if (c && isTrueCell(lose[c]) && !isTrueCell(win[c])) win[c] = lose[c];
    out[phone] = win;
  }
  return out;
}
const isTrueCell = (v) => /^\s*true\s*$/i.test(String(v || ""));
// התאריך נשלף כמו בשער: מתוך התא, ואם הוא ריק, מתוך שאר השורה.
const DATE_IN = /\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{4}/;
function sunOf(cells, startCol) {
  let raw = startCol && cells[startCol] ? (String(cells[startCol]).match(DATE_IN) || [])[0] : null;
  if (!raw) raw = (Object.values(cells).join(",").match(DATE_IN) || [])[0];
  return raw ? parseDateToSunday(raw) : null;
}
// המאוחרת מנצחת רק כשהיא מאוחרת ממש, ושורה בלי תאריך לעולם אינה מנצחת. בדיוק `summarize`.
function laterStart(sa, sb) {
  if (!sa) return false;
  return !sb || sa.getTime() > sb.getTime();
}
export async function importSheet(text, parseCsvLine, RU, RT, now = Date.now()) {
  const sheetRows = rowsFromSheet(text, parseCsvLine);
  const cur = await scanHash(RU, RT, MC_ROWS);
  const rows = {};
  for (const [phone, raw] of Object.entries(cur)) rows[phone] = parseJson(raw, null);
  let imported = 0, keptMc = 0;
  const writes = [];
  // **שורה ממניצ'ט שנשמרה לפני v7.79 נושאת תגית בשם הישן**, למשל "GLOW-FULL💄💄💄" במקום
  // GLOW-FULL, ואינה מתעדכנת עד שמניצ'ט שולח עליה שוב. v7.84: הייבוא מסדר אותה, בלי לדרוס
  // דבר ממה שהגיע ממניצ'ט. נמצא ב-06.10.2026: 17 שורות, וארבע מהן היו מאבדות את הקורס.
  let renamed = 0;
  for (const [phone, rec] of Object.entries(rows)) {
    if (!rec || rec.src !== "mc" || !rec.cells) continue;
    const fixed = normalizeFlagKeys(rec.cells);
    if (!fixed) continue;
    rows[phone] = { ...rec, cells: fixed };
    writes.push(phone, JSON.stringify(rows[phone]));
    renamed++;
  }
  for (const [phone, cells] of Object.entries(sheetRows)) {
    const prev = rows[phone];
    if (prev && prev.src === "mc") { keptMc++; continue; }
    rows[phone] = { cells, t: now, src: "import" };
    writes.push(phone, JSON.stringify(rows[phone]));
    imported++;
  }
  for (let i = 0; i < writes.length; i += 400) await rpost(RU, RT, ["HSET", MC_ROWS, ...writes.slice(i, i + 400)]);
  const byEmail = {};
  for (const [phone, rec] of Object.entries(rows)) {
    if (!rec || !rec.cells) continue;
    const e = emailOf(rec.cells);
    if (e) (byEmail[e] = byEmail[e] || {})[phone] = rec.cells;
  }
  const tmp = MC_BYEMAIL + ":build";
  await rpost(RU, RT, ["DEL", tmp]);
  const flat = Object.entries(byEmail).flatMap(([e, m]) => [e, JSON.stringify(m)]);
  for (let i = 0; i < flat.length; i += 400) await rpost(RU, RT, ["HSET", tmp, ...flat.slice(i, i + 400)]);
  if (flat.length) await rpost(RU, RT, ["RENAME", tmp, MC_BYEMAIL]);
  try {
    await rpost(RU, RT, ["HSET", MC_STATS, "imported", String(imported), "importedAt", String(now)]);
  } catch (e) {}
  return { imported, keptMc, renamed, total: Object.keys(sheetRows).length };
}
