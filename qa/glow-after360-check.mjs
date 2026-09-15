// מה קורה לאישה שסיימה את 360 ואז קנתה את קורס האיפור, ולכל שאר המצבים.
//
// **הבאג שזה סוגר:** עד 15 בספטמבר 2026 השער שאל שאלה אחת, "יש לה תאריך התחלה?",
// והסיק ממנה איזה מוצר יש לה. תאריך ההתחלה נשאר בגיליון לנצח, ולכן אישה שסיימה
// 360 וקנתה את הקורס **נחסמה לגמרי מקורס ששילמה עליו.** אותו דבר קרה למי שביטלה
// את 360 ולמי שנמצאת בהקפאה. מכאן נשאלות שתי שאלות נפרדות, 360 פתוח והקורס פתוח,
// והמסך נגזר מהן.
//
// הבדיקה מריצה את `api/access.js` האמיתי מול גיליון מדומה ומול Redis מדומה.
// בלי רשת ובלי עלות.
//
//   node qa/glow-after360-check.mjs

import accessHandler from "../api/access.js";

process.env.ACCESS_SHEET_CSV_URL = "https://sheet.test/csv";
process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";

// הכותרת המלאה, ובסופה העמודה החדשה. **`GLOW-PAID` יושבת אחרי `GLOW-FULL-M`
// בכוונה**, כדי שהבדיקה תיפול אם ההתאמה תהיה על תחילת השם ולא על השם המלא.
const HDR = 'ID,F_NAME,L_NAME,CF_EMAIL,360 - FINAL  PERSONAL START,ביטלה,קבוצה,חודשי גישה נוספים,בונוס איפור,GLOW-FULL,GLOW-FULL-M,GLOW-PAID';
// אותה כותרת בלי העמודה החדשה, כדי לוודא שהיא אופציונלית.
const HDR_OLD = 'ID,F_NAME,L_NAME,CF_EMAIL,360 - FINAL  PERSONAL START,ביטלה,קבוצה,חודשי גישה נוספים,בונוס איפור,GLOW-FULL,GLOW-FULL-M';

let CSV = HDR;
let REDIS_DOWN = false;
let store = { hash: {}, kv: {} };

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.startsWith("https://sheet.test")) return { ok: true, text: async () => CSV };
  if (REDIS_DOWN) throw new Error("redis down");
  const parts = u.replace("https://redis.test/", "").split("/").map(decodeURIComponent);
  const [cmd, a, b, c] = parts;
  const H = (k) => (store.hash[k] = store.hash[k] || {});
  let result = null;
  if (cmd === "HSET") { H(a)[b] = c; result = 1; }
  else if (cmd === "HSETNX") { if (H(a)[b] === undefined) { H(a)[b] = c; result = 1; } else result = 0; }
  else if (cmd === "HGET") result = H(a)[b] ?? null;
  else if (cmd === "HDEL") { delete H(a)[b]; result = 1; }
  else if (cmd === "SET") { store.kv[a] = b; result = "OK"; }
  else if (cmd === "GET") result = store.kv[a] ?? null;
  else if (cmd === "DEL") { delete store.kv[a]; result = 1; }
  else result = 0;
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
const monthsAgo = (n) => { const d = new Date(); d.setMonth(d.getMonth() - n); return d.toISOString().slice(0, 10); };
const sundayMonthsAgo = (n) => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().slice(0, 10);
};
const daysFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
};
const reset = () => { store = { hash: {}, kv: {} }; REDIS_DOWN = false; };
// שורה בגיליון. start ריק פירושו שאין לה מחזור.
const row = ({ email, start = "", cancel = "FALSE", full = "", m = "", paid = "", bonus = "FALSE", months = "3" }) =>
  `972500000001,רונית,לוי,${email},${start ? start + " 0:00:00" : ""},${cancel},א,${months},${bonus},${full},${m},${paid}`;
