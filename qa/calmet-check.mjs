#!/usr/bin/env node
// מתי יום נחשב "עמדה ביעד הקלורי", ומה נצבע בגרף. בלי רשת.
//
//   node qa/calmet-check.mjs
//
// הכלל נמשך מ-src/App.jsx לפי מחרוזת ולא מועתק לכאן.

import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const lines = src.split("\n");
const line = (p) => { const h = lines.find((l) => l.trim().startsWith(p)); if (!h) { console.log("✗ לא נמצא: " + p); process.exit(1); } return h; };

const A = new Function([
  line("const KCAL_FLOOR ="),
  line("const CAL_MET_LOW ="),
  // `onMaintain` מגיע באפליקציה מרמת האפליקציה; כאן הוא נכנס כפרמטר לפונקציה
  line("const metFloor =").replace("(g) =>", "(g, onMaintain) =>"),
  "return { KCAL_FLOOR, CAL_MET_LOW, CAL_MET_LOW_MAINT, CAL_MET_HIGH, metFloor };",
].join("\n"))();
const floorOf = (g, maint) => A.metFloor(g, !!maint);
const met = (kc, g, maint) => g > 0 && kc >= floorOf(g, maint) && kc <= g * A.CAL_MET_HIGH;
const below = (kc, g, maint) => g > 0 && kc > 0 && kc < floorOf(g, maint);

let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (extra ? "  → " + extra : "")); } };

console.log("\nהרף עצמו\n");
check("הגבול התחתון הוא 90 אחוז", A.CAL_MET_LOW === 0.9);
check("והעליון 105 אחוז, כי חריגה היא מה שהמעקב תופס", A.CAL_MET_HIGH === 1.05);
check("ורצפת הבטיחות היא אותה רצפה של היעד הקלורי", A.KCAL_FLOOR === 1200);

console.log("\nהרצפה תופסת בדיוק אצל מי שרון היה מודאג ממנה\n");
// אישה בשמירה מטעמי בריאות: היעד שלה הוא התחזוקה, ורצפת 1,200 חלה עליה
check("יעד 1,200 עם גירעון: 1,199 אינו נספר", !met(1199, 1200));
check("יעד 1,200 עם גירעון: 1,200 כן", met(1200, 1200));
check("יעד 1,333: 1,200 הוא הרצפה ולא 1,066", A.metFloor(1333) === 1200 && !met(1199, 1333) && met(1200, 1333));
check("מה שהיה נספר קודם ואינו נספר עכשיו", !met(1066, 1333) && !met(960, 1200));

console.log("\nואצל מי שהיעד שלה גבוה, האחוז הוא שקובע\n");
check("יעד 1,500: מ-1,350", A.metFloor(1500) === 1350 && met(1350, 1500) && !met(1349, 1500));
check("יעד 1,800: מ-1,620", A.metFloor(1800) === 1620 && met(1620, 1800) && !met(1619, 1800));
check("הגבול העליון לא זז", met(1575, 1500) && !met(1576, 1500));

console.log("\nמי שבשמירה נמדדת אחרת: 5 אחוז, ובלי רצפת ה-1,200\n");
// היעד שלה הוגבל ל-1,200 דווקא מפני שהיא צורכת פחות ממנה, ולכן אין גירעון כפול
check("הרף בשמירה הוא 5 אחוז", A.CAL_MET_LOW_MAINT === 0.95);
check("יעד 1,200 בשמירה: מ-1,140", floorOf(1200, true) === 1140 && met(1140, 1200, true) && !met(1139, 1200, true));
check("1,154 נספר בשמירה ולא נספר עם גירעון", met(1154, 1200, true) && !met(1154, 1200, false));
check("1,107 אינו נספר בשום מצב", !met(1107, 1200, true) && !met(1107, 1200, false));
check("בשמירה עם יעד גבוה יותר, 5 אחוז מהיעד", floorOf(1400, true) === 1330);
check("והמרווח בשמירה צר מזה שיש לה עם גירעון", A.CAL_MET_LOW_MAINT > A.CAL_MET_LOW);
check("המסך מקבל את המצב מרמת האפליקציה", src.includes("onMaintain={lossStopped || profile.weeklyRateG === 0}"));

console.log("\nשלושת המצבים בגרף\n");
check("מתחת לטווח אינו כמו מעליו", below(1000, 1500) === true && below(1600, 1500) === false);
check("יום ריק אינו נספר כמתחת ליעד", below(0, 1500) === false);
check("ובקוד נצבעים בשלושה צבעים ולא בשניים", src.includes("calMet(d.kcal) ? C.brand : calBelow(d.kcal) ? C.info : C.amber"));
check("ויש מקרא שמסביר מה כל צבע", src.includes('[C.brand, "ביעד"], [C.info, "מתחת ליעד"], [C.amber, "מעל היעד"]'));

console.log("\nהמשפט שרון ביקש\n");
check("נאמר לה שהספירה לפי מה שרשמה", src.includes("הספירה לפי מה שרשמת ביומן, ולכן יום שתועד חלקית לא ייחשב כעמידה ביעד."));
check("והדיסקליימר על ההערכה נשאר", src.includes("הקלוריות והמאקרו הם הערכה."));

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.\n");
process.exit(fail ? 1 : 0);
