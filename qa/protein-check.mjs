// משימת החלבון ביומן המעקב. בלי רשת.
//
//   node qa/protein-check.mjs
//
// **הכלל שהקובץ הזה קיים בשבילו:** החלבון היה המשימה האוטומטית היחידה שדרשה
// הצלחה ולא דיווח. צעדים, מים ויומן מסתמנים ברגע שהיא הזינה משהו, והחלבון דרש
// 95 אחוז מהיעד. לכן מי שלא תיעדה את כל מה שאכלה לא סגרה את היום, לא קיבלה
// מדליה ולא גביע, והרצף שלה נשבר. **על אכילה חלקית אין עונש, על תיעוד חלקי היה.**
//
// הפונקציות נמשכות מ-src/App.jsx לפי מחרוזת ואינן מועתקות לכאן, כי העתק היה
// נסחף בעריכה הראשונה. זו אותה מלכודת ש-qa/prompt-sync-check.mjs קיימת כדי למנוע.

import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const checkins = readFileSync(new URL("../src/checkins.js", import.meta.url), "utf8");

const grab = (from, to) => {
  const a = src.indexOf(from), b = src.indexOf(to, a);
  if (a < 0 || b < 0) { console.log("✗ לא נמצא בקוד: " + from); process.exit(1); }
  return src.slice(a, b);
};
const taskDone = new Function(grab("function taskDone(", "// Tasks shown for a given date") + "\nreturn taskDone;")();

let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (extra ? "  → " + extra : "")); } };

const P = { id: "protein", type: "bool", auto: "protein" };
const met = { protein: true }, notMet = { protein: false };

console.log("\nמי שהגיעה ליעד מקבלת את הווי לבד, כמו קודם\n");
check("הגיעה ליעד, בלי לסמן", taskDone(P, {}, met) === true);
check("הגיעה ליעד וגם סימנה", taskDone(P, { protein: true }, met) === true);

console.log("\nומי שלא, יכולה לסמן בעצמה\n");
check("לא הגיעה ולא סימנה, ולכן חסר", taskDone(P, {}, notMet) === false);
check("לא הגיעה אבל סימנה, ולכן יש", taskDone(P, { protein: true }, notMet) === true);
check("ערך שאינו true אינו נחשב סימון", taskDone(P, { protein: 1 }, notMet) === false);

console.log("\nושלוש האחרות לא נגעו\n");
check("צעדים נשארים על דיווח בלבד",
  taskDone({ id: "steps", auto: "steps" }, {}, { steps: 1 }) === true &&
  taskDone({ id: "steps", auto: "steps" }, { steps: true }, { steps: null }) === false);
check("מים נשארים על דיווח בלבד",
  taskDone({ id: "water", auto: "water" }, {}, { water: 1 }) === true &&
  taskDone({ id: "water", auto: "water" }, { water: true }, { water: null }) === false);
check("יומן תזונה נשאר על דיווח בלבד",
  taskDone({ id: "journal", auto: "journal" }, {}, { journal: true }) === true &&
  taskDone({ id: "journal", auto: "journal" }, { journal: true }, { journal: false }) === false);

console.log("\nהניסוח והמצב במשימה עצמה\n");
const row = (checkins.split("\n").find((l) => l.includes('id: "protein"')) || "");
check("הכיתוב בדיוק כפי שרון אישר", row.includes('label: "הקפדתי על חלבון בכל ארוחה"'), row.trim().slice(0, 90));
check("היא עדיין נפתחת בשבוע 3 יום 4", /startWeek: 3, startDow: 4/.test(row));
// היא אינה רשות בכוונה: היא עדיין חלק מהיום, רק שאפשר לסמן אותה ידנית.
check("והיא נשארת משימה נדרשת ולא רשות", !/optional/.test(row));

console.log("\nהיעד עצמו לא זז\n");
check("1.6 גרם לכל קילוגרם", /const PROTEIN_PER_KG = 1\.6;/.test(src));
check("והווי האוטומטי ניתן ב-95 אחוז מהיעד", /proteinHad >= targets\.protein \* 0\.95/.test(src));

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.");
process.exit(fail ? 1 : 0);
