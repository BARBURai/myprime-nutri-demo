// v8.53: שבוע 2 יום 3 בסדר חדש רק ממחזור 15.11.2026, בלי רשת.
// הווים נשמרים לפי המקום ברשימה, ולכן הבדיקה נועלת שהישנות לא זזות,
// ושההחלטה נעשית במקום אחד בלבד ואינה מועתקת לשום קובץ אחר.
import fs from "node:fs";
import { CONTENT_DAYS, contentForDay, applyContentOrder, W2D3_NEW_FROM } from "../src/content/data.js";

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name + (detail ? "  " + detail : "")); } };
const titles = () => contentForDay(2, 3).lessons.map((l) => l.title);
const INTRO = "משימת תנועה - מבוא לאימוני הכוח שלך";
const WORK = "אימון מס' 1";
const DIFF = "משימת תנועה: איך תתאימי את דרגת הקושי באימונים?";
const OLD_THEME = "אימון 1 + הדרכת הכנה + סרטון הסבר לאימונים על ויסות דרגת";
const NEW_THEME = "הדרכת הכנה לאימונים + הסבר על התאמת דרגת הקושי + אימון 1";

ok("נקודת ההתחלה היא 15.11.2026", W2D3_NEW_FROM === "2026-11-15");
ok("בלי קריאה, הסדר הישן", JSON.stringify(titles()) === JSON.stringify([INTRO, WORK, DIFF]), titles().join(" | "));

for (const s of ["2026-11-08", "2026-10-11", "2025-03-02", "2026-11-14"]) {
  applyContentOrder(s);
  ok(`מחזור ${s}: הסדר הישן`, JSON.stringify(titles()) === JSON.stringify([INTRO, WORK, DIFF]), titles().join(" | "));
  ok(`מחזור ${s}: הכותרת הישנה`, contentForDay(2, 3).theme === OLD_THEME);
}
for (const s of ["2026-11-15", "2026-11-22", "2027-01-03"]) {
  applyContentOrder(s);
  ok(`מחזור ${s}: הסדר החדש`, JSON.stringify(titles()) === JSON.stringify([DIFF, INTRO, WORK]), titles().join(" | "));
  ok(`מחזור ${s}: הכותרת החדשה`, contentForDay(2, 3).theme === NEW_THEME);
}
for (const s of ["", null, undefined, 20261115]) {
  applyContentOrder(s);
  ok(`תאריך לא תקין (${String(s)}): הסדר הישן`, titles()[0] === INTRO);
}

applyContentOrder("2026-11-22"); applyContentOrder("2026-11-08"); applyContentOrder("2026-11-22");
ok("מעבר הלוך ושוב: שלושה שיעורים, בלי כפילויות", new Set(titles()).size === 3 && titles().length === 3);
ok("אותו אובייקט ברשימת הימים ובחיפוש לפי יום", CONTENT_DAYS.find((d) => d.week === 2 && d.day === 3) === contentForDay(2, 3));
ok("אף יום אחר לא זז", contentForDay(2, 4).lessons.length > 0 && contentForDay(2, 2).theme !== NEW_THEME);
applyContentOrder("2026-11-08");

const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const cm = fs.readFileSync(new URL("../src/content/ContentModule.jsx", import.meta.url), "utf8");
ok("האפליקציה קוראת את ההחלטה פעם אחת, לפי תאריך ההתחלה", (app.match(/applyContentOrder\(/g) || []).length === 1 && app.includes("applyContentOrder(profile.startDate)"));
ok("הקריאה נעשית מיד אחרי הפרופיל, לפני שמסך כלשהו קורא את היום", app.indexOf("applyContentOrder(profile.startDate)") - app.indexOf("const [profile, setProfile]") < 200);
ok("מודול התוכן אינו מחזיק עותק של יום 3 בשבוע 2", !/week === 2 && \w+\.day === 3/.test(cm) && !/W2D3/.test(cm));
ok("מודול התוכן אינו מעתיק את רשימת הימים בטעינה", !/^const \w+ = CONTENT_DAYS\.(map|filter|slice)/m.test(cm));

console.log(`\n${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
