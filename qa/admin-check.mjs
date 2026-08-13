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

// Columns deliberately out of order, with the two-space start header and a trailing
// marketing column, because that is what the real sheet looks like.
const CSV = [
  'קבוצה,הורידה אפליקציה,שם פרטי,שם משפחה,ID,מייל,ביטלה,360 - FINAL  PERSONAL START,חודשי גישה נוספים',
  'קבוצה 12,TRUE,יפית,קורן,972501111111,yafit@test.com,FALSE,2026-06-14,3',
  'קבוצה 12,TRUE,נילי,לביא,972502222222,nili@test.com,FALSE,2026-06-14,',
  'קבוצה 7,FALSE,רותי,כהן,972503333333,ruti@test.com,TRUE,2026-01-04,3',
  'קבוצה 7,TRUE,מיכל,לוי,972504444444,michal@test.com,FALSE,2025-01-05,3',
].join("\n");

const store = { hash: {}, kv: {} };
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.startsWith("https://sheet.test")) return { ok: true, text: async () => CSV };
  const parts = u.replace("https://redis.test/", "").split("/").map(decodeURIComponent);
  const [cmd, a, b, c] = parts;
  const H = (k) => (store.hash[k] = store.hash[k] || {});
  let result = null;
  if (cmd === "HSET") { H(a)[b] = c; result = 1; }
  else if (cmd === "HGET") result = H(a)[b] ?? null;
  else if (cmd === "HDEL") { delete H(a)[b]; result = 1; }
  else if (cmd === "HGETALL") { const o = H(a); result = Object.keys(o).flatMap((k) => [k, o[k]]); }
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
check("כל שבע העמודות אותרו לפי כותרת", Object.values(headers).every(Boolean), JSON.stringify(headers));
check("ארבע נשים נקראו", women.length === 4, "התקבל " + women.length);
const yafit = women.find((w) => w.email === "yafit@test.com");
check("שם פרטי ומשפחה", yafit.first === "יפית" && yafit.last === "קורן");
check("טלפון בפורמט 972", yafit.phone === "972501111111");
check("קבוצה", yafit.group === "קבוצה 12");
check("תאריך התחלה נצמד ליום ראשון", yafit.start === "2026-06-14");
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
