// סדר הרשימה ביומן, ושדה כמות שמגיע עם ערך בפנים. בלי רשת ובלי עלות.
//
//   node qa/diary-order-check.mjs
//
// שני דברים נעולים כאן:
// 1. "מה שהוזן היום" מוצג לפי סדר ההזנה כברירת מחדל, ולפי הארוחה בלחיצה.
//    זו תצוגה בלבד: הקלוריות, הטבעת והמדליה ממשיכות להיחשב מכל היום.
// 2. שדה כמות שמגיע עם ערך בפנים מסמן אותו בכניסה, אחרת ההקלדה נדבקת אליו.
//    רינת לאון: "המספר 1 נשאר, לא יכולתי לרשום 70 אלא רק 71".
//
// הפונקציות נמשכות מ-src/App.jsx לפי מחרוזת ואינן מועתקות, כי העתק נסחף
// בעריכה הראשונה. זו בדיוק המלכודת ש-qa/prompt-sync-check.mjs קיימת כדי למנוע.

import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  ← " + extra : "")); }
};

console.log("\nסדר הארוחות ביומן");

const mealsSrc = src.match(/const MEALS = \[[^\]]*\];/);
const rankSrc = src.match(/function mealRank\(m\) \{[\s\S]*?\n\}/);
check("MEALS ו-mealRank קיימות ב-App.jsx", !!mealsSrc && !!rankSrc);
const mealRank = mealsSrc && rankSrc
  ? new Function(mealsSrc[0] + rankSrc[0] + "; return mealRank;")()
  : () => 0;

// אותו מיון בדיוק שהמסך עושה, מושך מהקוד ולא מועתק.
const sortSrc = src.match(/const shownLog = byMeal \? dayLog\.slice\(\)\.sort\(\(a, b\) => mealRank\(a\.meal\) - mealRank\(b\.meal\)\) : dayLog;/);
check("מסלול המיון נמצא ב-App.jsx", !!sortSrc);
const sortByMeal = (rows) => rows.slice().sort((a, b) => mealRank(a.meal) - mealRank(b.meal));

// כפי שהיא רשמה בפועל: קודם משהו מהערב, אחר כך הבוקר, ובאמצע נשנוש.
const entered = [
  { id: 1, meal: "ערב", name: "סלמון" },
  { id: 2, meal: "בוקר", name: "פרוסת לחם" },
  { id: 3, meal: "נשנושים", name: "שקדים" },
  { id: 4, meal: "בוקר", name: "ביצה" },
  { id: 5, meal: "צהריים", name: "אורז" },
];
const sorted = sortByMeal(entered);
check("הבוקר עולה לראש והנשנושים לסוף",
  sorted.map((e) => e.meal).join(",") === "בוקר,בוקר,צהריים,ערב,נשנושים",
  sorted.map((e) => e.meal).join(","));
check("ובתוך אותה ארוחה נשמר סדר ההזנה",
  sorted[0].name === "פרוסת לחם" && sorted[1].name === "ביצה",
  sorted[0].name + " " + sorted[1].name);
check("ארוחה שאינה ברשימה יורדת לסוף ולא עולה לראש",
  sortByMeal([{ meal: "משהו אחר" }, { meal: "בוקר" }])[0].meal === "בוקר");
check("ביניים בוקר יושבת בין הבוקר לצהריים",
  mealRank("בוקר") < mealRank("ביניים בוקר") && mealRank("ביניים בוקר") < mealRank("צהריים"));

// ברירת המחדל היא סדר ההזנה. מי שלא נוגעת בכפתור לא רואה שום שינוי.
check("ברירת המחדל היא סדר ההזנה",
  /useState\(\(\) => \{ try \{ return localStorage\.getItem\(DIARY_ORDER_KEY\) === "meal"; \} catch \{ return false; \} \}\)/.test(src));
check("והבחירה נזכרת על המכשיר שלה",
  /localStorage\.setItem\(DIARY_ORDER_KEY, n \? "meal" : "add"\)/.test(src));

// הכפתור אומר מה יקרה אם לוחצים עליו, ולא מה מוצג עכשיו.
check("הכפתור מציע את האפשרות השנייה", /\{byMeal \? "לפי סדר ההזנה" : "לפי הארוחה"\}/.test(src));
check("ואינו מוצג כשיש פריט אחד בלבד", /\{dayLog\.length > 1 && \(/.test(src));

// תצוגה בלבד: שום מספר לא זז.
check("הקלוריות נספרות מכל היום ולא מהרשימה הממוינת",
  /const consumed = dayLog\.reduce\(\(s, e\) => s \+ \(e\.kcal \|\| 0\), 0\);/.test(src));
check("החלבון והמאקרו גם הם", /const macros = dayLog\.reduce\(/.test(src));
check("והרשימה עצמה מציירת את הממוינת", /\{shownLog\.map\(\(e\) => \(/.test(src));
// הצעד בסיור מצביע על הרשימה הזאת, והוא נשבר אם התווית נעלמת.
check("עוגן הסיור נשאר על השורה", (src.match(/data-tut="diarylist"/g) || []).length === 1);

console.log("\nשדה כמות שמגיע עם ערך בפנים");
// שני המונים, זה של הוספת מזון וזה של אישור אופציה, וחמשת שדות ההזנה הידנית
// שמגיעים מלאים כשהיא מתקנת ערכים מהתווית.
const sel = (src.match(/onFocus=\{\(e\) => e\.target\.select\(\)\}/g) || []).length;
check("שבעה שדות מסמנים את תוכנם בכניסה", sel === 7, "נמצאו " + sel);
check("המונה של הוספת מזון בהם",
  /setGrams\(Math\.max\(1, c\) \* au\.g\); \}\} onFocus=\{\(e\) => e\.target\.select\(\)\}/.test(src));
check("והמונה של אישור האופציה",
  /setChosen\(\{ \.\.\.chosen, grams: Math\.max\(1, c\) \* au\.g \}\); \}\} onFocus=\{\(e\) => e\.target\.select\(\)\}/.test(src));
for (const [label, setter] of [["כמות", "setMAmount"], ["קלוריות", "setMKcal"], ["חלבון", "setMProt"], ["שומן", "setMFat"], ["פחמימות", "setMCarb"]]) {
  check("שדה " + label + " בהזנה הידנית",
    new RegExp(setter + '\\(e\\.target\\.value\\.replace\\(/\\[\\^0-9\\.\\]/g, ""\\)\\)\\} onFocus=\\{\\(e\\) => e\\.target\\.select\\(\\)\\}').test(src));
}

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.");
process.exit(fail ? 1 : 0);
