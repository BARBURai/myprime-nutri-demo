#!/usr/bin/env node
/* ============================================================================
   שכבה 1: מתי מותר לשלוח כל התראה

   דיווח של משתתפת בשבוע 1 יום 2: הגיעה אליה תזכורת ערב ששאלה אם מילאה את דוח
   המעקב היומי, בזמן שיומן המעקב עוד לא נפתח לה. **הכרטיס נפתח ביום 3 בתוכנית**
   (`CHECKIN_UNLOCK` ב-`src/App.jsx`), ולתזכורת הערב לא הייתה שום בדיקה של היום
   בתוכנית, אז היא יצאה לכל מכשיר רשום מהרגע שנרשם.

   ארבעת הכללים שרון קבע ב-10 באוגוסט 2026:
   1. תזכורת מעקב: מיום 3 בתוכנית.
   2. תזכורת מעקב: עד יום 70 ועד בכלל. יום 71 ואילך שקט.
   3. תוכן חדש: מיום 1 עד יום 69 ועד בכלל.
   4. **בשבת לא יוצאת אף התראה, משום סוג, בלי קשר ליום בתוכנית.**
   5. ביום שישי תזכורת המעקב יוצאת ב-18:00 ולא ב-19:00, כדי שתגיע לפני כניסת השבת.

   הבדיקה קוראת את הפונקציות מתוך `api/notify.js` עצמו ומריצה אותן על ימים
   אמיתיים. בלי רשת ובלי שליחה:  node qa/notify-window-check.mjs
   ========================================================================== */

import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../api/notify.js", import.meta.url), "utf8");
const a = src.indexOf("// The windows each push");
const b = src.indexOf("export default async function handler");
if (a === -1 || b === -1) { console.log("נכשל | לא נמצא בלוק החלונות ב-api/notify.js"); process.exit(1); }
const { hasTracker, hasNewContent, programDayNumber, reminderHourOf, groupsForHour } = new Function(
  `${src.slice(a, b)}\nreturn { hasTracker, hasNewContent, programDayNumber, reminderHourOf, groupsForHour };`
)();

// She starts on Sunday 2 August 2026, so day 1 is that Sunday and every seventh day after
// it is a Saturday. Long enough to cover both ends of both windows.
// Note that day 70 is ALWAYS a Saturday: the programme starts on a Sunday, so day 70 is
// exactly ten weeks later. The last evening reminder any woman actually gets is day 69.
const START = "2026-08-02";
const day = (n) => new Date(Date.UTC(2026, 7, 1 + n)).toISOString().slice(0, 10);
const isSat = (n) => n % 7 === 0;

let failed = 0, passed = 0;
const check = (name, got, want) => {
  const ok = got === want;
  passed++;
  if (!ok) failed++;
  console.log(`${ok ? "עובר " : "נכשל "} | ${name}`);
  return ok;
};

// Every day from before the start to well past the end, against the four rules.
let mismatches = 0;
for (let n = -2; n <= 80; n++) {
  const date = day(n);
  const saturday = isSat(n);
  const wantTracker = !saturday && n >= 3 && n <= 70;
  const wantContent = !saturday && n >= 1 && n <= 69;
  if (hasTracker(START, date) !== wantTracker || hasNewContent(START, date) !== wantContent) {
    mismatches++;
    console.log(`        יום ${programDayNumber(START, date)}${saturday ? " (שבת)" : ""}: מעקב ${hasTracker(START, date)} במקום ${wantTracker}, תוכן ${hasNewContent(START, date)} במקום ${wantContent}`);
  }
}
check("כל יום מ-2 לפני ההתחלה ועד יום 80 תואם לארבעת הכללים", mismatches, 0);

