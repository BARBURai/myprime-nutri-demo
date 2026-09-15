// "מה יש לה עכשיו": שורת הסיכום בכרטיס, וההיסטוריה שמתחתיה.
//
// **הבדיקה החשובה כאן אינה הטקסט אלא שהמסך והשער אינם יכולים לחלוק.** ב-v6.77
// שני הקבצים בחרו שורה אחרת מאותו גיליון, המסך הציג מחזור אחד והאפליקציה נתנה
// אחר, ואף מסך לא אמר שיש בעיה. מרגע שיש שני מוצרים ההזדמנות לאותה תקלה גדולה
// בהרבה, ולכן ההכרעה יושבת ב-`api/_product.js` ושניהם קוראים אותה.
//
// הבדיקה מריצה את `api/admin.js` ואת `api/access.js` האמיתיים על אותו גיליון
// מדומה ומשווה ביניהם, ומושכת את `stateBox` ואת `histBox` מתוך `public/admin.html`
// ומריצה אותן. בלי רשת.
//
//   node qa/state-box-check.mjs

import adminHandler from "../api/admin.js";
import accessHandler from "../api/access.js";
import { readFileSync } from "node:fs";

const KEY = "test-admin-key";
process.env.ADMIN_KEY = KEY;
process.env.ACCESS_SHEET_CSV_URL = "https://sheet.test/csv";
process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";

const HDR = 'ID,F_NAME,L_NAME,CF_EMAIL,360 - FINAL  PERSONAL START,ביטלה,קבוצה,חודשי גישה נוספים,בונוס איפור,GLOW-FULL,GLOW-FULL-M,GLOW-PAID,אפליקציית תזונה';
let CSV = HDR;
let store = { hash: {}, kv: {}, list: {} };

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.startsWith("https://sheet.test")) return { ok: true, text: async () => CSV };
  if (u.startsWith("https://api.manychat.com")) return { ok: true, json: async () => ({ status: "success", data: { id: 1, custom_fields: [], tags: [] } }) };
  const parts = u.replace("https://redis.test/", "").split("/").map(decodeURIComponent);
  const [cmd, a, b, c] = parts;
  const H = (k) => (store.hash[k] = store.hash[k] || {});
  let result = null;
  if (cmd === "HSET") { H(a)[b] = c; result = 1; }
  else if (cmd === "HSETNX") { if (H(a)[b] === undefined) { H(a)[b] = c; result = 1; } else result = 0; }
  else if (cmd === "HGET") result = H(a)[b] ?? null;
  else if (cmd === "HDEL") { delete H(a)[b]; result = 1; }
  else if (cmd === "HGETALL") { const o = H(a); result = Object.keys(o).flatMap((k) => [k, o[k]]); }
  else if (cmd === "KEYS") { const pre = String(a).replace(/\*$/, ""); result = Object.keys(store.kv).filter((k) => k.startsWith(pre)); }
  else if (cmd === "SET") { store.kv[a] = b; result = "OK"; }
  else if (cmd === "GET") result = store.kv[a] ?? null;
  else if (cmd === "DEL") { delete store.kv[a]; result = 1; }
  else result = 0;
  if (cmd === "ZRANGE" || cmd === "ZREVRANGE") result = [];
  return { ok: true, json: async () => ({ result }) };
};

