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

   **v7.24 ניסתה לסמן את השדות `autoComplete="one-time-code"` ולהשאיר אותם
   שדות סיסמה, וזה נמדד ונכשל:** רון פתח את מסך השחזור למחרת והשדה היה מלא
   שוב. **כרום ממלא כל שדה סיסמה באותו דומיין ומתעלם מהמאפיין הזה.**

   **הכלל שנעול כאן, ב-v7.25: אין באפליקציה שדה סיסמה בכלל.** שדה הקוד הוא
   שדה טקסט רגיל, וההסתרה נעשית ב-CSS ולא על ידי סוג השדה, **כלומר הקוד עדיין
   מוסתר בהקלדה ושום דבר בחוויה של האישה לא זז.**

   node qa/autofill-check.mjs
   ========================================================================== */
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log("עובר  | " + n); } else { fail++; console.log("נכשל  | " + n + (extra !== undefined ? "  → " + extra : "")); } };

// **הקוד מחוץ להערות בלבד**, אחרת ההסבר למעלה על מה שנכשל היה נספר כקוד חי.
const code = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

// כל תגית input שיש בה CODE_FIELD, בשלמותה.
// **ולמה לא ביטוי רגולרי פשוט:** בתוך התגית יושב `onChange={(e) => ...}`,
// והחץ מכיל סימן גדול-מ, ולכן חיפוש שנעצר בסימן הזה חותך את התגית באמצע
// ומחזיר אפס שדות. נתפס בבנייה של הבדיקה עצמה.
const fields = [];
for (let i = code.indexOf("{...CODE_FIELD}"); i !== -1; i = code.indexOf("{...CODE_FIELD}", i + 1)) {
  const a = code.lastIndexOf("<input", i);
  const b = code.indexOf("/>", i);
  if (a !== -1 && b !== -1) fields.push(code.slice(a, b + 2));
}

ok("נמצאו שדות קוד באפליקציה", fields.length >= 7, fields.length);

// **זו הבדיקה המרכזית, וזו שהייתה חסרה ב-v7.24.** שדה סיסמה אחד ששרד מספיק
// כדי שמנהל הסיסמאות ימלא אותו, ולכן הספירה היא אפס ולא "רובם".
ok("**אין באפליקציה שום שדה מסוג סיסמה**", !code.includes('type="password"'), code.includes('type="password"') ? "נשאר לפחות אחד" : "");

// ההגדרה עצמה: מה שהיא אומרת לדפדפן.
const def = code.match(/const CODE_FIELD = \{[^}]*\}/);
ok("ההגדרה קיימת", !!def, def ? "" : "CODE_FIELD חסר");
ok("והיא שדה טקסט ולא סיסמה", !!def && /type:\s*"text"/.test(def[0]), def && def[0]);
ok("ואומרת לדפדפן לא למלא", !!def && /autoComplete:\s*"off"/.test(def[0]));
// **בשדה סיסמה המקלדת אינה מגדילה אות ראשונה ואינה מתקנת, ובשדה טקסט היא כן.**
// בלי שני אלה אישה שבוחרת קוד בטלפון מקבלת אות גדולה בלי לדעת, **בשני השדות
// יחד ולכן בלי שדבר יעצור אותה**, והגיבוי שלה ננעל במפתח שהיא אינה מכירה.
ok("**ושהמקלדת לא תגדיל לה אות ראשונה**", !!def && /autoCapitalize:\s*"off"/.test(def[0]), def && def[0]);
ok("ולא תתקן לה את הקוד", !!def && /autoCorrect:\s*"off"/.test(def[0]) && /spellCheck:\s*false/.test(def[0]));
ok("וגם למנהלי סיסמאות חיצוניים", !!def && /1p-ignore/.test(def[0]) && /lpignore/.test(def[0]));

let named = 0;
const names = new Set();
for (const f of fields) {
  const nm = f.match(/name="([^"]+)"/);
  if (nm) { named++; names.add(nm[1]); }
}
ok("ולכל שדה שם משלו", named === fields.length && names.size === fields.length, `${named} שמות, ${names.size} ייחודיים`);
ok("ואף שם אינו נראה לדפדפן כשדה סיסמה", ![...names].some((n) => /^password$|pass$|pwd/i.test(n)), [...names].join(","));

// חמשת המסכים שבהם זה חי, כל אחד בנפרד, כדי ששכחה במסך אחד לא תיבלע בסכום.
const screens = [
  ["מסך ההרשמה, יצירת הקוד", 'name="mp-bk-new"'],
  ["ואישור הקוד באותו מסך", 'name="mp-bk-new2"'],
  ["מסך השחזור, וזה מה שרון נתקל בו", 'name="mp-bk-restore"'],
  ["החלפת קוד מהפרופיל", 'name="mp-bk-reset"'],
  ["והפעלת גיבוי מהפרופיל", 'name="mp-bk-on"'],
];
for (const [label, needle] of screens) {
  const f = fields.find((x) => x.includes(needle));
  ok(label, !!f, needle);
}

// **ומה שלא זז:** הקוד עדיין מוסתר בהקלדה. שינוי של זה הוא החלטה של רון,
// ולכן ההסתרה נבדקת בכל אחד משבעת השדות ולא רק בהגדרה.
const mask = code.match(/const CODE_MASK = \{[^}]*\}/);
ok("ההסתרה מוגדרת", !!mask && /WebkitTextSecurity:\s*"disc"/.test(mask[0]), mask && mask[0]);
const masked = fields.filter((f) => f.includes("...CODE_MASK")).length;
ok("**והקוד עדיין מוסתר בהקלדה בכל שדה**", fields.length > 0 && masked === fields.length, `${masked}/${fields.length}`);

console.log(`\nסה"כ: ${pass} עוברים, ${fail} נכשלים\n`);
process.exit(fail ? 1 : 0);
