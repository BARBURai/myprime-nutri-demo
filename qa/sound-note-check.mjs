#!/usr/bin/env node
// ההנחיה על הקול בסרטונים. בלי רשת.
//
//   node qa/sound-note-check.mjs
//
// **הסרטון נפתח מושתק, וזה הדפדפן ולא אנחנו.** שתי משתתפות עם סמסונג דיווחו
// שהן לא מוצאות את הכפתור, ורון ביקש שההנחיה תהיה מפורשת: על מה מקישים ובאיזה
// סדר. ההדרכה מוצגת פעם אחת ביום הראשון, ולכן השורה מתחת לנגן היא העיקר.

import { readFileSync, existsSync } from "node:fs";
const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const content = readFileSync(new URL("../src/content/ContentModule.jsx", import.meta.url), "utf8");

let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (extra ? "  → " + extra : "")); } };

console.log("\nהשורה שמתחת לכל סרטון, וזו החשובה\n");
check("קיימת", content.includes("אין קול?"));
check("אומרת להקיש קודם על הסרטון", /הקישי פעם אחת על הסרטון/.test(content));
check("ואז על סמל הרמקול", /VolumeX size=\{15\}/.test(content) && /import \{ Play, Maximize2, VolumeX,/.test(content));
check("או על בורר הקול שבפס שלידו", /בורר הקול שנמצא בפס שלידו/.test(content));
// היא יושבת מתחת לשורת "לחצי לצפייה", כלומר צמוד לנגן ולא בתחתית העמוד.
check("מיד אחרי שורת ההפעלה", content.indexOf("הגדלת המסך") < content.indexOf("אין קול?"));
check("ולפני הנגן עצמו", content.indexOf("אין קול?") < content.indexOf('title="סרטון"'));

console.log("\nההדרכה\n");
const both = ["ONBOARD_SLIDES", "CATCHUP_GUIDE"];
for (const key of both) {
  const a = app.indexOf(`const ${key} = [`);
  const blk = app.slice(a, app.indexOf("\n];", a));
  check(`${key}: יש שקופית קול`, blk.includes("/pdf/onboard-sound.jpg"));
  check(`${key}: הנוסח של רון, מילה במילה`,
    blk.includes("לשינוי עוצמת הקול: מקישים פעם אחת על הסרטון, ואז מקישים פעם אחת על סמל הרמקול, או על בורר הקול שנמצא בפס שלידו, והקול חוזר"));
  // **המשפט "לפעמים הסרטון נפתח בלי קול" ירד.** רון: בהדרכה הוא דוחף את ההנחיה
  // עצמה מתחת לקצה המסך, והיא נשארת עם משפט שלא אומר לה מה לעשות.
  check(`${key}: בלי משפט הפתיחה שנפסל`, !blk.includes("לפעמים הסרטון נפתח בלי קול"));
  // **הנוסח הישן היה שגוי ולא רק חסר.** "לשלוט בעוצמת הקול לפי מה שנוח לך"
  // מנוסח כאילו הקול עובד והיא רק מכווננת אותו, ובפועל הוא סגור.
  check(`${key}: הנוסח הישן ירד`, !blk.includes("לשלוט בעוצמת הקול"));
  check(`${key}: שקופית הקול לפני זו של הגדלת המסך`,
    blk.indexOf("/pdf/onboard-sound.jpg") < blk.indexOf("/pdf/onboard-9.jpg"));
}

console.log("\nריווח השורות בהדרכה\n");
// רון: "הם יורדים מתחת לפולד ואז היא לא קוראת את הכל". שורה שלמה ריקה בין שורה
// לשורה דחפה את סוף הטקסט אל מחוץ למסך, והיא ראתה רק את המשפט הראשון.
check("צומצם בשתי ההדרכות", (app.match(/lineHeight: 1\.5, margin: 0/g) || []).length >= 2 && !/lineHeight: 1\.75, margin: 0 \}\}>\{s\.text\}/.test(app));

console.log("\nובשאלות ותשובות\n");
check("יש שאלה על הקול", /q: "אין קול בסרטון, מה עושים\?"/.test(app));
check("ובאותו ניסוח", /a: "לשינוי עוצמת הקול: מקישים פעם אחת על הסרטון, ואז מקישים פעם אחת על סמל הרמקול, או על בורר הקול שנמצא בפס שלידו\."/.test(app));

console.log("\nהתמונה\n");
check("הקובץ קיים", existsSync(new URL("../public/pdf/onboard-sound.jpg", import.meta.url)));

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.");
process.exit(fail ? 1 : 0);
