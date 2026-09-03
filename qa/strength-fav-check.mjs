// שני דברים שמשתתפת ביקשה ב-2 בספטמבר 2026, ושניהם נבדקים כאן בלי רשת:
//
//   1. אימון כוח שהיא דיווחה מסמן את התיבה ביומן המעקב לבד, כמו הצעדים.
//      **הכלל היה קיים בקוד ולא יכול היה לירות**, כי הפעילות נשמרת עם משך הזמן
//      בתוך השם ("אימון כוח 30 דק׳") וההשוואה הייתה מדויקת מול "אימון כוח".
//
//   2. אפשר לתת כינוי לארוחה כששומרים אותה למועדפים, והכינוי חל גם ביומן.
//
// הפונקציות נמשכות מ-src/App.jsx לפי מחרוזת ואינן מועתקות לכאן. העתק היה נסחף
// בעריכה הראשונה, וזו בדיוק המלכודת ש-qa/prompt-sync-check.mjs קיימת כדי למנוע.
//
//   node qa/strength-fav-check.mjs

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
  const hit = lines.find((l) => l.trimStart().startsWith(prefix));
  if (!hit) { console.log("✗ לא נמצאה בקוד השורה: " + prefix); process.exit(1); }
  return hit.trim();
};

const code = [
  "const DEFAULT_CUP_ML = 250;",
  line("function waterMlOf("),
  grab("function autoStatusFor(", "// A day is auto-marked complete"),
  grab("function taskDone(", "// Tasks shown for a given date"),
  "return { autoStatusFor, taskDone };",
].join("\n");
const { autoStatusFor, taskDone } = new Function(code)();

let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (extra ? "  → " + extra : "")); } };

const DAY = "2026-09-01", OTHER = "2026-08-31";
const TASK = { id: "strength" };
const auto = (activityLog) => autoStatusFor(DAY, {}, {}, [], { protein: 100 }, 250, activityLog);
const ticked = (activityLog, answers = {}) => taskDone(TASK, answers, auto(activityLog));

console.log("\nאימון כוח מסמן את התיבה לבד");
{
  // זה בדיוק מה שנשמר היום כשהיא בוחרת "אימון כוח" ומזינה 30 דקות.
  check("פעילות בשם \"אימון כוח 30 דק׳\" מסמנת",
    ticked([{ id: "a1", date: DAY, name: "אימון כוח 30 דק׳", kcal: 130, strength: true }]));
  // אימון שהיא דיווחה לפני השינוי אינו נושא סימן, ולכן ההיסטוריה נתפסת לפי השם.
  check("וגם אימון ישן, בלי הסימן, נתפס לפי תחילת השם",
    ticked([{ id: "a2", date: DAY, name: "אימון כוח 45 דק׳", kcal: 200 }]));
  check("אימון בשם חופשי שמתחיל ב\"אימון כוח\" נתפס גם הוא",
    ticked([{ id: "a3", date: DAY, name: "אימון כוח בבית 20 דק׳", kcal: 90 }]));
  check("ריצה אינה מסמנת אימון כוח",
    !ticked([{ id: "a4", date: DAY, name: "ריצה 30 דק׳", kcal: 300 }]));
  check("יוגה אינה מסמנת אימון כוח",
    !ticked([{ id: "a5", date: DAY, name: "יוגה / פילאטיס 40 דק׳", kcal: 120 }]));
  check("אימון מיום אחר אינו מסמן את היום הזה",
    !ticked([{ id: "a6", date: OTHER, name: "אימון כוח 30 דק׳", kcal: 130, strength: true }]));
  check("בלי שום פעילות התיבה ריקה", !ticked([]));
  check("והיא עדיין ניתנת לסימון ידני, כמו קודם",
    ticked([], { strength: true }));
}

console.log("\nוהמסלול שלם: מהחלונית ועד היומן");
{
  check("החלונית מסמנת פעילות כאימון כוח רק כשנבחר מהרשימה",
    src.includes('strength: sel >= 0 && acts[sel].name === "אימון כוח"'));
  check("והסימן נשמר על הפעילות עצמה",
    src.includes("strength: !!a.strength"));
  // שלוש המשימות האוטומטיות האחרות לא נגעו.
  const a = autoStatusFor(DAY, { [DAY]: 8000 }, { [DAY]: 1500 }, [{ date: DAY, p: 120 }], { protein: 100 }, 250, []);
  check("צעדים, מים, יומן וחלבון ממשיכים לעבוד כמו קודם",
    a.steps === 8000 && a.water === 6 && a.journal === true && a.protein === true,
    JSON.stringify(a));
}

console.log("\nכינוי לארוחה");
{
  const save = grab("const saveFavorite = () => {", "const commit = (payload");
  check("הכינוי נכתב למועדפים", save.includes("setFavorites"));
  check("והוא נכתב גם לשורה שביומן", save.includes("setLog") && save.includes("favPrompt.entryId"));
  check("וגם לרשימת האחרונים", save.includes("setRecents"));
  // המאגר המשותף מתאר את המוצר ולא את הצלחת שלה, ולכן כינוי אישי לא נכנס אליו.
  check("ואינו נוגע במאגר המשותף", !save.includes("catalogAdd"));
  check("שדה ריק חוזר לשם המקורי", save.includes("|| orig"));
  check("המזהה של המועדף נגזר מהשם החדש", save.includes('id: "fav_" + name'));
  check("והכתיבה ליומן קורית רק כשהשם באמת השתנה", save.includes("if (name !== orig)"));

  check("השדה מגיע מלא מראש בשם הקיים", src.includes("setFavName(cands[0].fav.name)"));
  check("המזהה של השורה ביומן נשמר כדי שאפשר יהיה לשנות אותה",
    src.includes("entryId: cands[0].row.id"));
  check("והשורות נבנות לפני הכתיבה, כדי שיהיה מזהה בכלל",
    src.includes("const rows = items.map((p, i) =>"));
  check("הקופי שאושר נמצא במסך",
    src.includes("אפשר לתת לזה שם משלך, כדי שתזהי אותו בפעם הבאה."));
  // השורה הזאת היא ההסבר המקורי של החלונית, והיא נשמטה כשנוסף שדה הכינוי.
  check("וההסבר למה שומרים למועדפים נשאר מתחת לשדה",
    src.includes("כדי שתוכלי להוסיף אותו שוב בהקשה אחת."));
  check('ו"לא תודה" מנקה את השדה', src.includes('setFavPrompt(null); setFavName(""); }} style={{ marginTop: 8 }}>לא תודה'));
}

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.");
process.exit(fail ? 1 : 0);
