// המתג של קורס האיפור המלא בהרשאות, ומה הוא עושה בפועל.
//
// **הפער שזה סוגר:** עד v7.14 המתג היחיד לקורס המלא ישב בבלוק של מניצ'ט, ולכן
// הוא נעלם לגמרי כשמניצ'ט לא מצא אותה לפי הטלפון, **וגם כשהוא כן הופיע השינוי
// הגיע לאפליקציה רק אחרי שמניצ'ט ייצא לגיליון.** הבונוס תמיד עבד אחרת: נשמר
// אצלנו וחל בכניסה הבאה. עכשיו שניהם זהים.
//
// הבדיקה מריצה את `api/admin.js` ואת `api/access.js` האמיתיים מול גיליון מדומה
// ומול Redis מדומה, ומושכת את `tabPerm` מתוך `public/admin.html`. בלי רשת.
//
//   node qa/glowfull-toggle-check.mjs

import adminHandler from "../api/admin.js";
import accessHandler from "../api/access.js";
import { readFileSync } from "node:fs";

const KEY = "test-admin-key";
process.env.ADMIN_KEY = KEY;
process.env.ACCESS_SHEET_CSV_URL = "https://sheet.test/csv";
process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";
process.env.MANYCHAT_TOKEN = "mc-test";

const HDR = 'ID,F_NAME,L_NAME,CF_EMAIL,360 - FINAL  PERSONAL START,ביטלה,קבוצה,חודשי גישה נוספים,בונוס איפור,GLOW-FULL,GLOW-FULL-M,GLOW-PAID,אפליקציית תזונה';
let CSV = HDR;
let store = { hash: {}, kv: {}, list: {} };
const MC = { tags: [], found: true };

globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith("https://sheet.test")) return { ok: true, text: async () => CSV };
  if (u.startsWith("https://api.manychat.com")) {
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    if (u.includes("findByCustomField")) {
      if (!MC.found) return { ok: true, json: async () => ({ status: "success", data: [] }) };
      return { ok: true, json: async () => ({ status: "success", data: { id: 7, custom_fields: [], tags: [] } }) };
    }
    if (u.includes("TagByName")) { MC.tags.push((u.includes("addTag") ? "+" : "-") + (body && body.tag_name)); return { ok: true, json: async () => ({ status: "success" }) }; }
    return { ok: true, json: async () => ({ status: "success" }) };
  }
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
const one = async (em) => (await women()).find((w) => w.email === em) || null;
const save = async (em, patch) => {
  const res = mkRes();
  await adminHandler({ query: { key: KEY }, method: "POST", body: { email: em, by: "טלי", phone: "972500000001", ...patch } }, res);
  return res;
};
const gate = async (em) => {
  const res = mkRes();
  await accessHandler({ query: { email: em, device: "d1" }, method: "GET" }, res);
  return res.body || {};
};
const sundayMonthsAgo = (n) => { const d = new Date(); d.setMonth(d.getMonth() - n); d.setDate(d.getDate() - d.getDay()); return d.toISOString().slice(0, 10); };
const row = ({ email, start = "", full = "" }) => `972500000001,רונית,לוי,${email},${start ? start + " 0:00:00" : ""},FALSE,א,3,FALSE,${full},,,TRUE`;

let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (extra ? "  → " + extra : "")); } };
const reset = () => { store = { hash: {}, kv: {}, list: {} }; MC.tags = []; MC.found = true; };

const HTML = readFileSync(new URL("../public/admin.html", import.meta.url), "utf8");

