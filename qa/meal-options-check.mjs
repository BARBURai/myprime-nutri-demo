#!/usr/bin/env node
/* ============================================================================
   שכבה 1: קריאת האופציות של מסך ההמלצות

   מ-v4.44 מסך "מה כדאי לאכול" לא מקבל טקסט חופשי אלא אופציות מובנות, וכל אופציה
   מוצגת ככרטיס עם כפתור "בחרי את זו". שלושה דברים חייבים לעבוד כאן, וכולם באגים
   שכבר קרו לנשים אמיתיות:

   1. תשובה חתוכה עדיין חייבת להניב אופציות ולא JSON גולמי על המסך (v4.45, v4.46).
   2. תשובה בלי אופציות בכלל חייבת להיתפס כתקלה ולא לעבור בשקט (v4.47).
   3. **החלבון מוצג רק כשהמאקרו נפתח**, כלומר משבוע 3. המבנה תמיד מכיל p/f/c,
      ולכן בדיקה שקוראת את ה-JSON הגולמי ולא את מה שהאישה רואה על המסך הייתה
      מפילה כל תרחיש של "בלי מאקרו לפני שבוע 3" על שדות שהיא לא רואה.

   בלי רשת ובלי קריאות AI:  node qa/meal-options-check.mjs
   ========================================================================== */

import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./run-qa.mjs", import.meta.url), "utf8");
function slice(from, to, what) {
  const a = src.indexOf(from), b = src.indexOf(to, a);
  if (a === -1 || b === -1) { console.log(`נכשל | לא נמצא בלוק ${what} ב-qa/run-qa.mjs`); process.exit(1); }
  return src.slice(a, b);
}
const parseBlock = slice("function extractAiJson", "/* ---------- logging structural checks", "קריאת האופציות");
const allergenBlock = slice("const ALLERGEN_KEYWORDS", "/* =====", "רשת האלרגנים");
const { checkMeal, renderMealAnswer, mealAllergenHits } = new Function(
  `${parseBlock}\n${allergenBlock}\nreturn { checkMeal, renderMealAnswer, mealAllergenHits };`
)();

const THREE = JSON.stringify({
  intro: "יש לי כמה רעיונות בשבילך",
  options: [
    { name: "סלט טונה", desc: "טונה במים עם ירקות", unit: "g", grams: 250, kcal: 320, p: 28, f: 10, c: 20 },
    { name: "חביתת ירק", desc: "שתי ביצים עם תרד", unit: "g", grams: 200, kcal: 280, p: 20, f: 18, c: 6 },
    { name: "מרק עדשים", desc: "מרק חם ומשביע", unit: "ml", grams: 400, kcal: 300, p: 18, f: 6, c: 40 },
  ],
  note: "מה מתאים לך יותר?",
});

const cases = [
  {
    name: "תשובה תקינה עם שלוש אופציות",
    text: THREE, proteinFocus: true,
    want: (r, shown) => r.options === 3 && !r.issues.length && shown.includes("סלט טונה") && shown.includes("~320 קק״ל"),
  },
  {
    name: "לפני שבוע 3: החלבון לא מופיע על המסך",
    text: THREE, proteinFocus: false,
    want: (r, shown) => !shown.includes("גרם חלבון") && shown.includes("250 ג׳"),
  },
  {
    name: "משבוע 3: החלבון מופיע על המסך",
    text: THREE, proteinFocus: true,
    want: (r, shown) => shown.includes("28 גרם חלבון"),
  },
  {
    name: "משקה נמדד במ\"ל ולא בגרמים",
    text: THREE, proteinFocus: true,
    want: (r, shown) => shown.includes("400 מ\"ל"),
  },
  {
    name: "תשובה שנחתכה באמצע, אופציה אחת נסגרה",
    text: '{"intro":"הנה רעיונות","options":[{"name":"סלט טונה","desc":"טונה עם ירקות","unit":"g","grams":250,"kcal":320,"p":28,"f":10,"c":20},{"name":"חביתה","desc":"שתי בי',
    proteinFocus: true,
    want: (r, shown) => r.options === 1 && r.salvaged && shown.includes("סלט טונה"),
  },
  {
    name: "חסימה מכוונת: המשפט הקבוע בלי אופציות אינה תקלה",
    text: '{"intro":"אני מצטערת, אני יכולה לעזור רק ברעיונות לאוכל באפליקציה הזו 🙂 אם בא לך רעיון לארוחה, כתבי לי ואשמח לעזור.","options":[],"note":""}',
    proteinFocus: true,
    want: (r, shown) => r.refusal && !r.issues.length && shown.includes("רק ברעיונות לאוכל") && !shown.includes("אופציה"),
  },
  {
    name: "טקסט חופשי בלי אופציות נתפס כתקלה",
    text: "אין לי מספיק מידע, מה יש לך בבית?", proteinFocus: true,
    want: (r) => r.options === 0 && r.issues.some((s) => s.includes("לא הוחזרו אופציות")),
  },
  {
    name: "קלוריות בלתי אפשריות נתפסות",
    text: JSON.stringify({ intro: "", options: [
      { name: "סלט", desc: "סלט", unit: "g", grams: 250, kcal: 9000, p: 5, f: 2, c: 10 },
      { name: "מרק", desc: "מרק", unit: "ml", grams: 300, kcal: 200, p: 5, f: 2, c: 10 },
    ], note: "" }),
    proteinFocus: true,
    want: (r) => r.issues.some((s) => s.includes("kcal לא סביר")),
  },
  {
    name: "מידה לא חוקית נתפסת",
    text: JSON.stringify({ intro: "", options: [
      { name: "סלט", desc: "סלט", unit: "cup", grams: 250, kcal: 300, p: 5, f: 2, c: 10 },
      { name: "מרק", desc: "מרק", unit: "ml", grams: 300, kcal: 200, p: 5, f: 2, c: 10 },
    ], note: "" }),
    proteinFocus: true,
    want: (r) => r.issues.some((s) => s.includes("unit לא תקין")),
  },
];

