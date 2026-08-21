// Offline check for the admin screen and, more importantly, for what it does to the gate.
// A clerk's override changes who gets in, so this runs the REAL api/access.js and
// api/admin.js against a fake sheet and a fake Redis. No network, no cost.
//
//   node qa/admin-check.mjs

import adminHandler from "../api/admin.js";
import usageHandler from "../api/usage.js";
import accessHandler from "../api/access.js";
import { loadSheet } from "../api/_sheet.js";
import { readFileSync } from "node:fs";

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
// A stand-in ManyChat. `MC.accept` is the one value shape it is willing to store, so a test
// can make it refuse everything and prove the screen says so instead of reporting success.
const MC = { on: false, accept: null, stored: "", writes: [], calls: 0 };
const store = { hash: {}, kv: {}, list: {} };
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith("https://sheet.test")) return { ok: true, text: async () => (CSV2 || CSV) };
  if (u.startsWith("https://api.manychat.com")) {
    MC.calls++;
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    if (u.includes("findByCustomField")) {
      return { ok: true, json: async () => ({ status: "success", data: { id: 77, custom_fields: [
        { id: 11675348, name: "360 - FINAL  PERSONAL START", value: MC.stored || null },
        { id: 11510555, name: "CF_EMAIL", value: MC.email || null },
      ], tags: [] } }) };
    }
    if (u.includes("TagByName")) {
      MC.tags = MC.tags || [];
      MC.tags.push((u.includes("addTag") ? "+" : "-") + (body && body.tag_name));
      return { ok: true, json: async () => ({ status: "success" }) };
    }
    if (u.includes("setCustomField") && body && body.field_id === 11510555) {
      if (MC.refuseEmail) return { ok: true, json: async () => ({ status: "error", message: "no" }) };
      MC.email = body.field_value;
      return { ok: true, json: async () => ({ status: "success" }) };
    }
    if (u.includes("setCustomField")) {
      MC.writes.push(body && body.field_value);
      if (MC.accept === null || body.field_value === MC.accept) { MC.stored = body.field_value; return { ok: true, json: async () => ({ status: "success" }) }; }
      return { ok: true, json: async () => ({ status: "error", message: "wrong format" }) };
    }
    return { ok: true, json: async () => ({ status: "success" }) };
  }
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
  else if (cmd === "DEL") { const had = store.kv[a] !== undefined; delete store.kv[a]; result = had ? 1 : 0; }
  else if (cmd === "HINCRBY") { const h = H(a); h[b] = String((parseInt(h[b], 10) || 0) + parseInt(c, 10)); result = Number(h[b]); }
  else if (cmd === "LPUSH") { store.list[a] = store.list[a] || []; store.list[a].unshift(c ?? b); result = store.list[a].length; }
  else if (cmd === "LTRIM") { const L = store.list[a] || []; store.list[a] = L.slice(Number(b), Number(c) + 1); result = "OK"; }
  else if (cmd === "LRANGE") { const L = store.list[a] || []; result = L.slice(Number(b), Number(c) + 1); }
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
const callUsage = async (body) => {
  const res = mkRes();
  await usageHandler({ method: "POST", body }, res);
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

// The column Ron actually created is spelled "אפליקציית תזונה", and the sheet already
// carries a "הורידה אפליקציה" column full of TRUE. Anything matched loosely would land on
// that one and read as TRUE for almost everybody, so both halves are locked here.
{
  const H = 'ID,F_NAME,L_NAME,CF_EMAIL,360 - FINAL  PERSONAL START,הורידה אפליקציה,ביטלה,קבוצה,אפליקציית תזונה';
  CSV2 = [H,
    '972501111111,יפית,קורן,yafit@test.com,2026-06-14 0:00:00,TRUE,FALSE,ב,TRUE',
    '972502222222,נילי,לביא,nili@test.com,2026-06-14 0:00:00,TRUE,FALSE,ב,',
  ].join("\n");
  const r = await loadSheet(process.env.ACCESS_SHEET_CSV_URL);
  check('עמודת "אפליקציית תזונה" מאותרת', r.headers.newapp === true);
  check("TRUE בעמודה מסמן אותה כאפליקציה החדשה", r.women.find((w) => w.email === "yafit@test.com").sheetNewApp === true);
  check('"הורידה אפליקציה" אינה נקראת כעמודת האפליקציה', r.women.find((w) => w.email === "nili@test.com").sheetNewApp === false);
  CSV2 = null;
}
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

console.log("\nהשער קורא את עמודת המייל");
{
  // The gate used to take the first address anywhere in the row, so any other address
  // sitting in her row would win and she would be refused entry with her own. Both halves
  // are locked: the right column wins, and the row scan still saves a sheet without one.
  const H = 'ID,F_NAME,L_NAME,CF_EMAIL,360 - FINAL  PERSONAL START,ביטלה';
  const start = "2026-06-14 12:00:00";
  CSV2 = [H,
    `9721,שרה,other@old.com,real@new.com,${start},FALSE`,
    `9722,רונית,.,solo@test.com,${start},FALSE`,
  ].join("\n");
  check("נכנסת עם הכתובת שבעמודת המייל", (await callAccess("real@new.com")).body.allowed === true);
  check("וכתובת אחרת שיושבת בשורה אינה מזהה אותה", (await callAccess("other@old.com")).body.reason === "not_registered");
  check("שורה רגילה ממשיכה לעבוד", (await callAccess("solo@test.com")).body.allowed === true);
  CSV2 = null;
}

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
check("נרשמה שורת יומן לשינוי", y2.log.length === 1 && y2.log[0].by === "הפקידה");
check("היומן מתעד מאיזה תאריך לאיזה", y2.log[0].from === "2026-11-23" && y2.log[0].to === "2026-01-01",
  JSON.stringify(y2.log[0]));

await callAdmin({ key: KEY }, "POST", { email: "yafit@test.com", until: "", by: "הפקידה" });
check("ביטול השינוי מחזיר לגיליון", (await callAccess("yafit@test.com")).body.allowed === true);
const y3 = (await callAdmin({ key: KEY })).body.women.find((w) => w.email === "yafit@test.com");
check("ואז אין יותר סימון ידני", y3.override === null && y3.until === "2026-11-23");
check("אבל היומן נשמר, כולל פעולת הביטול", y3.log.length === 2 && y3.log[0].to === "" && y3.log[0].from === "2026-01-01",
  JSON.stringify(y3.log));

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

console.log("\nשיוך קבוצה ידני");
{
  // The cohort Sunday must be worked out in ISRAEL time, exactly as api/admin.js does it.
  // Computed in UTC, this file passed all day and failed only between 21:00 UTC and midnight,
  // when Israel is already on the next date. That is the trap in section 20 of CLAUDE.md.
  const sun = (n) => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const d = new Date(today + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - d.getUTCDay() + n * 7);
    return d.toISOString().slice(0, 10);
  };
  CSV2 = [
    'ID,F_NAME,L_NAME,CF_EMAIL,360 - FINAL  PERSONAL START,ביטלה,קבוצה,חודשי גישה נוספים',
    `972520000001,בלי,קבוצה,g1@test.com,${sun(0)} 12:00:00,FALSE,,3`,
    `972520000002,עם,קבוצה,g2@test.com,${sun(0)} 12:00:00,FALSE,א,3`,
  ].join("\n");
  const at = async (em) => (await callAdmin({ key: KEY })).body.women.find((w) => w.email === em);

  check("אות שאינה עברית נדחית", (await callAdmin({ key: KEY }, "POST", { email: "g1@test.com", group: "X" })).code === 400);
  check("בקשה בלי שום שדה נדחית", (await callAdmin({ key: KEY }, "POST", { email: "g1@test.com" })).code === 400);
  check("לפני השיוך היא נספרת כחסרת קבוצה", (await at("g1@test.com")).needsGroup === true);

  await callAdmin({ key: KEY }, "POST", { email: "g1@test.com", group: "ג", by: "רון" });
  const g1 = await at("g1@test.com");
  check("הקבוצה נשמרה", g1.group === "ג");
  check("ולא נספרת יותר כחסרת קבוצה", g1.needsGroup === false);
  check("הגיליון עדיין מציג ריק לצידה", g1.sheetGroup === "");
  check("היומן מתעד שינוי קבוצה", g1.log[0].field === "group" && g1.log[0].to === "ג" && g1.log[0].by === "רון");

  await callAdmin({ key: KEY }, "POST", { email: "g2@test.com", group: "ד", by: "רון" });
  const g2 = await at("g2@test.com");
  check("שינוי קבוצה קיימת גובר על הגיליון", g2.group === "ד" && g2.sheetGroup === "א");
  check("והיומן מתעד מאיזו אות לאיזו", g2.log[0].from === "א" && g2.log[0].to === "ד");

  await callAdmin({ key: KEY }, "POST", { email: "g2@test.com", group: "" });
  const g3 = await at("g2@test.com");
  check("חזרה לגיליון מחזירה את האות המקורית", g3.group === "א" && g3.groupOverride === null);

  await callAdmin({ key: KEY }, "POST", { email: "g1@test.com", until: "2027-05-01", by: "רון" });
  const g4 = await at("g1@test.com");
  check("שינוי תאריך אינו מוחק את שיוך הקבוצה", g4.group === "ג" && g4.until === "2027-05-01");
  check("ושתי הפעולות יושבות ביומן", g4.log.length === 2 && g4.log[0].field === "until" && g4.log[1].field === "group");
  CSV2 = null;
}

