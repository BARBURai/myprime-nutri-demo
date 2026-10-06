// רשימת מסך הניהול יוצאת דחוסה, v7.82. מריצה את api/admin.js האמיתי מול גיליון מדומה ומול
// Redis מדומה, בלי רשת. השאלה שקובעת: **מה שהדפדפן פותח זהה תו בתו למה שנשלח עד כה.**
//
//   node qa/admin-gzip-check.mjs

import { gunzipSync } from "node:zlib";

const KEY = "gzip-key";
process.env.ADMIN_KEY = KEY;
process.env.ACCESS_SHEET_CSV_URL = "https://sheet.test/csv";
process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";
delete process.env.MANYCHAT_TOKEN;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name + (extra !== undefined ? "  →  " + extra : "")); } };

// 5,000 נשים, כלומר מעל המקום שבו התשובה הייתה עוברת את 4.5MB. כתובות עבריות בשמות, כמו בגיליון.
const HEAD = "ID,F_NAME,L_NAME,CF_EMAIL,360 - FINAL  PERSONAL START,ביטלה,קבוצה,חודשי גישה נוספים,SOLO10WEEK";
const N = 5000;
const rows = [HEAD];
for (let i = 0; i < N; i++) rows.push(`9725${String(i).padStart(8, "0")},שם${i},משפחה,w${i}@t.co,2026-09-06 12:00:00,${i % 50 ? "FALSE" : "TRUE"},${"אבגדה"[i % 5]},${i % 7 ? "" : 5},${i % 9 ? "" : "TRUE"}`);
const CSV = rows.join("\n");

const hash = { "admin:seen": {}, "admin:overrides": {} };
for (let i = 0; i < N; i += 3) hash["admin:seen"][`w${i}@t.co`] = "2026-09-20";
hash["admin:overrides"]["w1@t.co"] = JSON.stringify({ until: "2027-01-01", by: "טלי", log: [{ at: "x", by: "טלי", what: "הארכה" }] });

globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith("https://sheet.test")) return { ok: true, status: 200, text: async () => CSV };
  const cmd = opts && opts.body ? JSON.parse(opts.body) : u.replace("https://redis.test/", "").split("/").map(decodeURIComponent);
  const [c, a, ...rest] = cmd;
  let result = null;
  if (c === "HGETALL") result = Object.entries(hash[a] || {}).flat();
  else if (c === "HGET") result = (hash[a] || {})[rest[0]] ?? null;
  else if (c === "SMEMBERS") result = [];
  else if (c === "MGET") result = [a, ...rest].map(() => null);
  else if (c === "GET" && a === "admin:appold:done") result = "1";
  return { ok: true, status: 200, json: async () => ({ result }) };
};

const { default: handler } = await import(new URL("../api/admin.js", import.meta.url));

// תשובה כמו של Node: setHeader, statusCode ו-end, ובנוסף status().json() של וורסל.
function nodeRes() {
  const r = { headers: {}, statusCode: 0, body: null, json: null };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.end = (b) => { r.body = b; return r; };
  r.status = (c) => { r.statusCode = c; return { json: (j) => { r.json = j; return r; } }; };
  return r;
}
const call = async (headers, res = nodeRes()) => { await handler({ method: "GET", query: { key: KEY }, headers, body: null }, res); return res; };

console.log("\nהרשימה דחוסה רק כשהדפדפן מבקש\n");
const plain = await call({});
ok("בלי בקשת דחיסה: התשובה הרגילה", plain.statusCode === 200 && plain.json && plain.json.ok === true && !plain.headers["content-encoding"]);
ok("ובה כל הנשים", plain.json && plain.json.women.length === N, plain.json && plain.json.women.length);
const plainText = JSON.stringify(plain.json);
const bytes = Buffer.byteLength(plainText);
ok("**בלי דחיסה התשובה עוברת את 4.5MB**, כלומר הבדיקה בודקת את המקרה האמיתי", bytes > 4500000, bytes);

const gz = await call({ "accept-encoding": "gzip, deflate, br" });
ok("עם בקשת דחיסה: Content-Encoding gzip", gz.headers["content-encoding"] === "gzip");
ok("ו-Content-Type של JSON", /application\/json/.test(gz.headers["content-type"] || ""));
ok("ו-Vary, כדי שמטמון לא יגיש דחוסה למי שלא ביקש", gz.headers["vary"] === "Accept-Encoding");
ok("קוד 200", gz.statusCode === 200);
let opened = "";
try { opened = gunzipSync(gz.body).toString("utf8"); } catch (e) { opened = "ERR " + e.message; }
const reread = (() => { try { return JSON.parse(opened); } catch (e) { return null; } })();
ok("**מה שנפתח זהה תו בתו לתשובה הרגילה**", reread && JSON.stringify(reread) === plainText, opened.slice(0, 80));
ok("**ודחוסה היא מתחת ל-4.5MB בהרבה**", !!gz.body && gz.body.length < 1000000, gz.body && gz.body.length);
console.log(`    (${bytes} בתים בלי דחיסה, ${gz.body ? gz.body.length : 0} דחוסה)`);

const caps = await call({ "Accept-Encoding": "gzip" });
ok("כותרת באותיות גדולות נקראת גם", caps.headers["content-encoding"] === "gzip");
const brOnly = await call({ "accept-encoding": "br" });
ok("דפדפן שמבקש רק br מקבל את התשובה הרגילה", !brOnly.headers["content-encoding"] && brOnly.json && brOnly.json.women.length === N);
const noEnd = { status: (c) => ({ json: (j) => { noEnd.code = c; noEnd.j = j; } }) };
await handler({ method: "GET", query: { key: KEY }, headers: { "accept-encoding": "gzip" }, body: null }, noEnd);
ok("תשובה בלי end נופלת לתשובה הרגילה ולא נשברת", noEnd.code === 200 && noEnd.j && noEnd.j.ok === true);

console.log("\nשאר הנתיבים לא נגעו\n");
const bad = nodeRes();
await handler({ method: "GET", query: { key: "wrong" }, headers: { "accept-encoding": "gzip" }, body: null }, bad);
ok("מפתח שגוי: 401 רגיל, לא דחוס", bad.statusCode === 401 && !bad.headers["content-encoding"]);
const st = nodeRes();
await handler({ method: "GET", query: { key: KEY, mcstatus: "1" }, headers: { "accept-encoding": "gzip" }, body: null }, st);
ok("mcstatus: תשובה רגילה, לא דחוסה", st.statusCode === 200 && st.json && !st.headers["content-encoding"]);

console.log(`\n${pass} מתוך ${pass + fail} עברו.`);
process.exit(fail ? 1 : 0);
