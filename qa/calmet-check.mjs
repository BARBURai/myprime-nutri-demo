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
  line("const metFloor ="),
  "const goalKcal = 0;",
  "return { KCAL_FLOOR, CAL_MET_LOW, CAL_MET_HIGH, metFloor };",
].join("\n"))();
const met = (kc, g) => g > 0 && kc >= A.metFloor(g) && kc <= g * A.CAL_MET_HIGH;
const below = (kc, g) => g > 0 && kc > 0 && kc < A.metFloor(g);

let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (extra ? "  → " + extra : "")); } };

console.log("\nהרף עצמו\n");
check("הגבול התחתון הוא 90 אחוז", A.CAL_MET_LOW === 0.9);
check("והעליון 105 אחוז, כי חריגה היא מה שהמעקב תופס", A.CAL_MET_HIGH === 1.05);
check("ורצפת הבטיחות היא אותה רצפה של היעד הקלורי", A.KCAL_FLOOR === 1200);

console.log("\nהרצפה תופסת בדיוק אצל מי שרון היה מודאג ממנה\n");
// אישה בשמירה מטעמי בריאות: היעד שלה הוא התחזוקה, ורצפת 1,200 חלה עליה
check("יעד 1,200: 1,199 אינו נספר", !met(1199, 1200));
check("יעד 1,200: 1,200 כן", met(1200, 1200));
check("יעד 1,333: 1,200 הוא הרצפה ולא 1,066", A.metFloor(1333) === 1200 && !met(1199, 1333) && met(1200, 1333));
check("מה שהיה נספר קודם ואינו נספר עכשיו", !met(1066, 1333) && !met(960, 1200));

console.log("\nואצל מי שהיעד שלה גבוה, האחוז הוא שקובע\n");
check("יעד 1,500: מ-1,350", A.metFloor(1500) === 1350 && met(1350, 1500) && !met(1349, 1500));
check("יעד 1,800: מ-1,620", A.metFloor(1800) === 1620 && met(1620, 1800) && !met(1619, 1800));
check("הגבול העליון לא זז", met(1575, 1500) && !met(1576, 1500));

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
