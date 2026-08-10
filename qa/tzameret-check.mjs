#!/usr/bin/env node
/* ============================================================================
   שכבה 1: טבלת המזונות של האפליקציה מול מאגר משרד הבריאות ("צמרת")

   `qa/food-check.mjs` בודק שהטבלה עקבית עם עצמה. הבדיקה הזאת בודקת משהו אחר
   לגמרי: שהמספרים **נכונים** מול מקור סמכותי ישראלי.

   שני דברים שחייבים להיות מובנים כדי שהשוואה כזאת תהיה שווה משהו:

   1. **צמרת מדווח פחמימות בניכוי סיבים, והאפליקציה כוללת אותם.** בלי לתקן את
      זה, כמעט כל שורה הייתה מדווחת כשגויה. אבוקדו הוא 1.8 גרם פחמימה בצמרת
      ו-9 באפליקציה, וההפרש הוא בדיוק 6.7 גרם הסיבים. לכן ההשוואה היא מול
      `carbohydrates + total_dietary_fiber`.

   2. **התאמת השם היא שיקול דעת, ולכן היא קפואה בקוד ולא מחושבת בכל הרצה.**
      חיפוש אוטומטי לפי שם היה מתאים "חומוס" לגרגירים מבושלים במקום לממרח,
      ומחזיר תשובה אחרת בכל פעם שהמאגר מתעדכן. הטבלה למטה נבחרה ידנית ב-10
      באוגוסט 2026, וכל שורה בה היא החלטה שאפשר לבדוק.

   מזון שאין לו מקבילה בצמרת (יוגורט יווני, סלט ירקות, קפה עם חלב) **מדווח
   במפורש כלא מושווה**, ולא מדולג בשקט.

   דורש רשת:  node qa/tzameret-check.mjs
   לעבודה לא מקוונת:  TZAMERET_FILE=<נתיב> node qa/tzameret-check.mjs
   ========================================================================== */

import { readFileSync } from "node:fs";

const RESOURCE = "c3cb0630-0650-46c1-a068-82d575c094b2"; // "רשימת המצרכים ... ל 100 גרם"
const DATA_URL = `https://data.gov.il/api/3/action/datastore_search?resource_id=${RESOURCE}&limit=5000` +
  "&fields=smlmitzrach,shmmitzrach,protein,total_fat,carbohydrates,food_energy,total_dietary_fiber";

// app food id -> צמרת code (smlmitzrach). Chosen by hand; see the note above.
const MAP = {
  ban: 63107010,        // בננה, טריה, בלי קליפה
  chk: 24120120,        // בשר עוף, חזה, ללא עצם, נאכל ללא עור
  rice: 56204930,       // אורז לבן, מבושל, ללא תוספת שומן
  cot: 14201019,        // גבינת קוטג' 5% שומן, תנובה
  oat: 57602100,        // שיבולת שועל, קוואקר, לא מבושל
  egg: 31101010,        // ביצה שלמה בלי קליפה
  bread: 51101009,      // לחם לבן
  pita: 51140559,       // פיתה, קלויה
  pasta: 56130010,      // אטריות/פסטה, חיטה, מבושלות, ללא תוספת שמן
  salmon: 26137108,     // דג סלמון אפוי ללא תוספת שומן בבישול
  ycheese: 14108409,    // גבינה צהובה 28% שומן
  milk: 11111009,       // חלב 3% שומן
  apple: 63101000,      // תפוח עץ, עם קליפה
  cuke: 75111030,       // מלפפון, טרי, עם קליפה
  tomato: 74101000,     // עגבניה, טריה
  avocado: 63105010,    // אבוקדו
  tahini: 43103119,     // טחינה גולמית, שומשום מלא, לא מדוללת
  hummus: 41205078,     // סלט חומוס, ביתי
  almond: 42101000,     // שקדים לא קלויים, ללא מלח
  potato: 71103010,     // תפוחי אדמה, מבושלים, ללא קליפה
  lentil: 41305000,     // עדשים יבשים, מבושלים
  sugar: 91101010,      // סוכר לבן
  oil: 82101000,        // שמן צמחי
  butter: 81101100,     // חמאה, ללא מלח
  honey: 91302010,      // דבש
  flour: 50010030,      // קמח חיטה לבן
  salt: 91000000,       // מלח
  tuna: 26155190,       // דג טונה, משומר במים
  wcheese: 14210109,    // גבינה לבנה 5% שומן, תנובה
  blackcoffee: 92101610, // קפה, אספרסו/שחור, לא ממותק
};

