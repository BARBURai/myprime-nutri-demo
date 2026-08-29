#!/usr/bin/env node
// היום שנבחר, ומה קורה לו כשעובר חצות. בלי רשת.
//
//   node qa/dayflip-check.mjs
//
// משתתפת: "יום שישי הזנתי בטעות את שבת." בדיקה שרצה כל דקה החליפה את היום
// הנבחר ברגע שהתאריך התחלף, גם בזמן שהיא באמצע מילוי. רון: "היא לחצה על פלוס
// שנמצא ביום שישי, מה הקשר בכלל שהיום עבר לשבת."
//
// ובאותה עבודה נשברה שורה שמגינה על סרגל הבדיקות, ולכן היא נעולה כאן גם היא.

import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (extra ? "  ← " + extra : "")); } };

console.log("\nמתי היום הנבחר זז");
check("התאריך עצמו מתעדכן תמיד", /setToday\(now\);/.test(src));
check("היום הנבחר זז רק כשהיא חוזרת לאפליקציה",
  /const id = setInterval\(\(\) => sync\(false\), 60000\);/.test(src)
  && /const onVis = \(\) => \{ if \(document\.visibilityState === "visible"\) sync\(true\); \};/.test(src));
check("ולא זז כשיש לה חלון פתוח",
  /if \(mayMove && !sheetRef\.current && !modalRef\.current\) setSelectedDate/.test(src));
check("גם focus וגם pageshow נחשבים חזרה לאפליקציה",
  /window\.addEventListener\("focus", onBack\)/.test(src) && /window\.addEventListener\("pageshow", onBack\)/.test(src));
// מי שנשארה על אתמול חייבת לראות את זה, אחרת זה נסתר בדיוק כמו הבאג עצמו
check("הכותרת אומרת אתמול כשהיא נשארה שם", /if \(dateStr === addDays\(today, -1\)\) return "אתמול";/.test(src));

console.log("\nהשעון של סרגל הבדיקות");
check("בייצור השעון הוא פשוט עכשיו", /if \(!DEV\) return new Date\(Date\.now\(\) \+ DEV_CLOCK_SHIFT\);/.test(src));
// זו השורה שנשברה: בלעדיה היום המדומה נדרס בתאריך האמיתי בכל חזרה לאפליקציה
check("ובדב היום המדומה הוא הבסיס ואינו נדרס", /const t = parseDay\(TODAY\);/.test(src) && /const base = new Date\(t\.getUTCFullYear\(\)/.test(src));
check("הבדיקה משווה מול השעון הזה ולא מול השעון האמיתי", /const now = ymd\(nowDate\(\)\);/.test(src));
check("וגם הכותרת אתמול/היום", /const today = ymd\(nowDate\(\)\);/.test(src));
check("כפתור מעבר חצות קיים בסרגל", /const crossMidnight = \(\) => \{/.test(src) && /מעבר חצות<\/button>/.test(src));
check("והוא מזיז יממה ומדמה חזרה לאפליקציה",
  /DEV_CLOCK_SHIFT \+= 24 \* 60 \* 60 \* 1000;/.test(src) && /window\.dispatchEvent\(new Event\("focus"\)\)/.test(src));
check("הסרגל מוצג רק ב-DEV", /\{DEV && <DevDateBar/.test(src) || /DEV \? <DevDateBar/.test(src));

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.");
process.exit(fail ? 1 : 0);
