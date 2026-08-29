// "שאלות, תשובות ועזרה": הקשה אחת, ופעולות החשבון בתחתית המסך. וגם: אין יותר אפור.
//
//   node qa/help-screen-check.mjs
//
// רון, 28 באוגוסט 2026: "לחיצה על שאלות ותשובות ועזרה צריכה להוביל ישר לשאלות
// והתשובות, ואז בסוף השאלות והתשובות שיהיה קו מפריד ומתחתיו מחיקת כל הנתונים
// והתנתקות מהמכשיר." בלי כותרת ביניהם, לפי בקשתו.
//
// ובאותה שיחה: "כל הטקסטים האפורים... אני רוצה אותם שחורים. אין יותר אפור."

import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  ← " + extra : "")); }
};

// הקטע של הפרופיל בלבד, כדי שבדיקה על "מה אין בו" לא תיפול על שאר הקובץ.
const profStart = src.indexOf("function ProfileScreen(");
const profEnd = src.indexOf("function FaqModal(");
const prof = src.slice(profStart, src.indexOf("\nfunction ", profStart + 10));
const faqStart = src.indexOf("function FaqModal(");
const faq = src.slice(faqStart, src.indexOf("\nfunction ", faqStart + 10));

console.log("\nהשורה בפרופיל");
check("הפרופיל והמסך שניהם נמצאו", profStart > 0 && faqStart > profStart && profEnd > 0);
check("הקשה על השורה פותחת ישר את השאלות והתשובות", /<div onClick=\{onOpenFaq\}/.test(prof));
check("אין יותר תפריט שנפתח בהקשה נוספת", !/helpOpen/.test(src));
check("ההתקנה על הטלפון היא שורה משלה", /<div onClick=\{onOpenInstall\}/.test(prof));
check("והיא מוצגת רק למי שעוד לא התקינה", /\{!isStandalone && \(\n\s*<div onClick=\{onOpenInstall\}/.test(prof));

console.log("\nפעולות החשבון עברו למסך השאלות והתשובות");
for (const [what, re] of [
  ["מחיקת כל הנתונים", /מחיקת כל הנתונים והתחלה מחדש/],
  ["התנתקות מהמכשיר", /התנתקות מהמכשיר הזה/],
  ["ניקוי תאריכים עתידיים", /ניקוי נתונים בתאריכים עתידיים/],
]) {
  check(what + " נמצא במסך השאלות והתשובות", re.test(faq));
  check("ואינו נשאר בפרופיל: " + what, !re.test(prof));
}
check("שתי חלוניות האישור עברו איתם", /confirmReset && \(/.test(faq) && /confirmLogout && \(/.test(faq));
check("ואינן נשארו בפרופיל", !/confirmReset/.test(prof) && !/confirmLogout/.test(prof));
check("קו מפריד לפני הפעולות, בלי כותרת ביניהן",
  /borderTop: `1px solid \$\{C\.line\}`, paddingTop: 14, marginTop: hasFutureEntries \? 14 : 18/.test(faq));
check("המסך מקבל את הפעולות מרמת האפליקציה",
  /<FaqModal startDate=\{profile\.startDate\} onReset=\{resetDemo\} onLogout=\{logoutDevice\}/.test(src));
check("וגם את מצב הגיבוי, שההסבר במחיקה נשען עליו", /backupOn=\{!!profile\.backup\?\.enabled\}/.test(src));

console.log("\nהדגשה בתוך תשובה");
check("הביטוי המודגש יושב בשדה נפרד ולא בתוך הטקסט", /untilMacro: true, b: "הסיכום היומי" \}/.test(src));
check("והטקסט עצמו נשאר מחרוזת אחת, זהה לבנק של המשרד", /function withBold\(text, phrase\) \{/.test(src));

console.log("\nאין יותר אפור");
const pal = src.match(/ink: "(#[0-9A-Fa-f]{6})", sub: "(#[0-9A-Fa-f]{6})", faint: "(#[0-9A-Fa-f]{6})"/);
check("שלושת הצבעים נמצאו בפלטה", !!pal, pal ? "" : "לא אותרו");
if (pal) {
  check("sub שחור כמו ink", pal[2] === pal[1], pal[2]);
  check("faint שחור כמו ink", pal[3] === pal[1], pal[3]);
}
// זה עיגול מלא ולא טקסט, ולכן הוא חייב להישאר בהיר גם כשאין יותר אפור בטקסט.
check("כפתור הפלוס הנעול נשאר עיגול בהיר", /borderRadius: "50%", background: "#BBA7AC", opacity: 0\.55/.test(src));

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.");
process.exit(fail ? 1 : 0);
