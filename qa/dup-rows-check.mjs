// אישה אחת שיושבת על כמה שורות בגיליון. עד 4 בספטמבר 2026 מסך הניהול לקח את
// השורה הראשונה בקובץ והשער את האחרונה, ולכן המסך הציג מחזור אחד והאפליקציה
// נתנה לה מחזור אחר, **ואף מסך לא אמר שיש לה שתי שורות בכלל.**
//
// הבדיקה מריצה את `api/_sheet.js` ואת `api/access.js` האמיתיים על אותו קובץ
// מדומה, ונופלת אם הם חולקים על תאריך ההתחלה ולו פעם אחת. בלי רשת ובלי עלות.
//
//   node qa/dup-rows-check.mjs

import accessHandler from "../api/access.js";
import adminHandler from "../api/admin.js";
// מרחב השמות ולא ייבוא בשם, כדי שהבדיקה תרוץ גם על קוד שאין בו `pickRow` ותיפול
// על מה שבאמת שונה, במקום ליפול בטעינה ולא לומר דבר.
import * as SHEET from "../api/_sheet.js";
const loadSheet = SHEET.loadSheet;
const pickRow = SHEET.pickRow || (() => ({}));
import { readFileSync } from "node:fs";

const KEY = "test-admin-key";
process.env.ADMIN_KEY = KEY;
process.env.ACCESS_SHEET_CSV_URL = "https://sheet.test/csv";
process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";
process.env.MANYCHAT_TOKEN = "mc-test";

const HDR = 'ID,F_NAME,L_NAME,CF_EMAIL,360 - FINAL  PERSONAL START,הורידה אפליקציה,ביטלה,קבוצה,חודשי גישה נוספים,אפליקציית תזונה';
let CSV = HDR;
// כמה רשומות מניצ'ט מחזיר לאותו טלפון. זה מה שהופך כתיבה שנחתה על הרשומה הלא
// נכונה לדבר שאפשר לראות, במקום להיראות כמו הצלחה.
const MC = { many: 1, calls: 0 };
const store = { hash: {}, kv: {}, list: {} };

globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith("https://sheet.test")) return { ok: true, text: async () => CSV };
  if (u.startsWith("https://api.manychat.com")) {
    MC.calls++;
    if (u.includes("findByCustomField")) {
      const one = { id: 77, custom_fields: [], tags: [] };
      const data = MC.many > 1 ? Array.from({ length: MC.many }, (_, i) => ({ ...one, id: 77 + i })) : one;
      return { ok: true, json: async () => ({ status: "success", data }) };
    }
    return { ok: true, json: async () => ({ status: "success" }) };
  }
  const parts = u.replace("https://redis.test/", "").split("/").map(decodeURIComponent);
  const [cmd, a, b, c] = parts;
  const H = (k) => (store.hash[k] = store.hash[k] || {});
  let result = null;
  if (cmd === "HSET") { H(a)[b] = c; result = 1; }
  else if (cmd === "HGET") result = H(a)[b] ?? null;
  else if (cmd === "HDEL") { delete H(a)[b]; result = 1; }
  else if (cmd === "HGETALL") { const o = H(a); result = Object.keys(o).flatMap((k) => [k, o[k]]); }
  else if (cmd === "KEYS") result = [];
  else if (cmd === "SET") { store.kv[a] = b; result = "OK"; }
  else if (cmd === "GET") result = store.kv[a] ?? null;
  else if (cmd === "LRANGE") result = [];
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
const gate = async (email) => {
  const res = mkRes();
  await accessHandler({ query: { email, device: "dev-1" }, method: "GET" }, res);
  return res.body || {};
};
const sheetOf = async (email) => {
  const { women } = await loadSheet(process.env.ACCESS_SHEET_CSV_URL);
  return women.filter((w) => w.email === email)[0] || null;
};

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
};

console.log("\nהחוק עצמו");
check("pickRow מיוצאת מהקובץ המשותף", typeof SHEET.pickRow === "function");
check("התאריך המאוחר ביותר מנצח",
  pickRow([{ start: "2026-06-14" }, { start: "2026-09-13" }]).start === "2026-09-13");
check("וגם כשהוא ראשון בקובץ",
  pickRow([{ start: "2026-09-13" }, { start: "2026-06-14" }]).start === "2026-09-13");
check("שורה בלי תאריך אינה מנצחת שורה שיש בה תאריך",
  pickRow([{ start: "2026-06-14" }, { start: "" }]).start === "2026-06-14");
check("וגם בסדר ההפוך", pickRow([{ start: "" }, { start: "2026-06-14" }]).start === "2026-06-14");
check("בלי אף תאריך נשארת הראשונה",
  pickRow([{ start: "", group: "א" }, { start: "", group: "ב" }]).group === "א");