console.log("\nחסרות קבוצה: השבוע והשבוע הבא בלבד");
{
  // Cohorts always start on a Sunday, so build the fixture off real Sundays rather than
  // "N days ago": the rule is about which cohort, not about how old a date is.
  // The cohort Sunday must be worked out in ISRAEL time, exactly as api/admin.js does it.
  // Computed in UTC, this file passed all day and failed only between 21:00 UTC and midnight,
  // when Israel is already on the next date. That is the trap in section 20 of CLAUDE.md.
  const sun = (n) => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const d = new Date(today + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - d.getUTCDay() + n * 7);
    return d.toISOString().slice(0, 10);
  };
  CSV2 = [
    'ID,F_NAME,L_NAME,CF_EMAIL,360 - FINAL  PERSONAL START,ביטלה,קבוצה,חודשי גישה נוספים',
    `972510000001,השבוע,בלי,a@test.com,${sun(0)} 12:00:00,FALSE,,3`,
    `972510000002,השבוע,עם,b@test.com,${sun(0)} 12:00:00,FALSE,ב,3`,
    `972510000003,הבא,בלי,c@test.com,${sun(1)} 12:00:00,FALSE,,3`,
    `972510000004,שעבר,בלי,d@test.com,${sun(-1)} 12:00:00,FALSE,,3`,
    `972510000005,בעוד_שבועיים,בלי,e@test.com,${sun(2)} 12:00:00,FALSE,,3`,
    `972510000006,מבוטלת,בלי,f@test.com,${sun(0)} 12:00:00,TRUE,,3`,
  ].join("\n");
  const w = (await callAdmin({ key: KEY })).body.women;
  const by = (em) => w.find((x) => x.email === em) || {};
  check("מחזור השבוע בלי קבוצה מסומן", by("a@test.com").needsGroup === true);
  check("מחזור השבוע עם קבוצה אינו מסומן", by("b@test.com").needsGroup === false);
  check("המחזור הבא בלי קבוצה מסומן", by("c@test.com").needsGroup === true);
  check("מחזור שעבר אינו מסומן", by("d@test.com").needsGroup === false);
  check("מחזור בעוד שבועיים אינו מסומן", by("e@test.com").needsGroup === false);
  check("מבוטלת אינה מסומנת", by("f@test.com").needsGroup === false);
  CSV2 = null;
}

