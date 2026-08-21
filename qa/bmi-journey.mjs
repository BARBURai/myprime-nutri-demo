#!/usr/bin/env node
/* ============================================================================
   סימולציית המסע: בדיוק מה שרון עשה ידנית בטלפון, על אלפי צירופים.

     node qa/bmi-journey.mjs

   בניגוד ל-qa/bmi-sim.mjs, שסורק את הכלל בנקודת זמן אחת, כאן מריצים **רצף**:
   אישה נרשמת, מדווחת משקל שוב ושוב, חוצה למטה, מקבלת את המסך, עוברת לשמירה,
   עולה בחזרה, ומקבלת את הדרך חזרה. בכל צעד נבדק מה המסכים היו מראים לה.

   הפונקציות נמשכות מ-src/App.jsx לפי מחרוזת. **ומעבר לזה, כל מעבר מצב שמסומלץ
   כאן מאומת מול שורת הקוד האמיתית שמבצעת אותו**, ולכן שינוי במעבר מפיל את
   הסימולציה במקום להשאיר אותה בודקת אפליקציה שכבר לא קיימת.
   ========================================================================== */

import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const lines = src.split("\n");
const line = (p) => { const h = lines.find((l) => l.startsWith(p)); if (!h) { console.log("✗ לא נמצא: " + p); process.exit(1); } return h; };

const A = new Function([
  line("const ACTIVITY_FACTORS ="), line("const KCAL_FLOOR ="), line("const KCAL_PER_KG ="),
  line("const PROTEIN_PER_KG ="), line("const FAT_PER_KG ="), line("const RATE_OPTIONS ="),
  line("const UNDERWEIGHT_BMI ="), line("const MIN_LOSS_BMI ="), line("const RESUME_LOSS_BMI ="),
  line("function bmiOf("), line("function minHealthyKg("), line("function noLossRoom("),
  line("function resumeLossKg("), line("function canResumeLoss("),
  // אלה רב-שורתיות, ולכן נחתכות בטווח ולא בשורה אחת
  src.slice(src.indexOf("function bmrMifflinWoman("), src.indexOf("function projection(")),
  src.slice(src.indexOf("function computeTargets("), src.indexOf("\n}\n", src.indexOf("function computeTargets("))) + "\n}\n",
  "return { KCAL_FLOOR, MIN_LOSS_BMI, RESUME_LOSS_BMI, bmiOf, minHealthyKg, noLossRoom, resumeLossKg, canResumeLoss, computeTargets };",
].join("\n"))();

/* ---------- כל מעבר מצב מאומת מול הקוד שמבצע אותו ---------- */
const TRANSITIONS = [
  ["המעבר לשמירה נורה מהזנת משקל", "if (!profile.lossStopAt && profile.weeklyRateG !== 0 && noLossRoom(cur, profile.heightCm))"],
  ["ומה שהוא כותב", "setProfile((pr) => ({ ...pr, weeklyRateG: 0, goalWeightKg: cur, lossStopAt: date }));"],
  ["הבדיקה היא על המשקל העדכני ולא על מה שהוקלד", "const cur = next[next.length - 1].kg;"],
  ["נעילת המסכים לפי המצב", "const inMaintain = !!profile.lossStopAt;"],
  ["והחזרה מול הקו השני", "const canResume = inMaintain && canResumeLoss("],
  ["מה שהחזרה כותבת", "lossStopAt: null, weeklyRateG: 250"],
  ["היעד בשמירה מחושב מהמשקל האמיתי", "const effProfile = lossStopped"],
  ["רשימת הקצבים נעולה לפי המצב", "{(inMaintain ? [0] : RATE_OPTIONS).map((r) => {"],
  ["ושורת משקל היעד מוסתרת לפיו", '{!inMaintain && <EditRow label="משקל יעד"'],
];
let drift = 0;
for (const [what, needle] of TRANSITIONS) {
  if (!src.includes(needle)) { console.log("✗ המעבר השתנה בקוד ולא כאן: " + what); drift++; }
}
if (drift) { console.log("\nהסימולציה בודקת אפליקציה שכבר לא קיימת. עצור.\n"); process.exit(1); }