console.log("\nשתי שורות לאותה כתובת");
{
  CSV = [HDR,
    '972501111111,אורלי,לוי,m058@test.com,2026-06-14 0:00:00,TRUE,FALSE,ב,3,TRUE',
    '972501111111,אורלי,לוי,m058@test.com,2026-09-13 0:00:00,TRUE,FALSE,ג,3,TRUE',
  ].join("\n");
  const { women, skipped } = await loadSheet(process.env.ACCESS_SHEET_CSV_URL);
  const w = women.filter((x) => x.email === "m058@test.com")[0];
  check("היא מופיעה פעם אחת ברשימה", women.length === 1);
  check("והשורה השנייה נספרת ככפילות", skipped.duplicate === 1);
  check("המסך לוקח את התאריך המאוחר", w.start === "2026-09-13", w.start);
  check("dupRows אומר כמה שורות יש לה", w.dupRows === 2);
  check("dupStarts מפרט את שתיהן",
    JSON.stringify(w.dupStarts) === JSON.stringify(["2026-06-14", "2026-09-13"]), JSON.stringify(w.dupStarts));
  check("שאר השדות מגיעים מהשורה המנצחת", w.group === "ג", w.group);
  const g = await gate("m058@test.com");
  check("והשער נותן בדיוק את אותו תאריך", g.startDate === w.start, g.startDate + " מול " + w.start);
  check("והיא נכנסת", g.allowed === true);
}

console.log("\nוסדר השורות בקובץ אינו משנה");
{
  CSV = [HDR,
    '972501111111,אורלי,לוי,m058@test.com,2026-09-13 0:00:00,TRUE,FALSE,ג,3,TRUE',
    '972501111111,אורלי,לוי,m058@test.com,2026-06-14 0:00:00,TRUE,FALSE,ב,3,TRUE',
  ].join("\n");
  const w = await sheetOf("m058@test.com");
  const g = await gate("m058@test.com");
  check("המסך אומר את אותו דבר בשני הסדרים", w.start === "2026-09-13", w.start);
  check("והשער גם הוא", g.startDate === "2026-09-13", g.startDate);
  check("ושניהם מסכימים", g.startDate === w.start);
}

console.log("\nביטול נספר מכל השורות");
{
  CSV = [HDR,
    '972501111111,אורלי,לוי,m058@test.com,2026-06-14 0:00:00,TRUE,TRUE,ב,3,TRUE',
    '972501111111,אורלי,לוי,m058@test.com,2026-09-13 0:00:00,TRUE,FALSE,ג,3,TRUE',
  ].join("\n");
  const w = await sheetOf("m058@test.com");
  const g = await gate("m058@test.com");
  // החלטת רון, 4 בספטמבר 2026: "אם מישהי ביטלה ויש לה שתי שורות אז היא ביטלה,
  // ולא צריך להיות לה שום גישה, וזה לא משנה אם יש שתי שורות או שמונה מאות."
  check("סימון באחת השורות מספיק, גם כשהמנצחת נקייה", w.cancelled === true);
  check("והשער חוסם אותה", g.allowed === false && g.reason === "cancelled", JSON.stringify(g));
  check("המסך והשער אומרים אותו דבר על הביטול", w.cancelled === !g.allowed);
}

console.log("\nאותו טלפון על שתי כתובות");
{
  CSV = [HDR,
    '972501111111,אורלי,לוי,one@test.com,2026-06-14 0:00:00,TRUE,FALSE,ב,3,TRUE',
    '972501111111,אורלי,לוי,two@test.com,2026-09-13 0:00:00,TRUE,FALSE,ג,3,TRUE',
    '972509999999,נילי,לביא,solo@test.com,2026-09-13 0:00:00,TRUE,FALSE,א,3,TRUE',
  ].join("\n");
  const { women } = await loadSheet(process.env.ACCESS_SHEET_CSV_URL);
  const a = women.filter((w) => w.email === "one@test.com")[0];
  const b = women.filter((w) => w.email === "two@test.com")[0];
  const c = women.filter((w) => w.email === "solo@test.com")[0];
  check("שתיהן מוצגות כשתי משתתפות נפרדות", women.length === 3);
  check("ואינן נחשבות כפילות מייל", !a.dupRows && !b.dupRows);
  check("כל אחת יודעת על השנייה", JSON.stringify(a.dupPhone) === '["two@test.com"]' &&
    JSON.stringify(b.dupPhone) === '["one@test.com"]', JSON.stringify([a.dupPhone, b.dupPhone]));
  check("ומי שהטלפון שלה יחיד אינה מסומנת", c.dupPhone === null);
}

console.log("\nשורות בלי מייל עם אותו טלפון");
{
  CSV = [HDR,
    '972501111111,אורלי,לוי,,2026-06-14 0:00:00,TRUE,FALSE,ב,3,TRUE',
    '972501111111,אורלי,לוי,,2026-09-13 0:00:00,TRUE,FALSE,ג,3,TRUE',
    '972502222222,נילי,לביא,,2026-09-13 0:00:00,TRUE,FALSE,א,3,TRUE',
  ].join("\n");
  const { noEmail } = await loadSheet(process.env.ACCESS_SHEET_CSV_URL);
  check("אישה אחת מוצגת פעם אחת באריח", noEmail.length === 2, String(noEmail.length));
  check("וכתוב בכמה שורות היא יושבת", noEmail[0].rows === 2, String(noEmail[0].rows));
  check("ומי שיש לה שורה אחת נשארת אחת", noEmail[1].rows === 1);
}

