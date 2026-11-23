// v8.65: לשונית "תשלומים" בכרטיס במסך הניהול. השרת שלנו פונה לדף התשלום עם APP_REF_KEY,
// מסנן את מה שחוזר, ומחזיר למסך. מריצה את api/admin.js האמיתי מול דף תשלום ו-Redis
// מדומים, ומושכת את payPanel מתוך public/admin.html ומריצה אותה. בלי רשת.
//
//   node qa/payments-check.mjs

import fs from "node:fs";
import adminHandler from "../api/admin.js";
import { cleanTx, fetchPayments, PAY_STATS_URL } from "../api/_payments.js";

const KEY = "test-admin-key";
process.env.ADMIN_KEY = KEY;
process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";
process.env.APP_REF_KEY = "ref-secret";

const store = { hash: {}, kv: {} };
let payCalls = [], payMode = "ok", redisWrites = 0;
const TX = [
  { tranId: 1, at: "2026-11-19T22:27:00", amount: 49, payments: 1, refund: false, dealType: "Debit", doc: "1001", docUrl: "https://cardcom.test/doc/1001", last4: "1234", cardNumber: "4580123412341234", token: "tok-secret", tz: "123456789" },
  { tranId: 2, at: "2026-11-20T10:00:00", amount: -49, payments: 1, refund: true, dealType: "Credit", doc: "1002", docUrl: "javascript:alert(1)", last4: "12345" },
  { tranId: 3, at: "2026-10-01T09:05:00", amount: 1490, payments: 10, refund: false, dealType: "Debit", doc: "1003", docUrl: "https://cardcom.test/doc/1003", last4: "9876" },
  { tranId: 4, at: "לא תאריך", amount: 10 },
];
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith(PAY_STATS_URL)) {
    payCalls.push({ url: u, key: opts && opts.headers && opts.headers["x-ref-key"] });
    if (payMode === "down") return { ok: false, status: 502, json: async () => ({ ok: false }) };
    if (payMode === "bad") return { ok: true, json: async () => ({ ok: false, why: "cardcom" }) };
    if (payMode === "hang") return new Promise((_, rej) => opts.signal.addEventListener("abort", () => rej(new Error("aborted"))));
    if (payMode === "none") return { ok: true, json: async () => ({ ok: true, days: 120, transactions: [] }) };
    return { ok: true, json: async () => ({ ok: true, days: 120, transactions: TX }) };
  }
  const [cmd, a, b, c] = u.replace("https://redis.test/", "").split("/").map(decodeURIComponent);
  const H = (k) => (store.hash[k] = store.hash[k] || {});
  let result = null;
  if (cmd === "HGET") result = H(a)[b] ?? null;
  else if (cmd === "HGETALL") { const o = H(a); result = Object.keys(o).flatMap((k) => [k, o[k]]); }
  else if (cmd === "HSET") { redisWrites++; H(a)[b] = c; result = 1; }
  else if (cmd === "GET") result = store.kv[a] ?? null;
  else if (cmd === "SET") { redisWrites++; store.kv[a] = b; result = "OK"; }
  return { ok: true, json: async () => ({ result }) };
};

const mkRes = () => { const r = { code: 0, body: null }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.setHeader = () => {}; r.send = (b) => { r.body = b; return r; }; return r; };
const get = async (key, q) => { const res = mkRes(); await adminHandler({ method: "GET", query: { key, ...q }, headers: {} }, res); return res; };

let pass = 0, fail = 0;
const check = (name, cond, extra) => { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); } };

console.log("\nהשרת");
{
  payCalls = []; payMode = "ok";
  const r = await get(KEY, { payments: "Dana@Test.com", phone: "054-123-4567" });
  check("מחזיר את העסקאות", r.body.ok === true && r.body.transactions.length === 3, JSON.stringify(r.body));
  check("**פנה לדף התשלום בייצור, עם המפתח בכותרת**", payCalls.length === 1 && payCalls[0].key === "ref-secret");
  check("המפתח אינו בכתובת", !payCalls[0].url.includes("ref-secret"));
  check("הטלפון והמייל נשלחו, נקיים", payCalls[0].url.includes("phone=0541234567") && payCalls[0].url.includes("email=dana%40test.com"));
  check("cctx ושנה אחורה, 365 יום", payCalls[0].url.includes("format=cctx") && payCalls[0].url.includes("days=365"));
  const t = r.body.transactions[0];
  check("**מספר כרטיס מלא, טוקן ות\"ז אינם עוברים**", !("cardNumber" in t) && !("token" in t) && !("tz" in t) && !JSON.stringify(r.body).includes("4580123412341234"));
  check("שורה תקינה נשמרת כמו שהיא", t.amount === 49 && t.last4 === "1234" && t.docUrl === "https://cardcom.test/doc/1001" && t.payments === 1);
  const ref = r.body.transactions[1];
  check("זיכוי מסומן", ref.refund === true && ref.amount === -49);
  check("**קישור שאינו https אינו עובר**", ref.docUrl === "");
  check("ארבע ספרות בלבד", ref.last4 === "");
  check("שורה בלי תאריך נזרקת", !r.body.transactions.some((x) => x.at === "לא תאריך"));
  check("שום דבר לא נכתב אצלנו", redisWrites === 0, String(redisWrites));
}
{
  const made = mkRes();
  await adminHandler({ query: { key: KEY }, method: "POST", body: { newCode: "טלי", by: "רון" }, headers: {} }, made);
  const tali = made.body && made.body.code;
  payCalls = []; redisWrites = 0;
  const r = await get(tali, { payments: "dana@test.com", phone: "0541234567" });
  check("**קוד של פקידה רואה את התשלומים**", r.code === 200 && r.body.ok === true && r.body.transactions.length === 3, JSON.stringify(r.body));
  payCalls = [];
  const n = await get("made-up", { payments: "dana@test.com" });
  check("בלי מפתח: 401, ושום פנייה לדף התשלום", n.code === 401 && payCalls.length === 0);
}
{
  payMode = "down"; const a = await get(KEY, { payments: "dana@test.com" });
  check("דף התשלום נפל: pay_failed", a.body.ok === false && a.body.error === "pay_failed");
  payMode = "bad"; const b = await get(KEY, { payments: "dana@test.com" });
  check("דף התשלום ענה ok:false: pay_failed", b.body.ok === false && b.body.error === "pay_failed");
  payMode = "none"; const c = await get(KEY, { payments: "dana@test.com" });
  check("אין עסקאות: רשימה ריקה ולא תקלה", c.body.ok === true && c.body.transactions.length === 0);
  payMode = "ok";
  const saved = process.env.APP_REF_KEY; delete process.env.APP_REF_KEY; payCalls = [];
  const d = await get(KEY, { payments: "dana@test.com" });
  check("בלי APP_REF_KEY: off, ושום פנייה", d.body.ok === false && d.body.error === "off" && payCalls.length === 0);
  process.env.APP_REF_KEY = saved;
  const e = await get(KEY, { payments: "" });
  check("בלי מייל ובלי טלפון: אין פנייה", e.body.ok === false && e.body.error === "bad_request");
}
{
  payMode = "hang";
  const t0 = Date.now();
  const r = await fetchPayments({ email: "dana@test.com" }, { key: "k", timeoutMs: 200 });
  check("**דף תשלום שאינו עונה נחתך בתקרת הזמן**", r.ok === false && r.error === "pay_failed" && Date.now() - t0 < 2000, String(Date.now() - t0));
  payMode = "ok";
}
check("cleanTx: סכום שאינו מספר נזרק", cleanTx({ at: "2026-11-01", amount: "abc" }) === null);
check("cleanTx: תשלומים מוגבלים ל-36", cleanTx({ at: "2026-11-01", amount: 1, payments: 999 }).payments === 36);