/* ---------- מודל המצב, מראה של הקוד ---------- */
function newWoman(heightCm, startKg, age = 50) {
  const noLoss = A.noLossRoom(startKg, heightCm);
  return {
    heightCm, age,
    weightKg: startKg,                       // המשקל של הרישום, לעולם לא זז לבד
    weeklyRateG: noLoss ? 0 : 250,
    goalWeightKg: noLoss ? startKg : Math.max(A.minHealthyKg(heightCm), startKg - 0.5),
    lossStopAt: noLoss ? "start" : null,
    weights: [startKg],
    screensShown: noLoss ? 1 : 0,            // מסך הרישום נחשב
  };
}
const cur = (w) => w.weights[w.weights.length - 1];
// בדיוק setWeightForDate
function logWeight(w, kg, day) {
  w.weights.push(kg);
  if (!w.lossStopAt && w.weeklyRateG !== 0 && A.noLossRoom(cur(w), w.heightCm)) {
    w.weeklyRateG = 0; w.goalWeightKg = cur(w); w.lossStopAt = day; w.screensShown++;
    return "moved";
  }
  return "none";
}
// בדיוק מה שהפרופיל מראה
const view = (w) => {
  const inMaintain = !!w.lossStopAt;
  return {
    inMaintain,
    rateChoices: inMaintain ? [0] : [0, 250, 500],
    goalRow: !inMaintain,
    resumeCard: inMaintain && A.canResumeLoss(cur(w), w.heightCm),
    target: A.computeTargets(inMaintain
      ? { age: w.age, heightCm: w.heightCm, weightKg: cur(w), weeklyRateG: 0 }
      : { age: w.age, heightCm: w.heightCm, weightKg: w.weightKg, weeklyRateG: w.weeklyRateG }),
  };
};
// בדיוק resumeLoss
function pressResume(w) {
  w.lossStopAt = null; w.weeklyRateG = 250;
  w.goalWeightKg = Math.max(A.minHealthyKg(w.heightCm), cur(w) - 0.5);
}

/* ---------- ההרצה ---------- */
let steps = 0, moved = 0, resumed = 0;
const bad = [];
const fail = (msg) => { if (bad.length < 30) bad.push(msg); };

