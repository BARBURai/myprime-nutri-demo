// מבצע בלאק נובמבר ל-360. v8.44
//
//   node qa/promo360-check.mjs
//
// **בלי רשת.** מריץ את `api/_ref.js`, את `api/_product.js`, את `api/access.js` ואת `api/admin.js`
// האמיתיים מול Redis בזיכרון וגיליון מדומה. רון, 4.11.2026: מי שקנתה 360 במבצע מקבלת 70 יום
// ועוד 6 חודשים, **מתאריך ההתחלה הראשון שלה, גם אם הועברה**. העיקר: **מי שלא קנתה במבצע
// מקבלת בדיוק את אותה תשובה ובאותן פניות כמו בלי המנגנון.**
process.env.ACCESS_SHEET_CSV_URL = "https://sheet.test/csv";
process.env.UPSTASH_REDIS_REST_URL = "redis://r";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";
delete process.env.MC_SYNC_SECRET;

let pass = 0, fail = 0;
const ck = (name, ok, info) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : "  → " + JSON.stringify(info)}`); };

const H = {}, S = {}; let log = [], failHset = false;
const hash = (k) => (H[k] = H[k] || {});
function run(cmd) {
  const [c, ...a] = cmd.map(String);
  log.push(c + " " + (a[0] || ""));
  switch (c) {
    case "GET": return S[a[0]] ?? null;
    case "HGET": return (H[a[0]] || {})[a[1]] ?? null;
    case "HGETALL": return Object.entries(H[a[0]] || {}).flat();
    case "HSET": { if (failHset && a[0] === "admin:overrides") throw new Error("down"); const h = hash(a[0]); for (let i = 1; i + 1 < a.length; i += 2) h[a[i]] = a[i + 1]; return 1; }
    case "HSETNX": { const h = hash(a[0]); if (h[a[1]] !== undefined) return 0; h[a[1]] = a[2]; return 1; }
    case "HDEL": if (H[a[0]]) delete H[a[0]][a[1]]; return 1;
    case "ZSCORE": return null;
    case "ZCARD": return 0;
    default: return 1;
  }
}
globalThis.fetch = async (url, opt) => {
  const u = String(url);
  if (u.startsWith("redis://")) {
    if (u.endsWith("/pipeline")) { const cmds = JSON.parse(opt.body); return { ok: true, json: async () => cmds.map((c) => ({ result: run(c) })) }; }
    const cmd = opt && opt.body ? JSON.parse(opt.body) : u.slice(10).split("/").map(decodeURIComponent);
    let result; try { result = run(cmd); } catch (e) { return { ok: true, json: async () => ({ error: "down" }) }; }
    return { ok: true, json: async () => ({ result }) };
  }
  if (u.startsWith("https://sheet.test")) return { ok: true, status: 200, text: async () => SHEET };
  throw new Error("no net " + u);
};

const { promo360Charge, PROMO360_KEY, PROMO360_START } = await import("../api/_ref.js");
const { decideAccess } = await import("../api/_product.js");
const { default: access } = await import("../api/access.js");

// ---------- קליטת הקנייה ----------
console.log("\nקליטת הקנייה\n");
const rp = async (cmd) => run(cmd);
const c = (b) => promo360Charge(b, rp);
ck("בלי מייל או הזמנה או תאריך: 400", (await c({ email: "", orderId: "1", paidAt: "2026-11-05T10:00:00Z" })).status === 400 && (await c({ email: "a@t.com", paidAt: "2026-11-05T10:00:00Z" })).status === 400 && (await c({ email: "a@t.com", orderId: "1", paidAt: "x" })).status === 400);
const pre = await c({ email: "early@t.com", orderId: "o0", paidAt: "2026-11-04T14:11:59Z" });
ck("**לפני ההדלקה, 4.11 14:11:59 UTC: אינה נכנסת**", pre.status === 200 && pre.json.skipped === "outside_window" && !(H[PROMO360_KEY] || {})["early@t.com"], pre);
const first = await c({ email: "First@T.com", orderId: "o1", paidAt: "2026-11-04T14:12:00Z" });
ck("**ברגע ההדלקה: נכנסת, ובמייל באותיות קטנות**", first.status === 200 && first.json.months === 9 && !!H[PROMO360_KEY]["first@t.com"], first);
const last = await c({ email: "last@t.com", orderId: "o2", paidAt: "2026-11-30T21:59:59Z" });
ck("30.11 23:59:59 שעון ישראל: נכנסת", last.status === 200 && last.json.months === 9, last);
const after = await c({ email: "late@t.com", orderId: "o3", paidAt: "2026-11-30T22:00:00Z" });
ck("1.12 00:00 שעון ישראל: אינה נכנסת", after.json.skipped === "outside_window", after);
const again = await c({ email: "first@t.com", orderId: "o9", paidAt: "2026-11-10T10:00:00Z" });
ck("פעם אחת לכל אישה", again.json.already === true && JSON.parse(H[PROMO360_KEY]["first@t.com"]).order === "o1", again);
hash("admin:overrides")["keep@t.com"] = JSON.stringify({ group: "ב", log: [{ field: "group", to: "ב" }] });
await c({ email: "keep@t.com", orderId: "o4", paidAt: "2026-11-06T08:00:00Z" });
const ovK = JSON.parse(H["admin:overrides"]["keep@t.com"]);
ck("**סימוני המשרד שכבר היו נשמרים, ושורה ביומן**", ovK.group === "ב" && ovK.bf26 && ovK.bf26.order === "o4" && ovK.log.length === 2 && ovK.log[0].field === "bf26" && ovK.log[0].by === "מערכת", ovK);
failHset = true;
const broke = await c({ email: "broke@t.com", orderId: "o5", paidAt: "2026-11-06T08:00:00Z" });
failHset = false;
ck("תקלה בשמירה: 502, והסימון משתחרר לניסיון הבא", broke.status === 502 && !(H[PROMO360_KEY] || {})["broke@t.com"], broke);
const retry = await c({ email: "broke@t.com", orderId: "o5", paidAt: "2026-11-06T08:00:00Z" });
ck("והניסיון הבא נקלט", retry.status === 200 && retry.json.months === 9, retry);

// ---------- ההכרעה ----------
console.log("\nההכרעה\n");
const S0 = new Date("2026-04-05T00:00:00Z");
const base = { startSunday: S0, extraMonths: null, solo: 0, today: "2026-11-04" };
const plain = decideAccess(base);
ck("בלי המבצע: 70 יום ועוד 3 חודשים", plain.end360 === "2026-09-14" && plain.allowed === false, plain.end360);
const pr = decideAccess({ ...base, promoUntil: "2026-12-14" });
ck("**עם המבצע: 70 יום ועוד 6 חודשים, ונכנסת**", pr.end360 === "2026-12-14" && pr.allowed === true, pr.end360);
ck("המבצע אינו מקצר חלון ארוך ממנו", decideAccess({ ...base, extraMonths: 9, promoUntil: "2026-12-14" }).end360 === decideAccess({ ...base, extraMonths: 9 }).end360);
ck("**תאריך שהמשרד קבע גובר**", decideAccess({ ...base, clerkUntil: "2026-10-01", promoUntil: "2026-12-14" }).allowed === false);
ck("בלי המבצע ההכרעה זהה בדיוק", JSON.stringify(decideAccess({ ...base, promoUntil: "" })) === JSON.stringify(plain));

// ---------- השער ----------
console.log("\nהשער\n");
const START = "360 - FINAL  PERSONAL START";
// מחזור שהתחיל לפני כ-200 יום: 70 יום ועוד 3 חודשים כבר עברו, ו-70 יום ועוד 6 חודשים עוד לא.
const sun = (daysAgo) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - daysAgo); while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
const startS = sun(200);
var SHEET = `ID,F_NAME,CF_EMAIL,${START},ביטלה\n972503000001,בל,bf@test.com,${startS} 12:00:00,\n972503000002,רג,reg@test.com,${startS} 12:00:00,\n`;
const login = async (email) => { let out; const res = { status() { return this; }, json(b) { out = b; return this; }, setHeader() {} }; await access({ query: { email, device: "d1" }, headers: {} }, res); return out; };
log = [];
const r0 = await login("reg@test.com");
const regCmds = log.slice();
ck("360 בלי המבצע ביום 200: הגישה הסתיימה", r0.allowed === false && r0.reason === "expired", r0);
ck("**ובלי שום פנייה למבצע**", !regCmds.some((x) => x.includes("promo:")), regCmds);
hash("admin:overrides")["bf@test.com"] = JSON.stringify({ bf26: { order: "o7", paidAt: "2026-11-05T10:00:00Z" } });
const b0 = await login("bf@test.com");
ck("**קנתה במבצע: נכנסת**", b0.allowed === true, b0);
ck("התאריך הראשון נתפס", H[PROMO360_START]["bf@test.com"] === startS, H[PROMO360_START]);
// המשרד מעביר אותה למחזור מאוחר בשבוע: הספירה נשארת מהתאריך הראשון.
const moved = sun(190);
hash("admin:overrides")["bf@test.com"] = JSON.stringify({ bf26: { order: "o7" }, start: moved });
await login("bf@test.com");
ck("**הועברה למחזור אחר: התאריך הראשון לא זז**", H[PROMO360_START]["bf@test.com"] === startS, H[PROMO360_START]);
// מחזור ישן מאוד: גם 70 ועוד 6 חודשים עברו.
H[PROMO360_START]["bf@test.com"] = sun(300);
hash("admin:overrides")["bf@test.com"] = JSON.stringify({ bf26: { order: "o7" } });
const b2 = await login("bf@test.com");
ck("מתאריך ראשון של לפני 300 יום: גם המבצע הסתיים", b2.allowed === false && b2.reason === "expired", b2);

// ---------- מסך הניהול ----------
console.log("\nמסך הניהול\n");
process.env.ADMIN_KEY = "adminkey"; process.env.APP_REF_KEY = "refkey";
const { default: admin } = await import("../api/admin.js");
const call = async (req) => { const r = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, setHeader() {}, end() { return this; } }; await admin({ headers: {}, body: null, method: "GET", ...req }, r); return r; };
const a0 = await call({ method: "POST", query: { promo360: "" }, body: { email: "w@test.com", orderId: "x1", paidAt: "2026-11-05T10:00:00Z" } });
ck("בלי מפתח: 401 ואינו נוגע בדבר", a0.code === 401 && !(H[PROMO360_KEY] || {})["w@test.com"], a0.code);
const a1 = await call({ method: "POST", query: { promo360: "" }, headers: { "x-ref-key": "refkey" }, body: { email: "w@test.com", orderId: "x1", paidAt: "2026-11-05T10:00:00Z" } });
ck("**עם מפתח: נשמר**", a1.code === 200 && a1.body.months === 9 && JSON.parse(H["admin:overrides"]["w@test.com"]).bf26.order === "x1", a1.body);
const a2 = await call({ method: "GET", query: { promo360: "" }, headers: { "x-ref-key": "refkey" } });
ck("רק POST", a2.code === 405, a2.code);

console.log(`\n${pass} מתוך ${pass + fail} עברו.`);
process.exit(fail ? 1 : 0);
