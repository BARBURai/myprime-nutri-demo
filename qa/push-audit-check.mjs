// qa/push-audit-check.mjs · v7.37
//
// **רון, 23 בספטמבר 2026: "אני רוצה לדעת כמה קיבלו וכמה לא קיבלו מאלה שאמורות לקבל, לא
// מאלה שלא אמורות לקבל."**
//
// שלושה חלקים, ושלושתם מריצים את הקוד האמיתי ולא עותק שלו:
//   א. auditPush לבדה, על כל מקרה קצה של "מי אמורה לקבל"
//   ב. api/notify.js האמיתי מול Redis מדומה ושירות התראות מדומה: מה נרשם לפי אישה,
//      **ושהשליחה עצמה לא השתנתה בשום דבר**, גם כשהרישום נכשל
//   ג. api/usage-report.js האמיתי, על מה ש-notify.js רשם באותה הרצה, מול גיליון מדומה
//
// **הזמן מוקפא** ליום חול שאינו חג ואינו ערב חג, כדי שהבדיקה לא תעבור ביום אחד ותיפול
// בשבת. זו המלכודת של סעיף 20.
//
// הרצה: node qa/push-audit-check.mjs

import fs from "node:fs";

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name + (extra ? "  →  " + extra : "")); } };
const done = () => { console.log(`\n${pass} מתוך ${pass + fail} עברו`); process.exit(fail ? 1 : 0); };

let audit, hebcal;
try { audit = await import("../api/_pushaudit.js"); hebcal = await import("../api/_hebcal.js"); }
catch (e) { ok("api/_pushaudit.js קיים", false, String(e).slice(0, 120)); done(); }
const { auditPush, AUDIT_DAYS, whoKey } = audit;

// ---------- הקפאת הזמן ----------
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
let D = "2026-10-06";
// יום שלישי, לא שקט ולא ערב, וגם אתמול לא שקט.
while (new Date(D + "T12:00:00Z").getUTCDay() !== 2 || hebcal.isQuietDay(D) || hebcal.isQuietDay(addDays(D, -1)) || hebcal.isErev(D)) D = addDays(D, 1);
const RealDate = Date;
const FIXED = new RealDate(D + "T07:30:00+03:00").getTime();
class FixedDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(FIXED); }
  static now() { return FIXED; }
}
globalThis.Date = FixedDate;

const S = addDays(D, -9);      // יום ראשון, ולכן D הוא יום 10
const OLD = addDays(D, -79);   // יום 80, אחרי סוף התוכנית
const W = (email, extra) => ({ email, start: S, cancelled: false, sheetNewApp: false, ...extra });
const set = (...a) => new Set(a);
const EMPTY = { sent: set(), failed: set(), pruned: set(), done: set() };

// =====================================================================
console.log("\nא. מי אמורה לקבל");

ok("החלונות זהים לאלה שב-notify.js", (() => {
  const src = fs.readFileSync(new URL("../api/notify.js", import.meta.url), "utf8");
  const t = src.match(/TRACKER_DAYS = \{ first: (\d+), last: (\d+) \}/), c = src.match(/CONTENT_DAYS = \{ first: (\d+), last: (\d+) \}/);
  return t && c && +c[1] === AUDIT_DAYS.morning.first && +c[2] === AUDIT_DAYS.morning.last
    && +t[1] === AUDIT_DAYS.evening.first && +t[2] === AUDIT_DAYS.evening.last;
})());

const edge = (kind, dayNo) => auditPush({ kind, date: D, women: [W("z@x.co", { start: addDays(D, -(dayNo - 1)), sheetNewApp: true })], who: EMPTY }).should;
// startDate הוא יום ראשון, ולכן מספרי הימים כאן נבחרו כך שההתחלה נופלת על ראשון.
ok("בוקר: יום 10 בפנים", edge("morning", 10) === 1);
ok("בוקר: יום 66 בפנים ויום 73 בחוץ", edge("morning", 66) === 1 && edge("morning", 73) === 0);
ok("ערב: יום 3 בפנים, ויום 1 בחוץ", (() => {
  const d3 = auditPush({ kind: "evening", date: addDays(S, 2), women: [W("z@x.co", { sheetNewApp: true })], who: EMPTY });
  const d1 = auditPush({ kind: "evening", date: S, women: [W("z@x.co", { sheetNewApp: true })], who: EMPTY });
  const m1 = auditPush({ kind: "morning", date: S, women: [W("z@x.co", { sheetNewApp: true })], who: EMPTY });
  return d3.should === 1 && d1.should === 0 && m1.should === 1;
})());
ok("יום 70 בערב בפנים ובבוקר בחוץ", (() => {
  const st = addDays(D, -69);
  // D הוא שלישי, ולכן st אינו ראשון. זה בודק את החשבון בלבד, לא מחזור אמיתי.
  const e = auditPush({ kind: "evening", date: D, women: [W("z@x.co", { start: st, sheetNewApp: true })], who: EMPTY });
  const m = auditPush({ kind: "morning", date: D, women: [W("z@x.co", { start: st, sheetNewApp: true })], who: EMPTY });
  return e.should === 1 && m.should === 0;
})());
ok("ביום שקט אין אף אחת שאמורה לקבל", (() => {
  let q = D; while (!hebcal.isQuietDay(q)) q = addDays(q, 1);
  return auditPush({ kind: "morning", date: q, women: [W("z@x.co")], who: EMPTY }).quiet === true;
})());

