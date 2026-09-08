// Quiet days, the eve of Shabbat and of a festival, and the two lines that go with them.
//
// Until now the push notifications knew about one quiet day, Saturday. Every festival went out
// as an ordinary day: a 07:00 "new content today" on Yom Kippur morning, and an evening
// reminder that on 20 September 2026 would have landed almost exactly as the fast came in.
//
// And the Friday rule was wrong half the year. It was fixed at 18:00 "so it lands before
// Shabbat comes in", which only holds in summer: in December candles are lit around 16:10 in
// Tel Aviv, so for the whole winter that reminder reached every woman inside Shabbat.
//
// Everything here is pulled out of the real modules and run. Nothing is copied, because a copy
// drifts on the first edit, which is the trap qa/prompt-sync-check.mjs exists to prevent.
//
//   node qa/holiday-check.mjs

import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (got === undefined ? "" : "   התקבל: " + got)); }
};
const head = (t) => console.log("\n" + t + "\n");

let H = null;
try { H = await import("../api/_hebcal.js"); } catch (e) { /* reported below */ }

if (!H) {
  console.log("✗ api/_hebcal.js לא קיים או לא נטען. כל שאר הבדיקות אינן יכולות לרוץ.");
  process.exit(1);
}

const HE_DOW = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const dow = (iso) => HE_DOW[new Date(iso + "T12:00:00Z").getUTCDay()];

head("החגים מחושבים מהלוח העברי, בלי טבלה");

// Israel keeps one day of yom tov, except Rosh Hashanah which is two. Verified against the
// calendar for three separate years so a one-off coincidence cannot carry the test.
const YOM_TOV = [
  ["2026-09-12", "ראש השנה א"], ["2026-09-13", "ראש השנה ב"], ["2026-09-21", "יום כיפור"],
  ["2026-09-26", "סוכות"], ["2026-10-03", "שמחת תורה"],
  ["2026-04-02", "פסח א"], ["2026-04-08", "שביעי של פסח"], ["2026-05-22", "שבועות"],
  ["2027-10-02", "ראש השנה א"], ["2027-10-11", "יום כיפור"], ["2027-04-22", "פסח א"],
  ["2028-09-21", "ראש השנה א"], ["2028-09-30", "יום כיפור"], ["2028-04-11", "פסח א"],
];
for (const [iso, name] of YOM_TOV) ok(`${iso} (${dow(iso)}) הוא ${name}`, H.isYomTov(iso));

head("חול המועד אינו שקט, כי עובדים בו");

// The days between the first and last of Pesach, and between Sukkot and Simchat Torah. If
// these were silenced the women would lose a week of reminders twice a year.
for (const iso of ["2026-04-03", "2026-04-05", "2026-04-07", "2026-09-28", "2026-09-30", "2026-10-01"])
  ok(`${iso} (${dow(iso)}) אינו יום שקט`, !H.isYomTov(iso) && !H.isQuietDay(iso));

head("ימים רגילים נשארים רגילים");

for (const iso of ["2026-09-15", "2026-09-17", "2026-09-23", "2026-09-28"])
  ok(`${iso} (${dow(iso)}) אינו שקט`, !H.isQuietDay(iso));
ok("שבת רגילה שקטה", H.isQuietDay("2026-09-19"));

head("ערב שבת וערב חג");

// isErev is phrased as "tomorrow is quiet", so a festival needs no branch of its own and an
// ordinary Friday and the eve of Yom Kippur come out of the same line of code.
ok("שישי רגיל הוא ערב", H.isErev("2026-09-18"));
ok("ראשון 20.09 הוא ערב, כי מחר יום כיפור", H.isErev("2026-09-20"));
ok("שישי 11.09 הוא ערב, כי מחר ראש השנה", H.isErev("2026-09-11"));
ok("יום רגיל אינו ערב", !H.isErev("2026-09-16"));
ok("שבת עצמה אינה ערב", !H.isErev("2026-09-19"));
ok("יום חג עצמו אינו ערב", !H.isErev("2026-09-12"));