console.log("\nהמסך");
{
  const html = fs.readFileSync(new URL("../public/admin.html", import.meta.url), "utf8");
  check("הלשונית ברשימת הלשוניות, אחרי שימוש", html.includes('["usage","שימוש"],["pay","תשלומים"]'));
  const grab = (name) => { const i = html.indexOf("function " + name + "("); if (i < 0) return ""; let d = 0, j = html.indexOf("{", i); for (let k = j; k < html.length; k++) { if (html[k] === "{") d++; else if (html[k] === "}") { d--; if (!d) return html.slice(i, k + 1); } } return ""; };
  const code = ["payStamp", "payAmount", "payPanel"].map(grab).join("\n");
  check("שלוש הפונקציות נמשכו", code.includes("payPanel") && code.includes("payStamp") && code.includes("payAmount"));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  let loads = 0;
  const PAY = {};
  const run = new Function("PAY", "esc", "payLoad", code + "; return payPanel;")(PAY, esc, (w) => { loads++; PAY[w.email] = { state: "loading" }; });
  const w = { email: "dana@test.com" };
  check("טעינה ראשונה מציגה את נוסח הטעינה", run(w).includes("טוען תשלומים מקארדקום...") && loads === 1);
  run(w); check("ולא טוענת שוב בזמן שהיא רצה", loads === 1);
  PAY[w.email] = { state: "ok", days: 120, tx: [cleanTx(TX[0]), cleanTx(TX[1]), cleanTx(TX[2])] };
  const okHtml = run(w);
  check("**השורה בנוסח שאושר**", okHtml.includes("19.11.2026 22:27 · 49 ₪ · תשלום אחד · כרטיס 1234 · <a"), okHtml.slice(0, 300));
  check("קישור לחשבונית", okHtml.includes('href="https://cardcom.test/doc/1001"') && okHtml.includes(">חשבונית</a>"));
  check("**השורה \"מוצגים התשלומים מהשנה האחרונה בלבד.\" מעל הרשימה**", okHtml.includes('<div class="paynote">מוצגים התשלומים מהשנה האחרונה בלבד.</div>'));
  check("זיכוי באדום, עם מינוס", /class="payref">זיכוי · ‎-49 ₪/.test(okHtml));
  check("עשרה תשלומים, ופסיק באלפים", okHtml.includes("1,490 ₪ · 10 תשלומים"));
  check("בזיכוי בלי קישור תקין אין קישור", !okHtml.includes("javascript:"));
  PAY[w.email] = { state: "ok", days: 120, tx: [] };
  check("**אין תשלומים: הנוסח שאושר**", run(w).includes("לא נמצאו תשלומים בשנה האחרונה לפי הטלפון והמייל שלה. אם היא שילמה עם פרטים של מישהו אחר, התשלום לא יופיע כאן."));
  PAY[w.email] = { state: "failed", t: Date.now() };
  check("**תקלה: הנוסח שאושר, בלי טעינה חוזרת מיד**", run(w).includes("קארדקום לא ענה. אפשר לנסות שוב בעוד רגע.") && loads === 1);
  PAY[w.email] = { state: "failed", t: Date.now() - 16000 };
  run(w); check("ואחרי 15 שניות מנסה שוב", loads === 2);
  PAY[w.email] = { state: "off" };
  check("בלי מפתח: אומר שהחיבור לא מוגדר", run(w).includes("החיבור לקארדקום לא מוגדר."));
}

console.log(`\n${pass} עברו, ${fail} נכשלו`);
process.exit(fail ? 1 : 0);