const base = { kind: "morning", date: D, manual: {}, overrides: {}, emailMap: {}, appEmails: set(), subEmails: set() };
ok("מי שביטלה אינה נספרת", auditPush({ ...base, women: [W("a@x.co", { cancelled: true, sheetNewApp: true })], who: EMPTY }).should === 0);
ok("מי שנחסמה במשרד אינה נספרת", auditPush({ ...base, women: [W("a@x.co", { sheetNewApp: true })], overrides: { "a@x.co": JSON.stringify({ blocked: "1" }) }, who: EMPTY }).should === 0);
ok("מי שבהקפאה אינה נספרת", auditPush({ ...base, women: [W("a@x.co", { sheetNewApp: true })], overrides: { "a@x.co": JSON.stringify({ freeze: { from: S } }) }, who: EMPTY }).should === 0);
ok("מי שחזרה מהקפאה נספרת שוב", auditPush({ ...base, women: [W("a@x.co", { sheetNewApp: true })], overrides: { "a@x.co": JSON.stringify({ freeze: { back: addDays(D, -1), week: 2 } }) }, who: EMPTY }).should === 1);
ok("תאריך התחלה שהמשרד שינה גובר על הגיליון", auditPush({ ...base, women: [W("a@x.co", { start: OLD, sheetNewApp: true })], overrides: { "a@x.co": JSON.stringify({ start: S }) }, who: EMPTY }).should === 1);
ok("מי שעברה את סוף התוכנית אינה נספרת", auditPush({ ...base, women: [W("a@x.co", { start: OLD, sheetNewApp: true })], who: EMPTY }).should === 0);
ok("מי שאין לה תאריך התחלה, קונת הקורס לבדו, אינה נספרת", auditPush({ ...base, women: [W("a@x.co", { start: "", sheetNewApp: true })], who: EMPTY }).should === 0);
ok("אישה באפליקציה הישנה אינה נספרת, ונספרת בנפרד", (() => {
  const r = auditPush({ ...base, women: [W("a@x.co")], who: EMPTY });
  return r.should === 0 && r.oldApp === 1;
})());
ok("עקבה באפליקציה מכניסה אותה גם בלי עמודה בגיליון", auditPush({ ...base, women: [W("a@x.co")], appEmails: set("a@x.co"), who: EMPTY }).should === 1);
ok("אישה שהמשרד הוסיף ביד נספרת", auditPush({ ...base, women: [], manual: { "m@x.co": JSON.stringify({ start: S }) }, who: EMPTY }).should === 1);
ok("והגיליון גובר על הרישום הידני", auditPush({ ...base, women: [W("m@x.co", { start: OLD, sheetNewApp: true })], manual: { "m@x.co": JSON.stringify({ start: S }) }, who: EMPTY }).should === 0);
ok("כתובת שהוחלפה נספרת תחת הכתובת החדשה", (() => {
  const r = auditPush({ ...base, women: [W("old@x.co", { sheetNewApp: true })], emailMap: { "new@x.co": "old@x.co" }, who: { ...EMPTY, sent: set("new@x.co") } });
  return r.should === 1 && r.got === 1;
})());
ok("אותה אישה על שתי שורות נספרת פעם אחת", auditPush({ ...base, women: [W("a@x.co", { sheetNewApp: true }), W("A@x.co ", { sheetNewApp: true })], who: EMPTY }).should === 1);

