// שתי בקשות של משתתפות, 3 בספטמבר 2026, ושתיהן נבדקות כאן בלי רשת:
//
//   1. "בדיווח שעות שינה כדאי להוסיף אפשרות לדווח חצאים ולא רק מספר עגול."
//      המונה נשאר בשלמים, והמספר שביניהם הפך לשדה שאפשר להקליד בו. **חצאים
//      בשעות השינה בלבד**, ובכל שאר המשימות המונה לא זז.
//
//   2. "לא רואה את סך הקלוריות שאכלתי בכל ארוחה." שורת סיכום מעל כל ארוחה,
//      במצב "לפי הארוחה" בלבד. **החלבון מצטרף רק כשמשימת החלבון נפתחת**, לפי
//      ההחלטה שהאפליקציה אינה מזכירה חלבון לפני שבוע 3.
//
// הפונקציות נמשכות מהקוד לפי מחרוזת ואינן מועתקות לכאן.
//
//   node qa/sleep-meal-check.mjs

import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const tasks = readFileSync(new URL("../src/checkins.js", import.meta.url), "utf8");
const grab = (from, to) => {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  if (a < 0 || b < 0) { console.log("✗ לא נמצא בקוד: " + from); process.exit(1); }
  return src.slice(a, b);
};
const lines = src.split("\n");
const line = (prefix) => {
  const hit = lines.find((l) => l.trimStart().startsWith(prefix));
  if (!hit) { console.log("✗ לא נמצאה בקוד השורה: " + prefix); process.exit(1); }
  return hit.trim();
};

let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (extra ? "  → " + extra : "")); } };

// ── 1. שעות שינה ─────────────────────────────────────────────
console.log("\nחצאי שעות שינה");

const sleepRow = tasks.split("\n").find((l) => l.includes('id: "sleephours"')) || "";
check("שעות השינה מסומנת decimal", /decimal:\s*true/.test(sleepRow), sleepRow.trim().slice(0, 60));
check("ויש לה תקרה של 24", /max:\s*24/.test(sleepRow));

// המונה של שאר המשימות לא זז: צבעי ירקות, ארוחות בסדר אכילה וחלון הצום נספרים
// בשלמים, וחצי צבע או חצי ארוחה אינם דבר.
const otherNums = tasks.split("\n").filter((l) => /type: "number"/.test(l) && !l.includes('id: "sleephours"'));
check("ואף משימת מספר אחרת אינה מסומנת decimal",
  otherNums.length >= 4 && otherNums.every((l) => !/decimal/.test(l)),
  otherNums.length + " שורות");

// הפונקציה שקובעת את הערך אחרי כל שינוי, נמשכת מתוך Stepper עצמו.
const capLine = line("const cap = (v) =>");
const mk = (min, max) => new Function("min", "max", capLine + "; return cap;")(min, max);
{
  const cap = mk(0, 24);
  check("6.5 נשמר כפי שהוא", cap(6.5) === 6.5);
  check("7.25 מתעגל לעשרוני אחד", cap(7.25) === 7.3, String(cap(7.25)));
  check("מעל התקרה נחסם ל-24", cap(30) === 24, String(cap(30)));
  check("ומתחת לאפס נחסם לאפס", cap(-3) === 0, String(cap(-3)));
  const noMax = mk(0, undefined);
  check("בלי תקרה מוגדרת שום דבר לא נחסם מלמעלה", noMax(9999) === 9999);
}

