// בדיקת מפתח הסימון של שיעורי גלו. בלי רשת.
//
// רון, 14 בספטמבר 2026: "למה אתה לא שם את הווי לפי הסרטון ולא לפי המקום ברשימה."
//
// מה שהיא נועלת: הווי, הלב ומונה הצפיות של גלו נגזרים ממזהה הסרטון, ולכן
// החלפת רשימה אינה מזיזה אותם; שאר 94 שיעורי התוכנית לא נגעו; וההמרה החד
// פעמית של מה שכבר שמור על המכשיר מעבירה כל סימון לשיעור הנכון.
//
// הפונקציות נמשכות מ-src/content/ContentModule.jsx לפי מחרוזת ואינן מועתקות,
// כדי שהעתק לא ייסחף בעריכה הראשונה.
import fs from "node:fs";
import { GLOW_DAY, GLOW_FULL_DAY } from "../src/content/glow.js";

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name); } };

const SRC = fs.readFileSync(new URL("../src/content/ContentModule.jsx", import.meta.url), "utf8");
// פונקציה שאינה קיימת מוחזרת כגוף ריק, כדי שהבדיקה תדווח כישלונות על קוד
// ישן במקום למות עם שגיאה שאי אפשר ללמוד ממנה כמה בדיוק נשבר.
const grab = (name, kind = "function") => {
  const start = SRC.indexOf(`${kind} ${name}(`);
  if (start === -1) return `function ${name}() {}`;
  let i = SRC.indexOf("{", start), depth = 0, end = -1;
  for (let j = i; j < SRC.length; j++) {
    if (SRC[j] === "{") depth++;
    else if (SRC[j] === "}") { depth--; if (depth === 0) { end = j + 1; break; } }
  }
  return SRC.slice(start, end);
};

// מחסן מדומה במקום localStorage.
let LS = {};
const store = {
  getItem: (k) => (k in LS ? LS[k] : null),
  setItem: (k, v) => { LS[k] = String(v); },
};
const DONE_KEY = "mp_content_done_v1", FAV_KEY = "mp_content_fav_v1", VIEWS_KEY = "mp_content_views_v1";
const loadStore = (k) => { try { return JSON.parse(store.getItem(k) || "{}"); } catch (e) { return {}; } };
const saveStore = (k, o) => store.setItem(k, JSON.stringify(o));

let FULL_ACCESS = true;
const glowVideoAt = (i, list) => {
  const ls = (list || (FULL_ACCESS ? GLOW_FULL_DAY : GLOW_DAY)).lessons;
  return ls[i] ? ls[i].videoId || "" : "";
};

// הקבוע נמשך גם הוא מהמקור ואינו מוקלד כאן, אחרת שינוי שם שלו היה משתיק את
// ההמרה בשקט והבדיקה הייתה ממשיכה לעבור.
const CONST_LINE = (SRC.match(/^const GLOW_MIGRATED_KEY = .*$/m) || [])[0]
  || 'const GLOW_MIGRATED_KEY = "__missing__";';

const build = () => new Function(
  "localStorage", "loadStore", "saveStore", "glowVideoAt", "DONE_KEY", "FAV_KEY", "VIEWS_KEY", "GLOW_DAY", "GLOW_FULL_DAY",
  `${CONST_LINE}\n${grab("lessonKey")}\n${grab("migrateGlowKeys")}\nreturn { lessonKey, migrateGlowKeys, GLOW_MIGRATED_KEY };`
)(store, loadStore, saveStore, glowVideoAt, DONE_KEY, FAV_KEY, VIEWS_KEY, GLOW_DAY, GLOW_FULL_DAY);

const { lessonKey, migrateGlowKeys, GLOW_MIGRATED_KEY } = build();

console.log("\n- המפתח עצמו -");
FULL_ACCESS = false;
const demoKey3 = lessonKey(0, 0, 1);  // שיעור 3 בדמו
FULL_ACCESS = true;
const fullKey3 = lessonKey(0, 0, 3);  // אותו שיעור 3 בקורס המלא
check("שיעור 3 מקבל את אותו מפתח בשתי הרשימות", demoKey3 === fullKey3 && demoKey3.startsWith("GV-"));
check("המפתח הוא מזהה הסרטון", demoKey3 === "GV-" + GLOW_DAY.lessons[1].videoId);
check("שני שיעורים שונים מקבלים מפתחות שונים", lessonKey(0, 0, 3) !== lessonKey(0, 0, 8));
check("אין יותר מפתח מבוסס מקום בגלו", !lessonKey(0, 0, 0).startsWith("W0D0"));

