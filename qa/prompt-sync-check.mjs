#!/usr/bin/env node
/* ============================================================================
   שכבה 1: ההנחיות ב-QA מול ההנחיות באפליקציה

   qa/run-qa.mjs מחזיק העתק של ההנחיות מ-src/App.jsx, כי הוא רץ בלי דפדפן ובלי
   React. כשההנחיות באפליקציה משתנות וההעתק לא, ההרצה בודקת אפליקציה שלא קיימת
   ומחזירה רשימת כשלים מדומים. זה קרה בפועל: מ-v4.44 מסך ההמלצות מחזיר אופציות
   מובנות, וההעתק עדיין ביקש טקסט חופשי.

   הבדיקה קוראת את שני הקבצים כטקסט, מחלצת מכל אזור את **תוכן המחרוזות בלבד**
   (בלי שמות משתנים, בלי הערות, ובלי מה שיושב בתוך ${...}), ומשווה. כל שינוי
   בנוסח באפליקציה מפיל אותה מיד.

   בלי רשת ובלי קריאות AI:  node qa/prompt-sync-check.mjs
   ========================================================================== */

import { readFileSync } from "node:fs";

const app = readFileSync("src/App.jsx", "utf8");
const qa = readFileSync("qa/run-qa.mjs", "utf8");

/* ---------- extract the text content of every string literal in a region ----------
   Handles "..." , '...' and `...`, skips // and /* comments, and drops ${...} from
   template literals so that variable names never take part in the comparison. The
   regions below contain no regex literals, which is why a scanner this small is enough. */
function literals(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") { const n = src.indexOf("\n", i); i = n === -1 ? src.length : n; continue; }
    if (c === "/" && src[i + 1] === "*") { const n = src.indexOf("*/", i); i = n === -1 ? src.length : n + 2; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      let buf = "";
      let j = i + 1;
      let depth = 0;
      while (j < src.length) {
        const d = src[j];
        if (d === "\\") { buf += src[j + 1] === "n" ? "\n" : src[j + 1]; j += 2; continue; }
        if (quote === "`" && d === "$" && src[j + 1] === "{") { depth = 1; j += 2; while (j < src.length && depth) { if (src[j] === "{") depth++; if (src[j] === "}") depth--; j++; } continue; }
        if (d === quote) { j++; break; }
        buf += d;
        j++;
      }
      out.push(buf);
      i = j;
      continue;
    }
    i++;
  }
  return out;
}

// One comparable blob: every literal, whitespace flattened, empties dropped.
function blob(src) {
  return literals(src).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean).join(" ⋮ ");
}

function region(src, startAnchor, endAnchor, label) {
  const a = src.indexOf(startAnchor);
  if (a === -1) throw new Error(`לא נמצאה נקודת התחלה עבור ${label}: ${startAnchor}`);
  const b = src.indexOf(endAnchor, a + startAnchor.length);
  if (b === -1) throw new Error(`לא נמצאה נקודת סיום עבור ${label}: ${endAnchor}`);
  return src.slice(a, b);
}

const CASES = [
  {
    name: "הנחיות מסך ההמלצות (aiMealChat)",
    appSrc: () => region(app, "async function aiMealChat(messages, ctx) {", "const res = await fetch(AI_ENDPOINT", "aiMealChat"),
    qaSrc: () => region(qa, "function mealSystem(proteinFocus) {", "\n// RecommendModal seed", "mealSystem"),
  },
  {
    name: "הנחיות הזנת האוכל (aiNutritionChat)",
    appSrc: () => region(app, "async function aiNutritionChat(messages) {", "const res = await fetch(AI_ENDPOINT", "aiNutritionChat"),
    qaSrc: () => region(qa, "const NUTRITION_SYSTEM =", "\n// analyzeMeal prompt", "NUTRITION_SYSTEM"),
  },
  {
    name: "הטקסט שנשלח בפתיחת מסך ההמלצות (seed)",
    appSrc: () => region(app, "const seed = `הקשר: נשארו לי", "const h = [{ role: \"user\"", "seed"),
    qaSrc: () => region(qa, "function buildSeed(p, ask) {", "\n// aiNutritionChat system", "buildSeed"),
  },
  {
    name: "הטקסט שנשלח עם תמונת ארוחה",
    appSrc: () => region(app, "\"זוהי תמונת", "\n", "photo"),
    qaSrc: () => region(qa, "const PHOTO_PROMPT =", "\nconst ALLERGEN_KEYWORDS", "PHOTO_PROMPT"),
  },
];

// Where the two first differ, in words, so the report points at the sentence itself.
function firstDiff(a, b) {
  const wa = a.split(" ");
  const wb = b.split(" ");
  let i = 0;
  while (i < wa.length && i < wb.length && wa[i] === wb[i]) i++;
  const ctx = (w) => w.slice(Math.max(0, i - 6), i + 12).join(" ") || "(סוף הטקסט)";
  return { app: ctx(wa), qa: ctx(wb) };
}

let failed = 0;
for (const c of CASES) {
  let a, b;
  try { a = blob(c.appSrc()); b = blob(c.qaSrc()); }
  catch (e) { console.log(`נכשל  | ${c.name}\n        ${e.message}`); failed++; continue; }
  if (a === b) {
    console.log(`עובר  | ${c.name}\n        ${a.length} תווים, זהה בין האפליקציה ל-QA`);
  } else {
    const d = firstDiff(a, b);
    console.log(`נכשל  | ${c.name}`);
    console.log(`        באפליקציה: …${d.app}…`);
    console.log(`        ב-QA:       …${d.qa}…`);
    failed++;
  }
}

console.log(`\n${CASES.length - failed} מתוך ${CASES.length} עברו.`);
if (failed) {
  console.log("\nההעתק ב-qa/run-qa.mjs התנתק מ-src/App.jsx. עדכן את ההעתק לפני שמריצים QA,");
  console.log("אחרת ההרצה בודקת אפליקציה שלא קיימת ומחזירה כשלים מדומים.");
  process.exit(1);
}