console.log("\nמניצ'ט: כמה רשומות נושאות את הטלפון");
{
  CSV = [HDR, '972501111111,אורלי,לוי,one@test.com,2026-06-14 0:00:00,TRUE,FALSE,ב,3,TRUE'].join("\n");
  const call = async (body) => {
    const res = mkRes();
    await adminHandler({ query: { key: KEY, save: "1" }, method: "POST", body }, res);
    return res.body || {};
  };
  MC.many = 2;
  const r2 = await call({ email: "one@test.com", phone: "972501111111", group: "ד", by: "טלי" });
  check("שתי רשומות מדווחות למסך", r2.mcMulti === 2, JSON.stringify(r2));
  MC.many = 1;
  const r1 = await call({ email: "one@test.com", phone: "972501111111", group: "ה", by: "טלי" });
  check("ורשומה אחת אינה מדווחת ככפילות", !r1.mcMulti, JSON.stringify(r1));
  check("והכתיבה עצמה הצליחה בשני המקרים",
    String(r1.mc).indexOf("ok") === 0 && String(r2.mc).indexOf("ok") === 0, r1.mc + " / " + r2.mc);
}

console.log("\nמה שהמסך מציג");
{
  const html = readFileSync(new URL("../public/admin.html", import.meta.url), "utf8");
  check('יש צ׳יפ סינון "כפילות בגיליון"', /data-v="dup"/.test(html) && html.indexOf("כפילות בגיליון (") !== -1);
  check("והוא מסנן את הרשימה", /VIEW==="dup" \? dupList/.test(html));
  check("הרשימה נבנית משתי הכפילויות",
    /dupList = pool\.filter\(function\(w\)\{ return w\.dupRows > 1 \|\| \(w\.dupPhone && w\.dupPhone\.length\); \}\)/.test(html));
  check("ויש שורת הסבר לתצוגה", /VIEW==="dup" \? '<div class="note">/.test(html));
  check("ובשורה ברשימה יש תג", /dupRows>1\|\|\(w\.dupPhone&&w\.dupPhone\.length\)\)\?'<span class="grp warnpill">כפילות בגיליון/.test(html));

  const fn = html.match(/  function dupBox\(w\)\{[\s\S]*?\n  \}/);
  check("dupBox קיימת", !!fn);
  const mk = fn ? new Function("il", "esc", fn[0] + "; return dupBox;")((d) => d, (x) => x) : () => "";
  const boxA = mk({ dupRows: 2, dupStarts: ["2026-06-14", "2026-09-13"], sheetStart: "2026-09-13", cancelled: false, dupPhone: null });
  check("היא אומרת בכמה שורות המייל יושב", boxA.indexOf("המייל הזה מופיע ב-2 שורות בגיליון") !== -1, boxA);
  check("ומפרטת את שני התאריכים", boxA.indexOf("2026-06-14 · 2026-09-13") !== -1, boxA);
  check("ואומרת באיזה מהם משתמשים", boxA.indexOf("משתמשים ב-2026-09-13") !== -1, boxA);
  check("בלי ביטול אין משפט ביטול", boxA.indexOf("ביטלה") === -1);
  const boxC = mk({ dupRows: 2, dupStarts: ["a", "b"], sheetStart: "b", cancelled: true, dupPhone: null });
  check("ועם ביטול היא אומרת שהיא חסומה", boxC.indexOf("מסומנת ביטלה, ולכן היא חסומה") !== -1, boxC);
  const boxP = mk({ dupRows: 0, dupStarts: null, sheetStart: "x", cancelled: false, dupPhone: ["two@test.com"] });
  check("וטלפון כפול מקבל קופסה משלו", boxP.indexOf("הטלפון הזה מופיע גם על כתובת מייל אחרת") !== -1, boxP);
  check("ובה הכתובת השנייה", boxP.indexOf("two@test.com") !== -1);
  check("והיא אומרת שהכתיבה מגיעה לרשומה אחת", boxP.indexOf("לרשומה אחת בלבד") !== -1);
  check("ומי שאין לה כפילות לא מקבלת כלום",
    mk({ dupRows: 0, dupStarts: null, sheetStart: "x", cancelled: false, dupPhone: null }) === "");

  const wf = html.match(/function mcWarn\(r\)\{[\s\S]*?\n\}/);
  check("mcWarn מזהירה על כמה רשומות", !!wf && /r\.mcMulti > 1/.test(wf[0]));
  // האזהרה חייבת לצאת לפני היציאות המוקדמות, אחרת דווקא כשהכתיבה "הצליחה" איש
  // לא ידע שהיא נחתה על רשומה אחת מתוך שתיים, וזה בדיוק המקרה שנראה תקין ואינו.
  check("והיא יוצאת גם כשהכתיבה הצליחה",
    !!wf && wf[0].indexOf("r.mcMulti > 1") < wf[0].indexOf('r.mc === "ok"'));
}

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.");
process.exit(fail ? 1 : 0);