const ovr = (email, o) => { store.hash["admin:overrides"] = store.hash["admin:overrides"] || {}; store.hash["admin:overrides"][email] = JSON.stringify(o); };

console.log("\n1-4 · 360 פתוח: שום דבר לא זז");
{
  reset();
  CSV = [HDR, row({ email: "a@t.com", start: sundayMonthsAgo(1) })].join("\n");
  const g = await gate("a@t.com");
  check("1 · 360 בלי גלו נכנסת כרגיל", g.allowed === true && g.product === "360", g.reason || g.product);
}
{
  reset();
  CSV = [HDR, row({ email: "b@t.com", start: sundayMonthsAgo(1), bonus: "TRUE" })].join("\n");
  const g = await gate("b@t.com");
  check("2 · 360 עם שיעורי המתנה נכנסת כ-360", g.allowed === true && g.product === "360" && g.glow === true, g.reason);
}
{
  reset();
  CSV = [HDR, row({ email: "c@t.com", start: sundayMonthsAgo(1), full: "TRUE" })].join("\n");
  const g = await gate("c@t.com");
  check("3 · מתנת הוובינר מקבלת 360 והקורס בתוכו", g.allowed === true && g.product === "360" && g.glowFull === true, g.reason);
  check("   וסרטוני התוכנית נחתמים לה", store.kv["glowonly:c@t.com"] === undefined);
}
{
  reset();
  CSV = [HDR, row({ email: "d@t.com", start: sundayMonthsAgo(1), full: "TRUE", paid: "TRUE" })].join("\n");
  const g = await gate("d@t.com");
  check("4 · מי שקנתה בזמן 360 מקבלת 360 והקורס בתוכו", g.allowed === true && g.product === "360" && g.glowFull === true, g.product);
  check("   והשעון של הקורס עוד לא התחיל לרוץ", !store.hash["glow:start"]);
}

