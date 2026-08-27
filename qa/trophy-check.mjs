// הגביע השבועי. בלי רשת ובלי עלות.
//
//   node qa/trophy-check.mjs
//
// נכתבה אחרי דיווח של הילה, 22 באוגוסט 2026: "לא ביצעתי את אימון הכוח ביום חמישי,
// ביצעתי אותו ביום שישי וסימנתי אותו כאילו ביצעתי ביום חמישי. למרות שקיבלתי מדליה
// על כל הימים לא קיבלתי גביע. ואז אחרי שלחצתי על אימון הכוח גם ביום שישי פתאום
// הופיע הגביע." הבדיקה מריצה את הכלל האמיתי על המסלול שלה, כדי שהתשובה אליה תהיה
// עובדה ולא הסבר.
//
// weekTrophyEarned נמשכת מ-src/App.jsx לפי מחרוזת ואינה מועתקת.

import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  ← " + extra : "")); }
};

const grab = (re, label) => {
  const m = src.match(re);
  if (!m) { console.log("  ✗ " + label + " לא נמצאה ב-App.jsx"); process.exit(1); }
  return m[0];
};
const helpers =
  grab(/function pad2\([^\n]*\n/, "pad2") + "\n" +
  grab(/function fmtDay\([\s\S]*?\n\}/, "fmtDay") + "\n" +
  grab(/function parseDay\(dateStr\)[^\n]*\n/, "parseDay") + "\n" +
  grab(/function addDays\(dateStr, n\)[^\n]*\n/, "addDays") + "\n" +
  grab(/function weekTrophyEarned\(checkins, startDate, w, today\) \{[\s\S]*?\n\}/, "weekTrophyEarned");
const weekTrophyEarned = new Function(helpers + "; return weekTrophyEarned;")();

// מחזור מתחיל תמיד ביום ראשון. 2026-08-16 הוא יום ראשון, ולכן שבוע 2 הוא 23 עד 29.
const START = "2026-08-16";
const d = (n) => { const t = new Date(Date.UTC(2026, 7, 16)); t.setUTCDate(t.getUTCDate() + n - 1); return t.toISOString().slice(0, 10); };
const W2 = [8, 9, 10, 11, 12, 13, 14];   // ראשון עד שבת של שבוע 2
const done = (days) => { const c = {}; days.forEach((n) => { c[d(n)] = { _done: true }; }); return c; };

console.log("\nהגביע השבועי, ומה שהילה תיארה");

check("יום ראשון של שבוע 2 הוא ה-23 בחודש", d(8) === "2026-08-23");
check("ויום שישי הוא ה-28", d(13) === "2026-08-28");

// כל ששת ימי החול סגורים, ביום שישי. שבת אינה נדרשת.
check("שישה ימים סגורים ביום שישי מזכים בגביע",
  weekTrophyEarned(done([8, 9, 10, 11, 12, 13]), START, 2, d(13)) === true);
check("ושבת אינה נדרשת גם בסוף השבוע",
  weekTrophyEarned(done([8, 9, 10, 11, 12, 13]), START, 2, d(14)) === true);

// זה בדיוק המסלול שלה: חמישי לא היה סגור, והיא סגרה אותו ביום שישי.
const beforeMakeup = done([8, 9, 10, 11, 13]);          // חמישי (12) חסר
check("בלי יום חמישי אין גביע", weekTrophyEarned(beforeMakeup, START, 2, d(13)) === false);
const afterMakeup = done([8, 9, 10, 11, 12, 13]);
check("ברגע שחמישי נסגר, הגביע מגיע באותו יום שישי",
  weekTrophyEarned(afterMakeup, START, 2, d(13)) === true);

// והנקודה שמסבירה למה אצלה הוא לא הגיע מיד: יום שישי עצמו חייב להיות סגור.
const fridayOpen = done([8, 9, 10, 11, 12]);            // שישי (13) עדיין פתוח
check("חמישי הושלם אבל שישי עוד פתוח - אין גביע",
  weekTrophyEarned(fridayOpen, START, 2, d(13)) === false);
check("וברגע ששישי נסגר, הגביע מופיע",
  weekTrophyEarned(done([8, 9, 10, 11, 12, 13]), START, 2, d(13)) === true);

// יום אחד חסר מבטל את הגביע של כל השבוע. זו החלטת מוצר ולא תקלה, וכאן היא נעולה
// כדי שאם רון ישנה אותה, השינוי יהיה מפורש.
for (const miss of [8, 9, 10, 11, 12, 13]) {
  const days = [8, 9, 10, 11, 12, 13].filter((n) => n !== miss);
  check("יום " + (miss - 7) + " חסר מבטל את הגביע", weekTrophyEarned(done(days), START, 2, d(13)) === false);
}

// לפני יום שישי אין גביע גם כשכל מה שעבר סגור, כי השבוע עוד לא נגמר.
check("ביום חמישי עוד אין גביע גם כשהכל סגור",
  weekTrophyEarned(done([8, 9, 10, 11, 12]), START, 2, d(12)) === false);

// שבוע 1: היומן נפתח ביום 3, ולכן נדרשים ימים 3 עד 6 בלבד.
check("בשבוע 1 נדרשים ארבעה ימים בלבד, מיום 3",
  weekTrophyEarned(done([3, 4, 5, 6]), START, 1, d(6)) === true);
check("ובשבוע 1 יום 3 חסר מבטל אותו",
  weekTrophyEarned(done([4, 5, 6]), START, 1, d(6)) === false);
check("ויום 1 ויום 2 אינם נדרשים",
  weekTrophyEarned(done([3, 4, 5, 6]), START, 1, d(6)) === true);

// שבוע ריק לגמרי אינו מזכה, גם כשעברה כל התקופה.
check("שבוע בלי אף יום סגור אינו מזכה", weekTrophyEarned({}, START, 2, d(14)) === false);

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.");
process.exit(fail ? 1 : 0);
