// סימולציה של כלל ה-BMI על כל צירוף של גובה ומשקל שאישה יכולה להזין.
//
//   node qa/bmi-sim.mjs
//
// זה דוח ולא שער: הוא מדפיס מה קורה בכל צירוף ותמיד מסיים בהצלחה. השער שנופל
// על רגרסיה הוא qa/bmi-check.mjs. את שניהם מריצים בלי רשת.
//
// הפונקציות נמשכות מ-src/App.jsx לפי מחרוזת ולא מועתקות לכאן, כדי שזו תהיה
// האפליקציה עצמה ולא העתק שיסחף בעריכה הראשונה.
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const lines = src.split("\n");
const line = (p) => { const h = lines.find((l) => l.startsWith(p)); if (!h) throw new Error(p); return h; };
const grab = (from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a); return src.slice(a, b); };

const code = [
  line("const ACTIVITY_FACTORS ="), line("const KCAL_FLOOR ="),
  line("const PROTEIN_PER_KG ="), line("const KCAL_PER_KG ="), line("const FAT_PER_KG ="), line("const RATE_OPTIONS ="),
  line("const UNDERWEIGHT_BMI ="), line("const MIN_LOSS_BMI ="),
  line("function bmiOf("), line("function minHealthyKg("), line("function noLossRoom("),
  grab("function bmrMifflinWoman(", "function projection("),
  grab("function computeTargets(", "\n}\n") + "\n}\n",
  "return { KCAL_FLOOR, UNDERWEIGHT_BMI, MIN_LOSS_BMI, RATE_OPTIONS, bmiOf, minHealthyKg, noLossRoom, computeTargets };",
].join("\n");
const A = new Function(code)();

// שדה המשקל ברישום, מועתק מהשורה עצמה כדי שהסימולציה תיפול אם הטווח משתנה
const wLine = line("  const weightOk =");
const m = wLine.match(/weightN >= ([\d.]+) && weightN <= ([\d.]+)/);
const [WMIN, WMAX] = [parseFloat(m[1]), parseFloat(m[2])];
console.log(`שדה המשקל ברישום: ${WMIN} עד ${WMAX} ק״ג · הרף לירידה: BMI ${A.MIN_LOSS_BMI}\n`);

const rows = [];
let n = 0, blocked = 0, maint = 0, loss = 0;
const problems = [], deadEnd = [];
for (let h = 140; h <= 200; h++) {
  for (let w2 = 60; w2 <= 400; w2++) {          // חצאי קילו
    const w = w2 / 2;
    n++;
    const bmi = A.bmiOf(w, h);
    const okField = w >= WMIN && w <= WMAX;
    if (!okField) {
      blocked++;
      // חסימה בשדה היא מסך ללא מוצא. מותרת רק על מספר שאינו משקל אמיתי של אישה.
      if (bmi >= A.MIN_LOSS_BMI) problems.push(`חסימה בשדה על משקל תקין לגמרי: ${h} ס״מ, ${w} ק״ג, BMI ${bmi.toFixed(1)}`);
      else if (bmi >= 16) deadEnd.push([h, w, bmi]);
      continue;
    }
    const noLoss = A.noLossRoom(w, h);
    const floor = A.minHealthyKg(h);
    if (noLoss) {
      maint++;
      if (bmi > A.MIN_LOSS_BMI + 0.6) problems.push(`שמירה בלבד למי שיש לה לאן לרדת: ${h}/${w}, BMI ${bmi.toFixed(1)}`);
      // הטיוטה של מי שאין לה לאן לרדת
      const p = { age: 50, heightCm: h, weightKg: w, weeklyRateG: 0 };
      const t = A.computeTargets(p);
      if (t.deficit !== 0) problems.push(`גירעון למי שבשמירה: ${h}/${w}`);
      if (t.targetKcal < A.KCAL_FLOOR) problems.push(`יעד מתחת לרצפה בשמירה: ${h}/${w} = ${t.targetKcal}`);
    } else {
      loss++;
      if (bmi < A.MIN_LOSS_BMI) problems.push(`ירידה מותרת מתחת לרף: ${h}/${w}, BMI ${bmi.toFixed(1)}`);
      // היעד הנמוך ביותר שהיא יכולה לבחור, בכל אחד מקצבי הירידה
      for (const rate of A.RATE_OPTIONS.filter((r) => r !== 0)) {
        const goal = Math.max(floor, w - 0.5);
        const goalBmi = A.bmiOf(goal, h);
        if (goalBmi < A.MIN_LOSS_BMI - 0.001) problems.push(`יעד מתחת לרף: ${h}/${w} קצב ${rate} → ${goal} (BMI ${goalBmi.toFixed(1)})`);
        const t = A.computeTargets({ age: 50, heightCm: h, weightKg: w, weeklyRateG: rate });
        if (t.targetKcal < A.KCAL_FLOOR) problems.push(`יעד קלורי מתחת ל-${A.KCAL_FLOOR}: ${h}/${w} קצב ${rate} = ${t.targetKcal}`);
      }
    }
  }
}

