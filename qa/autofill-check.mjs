/* ============================================================================
   מנהל הסיסמאות של הדפדפן ושדות קוד הגיבוי.

   **נמצא ב-18 בספטמבר 2026, בבדיקה של רון בדב:** מסך השחזור נפתח לו **ושדה
   הקוד כבר היה מלא**, בלי שהקליד דבר. זה היה מנהל הסיסמאות של כרום, שראה שדה
   מסוג סיסמה באותו אתר ומילא אותו בסיסמה שמורה.

   **ולמה זה חמור בשני הכיוונים:**
   - **במסך השחזור** היא לוחצת "שחזרי את הנתונים", מקבלת "קוד שגוי", **ומסיקה
     שהגיבוי אינו עובד.**
   - **ובמסך ההרשמה זה גרוע פי כמה:** שני שדות הקוד מתמלאים באותה סיסמה, הם
     תואמים זה לזה, **והיא ממשיכה הלאה בלי לדעת שהקוד שלה אינו מה שהקלידה.**
     מאותו רגע הגיבוי שלה נעול במפתח שהיא אינה מכירה.

   **הכלל שנעול כאן: כל שדה קוד באפליקציה נושא `autoComplete="one-time-code"`
   ושם משלו.** זה מה שאומר לדפדפן שזה קוד ולא סיסמה של האתר.

   node qa/autofill-check.mjs
   ========================================================================== */
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log("עובר  | " + n); } else { fail++; console.log("נכשל  | " + n + (extra !== undefined ? "  → " + extra : "")); } };

// כל תגית input שיש בה type="password", בשלמותה.
// **ולמה לא ביטוי רגולרי פשוט:** בתוך התגית יושב `onChange={(e) => ...}`,
// והחץ מכיל סימן גדול-מ, ולכן חיפוש שנעצר בסימן הזה חותך את התגית באמצע
// ומחזיר אפס שדות. נתפס בבנייה של הבדיקה עצמה.
const fields = [];
for (let i = src.indexOf('type="password"'); i !== -1; i = src.indexOf('type="password"', i + 1)) {
  const a = src.lastIndexOf("<input", i);
  const b = src.indexOf("/>", i);
  if (a !== -1 && b !== -1) fields.push(src.slice(a, b + 2));
}

ok("נמצאו שדות קוד באפליקציה", fields.length >= 7, fields.length);

let guarded = 0, named = 0;
const names = new Set();
for (const f of fields) {
  if (f.includes('autoComplete="one-time-code"')) guarded++;
  const nm = f.match(/name="([^"]+)"/);
  if (nm) { named++; names.add(nm[1]); }
}
ok("**כל שדה קוד מסומן לדפדפן כקוד ולא כסיסמה**", guarded === fields.length, `${guarded}/${fields.length}`);
ok("ולכל אחד שם משלו", named === fields.length && names.size === fields.length, `${named} שמות, ${names.size} ייחודיים`);
ok("ואף שם אינו נראה לדפדפן כשדה סיסמה", ![...names].some((n) => /^password$|pass$|pwd/i.test(n)), [...names].join(","));

// ארבעת המסכים שבהם זה חי, כל אחד בנפרד, כדי ששכחה במסך אחד לא תיבלע בסכום.
const screens = [
  ["מסך ההרשמה, יצירת הקוד", 'name="mp-bk-new"'],
  ["ואישור הקוד באותו מסך", 'name="mp-bk-new2"'],
  ["מסך השחזור, וזה מה שרון נתקל בו", 'name="mp-bk-restore"'],
  ["החלפת קוד מהפרופיל", 'name="mp-bk-reset"'],
  ["והפעלת גיבוי מהפרופיל", 'name="mp-bk-on"'],
];
for (const [label, needle] of screens) {
  const f = fields.find((x) => x.includes(needle));
  ok(label, !!f && f.includes('autoComplete="one-time-code"'), needle);
}

// **ומה שלא זז:** הקוד עדיין מוסתר בהקלדה. שינוי של זה הוא החלטה של רון.
ok("והקוד עדיין מוסתר בהקלדה, כמו קודם", fields.every((f) => f.includes('type="password"')));

console.log(`\nסה"כ: ${pass} עוברים, ${fail} נכשלים\n`);
process.exit(fail ? 1 : 0);
