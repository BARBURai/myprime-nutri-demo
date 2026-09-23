// ===== מי הייתה אמורה לקבל התראה, ומי קיבלה בפועל. v7.37 =====
//
// **רון, 23 בספטמבר 2026: "אני רוצה לדעת כמה קיבלו וכמה לא קיבלו מאלה שאמורות לקבל,
// לא מאלה שלא אמורות לקבל."**
//
// עד כאן הדוח ידע רק על מכשירים שנרשמו להתראות. **מי שלא אישרה התראות לא הופיעה בשום
// מספר**, מכשיר שהסירו ממנו את האפליקציה נמחק בשקט ולא נספר, ו"דילגו" ערבב מי שסיימה את
// התוכנית עם מי שבהקפאה. **ובמכשירים ולא בנשים**, כך שאישה עם טלפון ומחשב נספרה פעמיים.
//
// **שני החלקים מופרדים בכוונה:**
// 1. `api/notify.js` רושם אחרי השליחה מי קיבלה, לפי מייל. **הוא אינו קורא את הגיליון**,
//    ולכן שום דבר כאן אינו יכול לעכב או לעצור התראה אחת.
// 2. הדוח של הבוקר קורא את הגיליון, מחשב מי הייתה אמורה לקבל, ומצליב.
//
// **והכלל של מי אמורה לקבל הוא אותו כלל ש-notify.js שולח לפיו**: ימים 1 עד 69 בבוקר,
// 3 עד 70 בערב, לא ביטלה, לא חסומה ולא בהקפאה, ואף אחת ביום שקט.

import { isQuietDay } from "./_hebcal.js";

export const WHO_TTL = 345600; // ארבעה ימים. הדוח קורא אותם למחרת בבוקר
export const whoKey = (date, kind, status) => `push:who:${date}:${kind}:${status}`;
export const WHO_STATUSES = ["sent", "failed", "pruned", "done"];

// אותם חלונות בדיוק כמו ב-api/notify.js. בדיקה נועלת שהם זהים.
export const AUDIT_DAYS = { morning: { first: 1, last: 69 }, evening: { first: 3, last: 70 } };

const low = (s) => String(s || "").trim().toLowerCase();

function programDay(start, date) {
  return Math.floor((new Date(date) - new Date(start)) / 86400000) + 1;
}

// מי הייתה אמורה לקבל, ומה קרה לכל אחת. פונקציה טהורה, בלי רשת, כדי שאפשר יהיה להריץ
// אותה בבדיקה על נתונים מדומים.
//
// women     - הנשים מהגיליון, כפי ש-loadSheet מחזיר אותן
// manual    - { מייל: JSON } מ-admin:manual, נשים שהמשרד הוסיף ביד
// overrides - { מייל: JSON } מ-admin:overrides, מה שהפקידה שינתה
// emailMap  - { חדש: ישן } מ-admin:emailmap, כתובת שהוחלפה ועוד לא הגיעה לגיליון
// appEmails - מי שהשאירה עקבה כלשהי באפליקציה החדשה
// subEmails - מי שיש לה עכשיו לפחות מכשיר אחד רשום להתראות
// who       - { sent, failed, pruned, done }, כל אחד Set של מיילים, מה ש-notify.js רשם
export function auditPush({ kind, date, women, manual, overrides, emailMap, appEmails, subEmails, who }) {
  if (isQuietDay(date)) return { quiet: true };
  const win = AUDIT_DAYS[kind];
  const renamed = {};
  Object.keys(emailMap || {}).forEach((to) => { renamed[low(emailMap[to])] = low(to); });

  // אותו סדר כמו במסך הניהול ובשער: הגיליון קודם ותמיד מנצח, והרישום הידני רק למי
  // שהגיליון אינו מחזיק.
  const list = [];
  const inSheet = new Set();
  (women || []).forEach((w) => {
    const em = renamed[low(w.email)] || low(w.email);
    inSheet.add(low(w.email));
    inSheet.add(em);
    list.push({ email: em, start: w.start || "", cancelled: !!w.cancelled, newApp: !!w.sheetNewApp });
  });
  Object.keys(manual || {}).forEach((em) => {
    if (inSheet.has(low(em))) return;
    let m = null;
    try { m = JSON.parse(manual[em]); } catch (e) {}
    if (!m || !m.start) return;
    list.push({ email: low(em), start: m.start, cancelled: false, newApp: true });
  });

  const has = (set, em) => !!(set && set.has(em));
  const out = { quiet: false, should: 0, got: 0, noSub: 0, pruned: 0, failed: 0, missed: 0, done: 0, oldApp: 0 };
  const seen = new Set();
  list.forEach((w) => {
    if (!w.email || seen.has(w.email)) return;
    seen.add(w.email);
    if (w.cancelled) return;
    let o = null;
    try { o = overrides && overrides[w.email] ? JSON.parse(overrides[w.email]) : null; } catch (e) {}
    if (o && o.blocked === "1") return;
    // אותו תנאי הקפאה כמו ב-notify.js, רק ביחס לתאריך שנבדק ולא ליום הדוח.
    if (o && o.freeze && (!o.freeze.back || !o.freeze.week || date < o.freeze.back)) return;
    const start = (o && o.start) || w.start;
    if (!start) return;
    const d = programDay(start, date);
    if (d < win.first || d > win.last) return;

    // **נשים באפליקציה הישנה אינן אמורות לקבל כלום מהאפליקציה הזאת**, וזה אותו כלל של
    // מסך הניהול: עמודה בגיליון, רישום ידני, או עקבה שהשאירה באפליקציה.
    const onApp = w.newApp || has(appEmails, w.email) || has(subEmails, w.email)
      || has(who.sent, w.email) || has(who.failed, w.email) || has(who.pruned, w.email);
    if (!onApp) { out.oldApp++; return; }

    // בערב, מי שהשלימה את היום לפני התזכורת שלה לא מקבלת אותה בכוונה, ולכן היא לא
    // נספרת כמי שהייתה אמורה לקבל. **ומי שקיבלה ואחר כך השלימה נספרת כמי שקיבלה.**
    if (kind === "evening" && has(who.done, w.email) && !has(who.sent, w.email)) { out.done++; return; }

    out.should++;
    if (has(who.sent, w.email)) out.got++;
    else if (has(who.failed, w.email)) out.failed++;
    else if (has(who.pruned, w.email)) out.pruned++;
    else if (has(subEmails, w.email)) out.missed++;
    else out.noSub++;
  });
  return out;
}