for (let h = 140; h <= 195; h++) {
  const floor = A.minHealthyKg(h), back = A.resumeLossKg(h);
  // נרשמת בכל משקל סביר, ואז יורדת בחצאי קילו עד הרבה מתחת לקו, ועולה בחזרה
  for (const startKg of [floor + 25, floor + 10, floor + 3, floor + 0.5, floor, floor - 2]) {
    if (startKg < 35 || startKg > 200) continue;
    const w = newWoman(h, startKg);
    const path = [];
    for (let kg = startKg; kg >= Math.max(35, floor - 6); kg -= 0.5) path.push(kg);
    for (let kg = path[path.length - 1] + 0.5; kg <= startKg; kg += 0.5) path.push(kg);

    let everMoved = !!w.lossStopAt, screensAtLine = 0;
    for (let i = 0; i < path.length; i++) {
      const kg = Math.round(path[i] * 2) / 2;
      const before = w.lossStopAt;
      const res = logWeight(w, kg, "d" + i);
      steps++;
      if (res === "moved") { moved++; screensAtLine++; }
      const v = view(w);

      // 1. לעולם לא גירעון מתחת לקו
      if (A.noLossRoom(kg, h) && !v.inMaintain) fail(`${h}/${kg}: מתחת לקו ולא בשמירה`);
      if (A.noLossRoom(kg, h) && w.weeklyRateG !== 0) fail(`${h}/${kg}: מתחת לקו עם קצב ${w.weeklyRateG}`);
      // 2. בשמירה: הרשימה נעולה, אין שורת יעד, והיעד אינו גירעון
      if (v.inMaintain) {
        if (v.rateChoices.length !== 1) fail(`${h}/${kg}: רשימת קצבים פתוחה בשמירה`);
        if (v.goalRow) fail(`${h}/${kg}: שורת משקל יעד מוצגת בשמירה`);
        const tdee = A.computeTargets({ age: 50, heightCm: h, weightKg: kg, weeklyRateG: 0 }).targetKcal;
        if (v.target.targetKcal < tdee) fail(`${h}/${kg}: יעד ${v.target.targetKcal} נמוך מהתחזוקה ${tdee}`);
      }
      // 3. החזרה מוצעת אך ורק מעל הקו השני
      if (v.resumeCard && kg < back) fail(`${h}/${kg}: הוצע לחזור מתחת ל-${back}`);
      if (v.inMaintain && kg >= back && !v.resumeCard) fail(`${h}/${kg}: לא הוצע לחזור אף שהיא מעל ${back}`);
      // 4. אף פעם לא יוצאים משמירה בלי לחיצה
      if (before && !w.lossStopAt) fail(`${h}/${kg}: יצאה משמירה בלי לחיצה`);
      if (!everMoved && w.lossStopAt) everMoved = true;
    }

    // 5. המסך מוצג פעם אחת לחצייה, לא בכל הזנה
    if (screensAtLine > 1) fail(`${h}/${startKg}: המסך הוצג ${screensAtLine} פעמים באותה חצייה`);

    // 6. עכשיו היא בחזרה במשקל ההתחלתי. אם היא בשמירה, הכפתור חייב להיות שם.
    const v = view(w);
    if (v.inMaintain) {
      if (cur(w) >= back && !v.resumeCard) fail(`${h}/${startKg}: חזרה למשקל ההתחלתי ואין כפתור`);
      if (v.resumeCard) {
        pressResume(w); resumed++;
        const after = view(w);
        if (after.inMaintain) fail(`${h}/${startKg}: הלחיצה לא החזירה אותה`);
        if (w.weeklyRateG !== 250) fail(`${h}/${startKg}: הקצב אחרי החזרה ${w.weeklyRateG}`);
        if (A.bmiOf(w.goalWeightKg, h) < A.MIN_LOSS_BMI - 0.001) fail(`${h}/${startKg}: יעד אחרי חזרה מתחת לרף`);
        if (!after.goalRow) fail(`${h}/${startKg}: שורת היעד לא חזרה`);
        // 7. ואם היא יורדת שוב, המסך חוזר. חצייה חדשה היא אירוע חדש.
        const again = logWeight(w, A.minHealthyKg(h) - 0.5, "again");
        if (again !== "moved") fail(`${h}/${startKg}: חצייה שנייה לא הפעילה את המסך`);
      }
    }
  }
}

/* ---------- המסלול של רון, מודפס צעד-צעד ---------- */
console.log("\nהמסלול שרון עשה בטלפון: גובה 155, נרשמה ב-75\n");
const r = newWoman(155, 75, 55);   // הגיל שלו, כדי שהיעד הקלורי יהיה זהה למה שראה
console.log(`  הקו התחתון ${A.minHealthyKg(155)} ק״ג · הקו לחזרה ${A.resumeLossKg(155)} ק״ג\n`);
console.log("  משקל | BMI  | מצב      | רשימת הקצבים | שורת יעד | כפתור חזרה | יעד קלורי");
for (const kg of [50, 45, 48, 49.5, 50, 51]) {
  const res = logWeight(r, kg, "x");
  const v = view(r);
  console.log(`  ${String(kg).padEnd(5)}| ${A.bmiOf(kg, 155).toFixed(1)} | ${(v.inMaintain ? "שמירה" : "ירידה").padEnd(8)} | ${(v.rateChoices.length === 1 ? "נעולה" : "פתוחה").padEnd(13)}| ${(v.goalRow ? "מוצגת" : "מוסתרת").padEnd(9)}| ${(v.resumeCard ? "מוצג" : "אין").padEnd(11)}| ${v.target.targetKcal}${res === "moved" ? "   ← כאן קפץ המסך" : ""}`);
}
pressResume(r);
console.log(`  אחרי לחיצה על "חזרה לירידה במשקל": קצב ${r.weeklyRateG} ג׳/שבוע, משקל יעד ${r.goalWeightKg} ק״ג\n`);

console.log(`${steps.toLocaleString()} הזנות משקל סומלצו על ${56} גבהים · ${moved} מעברים לשמירה · ${resumed} חזרות לירידה\n`);
if (bad.length) { console.log("בעיות:\n" + bad.map((b) => "  ✗ " + b).join("\n") + "\n"); process.exit(1); }
console.log("לא נמצאה אף בעיה באף צעד.\n");