console.log("\n- שאר התוכנית לא נגעה -");
check("שיעור רגיל שומר על המפתח הישן", lessonKey(3, 5, 2) === "W3D5-2");
check("גם שבוע 1 יום 1", lessonKey(1, 1, 0) === "W1D1-0");
check("שבוע 0 עם יום שאינו 0 אינו נחשב גלו", lessonKey(0, 2, 1) === "W0D2-1");
check("מקום שאין בו שיעור נופל חזרה למפתח הישן", lessonKey(0, 0, 99) === "W0D0-99");

console.log("\n- ההמרה, אישה שראתה את הדמו -");
// היא ראתה מבוא, שיעור 3 ושיעור 8, וסימנה את שיעור 6 כמועדף.
LS = {};
saveStore(DONE_KEY, { "W0D0-0": 1, "W0D0-1": 1, "W0D0-3": 1, "W2D4-1": 1 });
saveStore(FAV_KEY, { "W0D0-2": 1 });
saveStore(VIEWS_KEY, { "W0D0-1": 2, "W3D1-0": 5 });
FULL_ACCESS = true;
migrateGlowKeys();
const d = loadStore(DONE_KEY), f = loadStore(FAV_KEY), v = loadStore(VIEWS_KEY);
const gv = (t) => "GV-" + GLOW_FULL_DAY.lessons.find((l) => l.title.includes(t)).videoId;
check("מבוא נשאר מסומן", d[gv("מבוא קורס")] === 1);
check("שיעור 3 מסומן, ולא שיעור 1ב׳", d[gv("שיעור 3")] === 1 && d[gv("שיעור 1 ב׳")] === undefined);
check("שיעור 8 מסומן, ולא שיעור 3 בלבד", d[gv("שיעור 8")] === 1);
check("שיעור 2, גוואשה, אינו מסומן", d[gv("שיעור 2")] === undefined);
check("בדיוק שלושה שיעורי גלו מסומנים", Object.keys(d).filter((k) => k.startsWith("GV-")).length === 3);
check("לא נשאר אף מפתח גלו ישן", Object.keys(d).every((k) => !/^W0D0-/.test(k)));
check("שיעור התוכנית שלה לא נגע", d["W2D4-1"] === 1);
check("המועדף עבר לשיעור 6", f[gv("שיעור 6")] === 1 && Object.keys(f).length === 1);
check("מונה הצפיות עבר לשיעור 3", v[gv("שיעור 3")] === 2);
check("ומונה הצפיות של התוכנית לא נגע", v["W3D1-0"] === 5);
check("ההמרה מסומנת כבוצעה", store.getItem(GLOW_MIGRATED_KEY) === "1");

console.log("\n- ההמרה רצה פעם אחת בלבד -");
saveStore(DONE_KEY, { ...loadStore(DONE_KEY), "W0D0-9": 1 });
migrateGlowKeys();
check("סימון חדש מהצורה הישנה אינו מומר שוב", loadStore(DONE_KEY)["W0D0-9"] === 1);

console.log("\n- ההמרה, אישה שכבר הייתה על הקורס המלא -");
LS = {};
// מפתח 10 יכול היה להיכתב רק מול הקורס, ולכן כל המפתחות שלה מומרים מולו.
saveStore(DONE_KEY, { "W0D0-1": 1, "W0D0-10": 1 });
migrateGlowKeys();
const d2 = loadStore(DONE_KEY);
check("שיעור 1ב׳ מסומן, כי היא באמת ראתה אותו", d2[gv("שיעור 1 ב׳")] === 1);
check("ושיעור 8 מסומן", d2[gv("שיעור 8")] === 1);
check("ולא שיעור 3", d2[gv("שיעור 3")] === undefined);

console.log("\n- אין מה להמיר -");
LS = {};
saveStore(DONE_KEY, { "W5D2-0": 1 });
migrateGlowKeys();
check("מכשיר בלי סימוני גלו יוצא נקי", JSON.stringify(loadStore(DONE_KEY)) === '{"W5D2-0":1}');

console.log("\n- הדוח למסך הניהול -");
const US = SRC.slice(SRC.indexOf("export function usageSummary"));
check("הדוח סופר את הרשימה של האישה ולא את זו שבקוד", /const gList = glowListFor\(\)/.test(US));
check("ואינו סופר 28 לכל אישה", !/glowTotal: \(hasGlowFull\(\)/.test(US));

console.log(`\n${pass} מתוך ${pass + fail}`);
process.exit(fail ? 1 : 0);
