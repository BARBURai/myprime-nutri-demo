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

const { refCharge, makeCode, cleanCode, REF_MAX_MONTHS } = await import("../api/_ref.js");
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

// ---------- decideAccess ----------
console.log("\nהחלון\n");
const sun = new Date(Date.UTC(2026, 7, 2));
const base = { startSunday: sun, solo: 10, today: "2026-10-13" };
ck("סמארט בלי בונוס: נגמר ביום 70", decideAccess(base).end360 === "2026-10-11" && decideAccess(base).allowed === false);
const b1 = decideAccess({ ...base, bonusMonths: 1 });
ck("**סמארט עם חודש: 70 יום ועוד חודש**", b1.end360 === "2026-11-11" && b1.allowed === true, b1.end360);
ck("בונוס אפס או שלילי אינו משנה דבר", JSON.stringify(decideAccess({ ...base, bonusMonths: 0 })) === JSON.stringify(decideAccess(base)) && JSON.stringify(decideAccess({ ...base, bonusMonths: -2 })) === JSON.stringify(decideAccess(base)));
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
const s2 = await login("smart@test.com");
ck("**הקוד קבוע בין כניסות**", s2.ref && s2.ref.code === s1.ref.code);
ck("והקוד מוביל אליה", H["ref:code"][s1.ref.code] === "smart@test.com");
log = []; const r1 = await login("reg@test.com"); const regLog = log.filter((x) => /ref:/.test(x));
ck("**אישה שאינה בסמארט: אף פנייה ל-ref, ובלי קוד**", regLog.length === 0 && !r1.ref, { regLog, ref: r1.ref });
hash("ref:bonus")["reg@test.com"] = JSON.stringify({ m: 3, f: 3 });
const r2 = await login("reg@test.com");
ck("ובונוס שרשום לה אינו משנה את התשובה שלה", JSON.stringify(r2) === JSON.stringify(r1), r2);

console.log(`\n${pass} מתוך ${pass + fail} עברו.`);
process.exit(fail ? 1 : 0);
