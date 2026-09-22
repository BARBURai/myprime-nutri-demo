// תרגול הנשימה: הזמנים, ההיפוך באמצע, והחיבור שלו למשימה שביומן.
//
// **היא מייבאת את `src/features/breathPlan.js` האמיתי ומריצה אותו**, ולא מעתיקה
// ממנו מספרים. העתק היה נסחף בעריכה הראשונה, וזו בדיוק המלכודת שסעיף 24 מתאר.
//
//   node qa/breath-check.mjs

import { readFileSync } from "node:fs";
import { IN, HOLD, OUT, CYCLE, MINUTES, SMALL, phaseAt, swapCycleFor } from "../src/features/breathPlan.js";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log("  ✗ " + m); } };
const head = (t) => console.log("\n" + t + "\n");

const app = readFileSync("src/App.jsx", "utf8");
const cmpRaw = readFileSync("src/features/BreathCircle.jsx", "utf8");
// **ההערות בקוד נחתכות לפני הבדיקה.** הן מסבירות מאיפה המספרים ומזכירות את ענת
// בשמה, והן אינן מסך שמישהי רואה. בלי החיתוך הבדיקה נופלת על תיעוד.
const cmp = cmpRaw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const tasks = readFileSync("src/checkins.js", "utf8");

// ---------------------------------------------------------------- המספרים של ענת
head("המחזור הוא מה שענת כתבה בדף המשימה");
ok(IN === 4, `שאיפה 4, התקבל ${IN}`);
ok(HOLD === 2, `החזקה 2, התקבל ${HOLD}`);
ok(OUT === 6, `נשיפה 6, התקבל ${OUT}`);
ok(CYCLE === 12, `מחזור 12 שניות, התקבל ${CYCLE}`);
ok(MINUTES[0] === 5 && MINUTES[MINUTES.length - 1] === 10, "הטווח הוא 5 עד 10 דקות, כמו בדף");

// ---------------------------------------------------------------- הסדר הראשון
head("הסדר הראשון: שאיפה, החזקה, נשיפה");
const SW = swapCycleFor(300);            // חמש דקות
ok(phaseAt(0, SW).phase === "in", "בשנייה 0 שואפים");
ok(phaseAt(3.9, SW).phase === "in", "בשנייה 3.9 עדיין שואפים");
ok(phaseAt(4, SW).phase === "hold", "בשנייה 4 מחזיקים");
ok(phaseAt(5.9, SW).phase === "hold", "בשנייה 5.9 עדיין מחזיקים");
ok(phaseAt(6, SW).phase === "out", "בשנייה 6 משחררים");
ok(phaseAt(11.9, SW).phase === "out", "בשנייה 11.9 עדיין משחררים");
ok(phaseAt(12, SW).phase === "in", "בשנייה 12 מתחיל מחזור חדש");

// ---------------------------------------------------------------- הסדר ההפוך
head("ואחרי מחצית הזמן, ההחזקה עוברת לסוף כשהריאות ריקות");
const after = SW * CYCLE;                // השנייה הראשונה שאחרי ההחלפה
ok(phaseAt(after, SW).swapped === true, "אחרי מחצית הזמן הסדר מתהפך");
ok(phaseAt(after - 0.1, SW).swapped === false, "ורגע לפני כן הוא עדיין לא");
ok(phaseAt(after + 0, SW).phase === "in", "גם בסדר ההפוך מתחילים בשאיפה");
ok(phaseAt(after + 4, SW).phase === "out", "ומיד אחריה משחררים, בלי החזקה באמצע");
ok(phaseAt(after + 9.9, SW).phase === "out", "הנשיפה נמשכת שש שניות");
ok(phaseAt(after + 10, SW).phase === "empty", "ורק בסוף מחזיקים, כשהריאות ריקות");
ok(phaseAt(after + 11.9, SW).phase === "empty", "עד סוף המחזור");

