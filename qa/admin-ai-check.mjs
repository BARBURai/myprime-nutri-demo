// qa/admin-ai-check.mjs · v7.41
//
// **רון, 23 בספטמבר 2026, על נילי קוניאק: "איך אני יכול לדעת כמה תמונות היא בפועל צרכה?"**
// שורה במסך הניהול שמציגה את שני המונים ש-api/ai.js עוצר לפיהם. הבדיקה מריצה את
// api/admin.js האמיתי מול גיליון מדומה ו-Redis מדומה, **ומושכת את aiBox מתוך
// public/admin.html ומריצה אותה**, ולא מעתיקה.
//
//   node qa/admin-ai-check.mjs

import { readFileSync } from "node:fs";

const KEY = "k";
process.env.ADMIN_KEY = KEY;
process.env.ACCESS_SHEET_CSV_URL = "https://sheet.test/csv";
process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x ? "  →  " + x : "")); } };

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const CSV = [
  "ID,F_NAME,L_NAME,CF_EMAIL,360 - FINAL  PERSONAL START,ביטלה,קבוצה,אפליקציית תזונה",
  "1,נילי,א,nili@t.co,2026-09-06 0:00:00,FALSE,א,TRUE",
  "2,רות,ב,ruth@t.co,2026-09-06 0:00:00,FALSE,א,TRUE",
  "3,דנה,ג,dana@t.co,2026-09-06 0:00:00,FALSE,א,",
  "4,שרה,ד,OLD@t.co,2026-09-06 0:00:00,FALSE,א,TRUE",
].join("\n");

const kv = {
  "ai:photos:nili@t.co": "70",
  [`ai:day:nili@t.co:${today}`]: "4",
  "ai:photos:ruth@t.co": "23",
  "ai:photos:new@t.co": "9",     // שרה עברה לכתובת חדשה, והאפליקציה סופרת תחתיה
  "ai:photos:dana@t.co": "5",    // דנה בקג'אבי: המונה קיים ובכל זאת לא מוצג
};
const hash = { "admin:emailmap": { "new@t.co": "old@t.co" } };
let mgetFails = false, mgetCalls = 0, mgetMax = 0, writes = 0;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith("https://sheet.test")) return { ok: true, status: 200, text: async () => CSV };
  if (opts && opts.method === "POST" && opts.body) {
    const cmd = JSON.parse(opts.body);
    if (cmd[0] === "MGET") {
      mgetCalls++; mgetMax = Math.max(mgetMax, cmd.length - 1);
      if (mgetFails) return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, json: async () => ({ result: cmd.slice(1).map((k) => kv[k] ?? null) }) };
    }
    if (/^(SET|INCR|DEL|HSET|HDEL|EXPIRE)$/.test(cmd[0])) writes++;
    return { ok: true, json: async () => ({ result: null }) };
  }
  const [cmd, a, b] = u.replace("https://redis.test/", "").split("/").map(decodeURIComponent);
  if (/^(SET|INCR|DEL|HSET|HDEL|EXPIRE|HINCRBY)$/.test(cmd)) writes++;
  let result = null;
  if (cmd === "HGETALL") { const o = hash[a] || {}; result = Object.entries(o).flat(); }
  else if (cmd === "HGET") result = (hash[a] || {})[b] ?? null;
  else if (cmd === "KEYS") result = [];
  else if (cmd === "GET") result = kv[a] ?? null;
  return { ok: true, json: async () => ({ result }) };
};

const admin = (await import("../api/admin.js")).default;
const ai = await import("../api/ai.js");
const call = async () => { const r = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, setHeader() {} }; await admin({ query: { key: KEY }, method: "GET", body: null, headers: {} }, r); return r; };