console.log("\nנתוני שימוש");
{
  check("בלי מייל נדחה", (await callUsage({ days: {} })).code === 400);
  check("שיטה שאינה POST נדחית", await (async () => { const r = mkRes(); await usageHandler({ method: "GET" }, r); return r.code === 405; })());

  await callUsage({
    email: "yafit@test.com",
    days: { "1-1": [2, 3], "1-2": [3, 3], "2-1": [0, 2], "bad-key!": [1, 1], "3-1": [9, 2] },
    videosDone: 41, videosTotal: 88, views: 53, trackerDays: 23,
  });
  const u = (await callAdmin({ key: KEY })).body.women.find((w) => w.email === "yafit@test.com").usage;
  check("הנתונים נשמרו והוחזרו", !!u && u.trackerDays === 23 && u.videosDone === 41);
  check("יום תקין נשמר כמו שהוא", u.days["1-1"][0] === 2 && u.days["1-1"][1] === 3);
  check("מפתח לא תקין נזרק", u.days["bad-key!"] === undefined);
  check("הושלמו לא יכול לעבור את הסך הכל", u.days["3-1"][0] === 2);
  check("אישה בלי נתונים מחזירה null", (await callAdmin({ key: KEY })).body.women.find((w) => w.email === "ruti@test.com").usage === null);

  // The evening reminder reads this flag to skip a woman who already finished today.
  const day = new Date().toISOString().slice(0, 10);
  check("בלי doneToday לא נכתב סימון", !store.kv[`trk:${day}:yafit@test.com`]);
  await callUsage({ email: "yafit@test.com", days: {}, day, doneToday: true });
  check("עם doneToday נכתב סימון ליום הנוכחי", store.kv[`trk:${day}:yafit@test.com`] === "1");
  await callUsage({ email: "nili@test.com", days: {}, day: "not-a-date", doneToday: true });
  check("תאריך לא תקין אינו יוצר סימון", !store.kv["trk:not-a-date:nili@test.com"]);
}

console.log("\nהקפאה");
{
  process.env.MANYCHAT_TOKEN = "test-token";
  MC.email = ""; MC.stored = ""; MC.accept = null;
  const EM = "sigal@test.com";
  // A woman mid-programme. She freezes and comes back on a Sunday, to a week the office
  // chooses - not necessarily the one she left.
  CSV2 = [
    'ID,F_NAME,L_NAME,CF_EMAIL,360 - FINAL  PERSONAL START,ביטלה,קבוצה',
    `9731,סיגל,גל,${EM},2026-06-14 12:00:00,FALSE,ב`,
  ].join("\n");

  check("תאריך חזרה שאינו יום ראשון נדחה",
    (await callAdmin({ key: KEY }, "POST", { email: EM, freeze: { back: "2026-10-05", week: 3 } })).code === 400);
  check("שבוע מחוץ לטווח נדחה",
    (await callAdmin({ key: KEY }, "POST", { email: EM, freeze: { back: "2026-10-04", week: 11 } })).code === 400);

  MC.tags = [];
  const r = await callAdmin({ key: KEY }, "POST", { email: EM, freeze: { back: "2026-10-04", week: 3 }, phone: "9731", by: "רון" });
  check("ההקפאה נשמרת", r.code === 200 && r.body.ok === true, JSON.stringify(r.body));
  // Week 3 on 04.10 means she started two weeks earlier. This one number is both what the
  // app reads and the cohort the clerk has to put her in.
  check("תאריך ההתחלה מחושב שבועיים אחורה לשבוע 3",
    JSON.parse(store.hash["admin:overrides"][EM]).start === "2026-09-20",
    JSON.parse(store.hash["admin:overrides"][EM]).start);
  check("ואותו תאריך הוא שנכתב למניצ'ט, ולא תאריך החזרה",
    String(MC.stored).startsWith("2026-09-20"), String(MC.stored));
  check("תאריך ההתחלה המקורי נשמר, כדי שההיסטוריה שלה לא תיעלם",
    JSON.parse(store.hash["admin:overrides"][EM]).freeze.origStart === "2026-06-14");
  // Ron asked for the tag in both directions: freezing tags her, ending the freeze untags
  // her. His automations hang off it, so each direction is a real event over there.
  check("התגית הקפאה נוספת במניצ'ט", MC.tags.includes("+הקפאה"), JSON.stringify(MC.tags));

  const w = (await callAdmin({ key: KEY })).body.women.find((x) => x.email === EM);
  check("הכרטיס מסמן אותה כמוקפאת", w.frozen === true);
  check("והמחזור שטלי צריכה הוא אותו תאריך מחושב", w.backCohort === "2026-09-20", w.backCohort);

  const acc = await callAccess(EM);
  check("בזמן ההקפאה היא לא נכנסת", acc.body.allowed === false && acc.body.reason === "frozen", JSON.stringify(acc.body));
  check("והתאריך שהיא תראה על המסך מוחזר אליה", acc.body.back === "2026-10-04", acc.body.back);

  // "עוד לא יודעת" is a real answer for either half, and she has to stay visible until both
  // are filled in. A freeze that cannot resolve must never quietly let her in.
  await callAdmin({ key: KEY }, "POST", { email: EM, freeze: { back: "", week: "" }, phone: "9731", by: "רון" });
  const w2 = (await callAdmin({ key: KEY })).body.women.find((x) => x.email === EM);
  check("הקפאה בלי תאריך ובלי שבוע נשמרת ככזאת", w2.frozen === true && !w2.freeze.back && !w2.freeze.week);
  check("והמסך אומר מה חסר", w2.freezeTodo === "חסרים תאריך חזרה ושבוע", w2.freezeTodo);
  check("וגם בלי תאריך היא לא נכנסת", (await callAccess(EM)).body.reason === "frozen");

  // Date known, week not decided yet: still cannot resolve, so she waits.
  await callAdmin({ key: KEY }, "POST", { email: EM, freeze: { back: "2026-10-04", week: "" }, phone: "9731", by: "רון" });
  const w2b = (await callAdmin({ key: KEY })).body.women.find((x) => x.email === EM);
  check("תאריך בלי שבוע עדיין מוקפאת", w2b.frozen === true && w2b.freezeTodo === "חסר שבוע חזרה", w2b.freezeTodo);
  check("ואינה נספרת כחוזרת השבוע, כי אין לאיזה מחזור לשייך אותה", w2b.backSoon === false && !w2b.backCohort);
  check("ולא נכנסת", (await callAccess(EM)).body.reason === "frozen");

  MC.tags = [];
  await callAdmin({ key: KEY }, "POST", { email: EM, freeze: { off: true }, phone: "9731", by: "רון" });
  check("וסיום ההקפאה מסיר אותה", MC.tags.includes("-הקפאה"), JSON.stringify(MC.tags));
  const w3 = (await callAdmin({ key: KEY })).body.women.find((x) => x.email === EM);
  check("סיום ההקפאה מחזיר אותה פנימה", !w3.frozen && (await callAccess(EM)).body.allowed === true);
  check("ותאריך ההתחלה שנקבע לה נשאר", JSON.parse(store.hash["admin:overrides"][EM]).start === "2026-09-20");
  check("שתי הפעולות נרשמו ביומן", (w3.log || []).filter((L) => L.field === "freeze").length >= 2);
  CSV2 = null;
  delete process.env.MANYCHAT_TOKEN;
  delete store.hash["admin:overrides"][EM];
}