// The edges, named one by one so a break says which rule broke.
check("יום 2, זה המקרה שדווח, אין תזכורת מעקב", hasTracker(START, day(2)), false);
check("יום 3, יומן המעקב נפתח ומכאן שולחים", hasTracker(START, day(3)), true);
check("יום 69 הוא התזכורת האחרונה בפועל", hasTracker(START, day(69)), true);
check("יום 70 שקט כי הוא תמיד שבת", hasTracker(START, day(70)), false);
check("יום 71 שקט כי הוא מחוץ לחלון", hasTracker(START, day(71)), false);
check("יום 1 מקבל התראת תוכן", hasNewContent(START, day(1)), true);
check("יום 69 עדיין מקבל התראת תוכן", hasNewContent(START, day(69)), true);
check("יום 70 כבר לא", hasNewContent(START, day(70)), false);

// Saturday beats everything, including a record with no start date at all.
check("שבת באמצע התוכנית: אין תזכורת מעקב", hasTracker(START, day(21)), false);
check("שבת באמצע התוכנית: אין התראת תוכן", hasNewContent(START, day(21)), false);
check("שבת גם למי שאין לה תאריך התחלה: אין מעקב", hasTracker(undefined, day(21)), false);
check("שבת גם למי שאין לה תאריך התחלה: אין תוכן", hasNewContent(undefined, day(21)), false);

// A registration made before v4.55 has no start date. Going silent on a weekday would rob a
// woman deep into the programme of her reminder, so the unknown case keeps sending.
check("רישום בלי תאריך התחלה ממשיך לקבל מעקב ביום חול", hasTracker(undefined, day(2)), true);
check("רישום בלי תאריך התחלה ממשיך לקבל תוכן ביום חול", hasNewContent(undefined, day(2)), true);

// Friday goes an hour earlier so the reminder does not land as Shabbat comes in.
// 5. שעת התזכורת: ברירת מחדל 19:00, בחירה אישית מכובדת, ושישי גובר על הכל.
const eq = (a2, b2) => JSON.stringify(a2) === JSON.stringify(b2);
check("ברירת מחדל: רישום בלי שעה מקבל 19:00", reminderHourOf({}, day(1)), 19);
check("שעה לא חוקית נדחית וחוזרת ל-19:00", reminderHourOf({ hour: 3 }, day(1)), 19);
check("מי שבחרה 22:00 מקבלת 22:00", reminderHourOf({ hour: 22 }, day(1)), 22);
check("מי שבחרה 21:00 מקבלת 21:00", reminderHourOf({ hour: 21 }, day(4)), 21);
check("שישי גובר: מי שבחרה 22:00 מקבלת 18:00", reminderHourOf({ hour: 22 }, day(6)), 18);
check("שישי גובר גם על ברירת המחדל", reminderHourOf({}, day(6)), 18);

// 6. כל קבוצת שעה מקבלת שני ניסיונות, שלה ושל השעה שאחריה, בדיוק כמו שהיה ל-19:00 לבד.
check("הרצה ב-19 משרתת את 19 ואת 18", eq(groupsForHour(19), [19, 18]), true);
check("הרצה ב-22 משרתת את 22 ואת 21", eq(groupsForHour(22), [22, 21]), true);
check("הרצה ב-23 היא הגיבוי של 22", eq(groupsForHour(23), [22]), true);
check("הרצה ב-18 משרתת את שישי בלבד", eq(groupsForHour(18), [18]), true);
check("הרצה ב-17 לא משרתת אף אחת", eq(groupsForHour(17), []), true);
check("הרצה בחצות לא משרתת אף אחת", eq(groupsForHour(0), []), true);
check("כל שעה שאפשר לבחור מכוסה בדיוק פעמיים", [19, 20, 21, 22, 18].every((g) => [18,19,20,21,22,23].filter((h) => groupsForHour(h).includes(g)).length === 2), true);
check("שישי עדיין מקבל תזכורת מעקב", hasTracker(START, day(6)), true);
check("שישי עדיין מקבל התראת תוכן", hasNewContent(START, day(6)), true);

console.log(`\n${passed - failed} מתוך ${passed} עברו.`);
process.exit(failed ? 1 : 0);
