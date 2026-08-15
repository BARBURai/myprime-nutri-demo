// The streak on the celebration screen: how many days in a row she closed, and which
// sentence she gets for it. No network, no AI.
//
//   node qa/streak-check.mjs
//
// The functions are pulled out of src/App.jsx by exact string, not copied here. A copy would
// drift the first time someone edits the app, and then this file would be testing something
// that no longer exists - the same trap qa/prompt-sync-check.mjs exists to prevent.

import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const grab = (from, to) => {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  if (a < 0 || b < 0) { console.log("✗ לא נמצא בקוד: " + from); process.exit(1); }
  return src.slice(a, b);
};

const lines = src.split("\n");
const line = (prefix) => {
  const hit = lines.find((l) => l.startsWith(prefix));
  if (!hit) { console.log("✗ לא נמצאה בקוד השורה: " + prefix); process.exit(1); }
  return hit;
};

const code = [
  "const pad2 = (n) => String(n).padStart(2, '0');",
  line("function parseDay("),
  line("function fmtDay("),
  line("function addDays("),
  line("function dowOf("),
  grab("function doneStreak(", "// Whether a task reads as"),
  "return { doneStreak, cheerFor, CHEER_LINES, CHEER_EMOJI, CHEER_MILESTONES };",
].join("\n");
const { doneStreak, cheerFor } = new Function(code)();

let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (extra ? "  → " + extra : "")); } };

// A programme that starts on a Sunday, so the weekday of every offset is known.
const START = "2026-07-26";
const day = (n) => { const d = new Date(Date.UTC(2026, 6, 26)); d.setUTCDate(d.getUTCDate() + n - 1); return d.toISOString().slice(0, 10); };
const built = (list) => { const c = {}; list.forEach((n) => { c[day(n)] = { _done: true }; }); return c; };

console.log("\nספירת הרצף\n");
check("בלי שום יום סגור הרצף אפס", doneStreak({}, START, day(10)) === 0);
check("יום אחד סגור הוא רצף של אחד", doneStreak(built([10]), START, day(10)) === 1);
check("שלושה ימים רצופים", doneStreak(built([8, 9, 10]), START, day(10)) === 3);
// Day 4 is a Wednesday, so this gap is a plain missed day and not the Shabbat exemption.
check("יום חול חסר באמצע עוצר את הספירה", doneStreak(built([3, 5, 6]), START, day(6)) === 2);

// Day 1 is Sunday, so day 7 is Saturday. She is given that day off and gets no notification,
// and a day we ourselves handed her must not cost her the streak.
check("יום 7 בתוכנית הוא שבת", (() => { const d = new Date(day(7) + "T00:00:00Z"); return d.getUTCDay() === 6; })());
check("שבת לא שוברת את הרצף", doneStreak(built([5, 6, 8, 9]), START, day(9)) === 4);
check("ושבת שכן נסגרה נספרת", doneStreak(built([5, 6, 7, 8, 9]), START, day(9)) === 5);
check("שני ימי חול חסרים כן שוברים", doneStreak(built([4, 8, 9]), START, day(9)) === 2);

// She filled at 22:00, or filled yesterday in retroactively. Nothing is stored, so both are
// simply recomputed and the run stays whole.
check("מילוי מאוחר של אתמול שומר על הרצף", doneStreak(built([8, 9, 10]), START, day(11)) === 3);
check("היום נסגר אחרי מילוי לאחור", doneStreak(built([8, 9, 10, 11]), START, day(11)) === 4);
check("לא נספר לפני תאריך ההתחלה", doneStreak(built([1, 2, 3]), START, day(3)) === 3);

console.log("\nהטקסט לפי הרצף\n");
const txt = (n, name = "רונית") => cheerFor(n, name).text;
check("ברצף 1 אין שורת רצף", cheerFor(1, "רונית").streak === 0);
check("וברצף 1 המשפט הישן נשמר", /עוד יום שהשלמת/.test(txt(1)));
check("מרצף 2 שורת הרצף מוצגת", cheerFor(2, "רונית").streak === 2);

// The ladder exactly as approved. Sentence, emoji and name each move on a different cycle.
const table = {
  2: "ממש יפה 🌷",
  3: "רונית, את בדרך הנכונה 🌼",
  4: "כל הכבוד לך 💐",
  5: "אלופה! 🥇",
  6: "רונית, גאה בך 🏆",
  7: "את בפריים שלך ✨",
  8: "המשיכי כך 👏",
  9: "רונית, ממש יפה ❤️",
  10: "רונית, זה כבר לא מקרי 🏆",
  11: "את בדרך הנכונה 💜",
  12: "כל הכבוד לך 🌸",
  13: "רונית, אלופה! 🌷",
  14: "גאה בך 🌼",
  20: "רונית, זה כבר חלק מהיום שלך ❤️",
  30: "רונית, חודש שלם שלא ויתרת על עצמך 🎉",
  40: "רונית, זה כבר הרגל ולא מאמץ ✨",
  50: "רונית, זה כבר מי שאת 💜",
  60: "רונית, את בפריים שלך 💐",
};
for (const n of Object.keys(table)) check("רצף " + n, txt(Number(n)) === table[n], txt(Number(n)));

check("אישה בלי שם שמור לא מקבלת פסיק מיותר", txt(3, "") === "את בדרך הנכונה 🌼", txt(3, ""));
check("וגם בנקודת ציון", txt(30, "") === "חודש שלם שלא ויתרת על עצמך 🎉", txt(30, ""));

// The three cycles are 7, 10 and 3 long. If any two lined up the messages would read as a
// template within a fortnight.
let sameTwice = 0;
for (let n = 2; n <= 70; n++) if (n - 1 >= 2 && txt(n) === txt(n - 1)) sameTwice++;
check("אותו משפט לא חוזר פעמיים ברצף", sameTwice === 0, sameTwice + " מקרים");
const seen = new Set();
for (let n = 2; n <= 70; n++) seen.add(txt(n));
check("לפחות 30 ניסוחים שונים ב-70 יום", seen.size >= 30, seen.size + " ניסוחים");
check("אין מקף ארוך באף משפט", ![...seen].some((t) => /[–—]/.test(t)));

console.log("\nהשלמת אימון כוח, ומסך החגיגה\n");
// A woman who trains Mon/Wed/Fri could never close Sun/Tue/Thu. The make-up row lives only
// inside the tracker sheet, so none of the counting screens see it - that is the whole point,
// and it is what these three checks pin down.
const app = src;
check("שורת ההשלמה מוצגת רק בשני, ברביעי ובשישי", /dn === 2 \|\| dn === 4 \|\| dn === 6 \? addDays\(date, -1\)/.test(app));
check("והיא כותבת ליום הקודם ולא להיום", /setPrevValue\("strength"/.test(app));
check("היא לא נוספה לרשימת המשימות", !/strengthmakeup/.test(app) && !/"makeup"/.test(readFileSync(new URL("../src/checkins.js", import.meta.url), "utf8")));
check("הקופי של שורת ההשלמה מדויק", app.includes("(אופציונלי למעקב היום, במידה ועשית היום במקום אתמול. אנחנו ממליצים על יום מנוחה בין אימון לאימון)"));
check("מסך החגיגה קופץ רק על היום הנוכחי", /if \(d === today\) celebrate = true;/.test(app));
check("שורת הרצף מופיעה גם במסך הגביע", (app.match(/ימים ברצף<\/div>/g) || []).length === 2);
check("החתימה של ענת כבר לא אפורה וקטנה", !/C\.faint, fontSize: 14 \}\}>ענת/.test(app));

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.");
process.exit(fail ? 1 : 0);