head("ההחלפה נופלת על גבול מחזור ולא באמצע נשימה");
for (const m of MINUTES) {
  const s = swapCycleFor(m * 60);
  ok(Number.isInteger(s), `${m} דקות: ההחלפה נופלת על מחזור שלם`);
  ok(phaseAt(s * CYCLE, s).x === 0, `${m} דקות: ובדיוק בתחילתו`);
}

// ---------------------------------------------------------------- הספירה שהיא רואה
head("המספר שבתוך העיגול סופר למטה ולא למעלה");
ok(Math.ceil(phaseAt(0, SW).left) === 4, "השאיפה מתחילה ב-4");
ok(Math.ceil(phaseAt(3.5, SW).left) === 1, "ונגמרת ב-1");
ok(Math.ceil(phaseAt(6, SW).left) === 6, "הנשיפה מתחילה ב-6");
ok(Math.ceil(phaseAt(11.5, SW).left) === 1, "ונגמרת ב-1");

head("העיגול מתרחב בשאיפה ומתכווץ בנשיפה");
ok(Math.abs(phaseAt(0, SW).scale - SMALL) < 0.001, "בתחילת השאיפה הוא הכי קטן");
ok(Math.abs(phaseAt(4, SW).scale - 1) < 0.001, "בסופה הוא מלא");
ok(phaseAt(5, SW).scale === 1, "ובהחזקה הוא עומד במלואו");
ok(phaseAt(7, SW).scale > phaseAt(10, SW).scale, "ובנשיפה הוא מתכווץ");
ok(Math.abs(phaseAt(after + 11, SW).scale - SMALL) < 0.001, "ובהחזקה שעל ריאות ריקות הוא נשאר קטן");

// ---------------------------------------------------------------- החיבור לאפליקציה
head("התרגול יושב על המשימה שביומן ולא כאריח נפרד");
ok(/id: "breathing"/.test(tasks), "משימת הנשימה קיימת ב-checkins.js");
ok(/startWeek: 4/.test(tasks.split('id: "breathing"')[1].slice(0, 200)), "והיא נפתחת בשבוע 4, ולא נגענו בזה");
ok(/t\.id === "breathing" && onBreath/.test(app), "הכפתור מוצג על שורת משימת הנשימה בלבד");
ok(/sheet === "breath"/.test(app), "ויש מסלול שפותח את התרגול");

head("הטעינה מושהית, ומי שלא נוגעת בתרגול לא מורידה אותו");
ok(/lazy\(\(\) => import\("\.\/features\/BreathCircle"\)\)/.test(app), "הקובץ נטען בטעינה מושהית");
ok(/<Suspense[^>]*>\s*<BreathCircle/.test(app), "ועטוף ב-Suspense, אחרת הוא נופל בטעינה");

head("סיום התרגול מסמן את המשימה, ולא נוגע בשום דבר אחר");
ok(/onDone=\{\(\) => setCheckinValue\(selectedDate, "breathing", true\)\}/.test(app), "הסיום כותב לתשובת המשימה הקיימת");
ok(!/localStorage/.test(cmp), "התרגול אינו כותב שום מפתח חדש לאחסון");
ok(!/fetch\(/.test(cmp), "ואינו פונה לרשת בכלל");

head("קול המערכת, לפי סעיף 8");
ok(!/ענת/.test(cmp), "אין חתימה של ענת על מסך שהאפליקציה מחליטה להציג");
ok(!/עצמי עיניים/.test(cmp) || /לפי הצליל/.test(cmp), "ההנחיה על העיניים מלווה בצליל, אחרת היא סותרת את המסך");
ok(!/מוכח|משפר|מפחית סיכון|מחקר/.test(cmp), "ואין במסך שום טענה על מה שהתרגול עושה");

console.log(`\n${pass} מתוך ${pass + fail} עברו.`);
process.exit(fail ? 1 : 0);