console.log("\nשינוי כתובת מייל");
{
  process.env.MANYCHAT_TOKEN = "test-token";
  MC.email = ""; MC.refuseEmail = false;
  const FROM = "michal@test.com", TO = "michal.new@test.com";

  // Something of hers under the old address, so the move can be proven rather than assumed.
  await callAdmin({ key: KEY }, "POST", { email: FROM, group: "ה", by: "רון" });
  store.kv["bk:" + FROM] = "encrypted-blob";
  store.hash["admin:usage"] = store.hash["admin:usage"] || {};
  store.hash["admin:usage"][FROM] = JSON.stringify({ days: {} });
  store.hash["push:subs"] = { "endpoint-1": JSON.stringify({ email: FROM, sub: {} }) };

  check("כתובת לא תקינה נדחית",
    (await callAdmin({ key: KEY }, "POST", { email: FROM, newEmail: "לא-מייל", phone: "972504444444" })).code === 400);
  check("אותה כתובת נדחית",
    (await callAdmin({ key: KEY }, "POST", { email: FROM, newEmail: FROM, phone: "972504444444" })).code === 400);
  check("כתובת שכבר קיימת בגיליון נדחית",
    (await callAdmin({ key: KEY }, "POST", { email: FROM, newEmail: "yafit@test.com", phone: "972504444444" })).code === 409);

  MC.refuseEmail = true;
  const bad = await callAdmin({ key: KEY }, "POST", { email: FROM, newEmail: TO, phone: "972504444444" });
  check("כשמניצ'ט מסרב, שום דבר אצלנו לא זז", bad.body.ok === false && store.kv["bk:" + FROM] === "encrypted-blob", JSON.stringify(bad.body));
  MC.refuseEmail = false;

  const good = await callAdmin({ key: KEY }, "POST", { email: FROM, newEmail: TO, phone: "972504444444", by: "רון" });
  check("השינוי מצליח", good.body.ok === true, JSON.stringify(good.body));
  check("והכתובת נכתבה למניצ'ט", MC.email === TO, String(MC.email));
  check("הגיבוי המוצפן עבר לכתובת החדשה", store.kv["bk:" + TO] === "encrypted-blob" && !store.kv["bk:" + FROM]);
  check("נתוני השימוש עברו", !!store.hash["admin:usage"][TO] && !store.hash["admin:usage"][FROM]);
  check("החלטות הפקידה עברו", !!store.hash["admin:overrides"][TO] && !store.hash["admin:overrides"][FROM]);
  check("רישום ההתראות מצביע על הכתובת החדשה", JSON.parse(store.hash["push:subs"]["endpoint-1"]).email === TO);
  const rec = JSON.parse(store.hash["admin:overrides"][TO]);
  check("השינוי נרשם ביומן, תחת הכתובת החדשה", (rec.log || []).some((L) => L.field === "email" && L.from === FROM && L.to === TO));

  // The whole point: the sheet still carries the old address, because it is exported from
  // ManyChat on its own schedule. She must be able to sign in with the new one at once.
  check("היא נכנסת מיד עם הכתובת החדשה, בזמן שהגיליון עדיין עם הישנה",
    (await callAccess(TO)).body.allowed === true);
  check("והישנה מפסיקה לעבוד, כדי ששתיהן לא יחיו במקביל",
    (await callAccess(FROM)).body.reason === "not_registered");
  const card = (await callAdmin({ key: KEY })).body.women.find((w) => w.email === FROM);
  check("הכרטיס מציג את הכתובת החדשה לצד זו שבגיליון", card && card.pendingEmail === TO, JSON.stringify(card && card.pendingEmail));

  // And once the export does catch up, the bridge clears itself.
  CSV2 = CSV.replace(FROM, TO);
  await callAdmin({ key: KEY });
  check("כשהגיליון מתעדכן, הגשר נמחק לבד", !store.hash["admin:emailmap"][TO] && !store.hash["admin:emailold"][FROM]);
  check("והיא ממשיכה להיכנס עם החדשה", (await callAccess(TO)).body.allowed === true);
  CSV2 = null;
  delete process.env.MANYCHAT_TOKEN;
}

