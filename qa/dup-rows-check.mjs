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

console.log("\nהתעלמות, והחזרה שלה כשהמצב משתנה");
{
  const HDR2 = HDR;
  CSV = [HDR2,
    '972501111111,אורלי,לוי,dup@test.com,2026-06-14 0:00:00,TRUE,FALSE,ב,3,TRUE',
    '972501111111,אורלי,לוי,dup@test.com,2026-09-13 0:00:00,TRUE,FALSE,ג,3,TRUE',
    '972502222222,נילי,לביא,,2026-08-16 0:00:00,TRUE,FALSE,א,3,TRUE',
  ].join("\n");
  const list = async () => {
    const res = mkRes();
    await adminHandler({ query: { key: KEY }, method: "GET" }, res);
    return res.body || {};
  };
  const post = async (body) => {
    const res = mkRes();
    await adminHandler({ query: { key: KEY }, method: "POST", body }, res);
    return res.body || {};
  };
  const her = (d) => (d.women || []).find((w) => w.email === "dup@test.com");
  const row = (d) => (d.noEmail || []).find((r) => r.phone === "972502222222");

  let d = await list();
  check("לפני ההתעלמות אין שום סימון", !her(d).ign && !row(d).ign);

  const mcBefore = MC.calls;
  const r1 = await post({ ignore: { kind: "dup", id: "dup@test.com" }, by: "טלי" });
  const r2 = await post({ ignore: { kind: "mail", id: "972502222222" }, by: "טלי" });
  check("שתי ההתעלמויות נשמרו", r1.ok === true && r2.ok === true, JSON.stringify([r1, r2]));
  // ההתעלמות היא החלטה של המשרד על מה להציג לו, ולכן היא לעולם לא נוגעת
  // במניצ'ט, בגיליון או באישה עצמה.
  check("ושום דבר לא נכתב למניצ׳ט", MC.calls === mcBefore, String(MC.calls - mcBefore));

  d = await list();
  check("היא מסומנת כמוסתרת", her(d).ign?.on === true && her(d).ign?.stale === false);
  check("ונרשם מי הסתיר ומתי", her(d).ign?.by === "טלי" && !!her(d).ign?.at);
  check("וגם שורת חסר המייל", row(d).ign?.on === true);

  // **החלטת רון, 5 בספטמבר 2026: "שתחזור."** ההתעלמות תקפה למצב שהיה כשלחצו
  // עליה, ולכן שורה שלישית מחזירה אותה לרשימה מעצמה.
  CSV = CSV + "\n" + '972501111111,אורלי,לוי,dup@test.com,2026-10-04 0:00:00,TRUE,FALSE,ג,3,TRUE';
  d = await list();
  check("שורה שלישית מחזירה אותה לרשימה", her(d).ign?.on === false && her(d).ign?.stale === true);
  check("והרשומה נשארת כדי שאפשר יהיה לומר לה למה", her(d).ign?.by === "טלי");
  check("ומי שלא השתנתה נשארת מוסתרת", row(d).ign?.on === true);

  const r3 = await post({ ignore: { kind: "mail", id: "972502222222", on: false }, by: "טלי" });
  d = await list();
  check("ביטול ההתעלמות מוחק אותה", r3.ok === true && !row(d).ign);
}

console.log("\nמה שהמסך מציג");
{
  const html = readFileSync(new URL("../public/admin.html", import.meta.url), "utf8");
  // שני סוגי הבעיות בקובץ יושבים בכפתור אחד מ-v6.78, לפי בקשת רון.
  check('יש כפתור אחד, "בעיות בגיליון"', /data-v="probs"/.test(html) && html.indexOf("בעיות בגיליון (") !== -1);
  check("והמספר שלו הוא סכום השניים", /probsN = noMailOn\.length \+ dupOn\.length/.test(html));
  check("ושני הכפתורים הישנים ירדו", !/data-v="nomail"/.test(html) && !/data-v="dup"/.test(html));
  check("המסך מציג את שני החלקים", /probsScreen\(noMailOn, dupOn\)/.test(html) &&
    /<div class="psec">חסר מייל \('\+nm\.length\+'\)<\/div>'\+\s*\n\s*nomailScreen\(/.test(html) &&
    /<div class="psec">כפילות בגיליון \('\+dup\.length\+'\)<\/div>'\+\s*\n\s*dupSection\(/.test(html));
  check("הכפילות מסוננת לפי בורר האפליקציה בלבד",
    /dupAll = DATA\.women\.filter/.test(html) && /dupList = dupAll\.filter/.test(html));
  check("ויש שורת הסבר לתצוגה", /VIEW==="probs" \? '<div class="note">/.test(html));
  // חלק ריק אומר את זה במפורש ולא נעלם. הכלל של v5.07: היעדר שורה אינו תשובה.
  check("חלק ריק אומר את זה במפורש", html.indexOf("אין כפילויות. כל אישה יושבת על שורה אחת") !== -1);
  check("ופתיחת כרטיס מתוך המסך יוצאת ממנו", /if\(VIEW === "probs"\)\{ VIEW = ""/.test(html));
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

  check("יש כפתור התעלמות על שני החלקים",
    /ignBtn\("dup", w\.email, w\)/.test(html) && /ignBtn\("mail", r\.phone, r\)/.test(html));
  check("והכיתוב הוא התעלמות וביטול ההתעלמות",
    html.indexOf('">התעלמות</button>') !== -1 && html.indexOf('">ביטול ההתעלמות</button>') !== -1);
  // הסתרה שאינה נאמרת היא בדיוק הדרך לפספס בעיה אמיתית.
  check("ושורת המוסתרות מוצגת תמיד", /function ignLine\(kind, n\)/.test(html) && html.indexOf("' מוסתרות</span>'") !== -1);
  check("ומי שחזרה אומרת למה", html.indexOf("חזרה לרשימה: המצב שלה בגיליון השתנה מאז שהתעלמת ממנה.") !== -1);
  check("והמספר על הכפתור סופר את המוצגות בלבד",
    /probsN = noMailOn\.length \+ dupOn\.length/.test(html) && /probsScreen\(noMailOn, dupOn\)/.test(html));

  const wf = html.match(/function mcWarn\(r\)\{[\s\S]*?\n\}/);
  check("mcWarn מזהירה על כמה רשומות", !!wf && /r\.mcMulti > 1/.test(wf[0]));
  // האזהרה חייבת לצאת לפני היציאות המוקדמות, אחרת דווקא כשהכתיבה "הצליחה" איש
  // לא ידע שהיא נחתה על רשומה אחת מתוך שתיים, וזה בדיוק המקרה שנראה תקין ואינו.
  check("והיא יוצאת גם כשהכתיבה הצליחה",
    !!wf && wf[0].indexOf("r.mcMulti > 1") < wf[0].indexOf('r.mc === "ok"'));
}

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.");
process.exit(fail ? 1 : 0);