console.log(`${n} צירופים נבדקו: ${loss} ירידה · ${maint} שמירה בלבד · ${blocked} נחסמו בשדה\n`);

// טבלה לקריאה: הרף לפי גובה, ומה קורה סביבו
console.log("הרף לפי גובה, ובדיקה של קילו מתחתיו ומעליו:\n");
console.log("גובה | הרף  | BMI ברף | 1 ק״ג מתחת → | 1 ק״ג מעל →");
for (const h of [140, 145, 150, 152, 155, 160, 165, 170, 175, 180, 185, 190]) {
  const f = A.minHealthyKg(h);
  const below = f - 1, above = f + 1;
  const tag = (w) => (w < WMIN ? "נחסם בשדה" : A.noLossRoom(w, h) ? "שמירה" : "ירידה");
  console.log(`${h}  | ${String(f).padStart(5)} | ${A.bmiOf(f, h).toFixed(2)}    | ${below} ${tag(below)}`.padEnd(58) + `| ${above} ${tag(above)}`);
}

console.log("\nמקרים אמיתיים ומקרי קצה:\n");
const cases = [
  [152, 44, "רינת: BMI 19.0, נחסמה לגמרי לפני התיקון"],
  [152, 46.5, "בדיוק על הרף"], [152, 47, "קילו מעל הרף"],
  [175, 51, "BMI 16.7, נכנסה בשקט עם הרף הישן של 50"],
  [140, 40, "הכי נמוכה שהשדה מקבל, בגובה הכי נמוך"],
  [140, 39.5, "חצי קילו מתחת לזה"],
  [200, 200, "הכי גבוהה והכי כבדה"], [140, 200, "BMI 102, טעות הקלדה סבירה"],
  [165, 72, "פרופיל ברירת המחדל"], [160, 95, "BMI 37"],
  [190, 61.5, "גבוהה ורזה, בדיוק על הרף"],
];
for (const [h, w, why] of cases) {
  const bmi = A.bmiOf(w, h);
  const okField = w >= WMIN && w <= WMAX;
  const noLoss = !okField ? null : A.noLossRoom(w, h);
  const t = okField ? A.computeTargets({ age: 50, heightCm: h, weightKg: w, weeklyRateG: noLoss ? 0 : 500 }) : null;
  console.log(`${String(h).padStart(3)}/${String(w).padEnd(5)} BMI ${bmi.toFixed(1).padStart(5)} | ` +
    (!okField ? "נחסם בשדה" : noLoss ? "שמירה בלבד" : `ירידה, רצפה ${A.minHealthyKg(h)} ק״ג`).padEnd(24) +
    (t ? `יעד ${t.targetKcal} קק״ל${t.floored ? " (על הרצפה)" : ""}`.padEnd(26) : "".padEnd(26)) + why);
}