console.log("\nסימון ביטול בתהליך");
{
  process.env.MANYCHAT_TOKEN = "test-token";
  MC.tags = [];
  const r = await callAdmin({ key: KEY }, "POST", { email: "yafit@test.com", tag: "cancelproc", on: true, phone: "972501111111", by: "רון" });
  check("הסימון נשלח למניצ'ט", r.code === 200 && r.body.mc === "ok", JSON.stringify(r.body));
  check("בשם התגית המדויק שבחשבון", MC.tags.includes("+ביטול בתהליך ❌❌"), JSON.stringify(MC.tags));

  MC.tags = [];
  await callAdmin({ key: KEY }, "POST", { email: "yafit@test.com", tag: "cancelproc", on: false, phone: "972501111111", by: "רון" });
  check("וההסרה מסירה את אותה תגית", MC.tags.includes("-ביטול בתהליך ❌❌"), JSON.stringify(MC.tags));

  const w = (await callAdmin({ key: KEY })).body.women.find((x) => x.email === "yafit@test.com");
  check("שתי הפעולות נרשמו ביומן", (w.log || []).filter((L) => L.field === "tag:cancelproc").length === 2);
  // Ron's decision on 19 August 2026: marking her also takes the new app away, and removing
  // the mark gives it back. Both directions are locked here.
  MC.tags = [];
  await callAdmin({ key: KEY }, "POST", { email: "yafit@test.com", tag: "cancelproc", on: true, phone: "972501111111", by: "רון" });
  const acc = await callAccess("yafit@test.com");
  check("הסימון חוסם לה את הכניסה לאפליקציה", acc.body.allowed === false && acc.body.reason === "cancelled", JSON.stringify(acc.body));
  check("והכרטיס מציג אותה כחסומה", (await callAdmin({ key: KEY })).body.women.find((x) => x.email === "yafit@test.com").blocked === true);

  await callAdmin({ key: KEY }, "POST", { email: "yafit@test.com", tag: "cancelproc", on: false, phone: "972501111111", by: "רון" });
  check("הסרת הסימון מחזירה לה את הגישה", (await callAccess("yafit@test.com")).body.allowed === true);
  check("והכרטיס כבר לא מציג אותה כחסומה", (await callAdmin({ key: KEY })).body.women.find((x) => x.email === "yafit@test.com").blocked === false);

  // A change to any other field must not quietly clear the block.
  await callAdmin({ key: KEY }, "POST", { email: "yafit@test.com", tag: "cancelproc", on: true, phone: "972501111111", by: "רון" });
  await callAdmin({ key: KEY }, "POST", { email: "yafit@test.com", group: "ג", by: "רון" });
  check("שינוי בשדה אחר אינו מבטל את החסימה", (await callAccess("yafit@test.com")).body.allowed === false);
  await callAdmin({ key: KEY }, "POST", { email: "yafit@test.com", tag: "cancelproc", on: false, phone: "972501111111", by: "רון" });
  await callAdmin({ key: KEY }, "POST", { email: "yafit@test.com", group: "" });
  check("תגית שאינה ברשימה הסגורה נדחית",
    (await callAdmin({ key: KEY }, "POST", { email: "yafit@test.com", tag: "whatever", on: true })).code === 400);
  delete process.env.MANYCHAT_TOKEN;
}

console.log("\nקודי גישה לצוות המשרד");
{
  check("קוד שלא קיים נחסם", (await callAdmin({ key: "made-up-code" })).code === 401);
  check("בקשת קודים בלי מפתח המנהל נחסמת", (await callAdmin({ codes: "1" })).code === 401);

  const made = await callAdmin({ key: KEY }, "POST", { newCode: "טלי", by: "רון" });
  check("המנהל יוצר קוד", made.code === 200 && !!made.body.code, JSON.stringify(made.body));
  const tali = made.body.code;
  check("הקוד באורך ובצורה קבועים", /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(tali), tali);

  const list = await callAdmin({ key: KEY, codes: "1" });
  check("הקוד מופיע ברשימה עם השם", list.body.codes.some((c) => c.code === tali && c.name === "טלי"));

  const asTali = await callAdmin({ key: tali });
  check("טלי נכנסת עם הקוד שלה", asTali.code === 200);
  check("והמסך יודע שהיא אינה המנהל", asTali.body.owner === false && asTali.body.me === "טלי");
  check("המנהל מסומן כמנהל", (await callAdmin({ key: KEY })).body.owner === true);

  // The whole point beyond access: the name on a change is the code's, not what was typed.
  await callAdmin({ key: tali }, "POST", { email: "nili@test.com", group: "ד", by: "רון" });
  const w = (await callAdmin({ key: KEY })).body.women.find((x) => x.email === "nili@test.com");
  check("השם ביומן מגיע מהקוד ולא ממה שהוקלד", (w.log || [])[0].by === "טלי", JSON.stringify((w.log || [])[0]));

  check("טלי אינה יכולה לראות את הקודים", (await callAdmin({ key: tali, codes: "1" })).code === 403);
  check("וגם לא ליצור קוד", (await callAdmin({ key: tali }, "POST", { newCode: "מישהי" })).code === 403);
  check("וגם לא לבטל אחד", (await callAdmin({ key: tali }, "POST", { dropCode: tali })).code === 403);

  await callAdmin({ key: KEY }, "POST", { dropCode: tali });
  check("אחרי ביטול היא כבר לא נכנסת", (await callAdmin({ key: tali })).code === 401);
  check("והמנהל ממשיך להיכנס", (await callAdmin({ key: KEY })).code === 200);
  await callAdmin({ key: KEY }, "POST", { email: "nili@test.com", group: "" });
}