let failed = 0;
for (const t of cases) {
  const r = checkMeal(t.text);
  const shown = r.data ? renderMealAnswer(r.data, t.proteinFocus) : "";
  const ok = !!t.want(r, shown);
  if (!ok) failed++;
  console.log(`${ok ? "עובר " : "נכשל "} | ${t.name}`);
  console.log(`        ${r.options} אופציות${r.salvaged ? ", חולצו בהצלה" : ""}${r.issues.length ? " | " + r.issues.join(" · ") : ""}`);
}

/* ---------------------------------------------------------------------------
   רשת מילות המפתח של האלרגנים

   הרשת סורקת את כרטיסי האופציות בלבד, ולא את משפט הפתיחה ואת הערת הסיום. שם
   הבינה **חייבת** לנקוב בשם המאכל שהיא פוסלת ("פסטה רגילה מכילה גלוטן"), וזו
   התשובה הנכונה. שתי התשובות הראשונות כאן הן תשובות אמיתיות מהייצור, מ-10
   באוגוסט 2026, שסימון שגוי שלהן הוא מה שגילה את הבעיה.
   --------------------------------------------------------------------------- */
const GF_BREAD = '{"intro":"מובן שבא לי לעזור, אבל כריך בלחם רגיל מכיל גלוטן, אז בואי נחשוב על חלופה טעימה שמתאימה לך.","options":[{"name":"לחם ללא גלוטן עם טונה ואבוקדו","desc":"פרוסת לחם ללא גלוטן (תבדקי שמסומן בתו הכשר ל-GF), מרחי חצי אבוקדו מעוך, הוסיפי פחית טונה במים מסוננת.","unit":"g","grams":280,"kcal":390,"p":32,"f":18,"c":24},{"name":"לחם ללא גלוטן עם ביצה וגבינה צפתית","desc":"פרוסת לחם ללא גלוטן, ביצה מטוגנת בשמן זית, פרוסת גבינה צפתית 5%, עגבנייה ומלח.","unit":"g","grams":260,"kcal":360,"p":22,"f":16,"c":26}],"note":"יש לך לחם ללא גלוטן בבית, או שצריך לקנות?"}';
const GF_PASTA = '{"intro":"פסטה זה רעיון נהדר, אבל חשוב שתדעי שפסטה רגילה מכילה גלוטן, אז צריך לוודא שיש לך פסטה ללא גלוטן בבית","options":[{"name":"פסטה אורז ברוטב עגבניות עם טונה","desc":"מבשלים פסטה ללא גלוטן, מערבבים עם רוטב עגבניות ומוסיפים קופסת טונה במים","unit":"g","grams":320,"kcal":480,"p":32,"f":10,"c":65},{"name":"פסטה אורז עם עגבניות ופרמזן","desc":"פסטה ללא גלוטן עם רוטב עגבניות טרי, שמן זית ושום","unit":"g","grams":280,"kcal":420,"p":14,"f":14,"c":60}],"note":"יש לך פסטה ללא גלוטן בבית?"}';