// מי שנחסמת בשדה אף שהמשקל שלה אפשרי. זה מסך ללא מוצא, בדיוק כמו הבאג של רינת.
if (deadEnd.length) {
  const byH = {};
  for (const [h, w, b] of deadEnd) { byH[h] = byH[h] || []; byH[h].push([w, b]); }
  const hs = Object.keys(byH).map(Number).sort((a, b) => a - b);
  console.log(`\nמסך ללא מוצא: ${deadEnd.length} צירופים נחסמים בשדה אף שהם משקל אפשרי של אישה.`);
  console.log(`הגבהים שנוגעים בזה: ${hs[0]} עד ${hs[hs.length - 1]} ס״מ. הכי גבוה שנפגע:`);
  for (const h of [hs[0], hs[Math.floor(hs.length / 2)], hs[hs.length - 1]]) {
    const arr = byH[h].sort((a, b) => a[0] - b[0]);
    console.log(`  ${h} ס״מ: ${arr[0][0]} עד ${arr[arr.length - 1][0]} ק״ג (BMI ${arr[0][1].toFixed(1)} עד ${arr[arr.length - 1][1].toFixed(1)})`);
  }
}

// ---------- הפרופיל אחרי הרישום: אין שם כלל BMI, ולכן זו דלת אחורית ----------
// המשקל בפרופיל הוא מה ש-computeTargets מחשב ממנו, וקצב הירידה נשאר כפי שהיה.
// הדלת נסגרה ב-v5.97, ולכן מה שנמדד כאן הוא כמה היא הייתה שווה אילו נשארה פתוחה.
const guarded = src.includes('if (pendingWeight.key === "weightKg" && next.weeklyRateG !== 0 && noLossRoom(');
console.log("\nהדלת האחורית של הפרופיל: " + (guarded ? "סגורה" : "פתוחה") + "\n");
let back = 0, backWorst = null;
for (let h = 140; h <= 200; h++) {
  for (let w2 = 80; w2 <= 400; w2++) {
    const w = w2 / 2;
    if (!A.noLossRoom(w, h)) continue;               // כבר מתחת לרף
    for (const rate of A.RATE_OPTIONS.filter((r) => r !== 0)) {
      const t = A.computeTargets({ age: 50, heightCm: h, weightKg: w, weeklyRateG: rate });
      const tdee = A.computeTargets({ age: 50, heightCm: h, weightKg: w, weeklyRateG: 0 }).targetKcal;
      if (t.targetKcal < tdee) {                     // יש גירעון בפועל
        back++;
        const gap = tdee - t.targetKcal;
        if (!backWorst || gap > backWorst.gap) backWorst = { h, w, rate, gap, bmi: A.bmiOf(w, h), t: t.targetKcal, tdee };
      }
    }
  }
}
if (back) {
  const b = backWorst;
  const head = guarded
    ? `  ${back} צירופים היו מקבלים גירעון מתחת לרף אילו הדלת הייתה פתוחה. היא סגורה:`
    : `  ${back} צירופים שבהם אישה מתחת לרף מקבלת יעד קלורי נמוך מהתחזוקה שלה:`;
  console.log(head);
  console.log(`  הגרוע ביותר: ${b.h} ס״מ, ${b.w} ק״ג, BMI ${b.bmi.toFixed(1)}, קצב ${b.rate} → ${b.t} במקום ${b.tdee}, גירעון ${b.gap} קק״ל ביום.`);
  if (guarded) console.log("  עריכת המשקל בפרופיל מעבירה אותה לשמירה ומציגה לה את המסך, בדיוק כמו הזנת משקל בדוח.");
} else {
  console.log("  אין. רצפת 1200 הקלוריות בולעת כל גירעון בטווח הזה.");
}

console.log("\n" + (problems.length ? "בעיות שנמצאו:\n" + [...new Set(problems)].slice(0, 40).map((p) => "  ✗ " + p).join("\n") + `\n(${new Set(problems).size} ייחודיות)` : "לא נמצאה אף בעיה בכל הצירופים."));