console.log("\n5-6 · הקורס בלי 360, ואחרי 360");
{
  reset();
  CSV = [HDR, row({ email: "e@t.com", full: "TRUE" })].join("\n");
  const g = await gate("e@t.com");
  check("5 · מי שמעולם לא הייתה ב-360 מקבלת את מסך הקורס", g.allowed === true && g.product === "glow", g.reason || g.product);
}
{
  reset();
  CSV = [HDR, row({ email: "f@t.com", start: sundayMonthsAgo(20), full: "TRUE", paid: "TRUE" })].join("\n");
  const g = await gate("f@t.com");
  check("6 · מי שסיימה 360 וקנתה קורס מקבלת את מסך הקורס", g.allowed === true && g.product === "glow", g.reason || g.product);
  check("   וסרטוני 360 נחסמים לה", store.kv["glowonly:f@t.com"] === "1");
  check("   וסרטוני הקורס נחתמים לה", store.kv["glowfull:f@t.com"] === "1");
  check("   והשעון שלה נתפס מהיום", (store.hash["glow:start"] || {})["f@t.com"] === new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jerusalem" }));
}
{
  reset();
  CSV = [HDR, row({ email: "f@t.com", start: sundayMonthsAgo(20), full: "TRUE", paid: "TRUE" })].join("\n");
  store.hash["glow:start"] = { "f@t.com": monthsAgo(13) };
  const g = await gate("f@t.com");
  check("   ואחרי 12 חודשים הקורס שלה נגמר", g.allowed === false && g.reason === "expired", g.reason);
}

console.log("\n7 · המתנה נגמרת יחד עם 360, וזו החלטת רון מ-v7.03");
{
  reset();
  CSV = [HDR, row({ email: "g@t.com", start: sundayMonthsAgo(20), full: "TRUE" })].join("\n");
  const g = await gate("g@t.com");
  check("7 · מתנת הוובינר יוצאת כשחלון 360 נגמר", g.allowed === false && g.reason === "expired", g.reason);
  check("   ולא נפתח לה שום שעון של קורס", !store.hash["glow:start"]);
}
{
  reset();
  CSV = [HDR, row({ email: "g2@t.com", start: sundayMonthsAgo(20), full: "TRUE", m: "24" })].join("\n");
  const g = await gate("g2@t.com");
  check("   וגם GLOW-FULL-M מלאה אינה מצילה אותה בלי סימון קנייה", g.allowed === false, g.reason);
}

console.log("\n8-9 · חזרה ל-360");
{
  reset();
  CSV = [HDR, row({ email: "h@t.com", start: sundayMonthsAgo(1), full: "TRUE", paid: "TRUE" })].join("\n");
  store.hash["glow:start"] = { "h@t.com": monthsAgo(6) };
  const g = await gate("h@t.com");
  check("8 · מי שקנתה ונרשמה שוב ל-360 חוזרת ל-360 עם הקורס בתוכו", g.allowed === true && g.product === "360" && g.glowFull === true, g.product);
}
{
  reset();
  CSV = [HDR, row({ email: "i@t.com", start: sundayMonthsAgo(1), full: "TRUE" })].join("\n");
  const g = await gate("i@t.com");
  check("9 · קונת קורס שנרשמה ל-360 מקבלת את התוכנית המלאה", g.allowed === true && g.product === "360", g.product);
}

console.log("\n10-11 · ביטול והקפאה של 360 אינם לוקחים קורס בתשלום");
{
  reset();
  CSV = [HDR, row({ email: "j@t.com", start: sundayMonthsAgo(1), cancel: "TRUE", full: "TRUE", paid: "TRUE" })].join("\n");
  const g = await gate("j@t.com");
  check("10 · ביטלה 360 וממשיכה לקבל את הקורס", g.allowed === true && g.product === "glow", g.reason || g.product);
}
{
  reset();
  CSV = [HDR, row({ email: "j2@t.com", start: sundayMonthsAgo(1), full: "TRUE", paid: "TRUE" })].join("\n");
  ovr("j2@t.com", { blocked: "1" });
  const g = await gate("j2@t.com");
  check("   וגם ביטול בתהליך מהמשרד אינו לוקח אותו", g.allowed === true && g.product === "glow", g.reason || g.product);
}
{
  reset();
  CSV = [HDR, row({ email: "k@t.com", start: sundayMonthsAgo(1), full: "TRUE", paid: "TRUE" })].join("\n");
  ovr("k@t.com", { freeze: { from: monthsAgo(1), back: daysFromNow(30), week: 3 } });
  const g = await gate("k@t.com");
  check("11 · בהקפאה ב-360 ועדיין רואה את הקורס", g.allowed === true && g.product === "glow", g.reason || g.product);
}
{
  reset();
  CSV = [HDR, row({ email: "k2@t.com", start: sundayMonthsAgo(1), full: "TRUE" })].join("\n");
  ovr("k2@t.com", { freeze: { from: monthsAgo(1), back: daysFromNow(30), week: 3 } });
  const g = await gate("k2@t.com");
  check("   ומי שקיבלה במתנה נשארת בחוץ בהקפאה", g.allowed === false && g.reason === "frozen", g.reason);
}
{
  reset();
  CSV = [HDR, row({ email: "k3@t.com", start: sundayMonthsAgo(1) })].join("\n");
  ovr("k3@t.com", { freeze: { from: monthsAgo(1), back: daysFromNow(30), week: 3 } });
  const g = await gate("k3@t.com");
  check("   וההקפאה הרגילה ממשיכה לחסום בדיוק כמו קודם", g.allowed === false && g.reason === "frozen" && g.back === daysFromNow(30), g.reason);
}

console.log("\n12-13 · חלונות שנגמרו");
{
  reset();
  CSV = [HDR, row({ email: "l@t.com", start: sundayMonthsAgo(1), full: "TRUE", paid: "TRUE" })].join("\n");
  store.hash["glow:start"] = { "l@t.com": monthsAgo(20) };
  const g = await gate("l@t.com");
  check("12 · 360 פתוח וחלון הקורס נגמר: היא עדיין ב-360", g.allowed === true && g.product === "360", g.reason || g.product);
}
{
  reset();
  CSV = [HDR, row({ email: "m@t.com", start: sundayMonthsAgo(20) })].join("\n");
  const g = await gate("m@t.com");
  check("13 · שניהם נגמרו והיא בחוץ", g.allowed === false && g.reason === "expired", g.reason);
}

console.log("\nמה שאסור שיקרה");
{
  reset();
  CSV = [HDR, row({ email: "n@t.com", start: sundayMonthsAgo(20), paid: "TRUE" })].join("\n");
  const g = await gate("n@t.com");
  check("סימון קנייה בלי GLOW-FULL אינו נותן כלום", g.allowed === false && g.reason === "expired", g.reason);
}
{
  reset();
  CSV = [HDR, row({ email: "o@t.com", start: sundayMonthsAgo(20), full: "TRUE", m: "24" })].join("\n");
  const g = await gate("o@t.com");
  check("GLOW-FULL-M אינה משמשת כסימן קנייה", g.allowed === false, g.reason);
}
{
  reset();
  // אותה אישה בלי העמודה החדשה בגיליון כלל: הכל חוזר בדיוק למה שהיה.
  CSV = [HDR_OLD, `972500000001,רונית,לוי,p@t.com,${sundayMonthsAgo(20)} 0:00:00,FALSE,א,3,FALSE,TRUE,`].join("\n");
  const g = await gate("p@t.com");
  check("בלי העמודה החדשה שום דבר לא משתנה לאף אישה", g.allowed === false && g.reason === "expired", g.reason);
}
{
  reset();
  CSV = [HDR_OLD, `972500000001,רונית,לוי,p2@t.com,${sundayMonthsAgo(1)} 0:00:00,FALSE,א,3,FALSE,TRUE,`].join("\n");
  const g = await gate("p2@t.com");
  check("ומי שבתוך 360 נכנסת בדיוק כמו קודם", g.allowed === true && g.product === "360", g.reason);
}
{
  reset();
  CSV = [HDR, row({ email: "q@t.com", full: "TRUE", cancel: "TRUE" })].join("\n");
  const g = await gate("q@t.com");
  check("ביטול אצל מי שאין לה 360 בכלל סוגר גם את הקורס", g.allowed === false && g.reason === "cancelled", g.reason);
}
{
  reset();
  CSV = [HDR, row({ email: "r@t.com" })].join("\n");
  const g = await gate("r@t.com");
  check("אישה רשומה בלי מחזור ובלי קורס עדיין נכנסת", g.allowed === true && g.product === "360", g.reason);
}
{
  reset();
  CSV = [HDR, row({ email: "s@t.com" })].join("\n");
  ovr("s@t.com", { until: monthsAgo(1) });
  const g = await gate("s@t.com");
  check("והארכה ידנית שנגמרה סוגרת גם אותה", g.allowed === false && g.reason === "expired", g.reason);
}
{
  reset();
  CSV = [HDR, row({ email: "t@t.com", start: sundayMonthsAgo(1), full: "TRUE", paid: "TRUE" })].join("\n");
  ovr("t@t.com", { until: monthsAgo(1) });
  const g = await gate("t@t.com");
  check("הארכת 360 שנגמרה אינה לוקחת קורס בתשלום", g.allowed === true && g.product === "glow", g.reason || g.product);
}
{
  reset();
  CSV = [HDR, row({ email: "u@t.com", start: sundayMonthsAgo(20), full: "TRUE", paid: "TRUE" })].join("\n");
  REDIS_DOWN = true;
  const g = await gate("u@t.com");
  check("Redis נופל ואישה ששילמה אינה נעולה", g.allowed === true && g.product === "glow", g.reason || g.product);
}
{
  reset();
  // שתי שורות לאותה כתובת: הסימון יושב על השורה הישנה בלבד. הקנייה היא עובדה
  // על האישה, ולכן היא נספרת מכל השורות בדיוק כמו הביטול.
  CSV = [HDR,
    row({ email: "v@t.com", start: sundayMonthsAgo(30), full: "TRUE", paid: "TRUE" }),
    row({ email: "v@t.com", start: sundayMonthsAgo(20), full: "TRUE" })].join("\n");
  const g = await gate("v@t.com");
  check("קנייה בשורה כפולה אינה הולכת לאיבוד", g.allowed === true && g.product === "glow", g.reason || g.product);
}
{
  reset();
  CSV = [HDR, row({ email: "w@t.com", start: sundayMonthsAgo(1), full: "TRUE", paid: "TRUE" })].join("\n");
  const g = await gate("w@t.com");
  check("מי ש-360 פתוח לה לעולם אינה מועברת למסך הקורס", g.product === "360", g.product);
}
{
  reset();
  CSV = [HDR, row({ email: "x@t.com", start: daysFromNow(14) })].join("\n");
  const g = await gate("x@t.com");
  check("מחזור עתידי אינו נחשב נגמר", g.allowed === true && g.product === "360", g.reason);
}

console.log("\nלפני יום 1: הקורס המלא נעול, והמתנה לא");
{
  reset();
  // מחזור שמתחיל בעוד שבועיים. היא נכנסת, ורואה את מסך ההמתנה.
  CSV = [HDR, row({ email: "pre@t.com", start: daysFromNow(14), full: "TRUE" })].join("\n");
  const g = await gate("pre@t.com");
  check("היא נכנסת כרגיל", g.allowed === true && g.product === "360", g.reason);
  check("**והקורס המלא עוד לא נפתח לה**", g.glowFull === false, String(g.glowFull));
  check("ולכן גם הסרטונים שלו אינם נחתמים לה", store.kv["glowfull:pre@t.com"] === undefined);
}
{
  reset();
  // אותה אישה, עם שלושת שיעורי המתנה. **הם כן נפתחים בתקופת ההמתנה.**
  CSV = [HDR, row({ email: "pre2@t.com", start: daysFromNow(14), full: "TRUE", bonus: "TRUE" })].join("\n");
  const g = await gate("pre2@t.com");
  check("שיעורי המתנה כן פתוחים לה בהמתנה", g.glow === true);
  check("והקורס המלא עדיין לא", g.glowFull === false, String(g.glowFull));
  check("והסרטונים החינמיים נחתמים לה", store.kv["glow:pre2@t.com"] === "1");
}
{
  reset();
  // מחזור שמתחיל היום. **מכאן הקורס פתוח.**
  const d = new Date(); d.setDate(d.getDate() - d.getDay());
  CSV = [HDR, row({ email: "day1@t.com", start: d.toISOString().slice(0, 10), full: "TRUE" })].join("\n");
  const g = await gate("day1@t.com");
  check("ביום שהתוכנית מתחילה הקורס נפתח", g.glowFull === true, String(g.glowFull));
  check("והסרטונים שלו נחתמים לה", store.kv["glowfull:day1@t.com"] === "1");
}
{
  reset();
  // קונת הקורס לבדו: אין לה תוכנית ואין המתנה, ולכן זה אינו נוגע בה כלל.
  CSV = [HDR, row({ email: "solo2@t.com", full: "TRUE" })].join("\n");
  const g = await gate("solo2@t.com");
  check("קונת הקורס לבדו אינה מושפעת מההמתנה", g.allowed === true && g.product === "glow" && g.glowFull === true, g.reason);
}

console.log(`\n${pass} מתוך ${pass + fail} עברו.\n`);
process.exit(fail ? 1 : 0);