function mkRes() {
  const r = { code: 0, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
const women = async () => {
  const res = mkRes();
  await adminHandler({ query: { key: KEY, all: "1" }, method: "GET", body: null }, res);
  return (res.body && res.body.women) || [];
};
const one = async (email) => (await women()).find((w) => w.email === email) || null;
const gate = async (email) => {
  const res = mkRes();
  await accessHandler({ query: { email, device: "d1" }, method: "GET" }, res);
  return res.body || {};
};

const sundayMonthsAgo = (n) => { const d = new Date(); d.setMonth(d.getMonth() - n); d.setDate(d.getDate() - d.getDay()); return d.toISOString().slice(0, 10); };
const monthsAgo = (n) => { const d = new Date(); d.setMonth(d.getMonth() - n); return d.toISOString().slice(0, 10); };
const row = ({ email, start = "", cancel = "FALSE", full = "", m = "", paid = "" }) =>
  `972500000001,רונית,לוי,${email},${start ? start + " 0:00:00" : ""},${cancel},א,3,FALSE,${full},${m},${paid},TRUE`;

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
};
const reset = () => { store = { hash: {}, kv: {}, list: {} }; };

// ── הרכיבים עצמם, נמשכים מהמסך ולא מועתקים ─────────────────────────────────
const HTML = readFileSync(new URL("../public/admin.html", import.meta.url), "utf8");
const grab = (name) => {
  const at = HTML.indexOf("\n  function " + name + "(w){");
  if (at === -1) throw new Error("לא נמצאה הפונקציה " + name + " ב-public/admin.html");
  let i = HTML.indexOf("{", HTML.indexOf("(w)", at)), depth = 0, end = i;
  for (; end < HTML.length; end++) {
    if (HTML[end] === "{") depth++;
    else if (HTML[end] === "}") { depth--; if (!depth) break; }
  }
  return HTML.slice(at, end + 1);
};
const helpers = `
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const il = (s) => { const p = String(s || "").match(/^(\\d{4})-(\\d{2})-(\\d{2})$/); return p ? p[3] + "." + p[2] + "." + p[1] : String(s || ""); };
  const lastSeen = (w) => w.seen ? "נכנסה " + il(w.seen) : "עוד לא נכנסה";
  const logLines = (w) => "<div class='log'>" + ((w.log || []).length ? "שורה" : "אין") + "</div>";
`;
const mod = new Function("return (function(){" + helpers + grab("stateBox") + grab("histBox") + "return { stateBox, histBox }; })()")();

console.log("\nהמסך והשער אינם יכולים לחלוק");
// **זו הבדיקה שהסעיף הזה קיים בשבילה.** אותה אישה, שני קבצים, אותה תשובה.
const CASES = [
  ["open360@t.com", { email: "open360@t.com", start: sundayMonthsAgo(1) }, null],
  ["gift@t.com", { email: "gift@t.com", start: sundayMonthsAgo(1), full: "TRUE" }, null],
  ["giftdone@t.com", { email: "giftdone@t.com", start: sundayMonthsAgo(20), full: "TRUE" }, null],
  ["paid@t.com", { email: "paid@t.com", start: sundayMonthsAgo(20), full: "TRUE", paid: "TRUE" }, null],
  ["solo@t.com", { email: "solo@t.com", full: "TRUE" }, null],
  ["cancel@t.com", { email: "cancel@t.com", start: sundayMonthsAgo(1), cancel: "TRUE", full: "TRUE", paid: "TRUE" }, null],
  ["plainend@t.com", { email: "plainend@t.com", start: sundayMonthsAgo(20) }, null],
  ["expglow@t.com", { email: "expglow@t.com", start: sundayMonthsAgo(20), full: "TRUE", paid: "TRUE" }, monthsAgo(14)],
];
for (const [em, spec, gs] of CASES) {
  reset();
  CSV = [HDR, row(spec)].join("\n");
  if (gs) store.hash["glow:start"] = { [em]: gs };
  const g = await gate(em);
  const w = await one(em);
  const st = (w && w.state) || {};
  check(em + " · אותה תשובה בשני הקבצים",
    !!w && st.allowed === (g.allowed === true) && (!g.allowed || st.product === g.product),
    "מסך " + st.product + "/" + st.allowed + " · שער " + g.product + "/" + g.allowed);
}

console.log("\nשורת הסיכום אומרת את מה שאושר");
{
  reset();
  CSV = [HDR, row({ email: "paid@t.com", start: sundayMonthsAgo(20), full: "TRUE", paid: "TRUE" })].join("\n");
  await gate("paid@t.com");
  const w = await one("paid@t.com");
  const h = mod.stateBox(w);
  check("הכותרת היא 'מה יש לה עכשיו'", h.includes("מה יש לה עכשיו"));
  check("שורת 360 קיימת", h.includes("מיי פריים 360"));
  check("שורת הקורס קיימת", h.includes("קורס האיפור המלא"));
  check("וכתוב שהוא נקנה", h.includes("נקנה"), h);
  check("ושורת המסך אומרת קורס האיפור בלבד", h.includes("קורס האיפור בלבד"), h);
  check("ו-360 מוצג כהסתיים", h.includes("הסתיים ב-"), h);
}
{
  reset();
  CSV = [HDR, row({ email: "gift@t.com", start: sundayMonthsAgo(1), full: "TRUE" })].join("\n");
  const w = await one("gift@t.com");
  const h = mod.stateBox(w);
  check("מתנת הוובינר מסומנת כמתנה", h.includes("מתנה מהוובינר"), h);
  check("וכתוב שהיא נגמרת יחד עם 360", h.includes("נגמר יחד עם 360"), h);
  check("והמסך שלה הוא התוכנית והקורס בתוכה", h.includes("התוכנית, והקורס בתוכה"), h);
}
{
  reset();
  CSV = [HDR, row({ email: "plain@t.com", start: sundayMonthsAgo(1) })].join("\n");
  const w = await one("plain@t.com");
  const h = mod.stateBox(w);
  // **השורה קיימת גם כשהתשובה היא "אין".** כלל v5.07: היעדר שורה אינו תשובה.
  check("שורת הקורס קיימת גם למי שאין לה קורס", h.includes("קורס האיפור המלא"), h);
  check("וכתוב בה 'אין'", /קורס האיפור המלא[\s\S]{0,80}אין/.test(h), h);
}
{
  reset();
  CSV = [HDR, row({ email: "done@t.com", start: sundayMonthsAgo(20) })].join("\n");
  const w = await one("done@t.com");
  const h = mod.stateBox(w);
  check("מי ששני המוצרים שלה סגורים מסומנת כחסומה", h.includes("חסומה, התוכנית הסתיימה"), h);
}
{
  reset();
  CSV = [HDR, row({ email: "new@t.com" })].join("\n");
  const w = await one("new@t.com");
  const h = mod.stateBox(w);
  check("מי שעוד לא שובצה למחזור נאמר לה את זה במפורש", h.includes("עוד לא שובצה למחזור"), h);
}

console.log("\nההיסטוריה, ובדרופדאון");
{
  reset();
  CSV = [HDR, row({ email: "paid@t.com", start: sundayMonthsAgo(20), full: "TRUE", paid: "TRUE" })].join("\n");
  await gate("paid@t.com");
  const w = await one("paid@t.com");
  const h = mod.histBox(w);
  check("היא בתוך details ולא פרושה על המסך", h.startsWith("<details"), h.slice(0, 40));
  check("והכותרת שלה 'היסטוריה'", h.includes("<summary>היסטוריה</summary>"));
  check("הצטרפה לתוכנית", h.includes("הצטרפה לתוכנית"));
  check("סיימה את התוכנית", h.includes("סיימה את התוכנית"));
  check("נכנסה לקורס לראשונה", h.includes("נכנסה לקורס לראשונה"), h);
  check("הקורס נגמר", h.includes("הקורס נגמר"), h);
  check("נכנסה לאחרונה", h.includes("נכנסה לאחרונה"));
  check("ויומן השינויים בתוכה", h.includes("שינויים שנעשו כאן"));
  // **תאריך הקנייה אינו קיים אצלנו**, ולכן אסור שהמסך יקרא לזה קנייה.
  check("לא נאמר בשום מקום 'תאריך קנייה' כאילו הוא ידוע", !/נקנה ב-|תאריך הקנייה:/.test(h), h);
  check("ונאמר במפורש שזה היום הראשון ולא הקנייה", h.includes("היום הראשון שבו היא נכנסה לקורס"), h);
}
{
  reset();
  CSV = [HDR, row({ email: "plain@t.com", start: sundayMonthsAgo(1) })].join("\n");
  const w = await one("plain@t.com");
  const h = mod.histBox(w);
  check("למי שאין קורס אין שורות של קורס", !h.includes("נכנסה לקורס לראשונה"), h);
}

console.log("\nמסך הפתיחה תקף גם לקונת הקורס");
{
  const APP = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  check("הכותרת היא 'ברוכה הבאה לאפליקציית מיי פריים'", APP.includes("ברוכה הבאה לאפליקציית מיי פריים"));
  // רון: "צריך פשוט לשנות את השם כדי שזה יהיה תקף בכל מקרה." קונת הקורס אין לה
  // יומן מעקב בכלל, ומסך הפתיחה הזה נראה לה בכל טעינה.
  check("ואינה מבטיחה יומן מעקב למי שאין לה", !APP.includes("ברוכה הבאה לאפליקציית המעקב היומי"));
}

console.log(`\n${pass} מתוך ${pass + fail} עברו.\n`);
process.exit(fail ? 1 : 0);