console.log("\n   ומה קרה לכל אחת");
const cls = (who, subs) => auditPush({ ...base, women: [W("a@x.co", { sheetNewApp: true })], subEmails: set(...(subs || [])), who: { ...EMPTY, ...who } });
ok("קיבלה", cls({ sent: set("a@x.co") }).got === 1);
ok("קיבלה במכשיר אחד והשני נזרק: נספרת כמי שקיבלה", (() => { const r = cls({ sent: set("a@x.co"), pruned: set("a@x.co") }); return r.got === 1 && r.pruned === 0; })());
ok("תקלה בשליחה", cls({ failed: set("a@x.co") }).failed === 1);
ok("הסירה או כיבתה", cls({ pruned: set("a@x.co") }).pruned === 1);
ok("יש לה התראות ולא נשלח אליה", cls({}, ["a@x.co"]).missed === 1);
ok("לא אישרה התראות", cls({}).noSub === 1);
ok("בערב: השלימה לפני התזכורת, ולכן אינה במכנה", (() => {
  const r = auditPush({ ...base, kind: "evening", women: [W("a@x.co", { sheetNewApp: true })], subEmails: set("a@x.co"), who: { ...EMPTY, done: set("a@x.co") } });
  return r.should === 0 && r.done === 1;
})());
ok("בערב: קיבלה ואחר כך השלימה נספרת כמי שקיבלה", (() => {
  const r = auditPush({ ...base, kind: "evening", women: [W("a@x.co", { sheetNewApp: true })], who: { ...EMPTY, sent: set("a@x.co"), done: set("a@x.co") } });
  return r.should === 1 && r.got === 1 && r.done === 0;
})());
ok("הסכום תמיד נסגר: קיבלו ועוד כל סיבה שווה לאמורות", (() => {
  const women = ["a", "b", "c", "d", "e"].map((x) => W(x + "@x.co", { sheetNewApp: true }));
  const r = auditPush({ ...base, women, subEmails: set("d@x.co"), who: { ...EMPTY, sent: set("a@x.co"), failed: set("b@x.co"), pruned: set("c@x.co") } });
  return r.should === 5 && r.got + r.failed + r.pruned + r.missed + r.noSub === r.should;
})());

// =====================================================================
console.log("\nב. api/notify.js האמיתי");

process.env.NOTIFY_SECRET = "t";
process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "tok";
process.env.VAPID_PUBLIC = "p"; process.env.VAPID_PRIVATE = "q";
process.env.ACCESS_SHEET_CSV_URL = "https://sheet.test/csv";
process.env.RESEND_API_KEY = "r";

const webpush = (await import("web-push")).default;
webpush.setVapidDetails = () => {};
// לכל כתובת מכשיר התנהגות קבועה: מתקבל, נזרק (410) או תקלה (500).
const behave = {};
const pushed = [];
webpush.sendNotification = async (sub) => {
  pushed.push(sub.endpoint);
  const b = behave[sub.endpoint] || "ok";
  if (b === "ok") return {};
  const e = new Error(b); e.statusCode = b === "gone" ? 410 : 500; throw e;
};

