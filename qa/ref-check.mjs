// חברה מביאה חברה. v8.39
//
//   node qa/ref-check.mjs
//
// **בלי רשת.** מריץ את `api/_ref.js`, את `api/_product.js` ואת `api/access.js` האמיתיים מול
// Redis בזיכרון וגיליון מדומה. העיקר: **אישה שאינה בסמארט מקבלת בדיוק את אותה תשובה ובאותן
// פניות כמו בלי המנגנון**, ונשות סמארט מקבלות את החודשים שצברו.
process.env.ACCESS_SHEET_CSV_URL = "https://sheet.test/csv";
process.env.UPSTASH_REDIS_REST_URL = "redis://r";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";
delete process.env.MC_SYNC_SECRET;

let pass = 0, fail = 0;
const ck = (name, ok, info) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : "  → " + JSON.stringify(info)}`); };

const H = {}, S = {}; let log = [], down = false;
const hash = (k) => (H[k] = H[k] || {});
function run(cmd) {
  const [c, ...a] = cmd.map(String);
  log.push(c + " " + (a[0] || ""));
  switch (c) {
    case "GET": return S[a[0]] ?? null;
    case "HGET": return (H[a[0]] || {})[a[1]] ?? null;
    case "HSET": { const h = hash(a[0]); for (let i = 1; i + 1 < a.length; i += 2) h[a[i]] = a[i + 1]; return 1; }
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
    if (down) throw new Error("down");
    if (u.endsWith("/pipeline")) { const cmds = JSON.parse(opt.body); return { ok: true, json: async () => cmds.map((c) => ({ result: run(c) })) }; }
    const cmd = opt && opt.body ? JSON.parse(opt.body) : u.slice(10).split("/").map(decodeURIComponent);
    return { ok: true, json: async () => ({ result: run(cmd) }) };
  }
  if (u.startsWith("https://sheet.test")) return { ok: true, status: 200, text: async () => SHEET };
  throw new Error("no net " + u);
};

const { refCharge, makeCode, cleanCode, REF_MAX_MONTHS, promoCharge, refLink, PROMO_DAYS } = await import("../api/_ref.js");
const { decideAccess, end360 } = await import("../api/_product.js");
const { default: access } = await import("../api/access.js");

// ---------- refCharge ----------
console.log("\nקליטת התשלום\n");
const rp = async (cmd) => run(cmd);
const phones = { "maya@test.com": ["972501110000"] };
const phonesOf = async (e) => phones[e] || [];
hash("ref:code")["MAYA22"] = "maya@test.com";
hash("ref:mine")["maya@test.com"] = "MAYA22";
const charge = (b) => refCharge(b, rp, phonesOf, Date.UTC(2026, 10, 2));

ck("קוד מתקבל רק בתבנית", cleanCode("maya22") === "MAYA22" && cleanCode("x") === "" && cleanCode("AB<1") === "");
ck("קוד חדש בלי אותיות שמתבלבלות", /^[A-HJ-NP-Z2-9]{6}$/.test(makeCode()));
const bad = await charge({ ref: "MAYA22", email: "" , orderId: "1" });
ck("בלי מייל: 400, ואינו נספר", bad.status === 400);
const unk = await charge({ ref: "NOPE99", email: "a@test.com", orderId: "2" });
ck("קוד שאינו קיים: 200 בלי שינוי", unk.status === 200 && unk.json.skipped === "unknown_ref" && !(H["ref:by"] || {})["a@test.com"]);
const self1 = await charge({ ref: "MAYA22", email: "maya@test.com", orderId: "3" });
ck("**הזמנה עצמית לפי מייל אינה נספרת**", self1.json.skipped === "self");
const self2 = await charge({ ref: "MAYA22", email: "other@test.com", phone: "050-111-0000", orderId: "4" });
ck("**הזמנה עצמית לפי טלפון אינה נספרת**", self2.json.skipped === "self" && !(H["ref:by"] || {})["other@test.com"], self2.json);
const f1 = await charge({ ref: "maya22", email: "Dana@Test.com", phone: "0502220000", orderId: "100" });
const bM = JSON.parse(H["ref:bonus"]["maya@test.com"]), bD = JSON.parse(H["ref:bonus"]["dana@test.com"]);
ck("**חברה ראשונה: חודש למזמינה וחודש לחברה**", f1.status === 200 && bM.m === 1 && bM.f === 1 && bD.m === 1 && bD.via === true, { f1, bM, bD });
const again = await charge({ ref: "MAYA22", email: "dana@test.com", orderId: "100" });
ck("**אותה הזמנה פעם שנייה אינה מוסיפה**", again.json.already === true && JSON.parse(H["ref:bonus"]["maya@test.com"]).m === 1);
const rebuy = await charge({ ref: "MAYA22", email: "dana@test.com", orderId: "101" });
ck("**חברה שקנתה שוב נספרת פעם אחת**", rebuy.json.skipped === "friend_counted" && JSON.parse(H["ref:bonus"]["maya@test.com"]).f === 1);
for (const [i, e] of ["b@test.com", "c@test.com", "d@test.com", "e@test.com"].entries()) await charge({ ref: "MAYA22", email: e, orderId: "2" + i });
const bM5 = JSON.parse(H["ref:bonus"]["maya@test.com"]);
ck(`**תקרה של ${REF_MAX_MONTHS} חודשים למזמינה**`, bM5.m === 3 && bM5.f === 5, bM5);
ck("וכל חברה מקבלת חודש אחד", ["b@test.com", "e@test.com"].every((e) => JSON.parse(H["ref:bonus"][e]).m === 1));
// החברה מזמינה בעצמה: החודש שקיבלה נשמר, והחודש של ההזמנה נוסף.
hash("ref:code")["DANA33"] = "dana@test.com";
await charge({ ref: "DANA33", email: "zz@test.com", orderId: "300" });
const bD2 = JSON.parse(H["ref:bonus"]["dana@test.com"]);
ck("חברה שהגיעה דרך חברה ומזמינה בעצמה: 1 + 1", bD2.m === 2 && bD2.via === true && bD2.f === 1, bD2);
// תקלה באמצע: ההזמנה משתחררת, והניסיון הבא ממשיך.
let boom = 0;
const flaky = async (cmd) => { if (cmd[0] === "HSET" && cmd[1] === "ref:credit" && boom++ === 0) throw new Error("x"); return run(cmd); };
const p1 = await refCharge({ ref: "MAYA22", email: "late@test.com", orderId: "400" }, flaky, phonesOf);
ck("תקלה באמצע: 502, ודף התשלום ינסה שוב", p1.status === 502 && !(H["ref:orders"] || {})["400"], p1);
const p2 = await refCharge({ ref: "MAYA22", email: "late@test.com", orderId: "400" }, flaky, phonesOf);
const crM = JSON.parse(H["ref:credit"]["maya@test.com"]);
ck("**והניסיון הבא משלים בלי להכפיל**", p2.status === 200 && crM.friends.filter((x) => x.email === "late@test.com").length === 1 && JSON.parse(H["ref:bonus"]["late@test.com"]).m === 1, { p2, n: crM.friends.length });

// ---------- הטבת נובמבר, v8.41 ----------
console.log("\nהטבת נובמבר\n");
const pc = (b) => promoCharge(b, rp);
ck("בלי שעת תשלום: 400", (await pc({ email: "n@test.com", orderId: "p1" })).status === 400);
ck("לפני 02.11 בחצות שעון ישראל: אין הטבה", (await pc({ email: "n@test.com", orderId: "p1", paidAt: "2026-11-01T21:59:00Z" })).json.skipped === "outside_window" && !(H["promo:nov26"] || {})["n@test.com"]);
ck("אחרי 30.11 בחצות: אין הטבה", (await pc({ email: "n@test.com", orderId: "p1", paidAt: "2026-11-30T22:00:00Z" })).json.skipped === "outside_window");
const pOk = await pc({ email: "N@test.com", orderId: "p2", paidAt: "2026-11-01T22:00:00Z" });
ck(`**02.11 בחצות בדיוק: ${PROMO_DAYS} יום**`, pOk.status === 200 && JSON.parse(H["ref:bonus"]["n@test.com"]).pd === 28, pOk);
ck("**פעם אחת לכל אישה**", (await pc({ email: "n@test.com", orderId: "p3", paidAt: "2026-11-15T10:00:00Z" })).json.already === true && JSON.parse(H["ref:bonus"]["n@test.com"]).pd === 28);
await pc({ email: "dana@test.com", orderId: "p4", paidAt: "2026-11-30T21:59:00Z" });
const dPromo = JSON.parse(H["ref:bonus"]["dana@test.com"]);
ck("**הטבה לחברה שכבר קיבלה חודש: שניהם נשמרים**", dPromo.pd === 28 && dPromo.m === 2 && dPromo.via === true, dPromo);
await charge({ ref: "DANA33", email: "zz2@test.com", orderId: "301" });
ck("**ותשלום של חברה אחרי ההטבה אינו מוחק את הימים**", JSON.parse(H["ref:bonus"]["dana@test.com"]).pd === 28 && JSON.parse(H["ref:bonus"]["dana@test.com"]).f === 2);

// ---------- שיוך ידני ----------
console.log("\nשיוך ידני\n");
const lk = (from, friend) => refLink(from, friend, rp, phonesOf, Date.UTC(2026, 10, 2));
const l1 = await lk("MAYA22", "hand@test.com");
ck("**שיוך לפי קוד: חודש לחברה**", l1.status === 200 && JSON.parse(H["ref:bonus"]["hand@test.com"]).m === 1 && JSON.parse(H["ref:by"]["hand@test.com"]).order === "manual:hand@test.com", l1);
ck("שיוך שני של אותה חברה אינו מכפיל", (await lk("MAYA22", "hand@test.com")).json.already === true && JSON.parse(H["ref:bonus"]["hand@test.com"]).m === 1);
ck("**חברה שכבר נספרה בקנייה אינה נספרת שוב ביד**", (await lk("MAYA22", "dana@test.com")).json.skipped === "friend_counted");
const l2 = await lk("Noa@Test.com", "hand2@test.com");
const noaCode = H["ref:mine"]["noa@test.com"];
ck("**שיוך לפי מייל של מזמינה בלי קוד: נוצר לה קוד, ושתיהן מקבלות חודש**", l2.status === 200 && /^[A-Z0-9]{6}$/.test(noaCode || "") && H["ref:code"][noaCode] === "noa@test.com" && JSON.parse(H["ref:bonus"]["noa@test.com"]).m === 1 && JSON.parse(H["ref:bonus"]["hand2@test.com"]).m === 1, l2);
ck("שיוך של אישה לעצמה אינו נספר", (await lk("noa@test.com", "noa@test.com")).json.skipped === "self");
ck("קוד שאינו קיים: אין שינוי", (await lk("ZZZZ99", "hand3@test.com")).json.skipped === "unknown_ref" && !(H["ref:bonus"] || {})["hand3@test.com"]);

// ---------- decideAccess ----------
console.log("\nהחלון\n");
const sun = new Date(Date.UTC(2026, 7, 2));
const base = { startSunday: sun, solo: 10, today: "2026-10-13" };
ck("סמארט בלי בונוס: נגמר ביום 70", decideAccess(base).end360 === "2026-10-11" && decideAccess(base).allowed === false);
const b1 = decideAccess({ ...base, bonusMonths: 1 });
ck("**סמארט עם חודש: 70 יום ועוד חודש**", b1.end360 === "2026-11-11" && b1.allowed === true, b1.end360);
ck("בונוס אפס או שלילי אינו משנה דבר", JSON.stringify(decideAccess({ ...base, bonusMonths: 0 })) === JSON.stringify(decideAccess(base)) && JSON.stringify(decideAccess({ ...base, bonusMonths: -2 })) === JSON.stringify(decideAccess(base)));
const bd = decideAccess({ ...base, bonusDays: 28 });
ck("**סמארט עם 28 יום: 70 ועוד 28**", bd.end360 === "2026-11-08", bd.end360);
ck("חודש ועוד 28 יום יחד", decideAccess({ ...base, bonusMonths: 1, bonusDays: 28 }).end360 === "2026-12-09");
ck("ימים על תאריך שהמשרד קבע", decideAccess({ ...base, clerkUntil: "2026-10-01", bonusDays: 28 }).allowed === true && decideAccess({ ...base, clerkUntil: "2026-10-01" }).allowed === false);
const cl = decideAccess({ ...base, clerkUntil: "2026-10-12", bonusMonths: 1 });
ck("ותאריך שהמשרד קבע מתארך גם הוא", cl.allowed === true);

// ---------- השער ----------
console.log("\nהשער\n");
const START = "360 - FINAL  PERSONAL START";
const startS = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 80); while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); })();
var SHEET = `ID,F_NAME,CF_EMAIL,${START},ביטלה,SMART\n972503000001,סמ,smart@test.com,${startS} 12:00:00,,TRUE\n972503000002,רג,reg@test.com,${startS} 12:00:00,,\n`;
const login = async (email) => { let out; const res = { status() { return this; }, json(b) { out = b; return this; }, setHeader() {} }; await access({ query: { email, device: "d1" }, headers: {} }, res); return out; };
const s0 = await login("smart@test.com");
ck("סמארט ביום 80 בלי בונוס: הגישה הסתיימה", s0.allowed === false && s0.reason === "expired", s0);
hash("ref:bonus")["smart@test.com"] = JSON.stringify({ m: 1, f: 1, via: false });
const s1 = await login("smart@test.com");
ck("**סמארט עם חודש בונוס: נכנסת, ומקבלת קוד**", s1.allowed === true && s1.ref && /^[A-Z0-9]{6}$/.test(s1.ref.code) && s1.ref.friends === 1, s1);
hash("ref:bonus")["smart@test.com"] = JSON.stringify({ pd: 28 });
const sd = await login("smart@test.com");
ck("**סמארט ביום 80 עם 28 יום של נובמבר: נכנסת**", sd.allowed === true, sd);
hash("ref:bonus")["smart@test.com"] = JSON.stringify({ m: 1, f: 1, via: false });
const s2 = await login("smart@test.com");
ck("**הקוד קבוע בין כניסות**", s2.ref && s2.ref.code === s1.ref.code);
ck("והקוד מוביל אליה", H["ref:code"][s1.ref.code] === "smart@test.com");
log = []; const r1 = await login("reg@test.com"); const regLog = log.filter((x) => /ref:/.test(x));
ck("**אישה שאינה בסמארט: אף פנייה ל-ref, ובלי קוד**", regLog.length === 0 && !r1.ref, { regLog, ref: r1.ref });
hash("ref:bonus")["reg@test.com"] = JSON.stringify({ m: 3, f: 3 });
const r2 = await login("reg@test.com");
ck("ובונוס שרשום לה אינו משנה את התשובה שלה", JSON.stringify(r2) === JSON.stringify(r1), r2);

// ---------- מסך הניהול, v8.41 ----------
console.log("\nמסך הניהול\n");
process.env.ADMIN_KEY = "adminkey"; process.env.APP_REF_KEY = "refkey";
const { default: admin } = await import("../api/admin.js");
const call = async (req) => { const r = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, setHeader() {}, end() { return this; } }; await admin({ headers: {}, body: null, method: "GET", ...req }, r); return r; };
const pr0 = await call({ method: "POST", query: { promocharge: "" }, body: { email: "w@test.com", orderId: "x1", paidAt: "2026-11-05T10:00:00Z" } });
ck("הטבת נובמבר בלי מפתח: 401", pr0.code === 401 && !(H["promo:nov26"] || {})["w@test.com"], pr0.code);
const pr1 = await call({ method: "POST", query: { promocharge: "" }, headers: { "x-ref-key": "refkey" }, body: { email: "w@test.com", orderId: "x1", paidAt: "2026-11-05T10:00:00Z" } });
ck("**הטבת נובמבר עם מפתח: נשמרת**", pr1.code === 200 && JSON.parse(H["ref:bonus"]["w@test.com"]).pd === 28, pr1.body);
const lk0 = await call({ method: "POST", query: { key: "wrong" }, body: { refLink: "w2@test.com", refFrom: "MAYA22" } });
ck("שיוך ידני עם מפתח שגוי: נדחה ואינו נוגע בדבר", lk0.code >= 400 && !(H["ref:by"] || {})["w2@test.com"], lk0.code);
const lk1 = await call({ method: "POST", query: { key: "adminkey" }, body: { refLink: "w2@test.com", refFrom: "MAYA22", by: "טלי" } });
const ovW2 = JSON.parse((H["admin:overrides"] || {})["w2@test.com"] || "{}");
const ovM = JSON.parse((H["admin:overrides"] || {})["maya@test.com"] || "{}");
ck("**שיוך ידני מהמסך: חודש לחברה, ושורה ביומן של שתיהן**", lk1.code === 200 && JSON.parse(H["ref:bonus"]["w2@test.com"]).m === 1 && (ovW2.log || [])[0]?.field === "refby" && (ovM.log || [])[0]?.field === "reffriend", { b: lk1.body, ovW2 });

console.log(`\n${pass} מתוך ${pass + fail} עברו.`);
process.exit(fail ? 1 : 0);