// השדה עצמו: מוצג רק כשהמשימה מסומנת, ומקבל את התקרה מהמשימה.
const stepper = grab("function Stepper(", "\n}\n");
check("השדה מוצג רק כשהמשימה מסומנת", /editable \?/.test(stepper));
check("והמונה נשאר לכל השאר", /minWidth: 78/.test(stepper));
check("הפלוס והמינוס עוברים דרך אותה חסימה", (stepper.match(/bump\(/g) || []).length === 2 && /const bump = \(d\)/.test(stepper));
check("ההקלדה מקבלת נקודה עשרונית אחת", /replace\(\/\(\\\.\.\*\)\\\.\/g/.test(stepper), "ניקוי הקלט");
check("ובכניסה לשדה התוכן מסומן, כדי שההקלדה תחליף אותו", /e\.target\.select\(\)/.test(stepper));
check("המשימה מעבירה את התקרה ואת הסימון",
  /max=\{t\.max\} editable=\{!!t\.decimal\}/.test(src));

// הממוצע בסיכום השבועי: עשרוני אחד לשעות השינה, שלם לכל השאר.
{
  const avgBlock = grab("for (const id in sums) {", "\n  return {");
  const run = new Function("CHECKIN_TASKS", "sums", "ns",
    "const avgs = {};\n" + avgBlock + "\nreturn avgs;");
  const T = [{ id: "sleephours", decimal: true }, { id: "steps" }];
  const out = run(T, { sleephours: 6.5 * 4, steps: 32937 }, { sleephours: 4, steps: 4 });
  check("ממוצע שינה של 6.5 נשאר 6.5", out.sleephours.avg === 6.5, String(out.sleephours.avg));
  const out2 = run(T, { sleephours: 7.2 + 7.3 + 7.1 }, { sleephours: 3 });
  check("וממוצע 7.2 מוצג כ-7.2 ולא כ-7", out2.sleephours.avg === 7.2, String(out2.sleephours.avg));
  check("וממוצע הצעדים נשאר שלם", Number.isInteger(out.steps.avg), String(out.steps.avg));
  check("מספר הימים שדיווחה לא נגע", out.sleephours.n === 4);
}

// ── 2. סך הקלוריות בכל ארוחה ─────────────────────────────────
console.log("\nסיכום לכל ארוחה");

{
  const sumLine = line("dayLog.forEach((e) => { const m = mealSums");
  const run = new Function("dayLog", "const mealSums = {};\n" + sumLine + "\nreturn mealSums;");
  const out = run([
    { meal: "בוקר", kcal: 300, p: 12 },
    { meal: "צהריים", kcal: 610, p: 40 },
    { meal: "בוקר", kcal: 200, p: 8 },
  ]);
  check("הקלוריות של הבוקר מסתכמות משני הפריטים", out["בוקר"].kcal === 500, String(out["בוקר"].kcal));
  check("והחלבון איתן", out["בוקר"].p === 20, String(out["בוקר"].p));
  check("וכל ארוחה נספרת בנפרד", out["צהריים"].kcal === 610);
  const empty = run([{ meal: "ערב" }]);
  check("פריט בלי ערכים אינו מייצר NaN", empty["ערב"].kcal === 0 && empty["ערב"].p === 0);
}

const list = grab("{shownLog.map((e, i) => {", "MyPrime · v{VERSION}");
check("הכותרת נפתחת רק כשהארוחה מתחלפת", /shownLog\[i - 1\]\.meal !== e\.meal/.test(list));
// בסדר ההזנה הפריטים של אותה ארוחה אינם צמודים, ולכן שם אין מה לסכם.
check("ומוצגת במצב \"לפי הארוחה\" בלבד", /const head = byMeal &&/.test(list));
check("הקלוריות מוצגות תמיד", /קק״ל/.test(list));
// סעיף 18: האפליקציה אינה מזכירה חלבון לפני שמשימת החלבון נפתחת.
check("והחלבון מצטרף רק כשמשימת החלבון נפתחה", /macroOpen \? ` · \$\{Math\.round\(ms\.p\)\} ג׳ חלבון` : ""/.test(list));
check("הפריט הראשון בקבוצה מוותר על הקו העליון", /borderTop: head \? "none"/.test(list));
check("ושורת הפריט עצמה לא נגעה", /{e\.meal} · /.test(list) && /קק״ל<\/div>/.test(list) === false || /{e\.kcal} קק״ל/.test(list));

// הכפתור שמחליף את הסדר לא נגע, והוא עדיין מוצג רק משני פריטים ומעלה.
check("כפתור \"לפי הארוחה\" נשאר כפי שהוא", /dayLog\.length > 1 &&/.test(src) && /byMeal \? "לפי סדר ההזנה" : "לפי הארוחה"/.test(src));

// ── 3. הקופי ────────────────────────────────────────────────
console.log("\nהקופי");
const html = readFileSync(new URL("../public/admin.html", import.meta.url), "utf8");
const A_MEAL = 'ברשימת \\"מה שהוזן היום\\" יש כפתור \\"לפי הארוחה\\". בהקשה עליו הפריטים מסתדרים לפי סדר הארוחות, ומעל כל ארוחה מופיע סך הקלוריות שלה.';
const A_SLEEP = "אפשר לדווח גם חצאי שעות. בשורת שעות השינה אפשר להקיש על המספר עצמו ולהקליד אותו, למשל 6.5 או 7.5. הפלוס והמינוס ממשיכים לעבוד בשעות שלמות.";
check("התשובה על הקלוריות בארוחה נמצאת בבנק של המשרד", html.includes(A_MEAL));
check("וגם בשאלות ותשובות שבאפליקציה", src.includes(A_MEAL));
check("התשובה על חצאי השעות נמצאת בבנק של המשרד", html.includes(A_SLEEP));
// היא אינה נכנסת לשאלות ותשובות: השדה גלוי במסך ואין מה ללמד עליו.
check("ואינה נכנסת לשאלות ותשובות שבאפליקציה", !src.includes(A_SLEEP));

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.");
process.exit(fail ? 1 : 0);
