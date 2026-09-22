// רישום ההתראות, וסדר ההרצה מול cron-job.org. v7.31
//
//   node qa/push-log-check.mjs
//
// **למה זה קיים.** רון, 22 בספטמבר 2026: "עוד לא הבנתי אם כולן קיבלו הודעת בוקר היום".
// התשובה הייתה שאי אפשר לדעת: `api/notify.js` ספר לעצמו כמה נשלחו, החזיר את המספר
// בתשובה, **ווורסל אינה שומרת גוף תשובה.** שני החלקים שנבנו בעקבות זה הם מה שנעול כאן.
//
// **אומת שיש לה שיניים: על v7.27 היא מחזירה 5 מתוך 24.**
//
// **הגרסה שבדב רחבה מזו**, ויש בה עוד עשר בדיקות התנהגות על מטמון הגיליון. כאן הן אינן
// קיימות בכוונה, כי המטמון עצמו לא הועלה לייצור. **כשהוא יעלה, הקובץ שבדב מחליף את זה.**

import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (extra ? "  → " + extra : "")); } };
const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");

// ===== 1. סדר ההרצה: cron-job.org שולח, וורסל מגבה =====
//
// מי שתופס ראשון את הסימון "נשלח היום" ב-Redis הוא היחיד ששולח. נמדד בלוג הייצור של
// 22.09.2026: וורסל ב-04:00:01 UTC תפסה, cron-job.org הגיע ב-04:00:29 וקיבל
// already sent today. **כלומר השירות המדויק לא שלח, והגיבוי הפך לראשי.**
console.log("\nסדר ההרצה מול cron-job.org\n");
const crons = JSON.parse(read("vercel.json")).crons || [];
const notifyCrons = crons.filter((c) => String(c.path || "").startsWith("/api/notify"));
check("יש משימות התראה ב-vercel.json", notifyCrons.length >= 11, String(notifyCrons.length));
const earlyMorning = notifyCrons.filter((c) => c.path.includes("morning") && String(c.schedule).split(" ")[1] === "4");
check("משימת הבוקר המוקדמת קיימת", earlyMorning.length === 1, notifyCrons.map((c) => c.schedule).join(" | "));
check(
  "משימת הבוקר אינה בדקה 0",
  earlyMorning.length === 1 && Number(String(earlyMorning[0].schedule).split(" ")[0]) >= 3,
  earlyMorning.map((c) => c.schedule).join(" | ")
);
const evening = notifyCrons.filter((c) => !c.path.includes("morning"));
check("יש עשר משימות ערב", evening.length === 10, String(evening.length));
check(
  "אף משימת ערב אינה בדקה 0",
  evening.every((c) => Number(String(c.schedule).split(" ")[0]) >= 3),
  evening.map((c) => c.schedule).join(" | ")
);
// השעות עצמן לא זזו, רק הדקה. שינוי שעה משנה למי נשלח ומתי, וזו החלטה של רון.
check(
  "שעות הערב נשארו 12 עד 21 UTC",
  evening.map((c) => Number(String(c.schedule).split(" ")[1])).sort((a, b) => a - b).join(",") === "12,13,14,15,16,17,18,19,20,21",
  evening.map((c) => c.schedule).join(" | ")
);

// ===== 2. רישום התוצאה =====
console.log("\nכל שליחה נרשמת, וגם כשהיא אפס\n");
const notify = read("api/notify.js");
check("נכתבת רשומה ל-push:log", /push:log:\$\{israelDay\(0\)\}/.test(notify), "לא נמצא");
check("הרישום קורה לפני שהתשובה מוחזרת", notify.indexOf("push:log:") < notify.lastIndexOf("return res.status(200).json({ ok: true, kind:"), "אחרי ה-return");
check("הכתיבה ממתינה ואינה נשארת ברקע", /await redisCmd\(RU, RT, \["HSET", `push:log:/.test(notify), "בלי await, וזה הבאג של v6.17");
check("לרשומה יש תפוגה", /"EXPIRE", `push:log:/.test(notify), "בלי EXPIRE, הרשומות יצטברו לנצח");
check("המפתח של הערב מכיל את השעות", /`evening:\$\{serve\.join\("-"\)\}`/.test(notify), "הערב ידרוס את עצמו בין קבוצות");
check("נרשמים sent, failed, quiet ו-total", /sent, failed, pruned, quiet, total:/.test(notify), "חסר שדה");
check("נרשמת גם השעה", /at: israelClock\(\)/.test(notify), "בלי שעה אי אפשר לדעת מתי זה יצא");
// המלכודת של סעיף 20: שעה שנרשמת ב-UTC נקראת כשעה אחרת לגמרי.
check("השעה מחושבת בשעון ישראל ולא ב-UTC", /israelClock[\s\S]{0,300}Asia\/Jerusalem/.test(notify), "לא נמצא Asia/Jerusalem");
check("כישלון ברישום אינו מפיל את השליחה", /catch \(e\) \{ console\.warn\("push log write failed/.test(notify), "אין catch");

console.log("\nהדוח היומי מציג את זה, וגם כשאין נתון\n");
const report = read("api/usage-report.js");
check("הדוח קורא את הרשומה", /push:log:/.test(report), "לא נמצא");
check("יש כותרת התראות", /התראות/.test(report), "לא נמצא");
check("מוצגת שורת הבוקר של היום", /תוכן בוקר/.test(report), "לא נמצא");
check("מוצגות שורות הערב של אתמול", /תזכורת ערב/.test(report), "לא נמצא");
// הכלל של v5.07: בכלי עבודה, היעדר שורה אינו תשובה. זו בדיוק השורה שתספר לרון
// שהבוקר לא יצא, ולכן היא חייבת להופיע ולא להיעלם.
check('חוסר נתון נקרא "לא נרשמה" ולא נעלם', (report.match(/לא נרשמה/g) || []).length >= 2, "פחות משתי הופעות");
check("הבוקר נקרא מהתאריך של היום", /pushLog\(israelDay\(0\)\)/.test(report), "לא נמצא");
check("הערב נקרא מהתאריך של אתמול", /pushLog\(day\)/.test(report), "לא נמצא");
check("תקלה בקריאה אינה מפילה את הדוח", /catch \(e\) \{ return \[\]; \}/.test(report), "אין נפילה רכה");
check("המספרים חוזרים גם בתשובת ה-JSON", /push: \{ morning:/.test(report), "לא נמצא");

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.");
process.exit(fail ? 1 : 0);