// קריאת כל מה שהחישוב צריך, מ-Redis ומהגיליון. **כל מקור שנכשל מחזיר ריק ולא זורק**,
// חוץ מהגיליון: בלעדיו אין מכנה, והדוח אומר "לא נמדד" במקום להציג מספר שגוי.
export async function loadAuditInputs({ redisCmd, base, token, loadSheet, csvUrl }) {
  const flat = (v) => {
    const o = {};
    if (Array.isArray(v)) { for (let i = 0; i < v.length; i += 2) o[v[i]] = v[i + 1]; return o; }
    return v && typeof v === "object" ? v : o;
  };
  const hget = async (k) => { try { return flat(await redisCmd(base, token, ["HGETALL", k])); } catch (e) { return {}; } };
  const sheet = await loadSheet(csvUrl, base, token);
  const overrides = await hget("admin:overrides");
  const manual = await hget("admin:manual");
  const emailMap = await hget("admin:emailmap");
  const seenApp = await hget("admin:seen");
  const appEmails = new Set(Object.keys(seenApp).map(low));
  for (const [pattern, cut] of [["bk:*", 3], ["devices:*", 8]]) {
    try {
      const keys = (await redisCmd(base, token, ["KEYS", pattern])) || [];
      keys.forEach((k) => { const e = low(String(k).slice(cut)); if (e.includes("@")) appEmails.add(e); });
    } catch (e) {}
  }
  const subEmails = new Set();
  Object.values(await hget("push:subs")).forEach((v) => {
    try { const j = JSON.parse(v); if (j && j.email) subEmails.add(low(j.email)); } catch (e) {}
  });
  return { women: sheet.women || [], overrides, manual, emailMap, appEmails, subEmails };
}

// מה ש-notify.js רשם לתאריך ולסוג. **null כשלא נרשם דבר**, כדי שהדוח יבדיל בין "אף אחת
// לא קיבלה" לבין "הרישום לא קיים", למשל בבוקר הראשון אחרי שזה עלה.
export async function loadWho({ redisCmd, base, token, date, kind }) {
  const who = {};
  let any = false;
  for (const s of WHO_STATUSES) {
    try {
      const arr = (await redisCmd(base, token, ["SMEMBERS", whoKey(date, kind, s)])) || [];
      who[s] = new Set(arr.map(low));
      if (arr.length) any = true;
    } catch (e) { who[s] = new Set(); }
  }
  return any ? who : null;
}
