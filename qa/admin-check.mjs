// Offline check for the admin screen and, more importantly, for what it does to the gate.
// A clerk's override changes who gets in, so this runs the REAL api/access.js and
// api/admin.js against a fake sheet and a fake Redis. No network, no cost.
//
//   node qa/admin-check.mjs

import adminHandler from "../api/admin.js";
import accessHandler from "../api/access.js";
import { loadSheet } from "../api/_sheet.js";

const KEY = "test-admin-key";
process.env.ADMIN_KEY = KEY;
process.env.ACCESS_SHEET_CSV_URL = "https://sheet.test/csv";
process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";

// The real header row of "נרשמות 360 לבדיקה", including the two spaces after FINAL, the
// English name columns, and the timestamp glued to the start date. That timestamp is what
// made every woman parse as having no start date, so it stays in the fixture on purpose.
const CSV = [
  'ID,F_NAME,L_NAME,CF_EMAIL,360 - FINAL  PERSONAL START,הורידה אפליקציה,ביטלה,שבוע בתוכנית,צמיד,קבוצה,חודשי גישה נוספים',
  '972501111111,יפית,קורן,yafit@test.com,2026-06-14 0:00:00,TRUE,FALSE,10.00,TRUE,ב,3',
  '972502222222,נילי,לביא,nili@test.com,2026-06-14 12:00:00,TRUE,FALSE,10.00,TRUE,ב,',
  '972503333333,רותי,כהן,ruti@test.com,2026-01-04 0:00:00,FALSE,TRUE,10.00,TRUE,א,3',
  '972504444444,מיכל,לוי,michal@test.com,2025-01-05 0:00:00,TRUE,FALSE,10.00,TRUE,א,3',
  '972505555555,שרה,אלמונית,sara@test.com,,TRUE,FALSE,0.00,FALSE,ג,',
].join("\n");

let CSV2 = null;   // lets a test swap the sheet for a few rows of its own
const store = { hash: {}, kv: {} };
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.startsWith("https://sheet.test")) return { ok: true, text: async () => (CSV2 || CSV) };
  const parts = u.replace("https://redis.test/", "").split("/").map(decodeURIComponent);
  const [cmd, a, b, c] = parts;
  const H = (k) => (store.hash[k] = store.hash[k] || {});
  let result = null;
  if (cmd === "HSET") { H(a)[b] = c; result = 1; }
  else if (cmd === "HGET") result = H(a)[b] ?? null;
  else if (cmd === "HDEL") { delete H(a)[b]; result = 1; }
  else if (cmd === "HGETALL") { const o = H(a); result = Object.keys(o).flatMap((k) => [k, o[k]]); }
  else if (cmd === "KEYS") { const pre = String(a).replace(/\*$/, ""); result = Object.keys(store.kv).filter((k) => k.startsWith(pre)); }
  else if (cmd === "SET") { store.kv[a] = b; result = "OK"; }
  else if (cmd === "GET") result = store.kv[a] ?? null;
  else result = 0; // ZADD / ZREM / ZCARD / ZRANGE etc.
  if (cmd === "ZRANGE" || cmd === "ZREVRANGE") result = [];
  return { ok: true, json: async () => ({ result }) };
};

