#!/usr/bin/env node
// קוד הגיבוי: מתי הוא עוזב את המכשיר, ומה נשמר אצלנו. בלי רשת.
//
//   node qa/backup-mail-check.mjs
//
// הבדיקה הזאת קיימת בשביל הבטחה אחת: **הקוד נשלח לשרת רק כדי להרכיב ממנו מייל
// אחד, ולעולם אינו נכתב אצלנו.** אם מישהו יוסיף אי פעם שמירה של הקוד, היא נופלת.

import { readFileSync } from "node:fs";
const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../api/backup.js", import.meta.url), "utf8");

let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (extra ? "  → " + extra : "")); } };

console.log("\nמתי הקוד עוזב את המכשיר\n");
check("bkUpload שולח קוד רק כשמבקשים ממנו במפורש",
  /const payload = notify \? \{ email, blob, code, notify: 1 \} : \{ email, blob \};/.test(app));
check("ובגיבוי רגיל נשלח טקסט מוצפן בלבד",
  !/JSON\.stringify\(\{ email, blob, code/.test(app));
check("המייל יוצא רק כשהקוד נולד, ולא אם כבר היה לה אחד",
  /const had = bkGetCode\(\);/.test(app) && /bkUpload\(email, code, localStorage\.getItem\(STORAGE_KEY\) \|\| "", !had\)/.test(app));
check("ושוב כשהיא משנה את הקוד בעצמה",
  /bkUpload\(email, newCode, localStorage\.getItem\(STORAGE_KEY\) \|\| "", true\)/.test(app));

console.log("\nומה נשמר אצלנו, וזו ההבטחה עצמה\n");
// כל כתיבה ל-Redis בקובץ, וכל אחת מהן חייבת להיות מוסברת
const writes = api.match(/redisCmd\([^)]*\[\s*"SET"[^\]]*\]/g) || [];
check("יש בדיוק שתי כתיבות: הגיבוי המוצפן, וסימון שהמייל יצא", writes.length === 2, "נמצאו " + writes.length);
check("הגיבוי נשמר כטקסט מוצפן", writes.some((w) => /JSON\.stringify\(blob\)/.test(w)));
check("והסימון מחזיק חותמת זמן ולא את הקוד",
  writes.some((w) => /bkmail:\$\{email\}`, String\(Date\.now\(\)\)/.test(w)));
check("הקוד עצמו לעולם אינו נכתב ל-Redis",
  !/SET[^\]]*body\.code/.test(api) && !/SET[^\]]*, code\b/.test(api));
check("ואינו מוחזר בתשובה", !/json\(\{[^}]*code/.test(api));
check("ואינו נרשם ביומן", !/console\.(log|error|warn)/.test(api));

console.log("\nוההגנות סביב\n");
check("הגיבוי נשמר לפני המייל, כך שספק מייל שנופל אינו עולה לה בגיבוי",
  api.indexOf('["SET", key, JSON.stringify(blob)]') < api.indexOf("await mailCode(RU, RT, email"));
check("בלי מפתח של ספק המייל פשוט לא נשלח כלום",
  /if \(!KEY \|\| !process\.env\.REPORT_FROM\) return false;/.test(api));
// כתובת ברירת המחדל של הספק מורשית לשלוח לבעל החשבון בלבד, ולכן מייל לאישה
// היה נדחה ממילא. עדיף לא לנסות מאשר להיכשל בשקט אצל כל אחת.
check("וגם בלי כתובת שולח מאומתת, כדי לא להיכשל בשקט",
  !/onboarding@resend\.dev/.test(api));
check("סימון של חמש דקות מונע שליחה כפולה",
  /"NX", "EX", 300/.test(api));
check("וכישלון בשליחה לעולם אינו מפיל את הבקשה",
  /catch \(e\) \{ return false; \}/.test(api));

console.log("\nוהקופי\n");
// רק הטקסט שהיא רואה, ולא ההערות בקוד שמסבירות את הכלל עצמו
const copy = (api.match(/const MAIL_SUBJECT =[\s\S]*?\n\}/) || [""])[0];
check("הנוסח יושב במקום אחד ולא בתוך הלוגיקה", /const MAIL_SUBJECT =/.test(api) && /function mailHtml\(code\)/.test(api));
check("בקול המערכת: בלי חתימה בשמה של ענת", !/ענת/.test(copy));
check("ובלי אמוג'י", !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(copy));
check("ונאמר לה במפורש שבלי הקוד גם אנחנו לא נוכל לשחזר",
  /בלי הקוד לא נוכל לשחזר את הנתונים גם אנחנו/.test(copy));

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.");
process.exit(fail ? 1 : 0);