// Redis מדומה, בזיכרון
const db = { hash: {}, str: {}, sets: {} };
let saddFails = false, saddCalls = 0;
const redisExec = (cmd) => {
  const [op, key, ...a] = cmd;
  switch (op) {
    case "HGETALL": { const h = db.hash[key] || {}; return Object.entries(h).flat(); }
    case "HSET": { db.hash[key] = db.hash[key] || {}; db.hash[key][a[0]] = a[1]; return 1; }
    case "HDEL": { a.forEach((f) => { if (db.hash[key]) delete db.hash[key][f]; }); return a.length; }
    case "GET": return db.str[key] ?? null;
    case "MGET": return [key, ...a].map((k) => db.str[k] ?? null);
    case "SET": { if (a.includes("NX") && db.str[key] != null) return null; db.str[key] = a[0]; return "OK"; }
    case "EXPIRE": return 1;
    case "KEYS": { const re = new RegExp("^" + key.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$"); return [...Object.keys(db.str), ...Object.keys(db.hash)].filter((k) => re.test(k)); }
    case "ZCOUNT": return 0;
    case "SADD": { saddCalls++; if (saddFails) throw new Error("redis down"); db.sets[key] = db.sets[key] || new Set(); a.forEach((x) => db.sets[key].add(x)); return a.length; }
    case "SMEMBERS": return [...(db.sets[key] || [])];
    default: return null;
  }
};

const CSV = [
  "ID,F_NAME,L_NAME,CF_EMAIL,360 - FINAL  PERSONAL START,ביטלה,קבוצה,אפליקציית תזונה",
  `1,A,A,a@x.co,${S} 0:00:00,FALSE,א,`,
  `2,B,B,b@x.co,${S} 0:00:00,FALSE,א,`,
  `3,C,C,c@x.co,${S} 0:00:00,FALSE,א,`,
  `4,D,D,d@x.co,${S} 0:00:00,FALSE,א,`,
  `5,E,E,e@x.co,${S} 0:00:00,FALSE,א,`,
  `6,F,F,f@x.co,${S} 0:00:00,FALSE,א,`,
  `7,G,G,g@x.co,${S} 0:00:00,FALSE,א,`,
  `8,H,H,h@x.co,${S} 0:00:00,TRUE,א,`,
  `9,I,I,i@x.co,${S} 0:00:00,FALSE,א,`,
  `10,J,J,j@x.co,${OLD} 0:00:00,FALSE,א,`,
  `11,K,K,k@x.co,${S} 0:00:00,FALSE,א,TRUE`,
  `12,P,P,p@x.co,${S} 0:00:00,FALSE,א,`,
].join("\n");
let sheetOk = true;
const mails = [];
globalThis.fetch = async (url, opt) => {
  const u = String(url);
  if (u.startsWith("https://redis.test")) {
    try { return { ok: true, json: async () => ({ result: redisExec(JSON.parse(opt.body)) }) }; }
    catch (e) { return { ok: false, json: async () => ({ error: String(e) }) }; }
  }
  if (u.startsWith("https://sheet.test")) {
    if (!sheetOk) return { ok: false, status: 500, text: async () => "" };
    return { ok: true, status: 200, text: async () => CSV };
  }
  if (u.startsWith("https://api.resend.com")) { mails.push(JSON.parse(opt.body)); return { ok: true, json: async () => ({ id: "m" }) }; }
  throw new Error("unexpected fetch " + u);
};
// Redis שזורק ב-SADD: redisCmd של notify קורא d.result ולא בודק ok, ולכן כאן זורקים ממש.
const realExec = redisExec;

const sub = (email, endpoint, startDate) => [endpoint, JSON.stringify({ email, sub: { endpoint }, startDate: startDate || S, hour: 19 })];
const subs = [
  sub("a@x.co", "ep-a"),
  sub("b@x.co", "ep-b1"), sub("b@x.co", "ep-b2"),
  sub("c@x.co", "ep-c"),
  sub("d@x.co", "ep-d"),
  sub("f@x.co", "ep-f", "2026-01-04"), // רישום ישן עם תאריך התחלה שכבר לא נכון
  sub("m@x.co", "ep-m"),
  sub("p@x.co", "ep-p"),
];
const resetDb = () => {
  db.hash = { "push:subs": Object.fromEntries(subs), "admin:seen": { "e@x.co": D }, "admin:manual": { "m@x.co": JSON.stringify({ start: S }) }, "admin:overrides": { "i@x.co": JSON.stringify({ freeze: { from: S } }) } };
  // כל אישה שפתחה את האפליקציה החדשה משאירה גיבוי, bk:<מייל>. ככה זה בייצור מ-v4.72.
  db.str = Object.fromEntries(["a", "b", "c", "d", "f", "m", "p"].map((x) => [`bk:${x}@x.co`, "1"])); db.sets = {};
};
Object.assign(behave, { "ep-b1": "gone", "ep-c": "gone", "ep-d": "err" });

const notify = (await import("../api/notify.js")).default;
const report = (await import("../api/usage-report.js")).default;
const call = async (h, query) => { const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; }, setHeader() {} }; await h({ headers: {}, query: { secret: "t", ...query } }, res); return res; };

resetDb();
db.str[`trk:${D}:p@x.co`] = "1"; // p השלימה את היום לפני הערב
pushed.length = 0;
const m1 = await call(notify, { kind: "morning", force: "1" });
ok("הבוקר: התשובה נשארה בדיוק באותה צורה", JSON.stringify(Object.keys(m1.body)) === JSON.stringify(["ok", "kind", "hours", "sent", "pruned", "failed", "quiet", "total"]), JSON.stringify(m1.body));
ok("הבוקר: אותם מכשירים נשלחו כמו תמיד", m1.body.sent === 4 && m1.body.pruned === 2 && m1.body.failed === 1 && m1.body.quiet === 1 && pushed.length === 7, JSON.stringify(m1.body));
const S_ = (st) => [...(db.sets[whoKey(D, "morning", st)] || [])].sort().join(",");
ok("נרשמו לפי אישה ולא לפי מכשיר: קיבלו", S_("sent") === "a@x.co,b@x.co,m@x.co,p@x.co", S_("sent"));
ok("נזרקו", S_("pruned") === "b@x.co,c@x.co", S_("pruned"));
ok("תקלה", S_("failed") === "d@x.co", S_("failed"));
ok("בבוקר אין רשימת השלימו", S_("done") === "");