console.log("\nהכתיבה של תאריך ההתחלה למניצ'ט");
{
  // The first build wrote nothing at all: the value shape was rejected, the answer was never
  // read, and the screen said it had saved. Both halves are locked here.
  process.env.MANYCHAT_TOKEN = "test-token";
  const call = async (accept) => {
    MC.accept = accept; MC.stored = ""; MC.writes = [];
    const r = await callAdmin({ key: KEY }, "POST", { email: "yafit@test.com", start: "2026-08-16", phone: "972501111111", by: "הפקידה" });
    return r.body;
  };

  // The shape ManyChat really accepted on 19 August 2026, so it is the one tried first and
  // the ordinary case must cost exactly one write.
  let b = await call("2026-08-16T12:00:00+03:00");
  check("הפורמט שנבדק מול מניצ'ט האמיתי הוא הראשון שנוסה", b.mc === "ok:2026-08-16T12:00:00+03:00", String(b.mc));
  check("ולא נוסו פורמטים נוספים אחרי שהראשון הצליח", MC.writes.length === 1, String(MC.writes.length));

  b = await call("2026-08-16 12:00:00");
  check("ואם מניצ'ט ישנה דעה, הצורה הבאה מתגלה בניסיון ולא בניחוש", b.mc === "ok:2026-08-16 12:00:00", String(b.mc));
  check("והשעה תמיד 12:00", MC.writes.every((v) => String(v).includes("12:00")));

  b = await call("לא קיים");
  check("כשמניצ'ט דוחה את כולם, נאמר שזה נכשל", String(b.mc).indexOf("startfail:") === 0, String(b.mc));
  check("והשגיאה של מניצ'ט מועברת כמו שהיא", String(b.mc).includes("wrong format"), String(b.mc));
  check("והשמירה אצלנו בכל זאת נשמרה", b.ok === true);
  const still = (await callAdmin({ key: KEY })).body.women.find((w) => w.email === "yafit@test.com");
  check("כלומר המחזור החדש חל על האפליקציה גם כשמניצ'ט נכשל", still.start === "2026-08-16", still.start);

  await callAdmin({ key: KEY }, "POST", { email: "yafit@test.com", start: "", by: "הפקידה" });
  delete process.env.MANYCHAT_TOKEN;
  MC.accept = null;
}

console.log("\nלמה מסומנת בגיליון ואינה מוצגת");
{
  // Ron marked 123 women and the screen showed 103. Every row that never becomes a woman is
  // counted so the gap can be named on screen instead of read as a bug.
  const H = 'ID,F_NAME,L_NAME,CF_EMAIL,360 - FINAL  PERSONAL START,ביטלה,קבוצה,אפליקציית תזונה';
  CSV2 = [H,
    '9721,א,א,dup@test.com,2026-06-14 0:00:00,FALSE,ב,TRUE',
    '9722,ב,ב,dup@test.com,2026-06-14 0:00:00,FALSE,ב,TRUE',   // אותו מייל, נזרקת
    '9723,ג,ג,,2026-06-14 0:00:00,FALSE,ב,TRUE',               // בלי מייל, נזרקת
    '9724,ד,ד,nostart@test.com,,FALSE,ב,TRUE',                 // בלי תאריך התחלה
    '9725,ה,ה,gone@test.com,2026-06-14 0:00:00,TRUE,ב,TRUE',   // ביטלה
  ].join("\n");
  const r = await loadSheet(process.env.ACCESS_SHEET_CSV_URL);
  check("סך המסומנות בגיליון נספר מהשורות עצמן", r.sheetNewAppRows === 5, String(r.sheetNewAppRows));
  check("מייל כפול נספר בנפרד", r.skipped.newAppDuplicate === 1, JSON.stringify(r.skipped));
  check("שורה בלי מייל נספרת בנפרד", r.skipped.newAppNoEmail === 1, JSON.stringify(r.skipped));
  check("ומי שנשארה היא רק זו שיש לה מייל ייחודי", r.women.length === 3, String(r.women.length));
  CSV2 = null;
}

console.log("\nהעברת מחזור");
{
  // Sundays only. A cohort that starts on any other day splits the two things the app
  // derives from this date - the tracker card opens on days elapsed, its tasks open on the
  // day of the week - and the card then renders with no tasks at all. See section 28.
  check("תאריך שאינו יום ראשון נדחה",
    (await callAdmin({ key: KEY }, "POST", { email: "nili@test.com", start: "2026-08-19" })).code === 400);
  check("תאריך בפורמט שגוי נדחה",
    (await callAdmin({ key: KEY }, "POST", { email: "nili@test.com", start: "16.08.2026" })).code === 400);

  const before = (await callAdmin({ key: KEY })).body.women.find((w) => w.email === "nili@test.com");
  check("לפני השינוי המחזור הוא זה שבגיליון", before.start === "2026-06-14", before.start);

  await callAdmin({ key: KEY }, "POST", { email: "nili@test.com", start: "2026-08-16", by: "הפקידה" });
  const after = (await callAdmin({ key: KEY })).body.women.find((w) => w.email === "nili@test.com");
  check("המחזור החדש בתוקף במסך", after.start === "2026-08-16", after.start);
  check("והערך שבגיליון ממשיך להיות מוצג לצידו", after.sheetStart === "2026-06-14", after.sheetStart);
  check("מסומן כשינוי ידני", !!after.startOverride);
  // 2026-08-16 + 70 days + 3 months = 2026-01-25 of the next year.
  check("סיום הגישה מחושב מחדש מהמחזור החדש", after.until === "2027-01-25", after.until);
  check("השינוי נרשם ביומן", (after.log || []).some((L) => L.field === "start" && L.to === "2026-08-16" && L.from === "2026-06-14"));

  const acc = (await callAccess("nili@test.com")).body;
  check("שער הגישה מחזיר לאפליקציה את המחזור החדש", acc.startDate === "2026-08-16", acc.startDate);
  check("והיא עדיין נכנסת", acc.allowed === true);

  await callAdmin({ key: KEY }, "POST", { email: "nili@test.com", start: "", by: "הפקידה" });
  const back = (await callAdmin({ key: KEY })).body.women.find((w) => w.email === "nili@test.com");
  check("חזרה לגיליון מחזירה את המחזור המקורי", back.start === "2026-06-14" && !back.startOverride);
  check("וגם את סיום הגישה", back.until === "2026-11-23", back.until);
  check("והיומן שומר גם את הביטול", (back.log || []).some((L) => L.field === "start" && L.to === ""));
}

