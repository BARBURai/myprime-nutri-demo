// המסנן שקובע מה מתוך המאגר הגדול מוצג בחיפוש לכל הנשים. v7.48
//
// **המאגר עצמו ממשיך להתמלא בדיוק כמו קודם**, מכל פריט שנרשם ביומן (`cat:<שם>`).
// מה שנוסף כאן הוא השער שבינו לבין החיפוש: פריט מופיע לנשים אחרות רק אם עבר את שלוש
// הבדיקות, והוא נכנס לאינדקס `catidx` שהחיפוש קורא ממנו.
//
//   1. השם הוא של מזון ולא של צלחת אישית     nameProblem()
//   2. המספרים מתיישבים זה עם זה              plausiblePer100() ב-lib/foodcheck.js
//   3. בדיקה חד פעמית של הבינה                 judgePrompt() / parseJudge()
//
// **ומה שלא עבר אינו נמחק.** הוא נשאר במאגר ופשוט אינו מוצג.
//
// נשמר מחוץ ל-/api כדי שוורסל לא יספור אותו כפונקציה, ובלי תלות ב-Redis כדי שאפשר יהיה
// להריץ אותו בבדיקה כמו שהוא.

import { normName } from "./foodcheck.js";

// מילים שאומרות כמות או כלי ולא מזון. "שתי ביצים", "חצי פיתה", "כוס קפה", "מנת פסטה".
// הערכים ל-100 גרם שבפריט כזה נכונים בדרך כלל, **אבל השם הוא של הצלחת שלה ולא של מוצר**,
// ואישה אחרת שמחפשת "ביצה" אינה אמורה לקבל "שתי ביצים".
const QTY_WORDS = new Set(
  "חצי רבע שליש שתי שני שלוש שלושה ארבע ארבעה חמש חמישה כוס כוסות כף כפות כפית כפיות יחידה יחידות מנה מנת חתיכה חתיכות קערה קערת קערית צלחת סיר שלם שלמה פרוסה פרוסות ביס ביסים זוג".split(" ")
);

// הסוגריים הם כמעט תמיד הכמות או המתכון שלה: "תפוח פינק ליידי (חצי)", "לחם מחמצת (2 פרוסות
// לכריך)", "קציצות קינואה (קינואה, קישוא, בטטה)". **הערכים ל-100 גרם אינם תלויים בהם**, ולכן
// מורידים אותם מהשם במקום לפסול את הפריט.
//
// **וגם מילת גודל או "טרי" יורדת**, מאותה סיבה: "נקטרינה בינונית", "נקטרינה קטנה" ו"נקטרינה גדולה" הם
// אותו מזון ל-100 גרם, ובלי זה אישה שמחפשת נקטרינה הייתה מקבלת שבע שורות של אותו פרי.
// נמצא בהרצה על המאגר האמיתי, 24 בספטמבר 2026.
const SIZE_WORDS = new Set("קטן קטנה קטנים קטנות בינוני בינונית בינוניים בינוניות גדול גדולה גדולים גדולות טרי טריה טרייה טריים טריות".split(" "));
export function cleanName(raw) {
  return String(raw || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[()]/g, " ")
    .replace(/[!?]+/g, " ")
    .split(/\s+/)
    .filter((w) => !w.split("-").every((p) => SIZE_WORDS.has(p)))
    .join(" ")
    .trim()
    .replace(/^[-\s]+|[-\s]+$/g, "");
}

// null = השם תקין. אחרת הסיבה, במילה אחת, כדי שהבדיקה וההדגמה יוכלו להציג אותה.
export function nameProblem(raw) {
  const s = String(raw || "");
  const n = cleanName(s);
  if (n.length < 2 || !/[֐-׿a-zA-Z]/.test(n)) return "empty";
  // כמה מזונות יחד. " + " היא הצורה של ארוחה שנרשמה כפריט אחד, ופסיק או לוכסן הם שמות
  // מהמאגר הלאומי ("תפוחי אדמה, חטיף, תפוצ'יפס/טבעי"), שממילא נמצאים בחיפוש דרכו.
  if (s.includes("+") || /[,;/]/.test(n)) return "combo";
  if (/(^|\s)או(\s|$)/.test(n)) return "combo";
  // מספר שאינו אחוז שומן הוא כמות: "חביתה 2 ביצים", "x2". "גבינה 5%" ו"יוגורט 1.5%" תקינים.
  if (/\d/.test(n.replace(/\d+(\.\d+)?\s?%/g, ""))) return "qty";
  // מקף בודד אינו מילה: "קפה הפוך על בסיס חלב חלקי - קטן" הוא שש מילים.
  const words = n.split(" ").filter((w) => /[\u0590-\u05FFa-zA-Z]/.test(w));
  if (words.some((w) => QTY_WORDS.has(w))) return "qty";
  // שם ארוך הוא תיאור של צלחת מסוימת: "אייס קפה קטן ארומה עם חלב רגיל וסוכר".
  if (words.length > 6 || n.length > 45) return "long";
  return null;
}