const e1 = await call(notify, { force: "1" });
const E_ = (st) => [...(db.sets[whoKey(D, "evening", st)] || [])].sort().join(",");
ok("הערב: מי שהשלימה נרשמת כהשלימה ולא כמי שקיבלה", E_("done") === "p@x.co" && !E_("sent").includes("p@x.co"), E_("done") + " | " + E_("sent"));
ok("הערב: שאר הנשים נרשמו", E_("sent") === "a@x.co,b@x.co,m@x.co", E_("sent"));

const before = saddCalls;
await call(notify, { kind: "morning", force: "1", only: "a@x.co" });
ok("הרצה ידנית לטלפון אחד אינה נרשמת", saddCalls === before);

resetDb(); saddFails = true; pushed.length = 0;
const m2 = await call(notify, { kind: "morning", force: "1" });
saddFails = false;
ok("כשהרישום נכשל, ההתראות יוצאות בדיוק אותו דבר", m2.code === 200 && m2.body.sent === 4 && pushed.length === 7, JSON.stringify(m2.body));

// =====================================================================
console.log("\nג. api/usage-report.js האמיתי, על מה ש-notify רשם");

resetDb();
db.str[`trk:${D}:p@x.co`] = "1";
await call(notify, { kind: "morning", force: "1" });
await call(notify, { force: "1" });
mails.length = 0;
const r1 = await call(report, { force: "1", day: D });
const M = r1.body && r1.body.pushAudit && r1.body.pushAudit.morning;
ok("הדוח רץ ונשלח", r1.code === 200 && mails.length === 1, JSON.stringify(r1.body).slice(0, 200));
// אמורות בבוקר: a b c d e f k m p. לא: g (ישנה), h (ביטלה), i (הקפאה), j (סיימה).
ok("בוקר: 9 אמורות לקבל", M && M.should === 9, JSON.stringify(M));
ok("בוקר: קיבלו 4, a b m p. ו-b נספרת פעם אחת", M && M.got === 4, JSON.stringify(M));
ok("בוקר: לא אישרו 2, e ו-k", M && M.noSub === 2);
ok("בוקר: הסירו 1, c", M && M.pruned === 1);
ok("בוקר: תקלה 1, d", M && M.failed === 1);
ok("בוקר: יש לה התראות ולא נשלח 1, f", M && M.missed === 1);
ok("בוקר: g מהאפליקציה הישנה אינה במכנה", M && M.oldApp === 1);
const Ev = r1.body.pushAudit.evening;
ok("ערב: p השלימה לפני התזכורת ואינה במכנה", Ev && Ev.should === 8 && Ev.done === 1 && Ev.got === 3, JSON.stringify(Ev));
// c הסירה את האפליקציה בבוקר, ולכן בערב כבר אין לה מכשיר רשום. **היא עדיין נספרת כמי
// שהייתה אמורה לקבל**, בזכות הגיבוי שלה, ולא נעלמת כאילו היא באפליקציה הישנה.
ok("ערב: מי שהסירה בבוקר עדיין במכנה, תחת 'לא אישרו התראות'", Ev && Ev.noSub === 3 && Ev.oldApp === 1, JSON.stringify(Ev));
const html = mails[0] ? mails[0].html : "";
ok("המייל: אמורות לקבל, קיבלו, לא קיבלו", ["אמורות לקבל", "9 נשים", "קיבלו", "לא קיבלו", "לא אישרו התראות", "הסירו את האפליקציה או כיבו התראות", "תקלה בשליחה", "יש לה התראות ולא נשלח אליה", "השלימו את היום לפני התזכורת"].every((t) => html.includes(t)));
ok("המייל: אין יותר 'דילגו'", !html.includes("דילגו"));
// DUMP_HTML=<קובץ> שומר את המייל כפי שהוא, כדי לראות אותו בדפדפן.
if (process.env.DUMP_HTML) fs.writeFileSync(process.env.DUMP_HTML, html);

resetDb();
await call(notify, { kind: "morning", force: "1" });
sheetOk = false; mails.length = 0;
const r2 = await call(report, { force: "1", day: D });
sheetOk = true;
ok("הגיליון לא נקרא: הדוח עדיין נשלח", r2.code === 200 && mails.length === 1);
ok("ומציג את השורה הישנה עם 'לא נמדד', ולא מספר שגוי", r2.body.pushAudit.morning === null && mails[0].html.includes("נשלחו 4") && mails[0].html.includes("לא נמדד"));

resetDb(); mails.length = 0;
await call(report, { force: "1", day: D });
ok("בלי שום הרצה: 'לא נרשמה' באדום, כמו קודם", mails[0] && mails[0].html.includes("לא נרשמה"));

globalThis.Date = RealDate;
done();