console.log("\nהמתג עצמו");
{
  reset();
  CSV = [HDR, row({ email: "a@t.com", start: sundayMonthsAgo(1) })].join("\n");
  let g = await gate("a@t.com");
  check("לפני הכל אין לה קורס", g.glowFull === false);
  const r = await save("a@t.com", { glowFull: "1" });
  check("השמירה עוברת", r.body && r.body.ok === true, JSON.stringify(r.body));
  g = await gate("a@t.com");
  check("**והקורס נפתח לה בכניסה הבאה, בלי להמתין לגיליון**", g.glowFull === true, String(g.glowFull));
  check("וסרטוני הקורס נחתמים לה", store.kv["glowfull:a@t.com"] === "1");
  check("והתגית נכתבה למניצ'ט", MC.tags.includes("+GLOW-FULL💄💄💄"), MC.tags.join(","));
}
{
  reset();
  // בגיליון יש לה, והמשרד מוריד. **חייב לגבור על הגיליון**, בדיוק כמו בבונוס.
  CSV = [HDR, row({ email: "b@t.com", start: sundayMonthsAgo(1), full: "TRUE" })].join("\n");
  await save("b@t.com", { glowFull: "0" });
  const g = await gate("b@t.com");
  check("הסרה גוברת על הגיליון", g.glowFull === false, String(g.glowFull));
  check("והתגית הוסרה במניצ'ט", MC.tags.includes("-GLOW-FULL💄💄💄"), MC.tags.join(","));
  check("וסרטוני הקורס אינם נחתמים לה", store.kv["glowfull:b@t.com"] === undefined);
}
{
  reset();
  CSV = [HDR, row({ email: "c@t.com", start: sundayMonthsAgo(1), full: "TRUE" })].join("\n");
  await save("c@t.com", { glowFull: "0" });
  let w = await one("c@t.com");
  check("המסך מסמן שזה שינוי ידני", !!w.glowFullOverride);
  check("ומציג לצידו את מה שהגיליון אומר", w.sheetGlowFull === true);
  await save("c@t.com", { glowFull: "" });
  w = await one("c@t.com");
  check("חזרה לגיליון מוחקת את השינוי", !w.glowFullOverride);
  const g = await gate("c@t.com");
  check("והגיליון חוזר להיות בתוקף", g.glowFull === true, String(g.glowFull));
  check("וחזרה לגיליון אינה נוגעת בתגית שבמניצ'ט", MC.tags.filter((t) => t.includes("GLOW-FULL")).length === 1, MC.tags.join(","));
}
{
  reset();
  CSV = [HDR, row({ email: "d@t.com", start: sundayMonthsAgo(1) })].join("\n");
  const r = await save("d@t.com", { glowFull: "2" });
  check("ערך שאינו 1 או 0 נדחה", r.code === 400, String(r.code));
}
{
  reset();
  // **מניצ'ט לא מצא אותה, והמתג חייב לעבוד בכל זאת.** זה כל הפער שזה סוגר.
  CSV = [HDR, row({ email: "e@t.com", start: sundayMonthsAgo(1) })].join("\n");
  MC.found = false;
  const r = await save("e@t.com", { glowFull: "1" });
  check("מניצ'ט לא מצא אותה והשמירה עדיין עברה", r.body && r.body.ok === true, JSON.stringify(r.body));
  const g = await gate("e@t.com");
  check("**והקורס נפתח לה בכל זאת**", g.glowFull === true, String(g.glowFull));
}
{
  reset();
  CSV = [HDR, row({ email: "f@t.com", start: sundayMonthsAgo(1) })].join("\n");
  await save("f@t.com", { glowFull: "1" });
  const w = await one("f@t.com");
  const line = (w.log || [])[0] || {};
  check("השינוי נרשם ביומן עם מי שעשתה אותו", line.field === "glowfull" && line.to === "1" && line.by === "טלי", JSON.stringify(line));
}

console.log("\nהמסך");
{
  check("השורה קיימת בלשונית ההרשאות", /id="fld-glowfull"/.test(HTML));
  check("ושלושת הכפתורים בה", /data-glowfull="1"/.test(HTML) && /data-glowfull="0"/.test(HTML) && /data-glowfull=""/.test(HTML));
  check("ויש לה מטפל שקורא לשמירה", /save\(em,\{glowFull:v\}\)/.test(HTML));
  // **מתג אחד ולא שניים שיכולים לחלוק.** הישן ירד מבלוק מניצ'ט.
  check("המתג הכפול ירד מבלוק מניצ'ט", !/row\("full","קורס האיפור המלא"\)/.test(HTML));
  check("ומתג האפליקציה החדשה נשאר שם", /row\("app","אפליקציה חדשה"\)/.test(HTML));
  check("ושני הערכים מוצגים, מה שבתוקף ומה שבגיליון", /בגיליון: '\+\(w\.sheetGlowFull\?"יש גישה":"אין גישה"\)/.test(HTML));
  check("ונאמר שהקורס נפתח ביום הראשון", HTML.includes("נפתח לה ביום הראשון של התוכנית"));
  check("והשינוי מתורגם למילים ביומן", /L\.field === "glowfull"/.test(HTML));
}

console.log(`\n${pass} מתוך ${pass + fail} עברו.\n`);
process.exit(fail ? 1 : 0);
