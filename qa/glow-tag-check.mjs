#!/usr/bin/env node
// התיוג של מי שצפתה בשיעורי הבונוס. בלי רשת.
//
//   node qa/glow-tag-check.mjs
//
// שתי הבטחות שהבדיקה הזאת קיימת בשבילן:
// 1. **קריאה אחת למניצ'ט לכל אישה, אי פעם.** הנקודה הזאת רצה בכל טעינה של
//    האפליקציה, ובלי הסימון היא הייתה קוראת אלפי פעמים ביום.
// 2. **התג הזה ותו לא.** אין מכאן שום מסלול שכותב תג אחר, משנה שדה, או שולח
//    הודעה. היום זה בלתי אפשרי, וזו הגנה אמיתית ששווה לשמור.

import { readFileSync } from "node:fs";
const api = readFileSync(new URL("../api/usage.js", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (extra ? "  → " + extra : "")); } };

console.log("\nמתי מתייגים\n");
check("רק כשהיא באמת התחילה לצפות", /if \(hasUsage && rec\.glowStarted\)/.test(api));
check("והקריאה אינה חוסמת את שמירת נתוני השימוש",
  /tagWatched\([^)]*\)\.catch\(\(\) => \{\}\)/.test(api));
check("הטלפון מגיע מהאפליקציה", /phone: ph/.test(app) && /localStorage\.getItem\("myprime_phone"\)/.test(app));

console.log("\nפעם אחת בלבד, וזו ההגנה העיקרית\n");
check("הסימון נתפס לפני הקריאה ולא אחריה",
  api.indexOf('`glowtag:${email}`, "1", "NX"') < api.indexOf("addTagByName"));
check("ובלי תפוגה, כי זה אירוע של פעם אחת בחיים",
  /SET", `glowtag:\$\{email\}`, "1", "NX"\)/.test(api) && !/glowtag[^)]*"EX"/.test(api));
check("אם הסימון כבר קיים, לא נעשית שום קריאה",
  /if \(first !== "OK"\) return;/.test(api));
check("וכישלון משחרר את הסימון כדי שהטעינה הבאה תנסה שוב",
  /DEL", `glowtag:\$\{email\}`/.test(api));

console.log("\nמה מותר לכתוב מכאן, וזו ההגנה השנייה\n");
const paths = api.match(/\/fb\/subscriber\/[A-Za-z]+/g) || [];
check("שתי קריאות למניצ'ט בלבד: איתור והוספת תג", paths.length === 2, paths.join(", "));
check("איתור לפי הטלפון", paths.includes("/fb/subscriber/findByCustomField"));
check("והוספת תג", paths.includes("/fb/subscriber/addTagByName"));
check("אין מכאן הסרת תג", !/removeTagByName/.test(api));
check("אין מכאן כתיבת שדה", !/setCustomField/.test(api));
check("ואין מכאן שום שליחת הודעה או הפעלת זרימה",
  !/sendContent|sendFlow|\/sending\//.test(api));
check("התג היחיד שאפשר לכתוב הוא זה שרון נתן",
  (api.match(/tag_name:/g) || []).length === 1 && /GLOW_WATCH_TAG = "GLOW-DEMO-WATCH"/.test(api));

console.log("\nוההתנהגות מול מניצ'ט\n");
check("200 עם גוף שאומר שנכשל נחשב כישלון",
  /said !== "error"/.test(api));
check("בלי מפתח לא נעשה כלום", /if \(!token \|\| !p\) return;/.test(api));

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.");
process.exit(fail ? 1 : 0);