// Only the eve of a festival carries the extra line. Saying it every Friday would turn a
// useful sentence into weekly noise.
ok("ערב יום כיפור נושא את שורת החג", H.isErevYomTov("2026-09-20"));
ok("ערב ראש השנה נושא אותה", H.isErevYomTov("2026-09-11"));
ok("ערב סוכות נושא אותה", H.isErevYomTov("2026-09-25"));
ok("שישי רגיל אינו נושא אותה", !H.isErevYomTov("2026-09-18"));

head("הבוקר שאחרי החג");

ok("14.09, אחרי ראש השנה", H.wasYomTov("2026-09-14"));
ok("22.09, אחרי יום כיפור", H.wasYomTov("2026-09-22"));
ok("27.09, אחרי סוכות", H.wasYomTov("2026-09-27"));
ok("ראשון רגיל אחרי שבת רגילה אינו נחשב", !H.wasYomTov("2026-09-20"));

head("השקיעה מחושבת נכון, ולא נלקחת מטבלה");

// Published sunset times for Tel Aviv. A few minutes of error cannot matter for a push sent
// two hours earlier, but being an hour out would, so the tolerance is deliberately tight.
const hhmm = (dt) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hour12: false }).format(dt);
const mins = (s) => { const [a, b] = s.split(":").map(Number); return a * 60 + b; };
for (const [iso, real] of [["2026-06-19", "19:49"], ["2026-03-20", "17:53"], ["2026-12-18", "16:44"], ["2026-09-20", "18:47"]]) {
  const got = hhmm(H.sunsetUTC(iso));
  ok(`שקיעה ב-${iso} קרובה ל-${real}`, Math.abs(mins(got) - mins(real)) <= 8, got);
}

head("שעת השליחה בערב, שעתיים לפני הדלקת נרות");

ok("שישי בקיץ, 19.06", H.erevHour("2026-06-19") === 17, H.erevHour("2026-06-19"));
ok("שישי בחורף, 18.12", H.erevHour("2026-12-18") === 14, H.erevHour("2026-12-18"));
ok("ערב יום כיפור, 20.09", H.erevHour("2026-09-20") === 16, H.erevHour("2026-09-20"));
ok("ערב סוכות, 25.09", H.erevHour("2026-09-25") === 16, H.erevHour("2026-09-25"));
ok("ביום שאינו ערב אין שעה כזאת", H.erevHour("2026-09-16") === null);

// The whole point of the change: never again inside Shabbat. Checked across a full year rather
// than on the two dates that happen to be convenient.
head("ולעולם לא אחרי הדלקת נרות, בכל שישי בשנה");

let worst = null, bad = 0, fridays = 0;
for (let d = new Date(Date.UTC(2026, 0, 2)); d.getUTCFullYear() === 2026; d.setUTCDate(d.getUTCDate() + 7)) {
  const iso = d.toISOString().slice(0, 10);
  if (new Date(iso + "T12:00:00Z").getUTCDay() !== 5) continue;
  if (H.isQuietDay(iso)) continue;   // שישי שהוא עצמו חג, כמו שבועות. שקט, ואין לו שעת ערב
  fridays++;
  const h = H.erevHour(iso);
  if (h == null) { bad++; worst = { iso, h: "אין", gap: -1 }; continue; }
  const candle = mins(hhmm(new Date(H.sunsetUTC(iso).getTime() - 30 * 60000)));
  const gap = candle - h * 60;                 // minutes between the push and candle lighting
  if (gap < 90) { bad++; if (!worst || gap < worst.gap) worst = { iso, h, gap }; }
}
ok(`כל ${fridays} ימי שישי ב-2026 נשלחים לפחות שעה וחצי לפני הנרות`, bad === 0, worst && `${worst.iso} ב-${worst.h}:00, ${worst.gap} דקות לפני`);
ok("ובשעה שפויה בלבד, בין 12:00 ל-18:00", [...Array(52).keys()].every((i) => {
  const d = new Date(Date.UTC(2026, 0, 2) + i * 7 * 86400000);
  const iso = d.toISOString().slice(0, 10);
  if (new Date(iso + "T12:00:00Z").getUTCDay() !== 5) return true;
  if (H.isQuietDay(iso)) return true;
  const h = H.erevHour(iso);
  return h >= 12 && h <= 18;
}));

