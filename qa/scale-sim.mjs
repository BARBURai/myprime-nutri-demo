// qa/scale-sim.mjs · v7.43
//
// **עדיפות 1 של רון, 23 בספטמבר 2026: סקייל ל-10,000 נשים בלי שהמערכת קורסת.**
//
// **זו סימולציה ולא בדיקה.** היא אינה עוברת או נופלת, היא מדפיסה מספרים. היא מריצה את
// קבצי השרת **האמיתיים** (`api/access.js`, `api/catalog.js`, `api/notify.js`) מול Redis
// מדומה, גיליון מדומה ושירות התראות מדומה, בכמה גדלים, ושואלת שלוש שאלות:
//
//   א. השער: כמה פקודות Redis בכל פתיחה, והאם מטמון הגיליון עדיין נשמר
//   ב. חיפוש מזון: כמה נתונים עוברים בכל הקשה, כשמאגר המזון גדל
//   ג. התראות: כמה סבבים רצופים של שליחה, כשמספר המכשירים גדל
//
// **שום קריאה לא יוצאת החוצה**, ולכן זה חינם ואינו נוגע בייצור או בדב. זה בכוונה:
// הדב והייצור חולקים את אותו חשבון בוורסל, ובדיקת עומס על הדב עלולה לעצור את הייצור.
//
// **המספרים שנמדדו בייצור ב-23 בספטמבר 2026, ושמהם הגדלים כאן:**
//   גיליון: 4,642 שורות, 451,696 תווים, כלומר כ-97 תווים לשורה
//   מאגר המזון: 8,896 רשומות `cat:*`
//   מסד הנתונים: כ-16,300 מפתחות
//
// **מה שהיא לא יכולה לדעת:** זמן תגובה אמיתי של Upstash, של גוגל ושל שירותי ההתראות.
// אלה מודפסים כהנחה, בשם, ולא כמדידה. כלל 2 בסעיף 31.
//
// הרצה: node qa/scale-sim.mjs

import { performance } from "node:perf_hooks";

// ---------- הקפאת הזמן ליום שלישי, כדי שההתראות לא ייפלו על שבת. סעיף 20 ----------
const hebcal = await import("../api/_hebcal.js");
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
let D = "2026-10-06";
while (new Date(D + "T12:00:00Z").getUTCDay() !== 2 || hebcal.isQuietDay(D) || hebcal.isQuietDay(addDays(D, -1)) || hebcal.isErev(D)) D = addDays(D, 1);
const RealDate = Date;
const FIXED = new RealDate(D + "T07:30:00+03:00").getTime();
class FixedDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(FIXED); }
  static now() { return FIXED; }
}
globalThis.Date = FixedDate;
const S = addDays(D, -9); // יום ראשון, ולכן D הוא יום 10 בתוכנית

process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";
process.env.ACCESS_SHEET_CSV_URL = "https://sheet.test/csv";
process.env.NOTIFY_SECRET = "s";
process.env.VAPID_PUBLIC = "p"; process.env.VAPID_PRIVATE = "q";

// ---------- Redis מדומה, שסופר פקודות ובתים ----------
let db = { str: {}, hash: {} };
let stats = { cmds: 0, bytes: 0, byCmd: {} };
const resetStats = () => { stats = { cmds: 0, bytes: 0, byCmd: {} }; };
const globRe = (p) => new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
const exec = ([op, key, ...a]) => {
  switch (op) {
    case "GET": return db.str[key] ?? null;
    case "MGET": return [key, ...a].map((k) => db.str[k] ?? null);
    case "SET": { if (a.includes("NX") && db.str[key] != null) return null; db.str[key] = a[0]; return "OK"; }
    case "KEYS": { const re = globRe(key); return Object.keys(db.str).filter((k) => re.test(k)); }
    case "HGET": return (db.hash[key] || {})[a[0]] ?? null;
    case "HGETALL": return Object.entries(db.hash[key] || {}).flat();
    case "HSET": case "HSETNX": { db.hash[key] = db.hash[key] || {}; db.hash[key][a[0]] = a[1]; return 1; }
    case "HDEL": return a.length;
    case "INCR": { db.str[key] = String((+db.str[key] || 0) + 1); return +db.str[key]; }
    case "ZCARD": return 1;
    case "ZSCORE": return String(Date.now());
    default: return null; // EXPIRE, ZADD, ZREM, SADD, DEL וכו': אין צורך בתוכן כדי לספור
  }
};
globalThis.fetch = async (url, opt) => {
  const u = String(url);
  if (u.startsWith("https://redis.test")) {
    const cmd = opt && opt.body ? JSON.parse(opt.body)
      : u.slice("https://redis.test/".length).split("/").map(decodeURIComponent);
    const result = exec(cmd);
    const body = JSON.stringify({ result });
    stats.cmds++; stats.bytes += body.length;
    stats.byCmd[cmd[0]] = (stats.byCmd[cmd[0]] || 0) + 1;
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  }
  if (u.startsWith("https://sheet.test")) return { ok: true, status: 200, text: async () => SHEET };
  throw new Error("unexpected fetch " + u);
};