console.log("\nחוסן");
const hadFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (String(url).startsWith("https://redis.test")) throw new Error("redis down");
  return hadFetch(url);
};
check("תקלת Redis לא נועלת משתתפת רשומה", (await callAccess("nili@test.com")).body.allowed === true);
globalThis.fetch = hadFetch;

console.log("\nחיפוש טלפון במסך הניהול");
{
  // נמשך מ-public/admin.html ולא מועתק, כדי שעריכה שם תישבר כאן ולא תעבור בשקט.
  const html = readFileSync(new URL("../public/admin.html", import.meta.url), "utf8");
  const m = html.match(/function phoneKey\(s\)\{[\s\S]*?\n\}/);
  check("phoneKey קיימת ב-admin.html", !!m);
  const phoneKey = m ? new Function(m[0] + "; return phoneKey;")() : () => "";
  const want = "547676619";
  check("מספר כמו שהוא בגיליון", phoneKey("972547676619") === want);
  check("העתקה מהוואטסאפ העסקי", phoneKey("+972 54-767-6619") === want);
  check("עם רווחים ובלי מקפים", phoneKey("+972 54 767 6619") === want);
  check("בצורה מקומית עם אפס", phoneKey("054-767-6619") === want);
  check("בצורה מקומית בלי מקפים", phoneKey("0547676619") === want);
  check("בלי אפס ובלי 972", phoneKey("547676619") === want);
  check("עם 00 במקום פלוס", phoneKey("00972547676619") === want);
  check("שם אינו מייצר מספר", phoneKey("רונית לוי") === "");
}

console.log("\nהערות ותשובות");
{
  const EM = "yafit@test.com";
  // A note must never overwrite her progress: the bubble sends it on its own, with no
  // counters in it, and a blind write would blank her usage row until the next app load.
  await callUsage({ email: EM, days: { "1-1": [2, 3] }, trackerDays: 5 });
  await callUsage({ email: EM, note: { screen: "יומן", text: "איפה מזינים מים?" } });
  const kept = (await callAdmin({ key: KEY })).body.women.find((w) => w.email === EM);
  check("הערה אינה מוחקת את נתוני השימוש שלה", kept.usage && kept.usage.trackerDays === 5, JSON.stringify(kept.usage));
  const list = (await callAdmin({ key: KEY, notes: EM })).body;
  check("הערה שנכתבה באפליקציה נשמרת אצלנו", list.ok && list.notes.length === 1 && list.notes[0].text === "איפה מזינים מים?");
  check("ועם המסך שממנו נכתבה", list.notes[0].screen === "יומן");

  const women = () => callAdmin({ key: KEY }).then((r) => r.body.women.find((w) => w.email === EM));
  check("היא מסומנת ברשימה כממתינה לתשובה", (await women()).notes === 1);

  const id = list.notes[0].id;
  const bad = await callAdmin({ key: KEY }, "POST", { email: EM, by: "רון", reply: { to: id, text: "   " } });
  check("תשובה ריקה נדחית", bad.body.ok === false);

  // עד שהתשובה נשלחת, אין לה שום דבר לקרוא
  const before = await callAccess(EM);
  check("לפני שנשלחה תשובה, השער לא מחזיר כלום", (before.body.replies || []).length === 0);

  await callAdmin({ key: KEY }, "POST", { email: EM, by: "רון", reply: { to: id, text: "לוחצים על טבעת המים 💜" } });
  const after = await callAccess(EM);
  check("אחרי השליחה השער מחזיר לה את התשובה", (after.body.replies || []).length === 1);
  check("והטקסט הוא בדיוק מה שנכתב", after.body.replies[0].text === "לוחצים על טבעת המים 💜");
  check("והיא כבר לא מסומנת כממתינה", !(await women()).notes);

  const twice = await callAdmin({ key: KEY }, "POST", { email: EM, by: "רון", reply: { to: id, text: "עוד אחת" } });
  check("אי אפשר לענות פעמיים לאותה הערה", twice.body.ok === false);

  await callUsage({ email: EM, noteRead: after.body.replies[0].id });
  check("אחרי שהיא לחצה 'תודה, הבנתי' התשובה לא חוזרת", ((await callAccess(EM)).body.replies || []).length === 0);
  const seen = (await callAdmin({ key: KEY, notes: EM })).body.replies[0];
  check("והמשרד רואה שהיא נקראה", !!seen.read);

  // סימון כטופל בלי תשובה: יורד מהרשימה של המשרד, ואצלה לא נדלק כלום
  await callUsage({ email: EM, note: { screen: "יומן", text: "לא מצליחה להזין משקל 44" } });
  const two = (await callAdmin({ key: KEY, notes: EM })).body.notes;
  const bugId = two.find((n) => n.text.includes("44")).id;
  check("הערה שנייה מצטרפת לראשונה", two.length === 2);
  await callAdmin({ key: KEY }, "POST", { email: EM, by: "רון", noteDone: bugId });
  check("סימון כטופל מוריד אותה מהרשימה", !(await women()).notes);
  check("ואצלה לא נדלק שום דבר", ((await callAccess(EM)).body.replies || []).length === 0);
}