console.log("\nהשרת");
let r = await call();
const W = (em) => (r.body.women || []).find((w) => w.email === em);
ok("התקרות נלקחות מ-api/ai.js עצמו", r.body.aiLimits && r.body.aiLimits.photos === ai.PHOTO_LIMIT && r.body.aiLimits.day === ai.DAILY_LIMIT, JSON.stringify(r.body.aiLimits));
ok("נילי: 70 תמונות ו-4 פניות היום", W("nili@t.co") && W("nili@t.co").ai && W("nili@t.co").ai.photos === 70 && W("nili@t.co").ai.today === 4, JSON.stringify(W("nili@t.co") && W("nili@t.co").ai));
ok("רות: 23 תמונות, ואפס היום כשאין מונה", W("ruth@t.co").ai.photos === 23 && W("ruth@t.co").ai.today === 0);
ok("מי שהכתובת שלה הוחלפה נספרת תחת הכתובת החדשה", W("old@t.co") && W("old@t.co").ai && W("old@t.co").ai.photos === 9, JSON.stringify(W("old@t.co") && W("old@t.co").ai));
ok("אישה בקג'אבי לא נקראת בכלל", W("dana@t.co") && !W("dana@t.co").ai);
ok("המסך אינו כותב שום דבר ל-Redis", writes === 0, writes + " כתיבות");

mgetFails = true;
r = await call();
ok("כשהקריאה נכשלת: אין מספר, ולא אפס", r.code === 200 && !W("nili@t.co").ai);
mgetFails = false;

// 450 נשים: שלוש קריאות של 200 לכל מונה, ולא כתובת אחת ענקית
const rows = ["ID,F_NAME,L_NAME,CF_EMAIL,360 - FINAL  PERSONAL START,ביטלה,קבוצה,אפליקציית תזונה"];
for (let i = 0; i < 450; i++) rows.push(`${1000 + i},א,ב,w${i}@t.co,2026-09-06 0:00:00,FALSE,א,TRUE`);
const saveCsv = CSV;
globalThis.__csv = rows.join("\n");
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => String(url).startsWith("https://sheet.test") ? { ok: true, status: 200, text: async () => globalThis.__csv } : realFetch(url, opts);
mgetCalls = 0; mgetMax = 0;
r = await call();
ok("450 נשים נקראות בקבוצות של 200 לכל היותר", mgetMax <= 200 && mgetCalls === 6, `קריאות ${mgetCalls}, הגדולה ${mgetMax}`);

console.log("\nהמסך");
const HTML = readFileSync(new URL("../public/admin.html", import.meta.url), "utf8");
const at = HTML.indexOf("function aiBox(w)");
ok("aiBox קיימת במסך", at > 0);
let i = HTML.indexOf("{", at), depth = 0, end = i;
for (; end < HTML.length; end++) { if (HTML[end] === "{") depth++; else if (HTML[end] === "}") { depth--; if (!depth) break; } }
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const aiBox = new Function("esc", "DATA", HTML.slice(at, end + 1) + "; return aiBox;")(esc, { aiLimits: { photos: 70, day: 30 } });
const nili = aiBox({ newApp: true, ai: { photos: 70, today: 4 } });
ok("נילי: 70 מתוך 70, הגיעה למכסה, באדום", nili.includes("70 מתוך 70 · הגיעה למכסה") && nili.includes("#C0392B"));
ok("ופניות היום: 4 מתוך 30", nili.includes("4 מתוך 30"));
const ruth = aiBox({ newApp: true, ai: { photos: 23, today: 0 } });
ok("רות: 23 מתוך 70, בלי אדום", ruth.includes("23 מתוך 70") && !ruth.includes("#C0392B"));
ok("אפס מוצג כאפס", ruth.includes("0 מתוך 30"));
const unknown = aiBox({ newApp: true });
ok("בלי נתון: 'לא ידוע' בשתי השורות, ולא אפס", (unknown.match(/לא ידוע/g) || []).length === 2 && !unknown.includes("מתוך"));
ok("קג'אבי: אין קופסה בכלל", aiBox({ newApp: false, ai: { photos: 3, today: 1 } }) === "");
ok("הקופסה מרונדרת בכרטיס, מתחת ל'מה יש לה עכשיו'", /stateBox\(w\)\+\s*aiBox\(w\)\+/.test(HTML));

console.log(`\n${pass} מתוך ${pass + fail} עברו`);
process.exit(fail ? 1 : 0);
