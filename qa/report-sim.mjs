#!/usr/bin/env node
// סימולציה של "עמדת ביעד" בדוח מול התקציב שהיומן מציג לה, על כל מרחב המקרים.
// בלי רשת. הכללים נמשכים מ-src/App.jsx לפי מחרוזת ולא מועתקים לכאן.
//
//   node qa/report-sim.mjs
//
// השאלה שהיא עונה עליה: האם יש עוד מקרה שבו שני המסכים אומרים לאותה אישה
// שני דברים שונים על אותו יום. זה מה שקרה עד v6.08 עם האימון והצעדים.

import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const lines = src.split("\n");
const line = (p) => { const h = lines.find((l) => l.trim().startsWith(p)); if (!h) { console.log("✗ לא נמצא בקוד: " + p); process.exit(1); } return h; };
const grab = (re, what) => { const m = src.match(re); if (!m) { console.log("✗ לא נמצא בקוד: " + what); process.exit(1); } return m[0]; };

const A = new Function([
  line("const KCAL_FLOOR ="),
  line("const CAL_MET_LOW ="),
  grab(/function stepsKcal\(steps, weightKg\) \{[\s\S]*?\n\}/, "stepsKcal"),
  line("const metFloor =").replace("(g) =>", "(g, onMaintain) =>"),
  "return { KCAL_FLOOR, CAL_MET_LOW, CAL_MET_LOW_MAINT, CAL_MET_HIGH, metFloor, stepsKcal };",
].join("\n"))();

// הדוח, כפי שהוא אחרי v6.08
const floorOf = (g, m) => A.metFloor(g, !!m);
const verdict = (kc, g, m) => {
  if (!(g > 0) || kc === 0) return "ריק";
  if (kc >= floorOf(g, m) && kc <= g * A.CAL_MET_HIGH) return "ביעד";
  return kc < floorOf(g, m) ? "מתחת" : "מעל";
};
// היומן: תקציב = היעד + האימון + הצעדים. זו הצורה שב-DayScreen.
const budgetOf = (base, act, steps, wt, stepsOpen) => base + act + (stepsOpen ? A.stepsKcal(steps, wt) : 0);

let n = 0, contradict = 0, doubleDeficit = 0, worst = null;
const bases = [1200, 1250, 1333, 1400, 1500, 1650, 1800, 2000];
const acts = [0, 120, 250, 400, 600];
const stepsArr = [0, 3000, 6000, 8000, 10000, 14000];
const wts = [48, 60, 72, 85, 100];
const maints = [false, true];

for (const base of bases) for (const act of acts) for (const st of stepsArr) for (const wt of wts) for (const m of maints) for (const so of [true, false]) {
  const budget = budgetOf(base, act, st, wt, so);
  // מה שהיא באמת אוכלת, בטווח רחב סביב התקציב
  for (const frac of [0.55, 0.7, 0.85, 0.9, 0.95, 1.0, 1.03, 1.05, 1.1, 1.3]) {
    const ate = Math.round(budget * frac);
    n++;
    const v = verdict(ate, budget, m);
    // 1. סתירה: היומן אומר שנשאר לה תקציב, והדוח אומר חריגה
    const left = budget - ate;
    if (left >= 0 && v === "מעל") { contradict++; if (!worst) worst = { base, act, st, wt, m, ate, budget, v, why: "נשאר תקציב והדוח אמר חריגה" }; }
    // 2. גירעון כפול: אכלה הרבה מתחת לתקציב וקיבלה וי
    if (v === "ביעד" && left > budget * 0.12) { doubleDeficit++; if (!worst) worst = { base, act, st, wt, m, ate, budget, v, why: "וי על גירעון גדול" }; }
  }
}

console.log("\nהדוח מול היומן, אחרי v6.08\n");
console.log("  " + n.toLocaleString() + " צירופים של יעד, אימון, צעדים, משקל, שמירה ומה שאכלה");
console.log("  סתירות בין המסכים: " + contradict);
console.log("  וי על גירעון גדול:  " + doubleDeficit);
if (worst) console.log("  הגרוע ביותר: " + JSON.stringify(worst));

// אותו מרחב בדיוק, עם ההתנהגות הישנה, כדי לראות שהסימולציה בכלל יודעת לתפוס
let oldC = 0, oldD = 0;
for (const base of bases) for (const act of acts) for (const st of stepsArr) for (const wt of wts) for (const m of maints) for (const so of [true, false]) {
  const budget = budgetOf(base, act, st, wt, so);
  for (const frac of [0.55, 0.7, 0.85, 0.9, 0.95, 1.0, 1.03, 1.05, 1.1, 1.3]) {
    const ate = Math.round(budget * frac);
    const v = verdict(ate, base, m);   // ← היעד הבסיסי, כמו עד v6.07
    const left = budget - ate;
    if (left >= 0 && v === "מעל") oldC++;
    if (v === "ביעד" && left > budget * 0.12) oldD++;
  }
}
console.log("\nלשם השוואה, אותו מרחב עם ההתנהגות שהייתה עד v6.07\n");
console.log("  סתירות: " + oldC.toLocaleString() + "   ווי על גירעון גדול: " + oldD.toLocaleString());

const bad = contradict + doubleDeficit;
console.log("\n" + (bad === 0 ? "לא נמצאה אף בעיה בכל הצירופים." : "נמצאו " + bad + " מקרים."));
process.exit(bad === 0 && (oldC + oldD) > 0 ? 0 : 1);