function mkRes() {
  const r = { code: 0, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
const callAdmin = async (query, method = "GET", body = null) => {
  const res = mkRes();
  await adminHandler({ query, method, body }, res);
  return res;
};
const callAccess = async (email) => {
  const res = mkRes();
  await accessHandler({ query: { email, device: "dev-1" }, method: "GET" }, res);
  return res;
};

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
};

console.log("\nקריאת הגיליון");
const { women, headers } = await loadSheet(process.env.ACCESS_SHEET_CSV_URL);
// newapp is optional: the sheet does not carry it yet, and membership falls back to
// whether we have ever seen her open the app.
check("כל עמודות החובה אותרו לפי כותרת",
  ["cancel", "start", "months", "phone", "group", "first", "last", "email"].every((k) => headers[k]),
  JSON.stringify(headers));
check("עמודת האפליקציה אופציונלית ואינה נדרשת", headers.newapp === false);
check("חמש נשים נקראו", women.length === 5, "התקבל " + women.length);
const yafit = women.find((w) => w.email === "yafit@test.com");
check("שם פרטי ומשפחה נקראים מ-F_NAME ו-L_NAME", yafit.first === "יפית" && yafit.last === "קורן");
check("טלפון בפורמט 972", yafit.phone === "972501111111");
check("קבוצה", yafit.group === "ב");
check("תאריך עם שעה נקרא נכון ונצמד ליום ראשון", yafit.start === "2026-06-14", yafit.start);
check("גם תאריך עם שעה שאינה חצות", women.find((w) => w.email === "nili@test.com").start === "2026-06-14");
check("מי שאין לה תאריך התחלה מסומנת ככזאת", women.find((w) => w.email === "sara@test.com").start === "");
check('רק "ביטלה" מסמנת ביטול, לא "הורידה אפליקציה"', yafit.cancelled === false);
check("מי שביטלה מסומנת", women.find((w) => w.email === "ruti@test.com").cancelled === true);
check("סיום גישה מחושב: 70 יום ועוד 3 חודשים", yafit.sheetEnd === "2026-11-23", yafit.sheetEnd);
check("חודשים ריקים נופלים לברירת מחדל 3", women.find((w) => w.email === "nili@test.com").sheetEnd === "2026-11-23");

console.log("\nהרשאה");
check("בלי מפתח נחסם", (await callAdmin({})).code === 401);
check("מפתח שגוי נחסם", (await callAdmin({ key: "wrong" })).code === 401);
check("מפתח נכון עובר", (await callAdmin({ key: KEY })).code === 200);

console.log("\nשער הגישה לפני שינוי");
check("מי שבתוך החלון נכנסת", (await callAccess("yafit@test.com")).body.allowed === true);
check("מי שביטלה נחסמת", (await callAccess("ruti@test.com")).body.reason === "cancelled");
check("מי שהגישה שלה פגה נחסמת", (await callAccess("michal@test.com")).body.reason === "expired");
check("מייל שלא בגיליון נחסם", (await callAccess("nobody@test.com")).body.reason === "not_registered");
check("כניסה נרשמה כ'נכנסה לאחרונה'", !!store.hash["admin:seen"]["yafit@test.com"]);

console.log("\nשינוי של הפקידה");
check("תאריך לא תקין נדחה", (await callAdmin({ key: KEY }, "POST", { email: "michal@test.com", until: "24.11.2026" })).code === 400);
check("בלי מייל נדחה", (await callAdmin({ key: KEY }, "POST", { until: "2027-01-01" })).code === 400);

const far = new Date(Date.now() + 400 * 86400000).toISOString().slice(0, 10);
await callAdmin({ key: KEY }, "POST", { email: "michal@test.com", until: far, by: "הפקידה" });
check("הארכה מחזירה גישה למי שפגה", (await callAccess("michal@test.com")).body.allowed === true);

await callAdmin({ key: KEY }, "POST", { email: "yafit@test.com", until: "2026-01-01", by: "הפקידה" });
check("קיצור חוסם גם כשהגיליון עדיין בתוקף", (await callAccess("yafit@test.com")).body.reason === "expired");

const view = (await callAdmin({ key: KEY })).body;
const y2 = view.women.find((w) => w.email === "yafit@test.com");
check("המסך מציג את השינוי הידני", y2.override && y2.override.until === "2026-01-01");
check("ולצידו את ערך הגיליון המקורי", y2.sheetEnd === "2026-11-23");
check("שם מי ששינתה נשמר", y2.override.by === "הפקידה");

await callAdmin({ key: KEY }, "POST", { email: "yafit@test.com", until: "", by: "הפקידה" });
check("ביטול השינוי מחזיר לגיליון", (await callAccess("yafit@test.com")).body.allowed === true);
const y3 = (await callAdmin({ key: KEY })).body.women.find((w) => w.email === "yafit@test.com");
check("ואז אין יותר סימון ידני", y3.override === null && y3.until === "2026-11-23");

console.log("\nאפליקציה חדשה מול קג'אבי");
{
  const before = (await callAdmin({ key: KEY })).body.women;
  check("מי שנכנסה לאפליקציה מסומנת כחדשה", before.find((w) => w.email === "yafit@test.com").newApp === true);
  check("מי שמעולם לא נכנסה אינה מסומנת", before.find((w) => w.email === "nili@test.com").newApp === false);
  await callAccess("nili@test.com");
  const after = (await callAdmin({ key: KEY })).body.women;
  check("כניסה ראשונה מעבירה אותה לאפליקציה החדשה", after.find((w) => w.email === "nili@test.com").newApp === true);

  // A woman who has a backup but has not opened the app since admin:seen began still
  // belongs to the new app. This is the backfill that stops the list under-reporting.
  store.kv["bk:michal@test.com"] = "cipher";
  const back = (await callAdmin({ key: KEY })).body.women;
  check("גיבוי קיים מספיק כדי לסמן אותה כחדשה", back.find((w) => w.email === "michal@test.com").newApp === true);
}

console.log("\nחסרות קבוצה במחזור טרי");
{
  // Cohorts are keyed off the sheet, so drive this through fresh rows rather than the
  // fixture above: three days ago, twenty days ago, and one that has not started yet.
  const fresh = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  const old = new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const edge = new Date(Date.now() - 8 * 86400000).toISOString().slice(0, 10);
  CSV2 = [
    'ID,F_NAME,L_NAME,CF_EMAIL,360 - FINAL  PERSONAL START,ביטלה,קבוצה,חודשי גישה נוספים',
    `972510000001,טרייה,בלי,a@test.com,${fresh} 12:00:00,FALSE,,3`,
    `972510000002,טרייה,עם,b@test.com,${fresh} 12:00:00,FALSE,ב,3`,
    `972510000003,ישנה,בלי,c@test.com,${old} 12:00:00,FALSE,,3`,
    `972510000004,עתידית,בלי,d@test.com,${soon} 12:00:00,FALSE,,3`,
    `972510000005,מבוטלת,בלי,e@test.com,${fresh} 12:00:00,TRUE,,3`,
    `972510000006,יום,שמונה,f@test.com,${edge} 12:00:00,FALSE,,3`,
  ].join("\n");
  const w = (await callAdmin({ key: KEY })).body.women;
  const by = (em) => w.find((x) => x.email === em) || {};
  check("מחזור טרי בלי קבוצה מסומן", by("a@test.com").needsGroup === true);
  check("מחזור טרי עם קבוצה אינו מסומן", by("b@test.com").needsGroup === false);
  check("מחזור ישן בלי קבוצה אינו מסומן", by("c@test.com").needsGroup === false);
  check("מחזור שטרם התחיל אינו מסומן, כי עוד לא חולקו בו קבוצות", by("d@test.com").needsGroup === false);
  check("מבוטלת אינה מסומנת", by("e@test.com").needsGroup === false);
  check("יום שמיני כבר מחוץ לחלון", by("f@test.com").needsGroup === false);
  CSV2 = null;
}

console.log("\nחוסן");
const hadFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (String(url).startsWith("https://redis.test")) throw new Error("redis down");
  return hadFetch(url);
};
check("תקלת Redis לא נועלת משתתפת רשומה", (await callAccess("nili@test.com")).body.allowed === true);
globalThis.fetch = hadFetch;

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.");
process.exit(fail ? 1 : 0);