console.log("\nבנק התשובות");
{
  const empty = await callAdmin({ key: KEY, bank: "1" });
  check("בנק ריק מוחזר כרשימה ריקה", empty.body.ok === true && Array.isArray(empty.body.bank) && empty.body.bank.length === 0);

  const half = await callAdmin({ key: KEY }, "POST", { email: "yafit@test.com", by: "רון", bankAdd: { q: "איפה מזינים מים?", a: "" } });
  check("תשובה ריקה לא נכנסת לבנק", half.body.ok === false);

  await callAdmin({ key: KEY }, "POST", { email: "yafit@test.com", by: "רון", bankAdd: { q: "איפה מזינים מים?", a: "לוחצים על טבעת המים 💜" } });
  const one = (await callAdmin({ key: KEY, bank: "1" })).body.bank;
  check("שאלה ותשובה נשמרות", one.length === 1 && one[0].q === "איפה מזינים מים?");
  check("ונרשם מי הוסיף אותה", one[0].by === "רון");

  await callAdmin({ key: KEY }, "POST", { email: "yafit@test.com", by: "רון", bankDrop: one[0].id });
  check("אפשר להסיר מהבנק", (await callAdmin({ key: KEY, bank: "1" })).body.bank.length === 0);

  // הדירוג עצמו נמשך מ-public/admin.html ולא מועתק, כדי שעריכה שם תישבר כאן
  const html = readFileSync(new URL("../public/admin.html", import.meta.url), "utf8");
  const m = html.match(/var STOP = \[[\s\S]*?function bankSuggest\(text\)\{[\s\S]*?\n\}/);
  check("bankSuggest קיימת ב-admin.html", !!m);
  const fn = new Function("BANK", m[0] + "; return bankSuggest;");
  const bank = [
    { id: "a", q: "איפה מזינים שתיית מים?", a: "לוחצים על טבעת המים במסך היומן" },
    { id: "b", q: "מה זה המדליות והגביעים?", a: "מדליה על יום שהושלם" },
    { id: "c", q: "איך אני יודעת כמה צעדים עשיתי?", a: "פותחים את אפליקציית הבריאות ומזינים את המספר באפליקציה" },
  ];
  const sug = fn(bank);
  check("שאלה על מים מציעה את התשובה על מים", (sug("אחלה אפליקציה, איפה מזינים שתיית מים?")[0] || {}).id === "a");
  // הדירוג הרופף הקודם החזיר כאן דווקא את התשובה על הצעדים, על סמך "מזינים" ו"אפליקציה"
  check("ולא את התשובה על הצעדים, שחולקת איתה מילים נפוצות", sug("אחלה אפליקציה, איפה מזינים שתיית מים?").every((e) => e.id !== "c"));
  check("ושאלה רחוקה לא מציעה כלום", sug("סרקתי ברקוד של nature valley והקלוריות שגויות").length === 0);
  check("ומשפט קצר מדי לא מציע כלום", sug("המשקל שגוי").length === 0);

  // הניסוחים שכבר נכתבו לשאלות אמיתיות. כל אחד חייב להיתפס על הלשון שבה היא נכתבה,
  // ובאג חייב שלא לקבל הצעה בכלל, כי לו מגיע תיקון ולא הודעה.
  const seedSrc = html.match(/var BANK_SEED = \[[\s\S]*?\n\];/);
  check("BANK_SEED קיים ב-admin.html", !!seedSrc);
  const SEED = new Function(seedSrc[0] + "; return BANK_SEED;")();
  const onSeed = fn(SEED);
  const want = [
    ["s11", "חסרה לי רובריקה בפעילות הגופנית רק של הליכה מהירה שהיא ממש שונה מריצה"],
    ["s12", "סרקתי בר קוד של nature valley. האפליקציה זיהתה ונתנה 80 קלוריות. על האריזה כתוב 196 קלוריות"],
    ["s13", "יש בעייה בחישוב חלבון. לדוגמא היוגורט go טבעוני של תנובה. יש בו 29 גרם חלבון ולא 6 גרם כמו שמופיע"],
    ["s14", "ביומן מזון- לא קופץ אוטומטי המוצר כמו בקלוריה, מבקש שארשום ערכים תזונתיים שאני לא יודעת"],
    ["s15", "היי. הערה בקשר לסרטונים. היה טוב אם היו מופיעות גם כתוביות"],
    ["s16", "תאריך ההתחלה לא נכון, ביקשתי מועד אחר, 30/8"],
    ["s17", "הייתי שמחה למלא רק את כמות הקלוריות משום שאני משתמשת בגמיני"],
  ];
  want.forEach(function (pair) {
    check("הצעה מוכנה: " + pair[1].slice(0, 28), (onSeed(pair[1])[0] || {}).id === pair[0]);
  });
  // באג שכבר תוקן מקבל ניסוח שאומר לה שתוקן. באג שעוד לא, לא מקבל כלום.
  check("לבאג שתוקן יש ניסוח", (onSeed("לא מצליחה להזין את המשקל שלי, האפליקציה לא מקבלת אותו")[0] || {}).id === "s20");
  check("ולהערה בת שתי מילים עדיין אין", onSeed("המשקל שגוי").length === 0);
}

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.");
process.exit(fail ? 1 : 0);