// המפתח באינדקס. שני שמות שונים שמתנקים לאותו שם ("תפוח עץ (חצי)" ו"תפוח עץ") הם פריט אחד.
// גרש עברי ומרכאות עבריות יורדים, כדי ש"קוטג׳" ו"קוטג'" יהיו אותו פריט ואותו חיפוש.
// **normName עצמו לא שונה**, כי הוא המפתח של כל מה שכבר שמור במאגר.
export const searchKey = (s) => normName(s).replace(/[\u05F3\u05F4]/g, "").replace(/\s+/g, " ").trim();
export const indexField = (raw) => searchKey(cleanName(raw));

// Redis MATCH הוא glob, ולכן כוכבית או סוגר מרובע בשאילתה היו משנים את משמעותה.
export const escapeGlob = (s) => String(s).replace(/[*?[\]\\]/g, (c) => "\\" + c);

// הסדר בתוצאות: שם זהה, ואחריו שם שמתחיל במה שהקלידה, ואחריו מילה שמתחילה בו, ורק אז
// כל התאמה אחרת. בתוך כל דרגה, מה שנרשם יותר פעמים קודם.
export function hitRank(field, nq) {
  if (field === nq) return 0;
  if (field.startsWith(nq)) return 1;
  if (field.includes(" " + nq)) return 2;
  return 3;
}

// ---------- בדיקת הבינה ----------
// **פעם אחת לכל פריט**, ובקבוצות של עד 40 בקריאה אחת. התשובה נשמרת יחד עם הערכים שנבדקו,
// ובדיקה חוזרת קורית רק אם הערכים השתנו.
//
// **כשהבינה אינה בטוחה היא אומרת לא.** פריט שנפסל בטעות פשוט אינו מוצג, והאישה מוצאת
// אותו במאגר הלאומי או בבינה כמו היום. פריט שעבר בטעות מוצג לכולן.
export const JUDGE_SYSTEM = `You check entries for a shared food database used by Israeli women tracking what they eat.
Each entry is a food name (usually Hebrew) and its nutrition PER 100 grams (or 100 ml for drinks):
kcal, protein (p), fat (f), carbs (c).

Answer OK only if ALL of these hold:
1. The name is a real food, dish, drink or packaged product that another woman could plausibly search for. Brand names are fine.
2. The name has no spelling mistakes and no gibberish.
3. The name is not a personal description of one plate (not "the soup my mother made", not a list of several separate foods).
4. The four numbers are reasonable for that food per 100 g: each within about 30% of typical values, or a small absolute difference for small values.

Otherwise answer BAD. If you are not sure, answer BAD.

Reply with one line per entry and nothing else, in this exact form:
<number>:OK
<number>:BAD <a few words why>`;

export function judgePrompt(entries) {
  return entries
    .map((e, i) => {
      const p = e.per100 || {};
      const u = e.unit === "ml" ? "100ml" : "100g";
      return `${i + 1}. ${e.name} | per ${u}: kcal ${p.kcal}, p ${p.p}, f ${p.f}, c ${p.c}`;
    })
    .join("\n");
}

// מחזיר מערך באורך הקלט: true, false, או null כשהבינה לא ענתה על השורה הזאת.
// **null אינו נשמר כתשובה**, והפריט ייבדק שוב בפעם הבאה.
export function parseJudge(text, count) {
  const out = new Array(count).fill(null);
  const why = new Array(count).fill("");
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = line.trim().match(/^(\d+)\s*[:.)-]\s*(OK|BAD)\b\s*(.*)$/i);
    if (!m) continue;
    const i = Number(m[1]) - 1;
    if (i < 0 || i >= count || out[i] !== null) continue;
    out[i] = m[2].toUpperCase() === "OK";
    why[i] = m[3].trim().slice(0, 80);
  }
  return { ok: out, why };
}
