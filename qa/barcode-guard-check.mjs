// QA layer 1, part 2: does the barcode plausibility guard actually catch bad rows?
//
// Open Food Facts is user-contributed, so a product's numbers can be wrong in either
// direction. The guard in src/App.jsx decides whether we show the row or ask her to
// photograph the label instead, so what it MISSES gets logged as if it were true.
//
// Run: node qa/barcode-guard-check.mjs
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const i = src.indexOf("function nutritionPlausible");
const end = src.indexOf("\nfunction ", i + 10);
// eval() inside a module does not create a binding we can call, so return it explicitly.
const nutritionPlausible = new Function(`${src.slice(i, end)}\nreturn nutritionPlausible;`)();

// Each case: what the barcode row says per 100 g, and whether a human would accept it.
const cases = [
  { name: "טונה במים, ערכים תקינים", per100: { kcal: 116, p: 26, f: 1, c: 0 }, want: true },
  { name: "שמן זית, ערכים תקינים", per100: { kcal: 884, p: 0, f: 100, c: 0 }, want: true },
  { name: "לחם, ערכים תקינים", per100: { kcal: 265, p: 9, f: 3.2, c: 49 }, want: true },
  { name: "שורה מנופחת: מאקרו גבוה מהקלוריות", per100: { kcal: 100, p: 20, f: 20, c: 20 }, want: false },
  { name: "שומן בלבד מול קלוריות נמוכות", per100: { kcal: 50, p: 0, f: 30, c: 0 }, want: false },
  // The classic Open Food Facts mistake: the label's kilojoules typed into the kcal field.
  // 1 kcal = 4.184 kJ, so the number is roughly four times too big.
  { name: "יוגורט, קילו-ג׳אול הוזנו כקלוריות", per100: { kcal: 380, p: 4, f: 3, c: 6 }, want: false },
  { name: "משקה, קילו-ג׳אול הוזנו כקלוריות", per100: { kcal: 180, p: 0, f: 0, c: 10 }, want: false },
  { name: "ירקות קפואים עם קלוריות מנופחות", per100: { kcal: 700, p: 2, f: 0.3, c: 7 }, want: false },
];

let failed = 0;
for (const t of cases) {
  const got = nutritionPlausible(t.per100);
  const ok = got === t.want;
  if (!ok) failed++;
  const implied = Math.round(4 * t.per100.p + 9 * t.per100.f + 4 * t.per100.c);
  console.log(`${ok ? "עובר " : "נכשל "} | ${t.name}`);
  console.log(`        רשום ${t.per100.kcal} קק״ל, מהמאקרו יוצא ${implied} | ההגנה ${got ? "מאשרת" : "חוסמת"}, ציפינו ש${t.want ? "תאשר" : "תחסום"}`);
}
console.log(`\n${cases.length - failed} מתוך ${cases.length} עברו.`);
process.exit(0);