const call = async (h, query, method = "GET") => {
  let out = null, code = 0;
  const res = { status(c) { code = c; return this; }, json(o) { out = o; return this; }, setHeader() {}, end() { return this; } };
  await h({ method, query, headers: {}, body: undefined }, res);
  return { code, out };
};
const fmt = (n) => Math.round(n).toLocaleString("en-US");
const kb = (n) => (n / 1024).toFixed(0) + "KB";

// =====================================================================
// א. השער
console.log("\nא. השער, api/access.js: פתיחה אחת של אישה רשומה");
const HEADER = "ID,F_NAME,L_NAME,CF_EMAIL,360 - FINAL  PERSONAL START,ביטלה,קבוצה,שבוע בתוכנית,צמיד,חודשי גישה נוספים";
// שורה של כ-97 תווים, כמו שנמדד בייצור. הריפוד יושב בעמודה שהשער אינו קורא.
const row = (i) => {
  const base = `05${String(i).padStart(8, "0")},שם${i},משפחה${i},w${i}@test.co,${S} 12:00:00,FALSE,א,2,`;
  return base + "x".repeat(Math.max(0, 96 - base.length)) + ",";
};
let SHEET = "";
const access = (await import("../api/access.js")).default;
const SHEET_MAX = 5000000; // api/_sheet.js, בבתים מ-v7.43
for (const rows of [4642, 8000, 10000, 20000]) {
  SHEET = [HEADER, ...Array.from({ length: rows }, (_, i) => row(i))].join("\n");
  db = { str: {}, hash: {} };
  // פתיחה ראשונה ממלאת את המטמון (אם הוא נשמר), והשנייה היא הנמדדת
  await call(access, { email: `w${Math.floor(rows / 2)}@test.co`, device: "d0" });
  const cached = typeof db.str["sheet:csv:v1"] === "string";
  resetStats();
  const t = performance.now();
  const r = await call(access, { email: `w${Math.floor(rows / 2)}@test.co`, device: "d1" });
  const ms = performance.now() - t;
  console.log(`   ${fmt(rows).padStart(6)} שורות · ${fmt(SHEET.length).padStart(9)} תווים · מטמון ${cached ? "נשמר" : "כבוי, כל פתיחה הולכת לגוגל"}`
    + ` · ${stats.cmds} פקודות Redis · ${kb(stats.bytes)} מ-Redis · עיבוד ${ms.toFixed(0)}ms · allowed=${r.out && r.out.allowed}`);
}
console.log(`   הרף של המטמון: ${fmt(SHEET_MAX)} בתים`);

// =====================================================================
// ב. חיפוש מזון
console.log("\nב. חיפוש מזון, api/catalog.js: הקשה אחת");
const catalog = (await import("../api/catalog.js")).default;
const food = (i) => JSON.stringify({ name: `מוצר ${i}`, per100: { kcal: 100, p: 5, f: 3, c: 12 }, unit: "g", source: "off", seen: 1, ts: 1 });
for (const n of [8896, 30000, 100000]) {
  db = { str: {}, hash: {} };
  for (let i = 0; i < n; i++) db.str[`cat:מוצר_דוגמה_${i}`] = food(i);
  resetStats();
  const t = performance.now();
  const r = await call(catalog, { q: "דוגמה_12" });
  const ms = performance.now() - t;
  console.log(`   ${fmt(n).padStart(7)} מזונות במאגר · ${stats.cmds} פקודות · ${kb(stats.bytes).padStart(6)} חוזרים מ-Redis בכל הקשה · סינון ${ms.toFixed(0)}ms · ${(r.out.items || []).length} תוצאות`);
}

// =====================================================================
// ג. התראות
console.log("\nג. התראות, api/notify.js: הרצת בוקר אחת");
const webpush = (await import("web-push")).default;
webpush.setVapidDetails = () => {};
let inFlight = 0, waves = 0, pushed = 0;
webpush.sendNotification = async () => {
  if (inFlight === 0) waves++;
  inFlight++; pushed++;
  await new Promise((r) => setImmediate(r));
  inFlight--;
  return {};
};
const notify = (await import("../api/notify.js")).default;
const ASSUMED = [0.2, 0.5, 1.0]; // שניות לסבב. **הנחה**, לא מדידה
for (const n of [412, 2600, 10000, 20000]) {
  db = { str: {}, hash: { "push:subs": {} } };
  for (let i = 0; i < n; i++) {
    db.hash["push:subs"][`ep${i}`] = JSON.stringify({ email: `w${i}@test.co`, sub: { endpoint: `ep${i}` }, startDate: S, hour: 19 });
  }
  inFlight = 0; waves = 0; pushed = 0; resetStats();
  const r = await call(notify, { secret: "s", kind: "morning", force: "1" });
  const est = ASSUMED.map((s) => `${fmt(waves * s)}s`).join(" / ");
  console.log(`   ${fmt(n).padStart(6)} מכשירים · נשלחו ${fmt(pushed)} · ${fmt(waves)} סבבים רצופים · ${stats.cmds} פקודות Redis · אם כל סבב לוקח ${ASSUMED.join("/")}s: ${est} · code=${r.code}`);
}
console.log("   ומשך הריצה המותר לפונקציה בוורסל עדיין לא אומת מול החבילה. סעיף 5.6");
console.log();
