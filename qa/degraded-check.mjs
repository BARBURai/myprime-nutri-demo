// v7.77: תשובת חסימה שניתנה בלי סימוני המשרד מסומנת `degraded`, והבדיקה החוזרת
// באפליקציה (v7.74) לעולם אינה מוציאה אישה עליה.
//
//   node qa/degraded-check.mjs
//
// **למה זה קיים.** רון שאל מה הנזק למשתתפות קיימות. הרצה של השער האמיתי על הגיליון
// האמיתי ועל 155 הנשים עם סימון משרד, פעם עם Upstash תקין ופעם נופל, מצאה אחת שהמשרד
// האריך לה וקיבלה "הגישה הסתיימה". עם v7.74 היא הייתה יוצאת באמצע. בלי רשת.
process.env.ACCESS_SHEET_CSV_URL = "https://sheet.test/csv";
process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";
delete process.env.MC_SYNC_SECRET;
import { readFileSync } from "node:fs";

const ymd = (d) => d.toISOString().slice(0, 10);
const sundayAgo = (days) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - days); while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() - 1); return ymd(d); };
const old = sundayAgo(400);   // התוכנית והחלון של 3 חודשים נגמרו מזמן
const fresh = sundayAgo(14);  // באמצע התוכנית
const future = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() + 120); return ymd(d); })();
const SHEET = `ID,F_NAME,L_NAME,CF_EMAIL,360 - FINAL  PERSONAL START,ביטלה,קבוצה
0501,הוארכה,א,ext@test.com,${old} 12:00:00,,א
0502,נגמר,ב,done@test.com,${old} 12:00:00,,א
0503,ביטלה,ג,cancel@test.com,${fresh} 12:00:00,TRUE,א
0504,מוקפאת,ד,frozen@test.com,${fresh} 12:00:00,,א
0505,רגילה,ה,ok@test.com,${fresh} 12:00:00,,א
`;
const OVR = {
  "ext@test.com": JSON.stringify({ until: future }),
  "frozen@test.com": JSON.stringify({ freeze: { from: fresh, back: "" } }),
};

let mode = "ok";
globalThis.fetch = async (url, opt = {}) => {
  const u = String(url);
  if (u.startsWith("https://redis.test")) {
    const cmd = opt.body ? JSON.parse(opt.body) : u.slice("https://redis.test/".length).split("/").map(decodeURIComponent);
    if (mode === "error") throw new Error("redis down");
    if (mode === "hang") return new Promise((_, rej) => { if (opt.signal) opt.signal.addEventListener("abort", () => rej(opt.signal.reason)); });
    // תשובת שגיאה של Upstash מגיעה בלי `result`
    if (mode === "upstash-error") return { ok: true, json: async () => ({ error: "ERR max requests limit exceeded" }) };
    let res = null;
    if (cmd[0] === "HGET" && cmd[1] === "admin:overrides") res = OVR[cmd[2]] ?? null;
    else if (cmd[0] === "ZCARD") res = 1;
    else if (cmd[0] === "ZSCORE") res = String(Date.now());
    return { ok: true, json: async () => ({ result: res }) };
  }
  return { ok: true, status: 200, text: async () => SHEET };
};
const { default: handler } = await import(new URL("../api/access.js", import.meta.url));
const login = async (email) => { let out = null; await handler({ query: { email, device: "d1" }, headers: {} }, { status: () => ({ json: (j) => { out = j; } }), setHeader: () => {} }); return out; };

let pass = 0, fail = 0;
const ck = (n, c, x) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x ? "  → " + x : "")); } };

console.log("\nUpstash תקין: שום דבר לא משתנה, ואין degraded\n");
mode = "ok";
let r = await login("ext@test.com");
ck("מי שהמשרד האריך לה נכנסת", r.allowed === true, JSON.stringify(r));
r = await login("done@test.com");
ck("מי שהחלון שלה נגמר: expired", r.allowed === false && r.reason === "expired", JSON.stringify(r));
ck("**ובלי degraded, כי סימוני המשרד נקראו (ואין לה)**", r.degraded === false, JSON.stringify(r));
r = await login("cancel@test.com");
ck("מבוטלת: cancelled, בלי degraded", r.reason === "cancelled" && r.degraded === false, JSON.stringify(r));
r = await login("frozen@test.com");
ck("מוקפאת: frozen, בלי degraded", r.reason === "frozen" && r.degraded === false, JSON.stringify(r));
r = await login("ok@test.com");
ck("רגילה נכנסת", r.allowed === true, JSON.stringify(r));

for (const m of ["error", "hang", "upstash-error"]) {
  console.log(`\nUpstash במצב ${m}\n`);
  mode = m;
  r = await login("ext@test.com");
  ck(`${m}: מי שהמשרד האריך לה מקבלת expired, כמו קודם`, r.allowed === false && r.reason === "expired", JSON.stringify(r));
  ck(`**${m}: והתשובה מסומנת degraded**`, r.degraded === true, JSON.stringify(r));
  r = await login("done@test.com");
  ck(`${m}: גם חלון שנגמר באמת מסומן degraded, כי אי אפשר לדעת`, r.reason === "expired" && r.degraded === true, JSON.stringify(r));
  r = await login("ok@test.com");
  ck(`${m}: רגילה עדיין נכנסת`, r.allowed === true, JSON.stringify(r));
}

console.log("\nבאפליקציה\n");
const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
ck("**הבדיקה החוזרת אינה מוציאה על תשובה degraded**", /d\.allowed === false && !d\.degraded && ACCESS_RECHECK_BLOCK\.includes\(d\.reason\)/.test(app));
const load = app.slice(app.indexOf("const checkAccess"), app.indexOf("const checkAccess") + 4000);
ck("והטעינה עצמה לא נגעה: אין בה degraded", load.length > 100 && !/degraded/.test(load));

console.log(`\ndegraded-check: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