head("החיבור בתוך api/notify.js");

const N = readFileSync("api/notify.js", "utf8");
ok("שתי ההתראות נחסמות ביום שקט", (N.match(/if \(isQuietDay\(today\)\) return false;/g) || []).length === 2);
ok("כלל 18:00 הקבוע של יום שישי הוסר", !N.includes("FRIDAY_HOUR"));
ok("שעת הערב נגזרת מ-erevHour", N.includes("const e = erevHour(today);"));
ok("והיא גוברת על השעה שהאישה בחרה", /function reminderHourOf[\s\S]{0,220}if \(e != null\) return e;/.test(N));
ok("קבוצת השעות בערב חג היא אחת, עם חלון של שעתיים", N.includes("return (h === e || h === e + 1) ? [e] : [];"));
ok("today מחושב לפני שנקבעות קבוצות השעות", N.indexOf("const today = israelDay(0);") < N.indexOf("[askedHour] : groupsForHour(h, today)"));
ok("היום הנוכחי מחושב פעם אחת בלבד", (N.match(/const today = israelDay\(0\);/g) || []).length === 1);

head("הקופי, מילה במילה כפי שרון אישר");

const EVENING = "תזכורת קטנה 💜 מילאת היום את דוח המעקב היומי שלך?";
const HOLIDAY = "בימי החג לא נשלח תזכורות. האפליקציה פתוחה אם את מעוניינת להיכנס, ואפשר גם להשלים לאחור בסיום החג.";
const CATCHUP = "אם לא הספקת להיכנס בחג, ממליצה לך למצוא כמה דקות ולהשלים את התכנים של ימי החג 🙏";
ok("תזכורת הערב לא השתנתה", N.includes(`"${EVENING}"`));
ok("שורת החג", N.includes(`"${HOLIDAY}"`));
ok("שורת ההשלמה שאחרי החג", N.includes(`"${CATCHUP}"`));
ok("שורת החג מצורפת רק בערב חג", N.includes("isErevYomTov(today) ?"));
ok("ושורת ההשלמה יוצאת לכולן ולא רק למי שלא נכנסה", N.includes("afterYomTov ? HOLIDAY_CATCHUP :"));
ok("ואין ברכה בסוף, לפי החלטת רון", !N.includes("חג שמח") && !N.includes("צום קל"));
ok("אין מקף ארוך באף אחת מהן", ![EVENING, HOLIDAY, CATCHUP].some((t) => /[–—]/.test(t)));

head("הגיבוי של וורסל מכסה את השעות החדשות");

const V = JSON.parse(readFileSync("vercel.json", "utf8"));
const hours = V.crons.filter((c) => c.path === "/api/notify").map((c) => parseInt(c.schedule.split(" ")[1], 10));
// Israel is UTC+3 in summer and UTC+2 in winter, so the earliest send, 14:00 in midwinter,
// needs 12:00 UTC on the list. Without it the backup simply never fires on a winter Friday.
ok("יש הרצה ב-12:00 UTC, שהיא 14:00 בישראל בחורף", hours.includes(12), hours.join(","));
ok("ורצף שעות בלי חורים עד 21", [12, 13, 14, 15, 16, 17, 18, 19, 20, 21].every((h) => hours.includes(h)), hours.join(","));

console.log(`\n${pass} מתוך ${pass + fail} עברו.`);
process.exit(fail ? 1 : 0);
