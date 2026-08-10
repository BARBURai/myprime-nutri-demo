#!/usr/bin/env node
/* ============================================================================
   שכבה 1: מתי מותר לשלוח כל התראה

   דיווח של משתתפת בשבוע 1 יום 2: הגיעה אליה תזכורת ערב ששאלה אם מילאה את דוח
   המעקב היומי, בזמן שיומן המעקב עוד לא נפתח לה. **הכרטיס נפתח ביום 3 בתוכנית**
   (`CHECKIN_UNLOCK` ב-`src/App.jsx`), ולתזכורת הערב לא הייתה שום בדיקה של היום
   בתוכנית, אז היא יצאה לכל מכשיר רשום מהרגע שנרשם.

   הבדיקה קוראת את הפונקציות מתוך `api/notify.js` עצמו ומריצה אותן על ימים
   אמיתיים. בלי רשת ובלי שליחה:  node qa/notify-window-check.mjs
   ========================================================================== */

import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../api/notify.js", import.meta.url), "utf8");
const a = src.indexOf("const PROGRAM_DAYS");
const b = src.indexOf("export default async function handler");
if (a === -1 || b === -1) { console.log("נכשל | לא נמצא בלוק החלונות ב-api/notify.js"); process.exit(1); }
const { hasTracker, hasNewContent, programDayNumber } = new Function(
  `${src.slice(a, b)}\nreturn { hasTracker, hasNewContent, programDayNumber };`
)();

// She starts on Sunday 2 August 2026. Day 1 is that Sunday.
const START = "2026-08-02";
const day = (n) => new Date(Date.UTC(2026, 7, 1 + n)).toISOString().slice(0, 10);

const cases = [
  { name: "יום לפני שהתוכנית התחילה, אין תזכורת ערב", date: day(0), tracker: false },
  { name: "יום 1, היומן עוד לא נפתח", date: day(1), tracker: false },
  { name: "יום 2, זה המקרה שדווח", date: day(2), tracker: false },
  { name: "יום 3, היומן נפתח ומכאן שולחים", date: day(3), tracker: true },
  { name: "יום 4", date: day(4), tracker: true },
  { name: "יום 70, היום האחרון", date: day(70), tracker: true },
  { name: "יום 71, היומן נשאר פתוח בשלושת חודשי הגישה", date: day(71), tracker: true },
];

let failed = 0;
for (const t of cases) {
  const got = hasTracker(START, t.date);
  const ok = got === t.tracker;
  if (!ok) failed++;
  console.log(`${ok ? "עובר " : "נכשל "} | ${t.name}`);
  console.log(`        יום ${programDayNumber(START, t.date)} | תזכורת ערב: ${got ? "נשלחת" : "שקטה"}`);
}

// A registration made before v4.55 has no start date. Going silent there would rob a woman
// deep into the programme of her reminder, so the unknown case must keep sending.
const unknown = hasTracker(undefined, day(2)) === true && hasNewContent(undefined, day(2)) === true;
if (!unknown) failed++;
console.log(`${unknown ? "עובר " : "נכשל "} | רישום בלי תאריך התחלה ממשיך לקבל את שתי ההתראות`);

// The morning push must stay silent where it always was: Saturday, and after day 70.
const morning = [
  { name: "בוקר: שבת שקטה", date: "2026-08-08", want: false },
  { name: "בוקר: יום 71 שקט", date: day(71), want: false },
  { name: "בוקר: יום 2 כן נשלח, יש תוכן חדש", date: day(2), want: true },
];
for (const t of morning) {
  const got = hasNewContent(START, t.date);
  const ok = got === t.want;
  if (!ok) failed++;
  console.log(`${ok ? "עובר " : "נכשל "} | ${t.name}`);
}

const total = cases.length + 1 + morning.length;
console.log(`\n${total - failed} מתוך ${total} עברו.`);
process.exit(failed ? 1 : 0);
