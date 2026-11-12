/* ============================================================================
   שלושה עותקים אחורה של הגיבוי, ומונה שימוש. v8.49.

   הכתובת `api/backup.js` פתוחה לכל מי שיודע מייל רשום, ולכן כל אחד יכול לדרוס גיבוי.
   הבדיקה מריצה את `api/backup.js` האמיתי מול גיליון מדומה ומול Redis מדומה, בלי רשת,
   ושואלת:
     א. אחרי דריסה, הגיבוי הקודם נשמר ברשימה, ועד שלושה בלבד
     ב. שמירה ושחזור רגילים מחזירים בדיוק מה שהחזירו קודם
     ג. תקלה ברשימה או במונה לעולם אינה מכשילה גיבוי
     ד. המונה סופר ואינו חוסם
     ה. מי שאינה רשומה אינה משאירה שום עקבה

   node qa/backup-hist-check.mjs
   אפשר להריץ מול גרסה אחרת של הקובץ: BK_FILE=/path/to/backup.js
   ========================================================================== */
import { pathToFileURL } from "node:url";

process.env.ACCESS_SHEET_CSV_URL = "https://sheet.test/csv";
process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";
delete process.env.RESEND_API_KEY;

const file = process.env.BK_FILE ? pathToFileURL(process.env.BK_FILE).href : new URL("../api/backup.js", import.meta.url).href;
const handler = (await import(file)).default;

const CSV = "ID,F_NAME,CF_EMAIL,360 - FINAL  PERSONAL START\n972501111111,יפית,a@test.com,2026-11-01";
let kv = {}, lists = {}, hashes = {}, failOn = null, cmds = [];
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith("https://sheet.test")) return { ok: true, text: async () => CSV };
  if (u.startsWith("https://api.resend.com")) return { ok: true };
  const [cmd, a, b, c] = JSON.parse(opts.body);
  cmds.push(cmd);
  if (failOn && failOn.includes(cmd)) throw new Error("redis " + cmd + " down");
  let result = null;
  if (cmd === "GET") result = kv[a] ?? null;
  else if (cmd === "SET") { kv[a] = b; result = "OK"; }
  else if (cmd === "LPUSH") { (lists[a] = lists[a] || []).unshift(b); result = lists[a].length; }
  else if (cmd === "LTRIM") { lists[a] = (lists[a] || []).slice(+b, +c + 1); result = "OK"; }
  else if (cmd === "HINCRBY") { const h = (hashes[a] = hashes[a] || {}); h[b] = (h[b] || 0) + +c; result = h[b]; }
  else if (cmd === "HGET") result = (hashes[a] || {})[b] ?? null;
  else if (cmd === "EXPIRE") result = 1;
  return { ok: true, json: async () => ({ result }) };
};
const reset = () => { kv = {}; lists = {}; hashes = {}; failOn = null; cmds = []; };
const call = async (method, data) => {
  let out = null;
  const res = { status: () => res, json: (d) => { out = d; return res; } };
  await handler(method === "GET" ? { method, query: data, headers: {} } : { method, query: {}, body: data, headers: {} }, res);
  return out;
};
const blob = (n) => ({ ct: "ct" + n, salt: "s" + n, iv: "i" + n, v: 1 });
const save = (n, email = "a@test.com") => call("POST", { email, blob: blob(n) });

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name + (extra ? "  →  " + extra : "")); } };
const H = "bk:hist:a@test.com";
const useKey = () => Object.keys(hashes).find((k) => k.startsWith("bk:use:"));

console.log("\nא. העותקים הקודמים");
reset();
await save(1);
ok("שמירה ראשונה אינה יוצרת רשימה", !lists[H]);
await save(2);
ok("אחרי דריסה, הגיבוי הקודם ברשימה", lists[H] && lists[H].length === 1 && JSON.parse(lists[H][0]).ct === "ct1", JSON.stringify(lists[H]));
await save(3); await save(4); await save(5);
ok("לכל היותר שלושה", (lists[H] || []).length === 3, String(lists[H] && lists[H].length));
ok("החדש ביותר ראשון: 4, 3, 2", (lists[H] || []).map((x) => JSON.parse(x).ct).join(",") === "ct4,ct3,ct2");
ok("הגיבוי עצמו הוא האחרון", JSON.parse(kv["bk:a@test.com"]).ct === "ct5");
await save(5);
ok("גיבוי זהה לקודם אינו נדחף", (lists[H] || []).map((x) => JSON.parse(x).ct).join(",") === "ct4,ct3,ct2");

console.log("\nב. ההתנהגות הרגילה לא השתנתה");
reset();
const r1 = await save(7);
ok("שמירה מחזירה ok", r1 && r1.ok === true && r1.mailed === false, JSON.stringify(r1));
const g = await call("GET", { email: "a@test.com" });
ok("שחזור מחזיר את הגיבוי האחרון", g && g.ok && g.exists && g.blob && g.blob.ct === "ct7", JSON.stringify(g));
reset();
const g0 = await call("GET", { email: "a@test.com" });
ok("אין גיבוי: exists false", g0 && g0.ok === true && g0.exists === false, JSON.stringify(g0));
const bad = await call("POST", { email: "a@test.com", blob: { ct: "x" } });
ok("גיבוי חסר: no_blob ושום כתיבה", bad && bad.reason === "no_blob" && !kv["bk:a@test.com"] && !lists[H]);

console.log("\nג. תקלה ברשימה או במונה אינה מכשילה גיבוי");
reset(); await save(1);
failOn = ["LPUSH", "LTRIM"];
const r2 = await save(2);
ok("LPUSH נכשל: השמירה עדיין מצליחה", r2 && r2.ok === true && JSON.parse(kv["bk:a@test.com"]).ct === "ct2", JSON.stringify(r2));
failOn = ["HINCRBY"];
const r3 = await save(3);
ok("המונה נכשל: השמירה עדיין מצליחה", r3 && r3.ok === true && JSON.parse(kv["bk:a@test.com"]).ct === "ct3");
const g2 = await call("GET", { email: "a@test.com" });
ok("המונה נכשל: השחזור עדיין עובד", g2 && g2.exists && g2.blob.ct === "ct3");
failOn = null;

console.log("\nד. המונה סופר ואינו חוסם");
reset();
for (let i = 0; i < 40; i++) await save(i);
for (let i = 0; i < 40; i++) await call("GET", { email: "a@test.com" });
const u = hashes[useKey()] || {};
ok("40 שמירות נספרו", u["post:a@test.com"] === 40, JSON.stringify(u));
ok("40 קריאות נספרו", u["get:a@test.com"] === 40);
const last = await call("GET", { email: "a@test.com" });
ok("גם אחרי 40 אין חסימה", last && last.exists && last.blob.ct === "ct39");
ok("המפתח לפי יום בישראל", /^bk:use:\d{4}-\d{2}-\d{2}$/.test(useKey() || ""), useKey());

console.log("\nה. מי שאינה רשומה");
reset();
const nr = await call("POST", { email: "stranger@test.com", blob: blob(1) });
ok("not_registered", nr && nr.reason === "not_registered");
ok("שום כתיבה: לא גיבוי, לא רשימה, לא מונה", !Object.keys(kv).some((k) => k.startsWith("bk:")) && !Object.keys(lists).length && !Object.keys(hashes).length);

console.log(`\n${pass} מתוך ${pass + fail} עברו`);
process.exit(fail ? 1 : 0);
