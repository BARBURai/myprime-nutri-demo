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

// ===== סדר ההרצה מול cron-job.org, v7.29 =====
//
// שתי שכבות מתזמנות את אותה התראה (סעיף 7): cron-job.org, שמדויק לשניות, ומשימות ה-cron
// של וורסל כרשת ביטחון. **מי שתופס ראשון את הסימון "נשלח היום" ב-Redis הוא היחיד ששולח**,
// ולכן הסדר ביניהן אינו פרט אלא הוא שקובע מי עובד.
//
// נמדד בלוג של 22.09.2026: וורסל רץ ב-04:00:01 UTC ותפס, cron-job.org הגיע ב-04:00:29
// וקיבל "already sent today (morning)". **כלומר השירות המדויק לא שלח את התראת הבוקר,
// והגיבוי הפך לראשי.** זה הפוך בדיוק מהסיבה שבגללה הוא נוסף: וורסל נמדדה ב-07:53 וב-07:25
// במקום 07:00. ביום שבו היא תאחר שוב, אין מי שיכסה, כי הסימון כבר נתפס.
//
// התיקון: וורסל מתעוררת בדקה 5 ולא בדקה 0. cron-job.org שולח, וורסל הופכת לגיבוי אמיתי.
// **והחלון בקוד הוא 07:00 עד 08:59 בירושלים**, ולכן דקה 5 עדיין בתוכו בנוחות.
console.log("\nסדר ההרצה: cron-job.org שולח, וורסל מגבה\n");
const morning = crons.filter((c) => String(c.path || "").includes("kind=morning"));
check("יש שתי משימות בוקר", morning.length === 2, morning.map((c) => c.schedule).join(" | "));
const firstMorning = morning.map((c) => String(c.schedule || "").split(" ")).filter((f) => f[1] === "4")[0];
check("משימת הבוקר המוקדמת קיימת (שעה 4 UTC)", !!firstMorning, morning.map((c) => c.schedule).join(" | "));
check(
  "והיא אינה בדקה 0, אחרת היא תתפוס את הסימון לפני cron-job.org",
  !!firstMorning && Number(firstMorning[0]) >= 3,
  firstMorning ? firstMorning.join(" ") : "לא נמצאה"
);

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.");
process.exit(fail ? 1 : 0);