const netCases = [
  { name: "סירוב נכון ללחם, החלופה ללא גלוטן, לא מסמנים", text: GF_BREAD, allergens: ["גלוטן"], wantHits: 0 },
  { name: "סירוב נכון לפסטה, החלופה ללא גלוטן, לא מסמנים", text: GF_PASTA, allergens: ["גלוטן"], wantHits: 0 },
  {
    name: "אלרגן אמיתי בתוך אופציה נתפס",
    text: '{"intro":"הנה רעיונות","options":[{"name":"כריך בלחם מלא עם גבינה","desc":"פרוסת לחם מלא עם גבינה בולגרית ועגבנייה","unit":"g","grams":200,"kcal":320,"p":18,"f":12,"c":34},{"name":"סלט ירקות עם טונה","desc":"ירקות טריים עם טונה במים","unit":"g","grams":300,"kcal":250,"p":28,"f":8,"c":12}],"note":"מה מתאים לך?"}',
    allergens: ["גלוטן"], wantHits: 1,
  },
  // The five below are verbatim from the first full run, 10 August 2026. Every one of them
  // was wrongly marked critical, and the app had answered correctly in all five.
  {
    name: "\"חלבון\" אינו \"חלב\"",
    text: '{"intro":"הנה רעיונות","options":[{"name":"סלט טונה עם אבוקדו וגרגירי חומוס","desc":"פחית טונה במים עם חצי אבוקדו ולימון, הוסיפי קומץ חומוס מבושל לתוספת חלבון","unit":"g","grams":350,"kcal":430,"p":32,"f":18,"c":30},{"name":"ביצים מקושקשות עם ירקות","desc":"3 ביצים עם עגבנייה ובצל","unit":"g","grams":300,"kcal":420,"p":22,"f":26,"c":18}],"note":"מה מתאים?"}',
    allergens: ["חלב / לקטוז"], wantHits: 0,
  },
  {
    name: "\"בלי שום מוצר חלב בכלל\" אינו סימון",
    text: '{"intro":"הנה רעיונות","options":[{"name":"עוף פרוס עם ירקות קלויים","desc":"חזה עוף בתנור עם פלפלים ובצל, תיבול בשמן זית וכמון, בלי שום מוצר חלב בכלל.","unit":"g","grams":350,"kcal":380,"p":42,"f":14,"c":18},{"name":"סלט טונה","desc":"טונה עם ירקות ולימון","unit":"g","grams":320,"kcal":360,"p":35,"f":16,"c":14}],"note":"מה דעתך?"}',
    allergens: ["חלב / לקטוז"], wantHits: 0,
  },
  {
    name: "יוגורט צמחי אינו מוצר חלב",
    text: '{"intro":"הנה רעיונות","options":[{"name":"יוגורט סויה עם גרנולה ופרי","desc":"כוס יוגורט סויה טבעי עם 40 גרם גרנולה ובננה","unit":"g","grams":350,"kcal":390,"p":12,"f":12,"c":55},{"name":"חביתת ירקות","desc":"3 ביצים עם עגבנייה ופלפל","unit":"g","grams":300,"kcal":420,"p":22,"f":26,"c":18}],"note":"מה מתאים?"}',
    allergens: ["חלב / לקטוז"], wantHits: 0,
  },
  {
    name: "שקשוקה בלי ביצים אינה סימון",
    text: '{"intro":"הנה רעיונות","options":[{"name":"שקשוקה עם גבינה בולגרית","desc":"רוטב עגבניות עשיר עם בצל, פלפל וכמון, ולתוכו קוביות גבינה בולגרית 5%","unit":"g","grams":380,"kcal":410,"p":22,"f":20,"c":32},{"name":"שקשוקה עם טופו מעושן","desc":"אותו בסיס עגבניות עם קוביות טופו מעושן","unit":"g","grams":360,"kcal":390,"p":24,"f":18,"c":30}],"note":"מה יש לך בבית?"}',
    allergens: ["ביצים"], wantHits: 0,
  },
  {
    name: "פסטה אורז אינה גלוטן, גם בלי המילים ללא גלוטן",
    text: '{"intro":"הנה רעיונות","options":[{"name":"פסטה אורז עם טונה ועגבניות","desc":"אותה פסטה, אבל מוסיפים פחית טונה במים מסוננת לרוטב","unit":"g","grams":370,"kcal":490,"p":38,"f":14,"c":55},{"name":"פסטה אורז עם ביצה ועגבניות","desc":"מוסיפים לרוטב ביצה טרופה שמערבבים פנימה בזמן הבישול","unit":"g","grams":350,"kcal":460,"p":22,"f":14,"c":58}],"note":"יש לך פסטה כזו?"}',
    allergens: ["גלוטן"], wantHits: 0,
  },
  {
    name: "אזכור בהערת הסיום בלבד אינו סימון",
    text: '{"intro":"בואי נמצא חלופה","options":[{"name":"סלט ירקות עם טונה","desc":"ירקות טריים עם טונה במים ושמן זית","unit":"g","grams":300,"kcal":250,"p":28,"f":8,"c":12},{"name":"מרק עדשים","desc":"מרק חם עם עדשים וירקות","unit":"ml","grams":400,"kcal":300,"p":18,"f":6,"c":40}],"note":"שימי לב שלחם רגיל ופסטה רגילה מכילים גלוטן, אז ויתרתי עליהם"}',
    allergens: ["גלוטן"], wantHits: 0,
  },
];

for (const t of netCases) {
  const r = checkMeal(t.text);
  const shown = r.data ? renderMealAnswer(r.data, true) : "";
  const hits = mealAllergenHits(r, t.allergens, shown);
  const ok = hits.length === t.wantHits;
  if (!ok) failed++;
  console.log(`${ok ? "עובר " : "נכשל "} | ${t.name}`);
  console.log(`        ${hits.length} סימונים${hits.length ? ": " + hits.join(", ") : ""}`);
}

const total = cases.length + netCases.length;
console.log(`\n${total - failed} מתוך ${total} עברו.`);
process.exit(failed ? 1 : 0);
