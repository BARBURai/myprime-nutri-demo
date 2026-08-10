// QA layer 1: sanity-check the hardcoded FOODS table in src/App.jsx.
//
// Two checks that need no network and no opinion:
//
//  1. Atwater. Calories are not an independent number - they are produced by the macros:
//     4 kcal per gram of protein, 9 per gram of fat, 4 per gram of carbohydrate. A row
//     whose stated calories disagree with its own macros is wrong on its face, whichever
//     of the two numbers is the wrong one. Fibre and alcohol bend this, so only a wide
//     gap counts as a finding.
//  2. Mass. Protein + fat + carbohydrate cannot exceed 100 g in 100 g of food, and a
//     household measure has to be a plausible weight.
//
// Run: node qa/food-check.mjs
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

function block(marker) {
  const i = src.indexOf(marker);
  if (i < 0) throw new Error(`not found: ${marker}`);
  const start = src.indexOf("[", i);
  let depth = 0;
  for (let k = start; k < src.length; k++) {
    if (src[k] === "[") depth++;
    else if (src[k] === "]" && --depth === 0) return src.slice(start, k + 1);
  }
  throw new Error(`unbalanced: ${marker}`);
}

// The table is a plain array literal, so evaluating it is the only parse that cannot
// drift from what the app actually ships.
const FOODS = eval(block("const FOODS = ["));

const ATWATER_TOL = 0.15;   // 15% - beyond this the two numbers are telling different stories
const MIN_KCAL = 20;        // below this a percentage gap is noise (lettuce, salt, water)
const round = (n) => Math.round(n * 10) / 10;

const findings = [];
for (const f of FOODS) {
  const { kcal = 0, p = 0, f: fat = 0, c = 0 } = f.per100 || {};
  const fromMacros = 4 * p + 9 * fat + 4 * c;

  if (kcal >= MIN_KCAL && fromMacros > 0) {
    const gap = (fromMacros - kcal) / kcal;
    if (Math.abs(gap) > ATWATER_TOL) {
      findings.push({
        food: f.name, check: "קלוריות מול מאקרו",
        detail: `רשום ${kcal} קק״ל, מהמאקרו יוצא ${round(fromMacros)} (${gap > 0 ? "+" : ""}${round(gap * 100)}%)`,
      });
    }
  }

  const mass = p + fat + c;
  if (mass > 100) findings.push({ food: f.name, check: "מסה", detail: `חלבון+שומן+פחמימה = ${round(mass)} ג׳ ל-100 ג׳` });

  for (const m of f.measures || []) {
    if (!(m.g > 0)) findings.push({ food: f.name, check: "מידה", detail: `"${m.label}" שווה ${m.g} ג׳` });
    if (m.g > 1500) findings.push({ food: f.name, check: "מידה", detail: `"${m.label}" שווה ${m.g} ג׳, נראה גבוה מדי` });
  }
  if (f.measures && f.def != null && !f.measures[f.def]) {
    findings.push({ food: f.name, check: "ברירת מחדל", detail: `def=${f.def} מצביע על מידה שלא קיימת` });
  }
}

console.log(`נבדקו ${FOODS.length} מזונות.`);
if (!findings.length) {
  console.log("לא נמצאו חריגות.");
} else {
  console.log(`נמצאו ${findings.length} חריגות:\n`);
  for (const x of findings) console.log(`- ${x.food} [${x.check}]: ${x.detail}`);
}
process.exit(0);
