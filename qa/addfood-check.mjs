// מסך הוספת המזון: אין הוספה מהירה בכמות של המאגר, וה-✕ במסך הכמות אינו סוגר הכל.
//
//   node qa/addfood-check.mjs
//
// רון, 28 באוגוסט 2026: "ההסתברות שבדיוק מה שרשום במאגר זה בדיוק מה שהיא אכלה
// היא אפסית, היא חייבת בכל מקרה למלא את הכמויות." ולכן הפלוס ירד מתוצאות החיפוש,
// והקשה בכל מקום בשורה פותחת את מסך הכמות.
//
// והפלוס במועדפים ובאחרונים נשאר בכוונה, וזה ההבדל שקובע: שם הכמות היא זו שהיא
// עצמה הזינה בפעם הקודמת (lastG), ובחיפוש היא של המאגר.
//
// ובנוסף: "לחצתי על המוצר עשיתי איקס, לא חזרתי למסך החיפוש." ✕ במסך הכמות עושה
// עכשיו בדיוק מה שחץ החזרה עושה.

import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  ← " + extra : "")); }
};

// שלוש רשימות התוצאות: המאגר המקומי, הקטלוג שלנו, והמאגר החיצוני.
const rows = src.match(/<div key=\{f\.id\} onClick=\{\(\) => pickFood\(f, g\)\} style=\{\{ display: "flex", justifyContent: "space-between"[^\n]*cursor: "pointer" \}\}>/g) || [];

console.log("\nתוצאות החיפוש");
check("שלוש רשימות התוצאות פותחות את מסך הכמות בהקשה על השורה", rows.length === 3, "נמצאו " + rows.length);
const chev = (src.match(/<ChevronLeft size=\{18\} color=\{C\.faint\} style=\{\{ flexShrink: 0 \}\} \/>/g) || []).length;
check("ולכל אחת מהן יש חץ שאומר שהיא נפתחת", chev === 3, "נמצאו " + chev);

// זה מה שירד: הוספה מיידית בכמות של המאגר, בלי שנשאלה כמה אכלה.
check("אין יותר הוספה מיידית מהמאגר המקומי",
  !/commit\(\{ meal, name: f\.name, g, source: "verified", \.\.\.n \}\)/.test(src));
check("ואין מהקטלוג שלנו",
  !/commit\(\{ meal, name: f\.name, g, unit: f\.unit \|\| "g", source: f\.source === "verified"/.test(src));

console.log("\nמה שלא נגע: המועדפים והאחרונים");
// שם הכמות היא lastG, כלומר מה שהיא עצמה הזינה בפעם הקודמת, ולכן היא כמעט תמיד נכונה.
check("הפלוס נשאר בשורת פריט של האחרונים והמועדפים",
  /aria-label=\{added \? "ביטול הוספה" : "הוספה"\}/.test(src));
check("והכמות שם היא זו שהיא הזינה בפעם הקודמת", /const g = f\.lastG \?\? f\.measures\[f\.def\]\.g;/.test(src));

console.log("\nה-✕ במסך הכמות");
check("✕ במסך הכמות עושה בדיוק מה שחץ החזרה עושה",
  /onClick=\{step === "qty" && back \? back : close\}/.test(src));
check("ומכריז על עצמו נכון לקורא מסך",
  /aria-label=\{step === "qty" && back \? "חזרה" : "סגירה"\}/.test(src));
check("והחזרה מובילה לאן שהיא באה ממנו, חיפוש או מועדפים",
  /const back = step === "qty" && !state\.editEntry \? \(\) => setStep\(qtyOrigin\)/.test(src));
check("בעריכת פריט קיים ✕ ממשיך לסגור, כי אין לאן לחזור",
  /const back = step === "qty" && !state\.editEntry/.test(src));

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.");
process.exit(fail ? 1 : 0);
