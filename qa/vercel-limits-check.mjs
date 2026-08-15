// מגבלות התוכנית של וורסל, שנאכפות בזמן הבנייה ולא בזמן הקוד.
//
//   node qa/vercel-limits-check.mjs
//
// למה זה קיים: וורסל סופרת כל קובץ ב-api/ כפונקציה, ובתוכנית Hobby המקסימום הוא 12.
// קובץ עזר משותף שנוסף שם מפיל את הבנייה כולה עם "No more than 12 Serverless Functions",
// והבנייה המקומית עוברת בשקט כי המגבלה היא של וורסל ולא של הקוד. זה קרה ב-v5.20.
//
// הפתרון, והוא כבר היה בשימוש בקובץ api/_sheet.js: קובץ שמתחיל בקו תחתון אינו נספר.

import { readdirSync, readFileSync } from "node:fs";

const MAX_FUNCTIONS = 12; // Hobby plan

let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (extra ? "  → " + extra : "")); } };

const files = readdirSync(new URL("../api", import.meta.url)).filter((f) => f.endsWith(".js"));
const functions = files.filter((f) => !f.startsWith("_"));
const helpers = files.filter((f) => f.startsWith("_"));

console.log("\nמספר הפונקציות ב-api\n");
check(`עד ${MAX_FUNCTIONS} פונקציות (יש ${functions.length})`, functions.length <= MAX_FUNCTIONS, functions.join(", "));
console.log("  קבצי עזר שאינם נספרים: " + (helpers.join(", ") || "אין"));

// A helper is a file nothing routes to: it has no default export handler. If one of those
// ever loses its underscore it silently costs a function slot.
console.log("\nכל קובץ עזר באמת קובץ עזר\n");
for (const h of helpers) {
  const src = readFileSync(new URL("../api/" + h, import.meta.url), "utf8");
  check(`${h} אינו נקודת קצה`, !/export default async function handler/.test(src));
}

console.log("\nמגבלות נוספות של Hobby ש-vercel.json חייב לכבד\n");
const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
const crons = vercel.crons || [];
// A range of hours in a cron ("0 15-21 * * *") is valid cron and is REJECTED by Vercel before
// it even creates a deployment: no build, no red line, the push simply never appears.
check("אין טווח שעות בשום cron", crons.every((c) => !/\d+-\d+ /.test(String(c.schedule || ""))), crons.map((c) => c.schedule).join(" | "));
check("אין שדות משלנו בקובץ", !Object.keys(vercel).some((k) => k.startsWith("_")), Object.keys(vercel).join(", "));

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.");
process.exit(fail ? 1 : 0);