// No counterpart in צמרת, and saying so is more honest than forcing a match.
const NO_MATCH = {
  yog: "אין יוגורט יווני בצמרת. הערכים באפליקציה הם של יוגורט יווני 5% ממקור אחר",
  sal: "\"סלט ירקות\" הוא מנה ולא מצרך. כל השורות בצמרת כוללות שמן",
  cof: "\"קפה עם חלב\" תלוי לגמרי בכמות החלב ובסוכר",
  beef: "\"בשר בקר רזה\" הוא קטגוריה. בצמרת יש נתח נפרד לכל חיתוך, מ-177 ועד 287 קלוריות",
};

const KCAL_TOL = 0.10;   // 10%
const MACRO_TOL = 0.20;  // 20%, ומעל גרם אחד הפרש מוחלט
const MACRO_ABS = 1;

const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const i = src.indexOf("const FOODS");
const start = src.indexOf("[", i);
let depth = 0, end = start;
for (let k = start; k < src.length; k++) {
  if (src[k] === "[") depth++;
  else if (src[k] === "]" && --depth === 0) { end = k + 1; break; }
}
const FOODS = new Function("return " + src.slice(start, end))();

async function load() {
  const file = process.env.TZAMERET_FILE;
  if (file) return JSON.parse(readFileSync(file, "utf8"));
  const r = await fetch(DATA_URL);
  if (!r.ok) throw new Error(`data.gov.il החזיר ${r.status}`);
  return r.json();
}

let data;
try { data = await load(); }
catch (e) {
  console.log(`נכשל | לא הצלחתי להגיע למאגר: ${e.message}`);
  console.log("       הבדיקה הזאת דורשת רשת אל data.gov.il.");
  process.exit(1);
}

const rows = ((data.result && data.result.records) || []);
if (!rows.length) { console.log("נכשל | המאגר החזיר אפס שורות"); process.exit(1); }
const byCode = new Map(rows.map((r) => [Number(r.smlmitzrach), r]));
console.log(`נטענו ${rows.length} שורות מצמרת.\n`);

const n = (v) => { const x = parseFloat(v); return isFinite(x) ? x : 0; };
const off = (app, ref, tol, abs) => {
  const gap = Math.abs(app - ref);
  return gap > abs && (ref === 0 ? gap > abs : gap / Math.max(ref, 0.1) > tol);
};

const findings = [];
let compared = 0, missing = 0;

for (const f of FOODS) {
  if (NO_MATCH[f.id]) continue;
  const code = MAP[f.id];
  if (!code) { missing++; console.log(`חסר   | ${f.name} (${f.id}) אינו במפה ואינו ברשימת חסרי המקבילה`); continue; }
  const r = byCode.get(code);
  if (!r) { missing++; console.log(`חסר   | ${f.name}: הקוד ${code} לא נמצא בצמרת. ייתכן שהמאגר עודכן`); continue; }
  compared++;

  const a = f.per100 || {};
  const ref = {
    kcal: n(r.food_energy),
    p: n(r.protein),
    f: n(r.total_fat),
    c: n(r.carbohydrates) + n(r.total_dietary_fiber), // צמרת נותן פחמימות בלי סיבים
  };
  const bad = [];
  if (ref.kcal >= 20 && off(n(a.kcal), ref.kcal, KCAL_TOL, 5)) bad.push(`קלוריות ${a.kcal} מול ${ref.kcal}`);
  for (const [key, label] of [["p", "חלבון"], ["f", "שומן"], ["c", "פחמימה"]]) {
    if (off(n(a[key]), ref[key], MACRO_TOL, MACRO_ABS)) bad.push(`${label} ${a[key]} מול ${Math.round(ref[key] * 10) / 10}`);
  }
  if (bad.length) {
    findings.push({ f, r, bad });
    console.log(`חריגה | ${f.name}`);
    console.log(`        צמרת: ${r.shmmitzrach.slice(0, 60)}`);
    console.log(`        ${bad.join(" · ")}`);
  }
}

console.log("");
for (const [id, why] of Object.entries(NO_MATCH)) {
  const f = FOODS.find((x) => x.id === id);
  console.log(`לא הושווה | ${f ? f.name : id}: ${why}`);
}

console.log(`\nהושוו ${compared} מזונות מול צמרת, ${Object.keys(NO_MATCH).length} ללא מקבילה, ${missing} חסרים.`);
console.log(`נמצאו ${findings.length} חריגות.`);
// Findings here are for a human to judge, not a build breaker: a gap can mean the app is
// wrong, or that צמרת describes a different variety of the same food.
process.exit(missing ? 1 : 0);
