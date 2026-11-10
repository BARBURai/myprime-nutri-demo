// צילום ארוחה פתוח כל עוד הגישה פתוחה. v8.47
//
//   node qa/photo-window-check.mjs
//
// **בלי רשת.** רון, 10.11.2026: "מאשר א, כל עוד המקסימום הוא באמת עד 70 תמונות". עד כאן הצילום
// נסגר באפליקציה ביום 70 גם כשהגישה פתוחה עוד חודשים. מריץ את `api/_product.js`, את
// `api/access.js` ואת `api/ai.js` האמיתיים, ואת `photoEnded` מתוך `src/App.jsx`.
import fs from "node:fs";
process.env.ACCESS_SHEET_CSV_URL = "https://sheet.test/csv";
process.env.UPSTASH_REDIS_REST_URL = "redis://r";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";
process.env.ANTHROPIC_API_KEY = "k";
delete process.env.MC_SYNC_SECRET;

let pass = 0, fail = 0;
const ck = (name, ok, info) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : "  → " + JSON.stringify(info)}`); };

const H = {}, S = {};
function run(cmd) {
  const [c, ...a] = cmd.map(String);
  switch (c) {
    case "GET": return S[a[0]] ?? null;
    case "INCR": S[a[0]] = String((Number(S[a[0]]) || 0) + 1); return Number(S[a[0]]);
    case "HGET": return (H[a[0]] || {})[a[1]] ?? null;
    case "HGETALL": return Object.entries(H[a[0]] || {}).flat();
    case "HSETNX": { const h = (H[a[0]] = H[a[0]] || {}); if (h[a[1]] !== undefined) return 0; h[a[1]] = a[2]; return 1; }
    case "ZSCORE": return null;
    case "ZCARD": return 0;
    default: return 1;
  }
}
let aiCalls = 0;
globalThis.fetch = async (url, opt) => {
  const u = String(url);
  if (u.startsWith("redis://")) {
    if (u.endsWith("/pipeline")) { const cmds = JSON.parse(opt.body); return { ok: true, json: async () => cmds.map((c) => ({ result: run(c) })) }; }
    const cmd = opt && opt.body ? JSON.parse(opt.body) : u.slice(10).split("/").map(decodeURIComponent);
    return { ok: true, json: async () => ({ result: run(cmd) }) };
  }
  if (u.startsWith("https://sheet.test")) return { ok: true, status: 200, text: async () => SHEET };
  if (u.startsWith("https://api.anthropic.com")) { aiCalls++; return { ok: true, status: 200, text: async () => JSON.stringify({ content: [{ type: "text", text: "{}" }], usage: {} }), json: async () => ({ content: [{ type: "text", text: "{}" }], usage: {} }) }; }
  throw new Error("no net " + u);
};

const { decideAccess } = await import("../api/_product.js");
const { default: access } = await import("../api/access.js");
const { default: ai, PHOTO_LIMIT } = await import("../api/ai.js");

// ---------- ההכרעה ----------
console.log("\nסוף הגישה בהכרעה\n");
const S0 = new Date("2026-08-30T00:00:00Z");
const base = { startSunday: S0, extraMonths: null, solo: 0, today: "2026-11-10" };
const d360 = decideAccess(base);
ck("360 בלי סימונים: סוף הגישה הוא סוף החלון המחושב", d360.accessEnd === d360.end360 && !!d360.accessEnd, d360);
const dClerk = decideAccess({ ...base, clerkUntil: "2027-01-23", bonusDays: 28 });
ck("**תאריך של המשרד ועוד 28 יום של נובמבר: 20.02.2027** (המקרה של shellysherf)", dClerk.accessEnd === "2027-02-20", dClerk.accessEnd);
const dSmart = decideAccess({ ...base, solo: 10, bonusDays: 28 });
ck("סמארט במבצע: אותו יום אחרון שהשער מכניס בו (התחלה + 70 + 28)", dSmart.accessEnd === "2026-12-06" && decideAccess({ ...base, solo: 10, bonusDays: 28, today: "2026-12-06" }).allowed && !decideAccess({ ...base, solo: 10, bonusDays: 28, today: "2026-12-07" }).allowed, dSmart.accessEnd);
const { accessEnd: _x, ...rest } = d360;
const { accessEnd: _y, ...rest2 } = decideAccess(base);
ck("השדה החדש אינו משנה אף שדה אחר", JSON.stringify(rest) === JSON.stringify(rest2) && d360.allowed === true);

// ---------- השער ----------
console.log("\nהשער\n");
const START = "360 - FINAL  PERSONAL START";
const sun = (daysAgo) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - daysAgo); while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
var SHEET = `ID,F_NAME,CF_EMAIL,${START},ביטלה\n972503000001,אא,old@test.com,${sun(90)} 12:00:00,\n972503000002,בב,gone@test.com,${sun(90)} 12:00:00,TRUE\n`;
const login = async (email) => { let out; const res = { status() { return this; }, json(b) { out = b; return this; }, setHeader() {} }; await access({ query: { email, device: "d1" }, headers: {} }, res); return out; };
const r1 = await login("old@test.com");
ck("360 ביום ~90: נכנסת, ו-photoUntil הוא סוף הגישה", r1.allowed === true && /^\d{4}-\d{2}-\d{2}$/.test(r1.photoUntil || "") && r1.photoUntil > new Date().toISOString().slice(0, 10), r1);
const r2 = await login("gone@test.com");
ck("מבוטלת: אינה נכנסת ואינה מקבלת photoUntil", r2.allowed === false && !r2.photoUntil, r2);

// ---------- האפליקציה ----------
console.log("\nהאפליקציה\n");
const src = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const fn = src.slice(src.indexOf("function photoEnded("), src.indexOf("function bumpPhotosToday("));
const mk = (today, store) => {
  const localStorage = { getItem: (k) => (k in store ? store[k] : null) };
  const programDayNumber = (start, t) => Math.floor((new Date(t) - new Date(start)) / 86400000) + 1;
  return new Function("localStorage", "programDayNumber", "TODAY", fn + "; return photoEnded;")(localStorage, programDayNumber, today);
};
ck("יום 30: פתוח", mk("2026-09-28", {})("2026-08-30") === false);
ck("**יום 73, הגישה פתוחה עד 20.02.2027: פתוח**", mk("2026-11-10", { myprime_photo_until: "2027-02-20" })("2026-08-30") === false);
ck("ביום האחרון של הגישה: פתוח", mk("2027-02-20", { myprime_photo_until: "2027-02-20" })("2026-08-30") === false);
ck("יום אחרי סוף הגישה: סגור", mk("2027-02-21", { myprime_photo_until: "2027-02-20" })("2026-08-30") === true);
ck("אחרי יום 70 בלי photoUntil (מכשיר שלא נכנס מאז): סגור כמו קודם", mk("2026-11-10", {})("2026-08-30") === true);
// (במיין אין מנוי חודשי, ולכן בדיקת המנויה אינה כאן)
ck("האפליקציה כותבת ומוחקת את myprime_photo_until לפי השער", /if \(d\.photoUntil\) localStorage\.setItem\("myprime_photo_until"/.test(src) && /else localStorage\.removeItem\("myprime_photo_until"\)/.test(src));

// ---------- התקרה של 70 ----------
console.log("\nהתקרה של 70 צילומים\n");
ck("התקרה היא 70", PHOTO_LIMIT === 70, PHOTO_LIMIT);
const shot = async (n) => {
  let st = 0, body;
  const res = { status(s) { st = s; return this; }, json(b) { body = b; return this; }, setHeader() {}, send(b) { body = b; return this; }, end() { return this; } };
  const msg = { model: "x", max_tokens: 100, messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAA" } }, { type: "text", text: "מה זה " + n }] }] };
  await ai({ method: "POST", headers: { "x-user-id": "cap@test.com" }, body: msg }, res);
  return { st, body };
};
S["ai:photos:cap@test.com"] = "69";
const s69 = await shot(1);
ck("צילום 70 עובר", s69.st === 200, s69);
const s70 = await shot(2);
ck("**צילום 71 נחסם בשרת, בלי קשר לתאריך**", s70.st === 429 && s70.body && s70.body.scope === "photos", s70);

console.log(`\n${pass} עברו, ${fail} נכשלו\n`);
process.exit(fail ? 1 : 0);
