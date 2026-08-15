// מיי פריים Glow, שיעורי הבונוס. בלי רשת ובלי AI.
//
//   node qa/glow-check.mjs
//
// The single rule this file exists to defend: the bonus lessons must stay OUT of every
// count. The moment they join CONTENT_DAYS, every woman who received them reads as behind
// everyone else on the office screen, and nothing on any screen would say why.

import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const glow = read("src/content/glow.js");
const mod = read("src/content/ContentModule.jsx");
const app = read("src/App.jsx");
const sheet = read("api/_sheet.js");
const access = read("api/access.js");
const data = read("src/content/data.js");

let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (extra ? "  → " + extra : "")); } };

console.log("\nהבונוס מחוץ לכל ספירה\n");
check("שיעורי הבונוס יושבים בקובץ נפרד", /export const GLOW_DAY/.test(glow));
check("והם אינם חלק מ-60 ימי התוכנית", !/GLOW|בונוס איפור/.test(data));
check("הם נושאים שבוע 0 ויום 0", /week: 0,\s*\n\s*day: 0,/.test(glow));
check("ולכן הם לא נספרים בסיכום השימוש", !/GLOW/.test(mod.slice(mod.indexOf("export function usageSummary"))));
check("והם לא זולגים לשיעור הבא בתוכנית", /if \(w === 0\) return null;/.test(mod));

console.log("\nמי רואה אותם\n");
check("הגיליון נקרא לפי הכותרת בונוס איפור", sheet.includes('findCol(header, ["בונוס איפור"])'));
check("העמודה אופציונלית, והיעדרה אינו שובר כלום", /col\.glow !== -1 \? isTrue/.test(sheet));
check("השער מחזיר את הסימון", /startDate, phone, glow/.test(access));
check("והשער קורא גם הוא לפי אותה כותרת", access.includes('findCol(header, ["בונוס איפור"])'));
check("האפליקציה שומרת את הסימון ומרעננת אותו בכל טעינה", /myprime_glow/.test(app));
check("בלי סימון לא מוצג כלום", /const showGlow = !!glow && hasGlow\(\)/.test(mod));
check("וגם עם סימון, רשימה ריקה לא מציגה כלום", /export const hasGlow = \(\) => GLOW_DAY\.lessons\.length > 0/.test(glow));

console.log("\nהקופי והמסננים\n");
check("הכותרת בדיוק כפי שאושרה", glow.includes('export const GLOW_TITLE = "בונוס: שלושה שיעורי איפור וטיפוח מתוך תוכנית מיי פריים Glow"'));
check("שם הצ׳יפ בדיוק כפי שאושר", glow.includes('export const GLOW_CHIP = "מיי פריים Glow"'));
check("השורה מופיעה בכרטיס של מסך היום", /glow && hasGlow\(\) && !glowStarted\(\) && <div/.test(mod));
check("הכיתוב הקצר ביומן בדיוק כפי שאושר", glow.includes('export const GLOW_CARD_LINE = "בונוס: 3 שיעורי Glow 💄"'));
check("סימן השפתון מופיע בארבעת המקומות", (mod.match(/GLOW_EMOJI/g) || []).length >= 4);
check("הכיתוב של השורה הקטנה בדיוק כפי שאושר", glow.includes('export const GLOW_ROW = "שיעורי הבונוס שלך במיי פריים Glow"'));
check("שנייה אחת של צפייה מורידה את השורה מהיומן", /if \(!startedRef\.current && t > 0\)/.test(mod) && /onStart=\{openL\.week === 0 \? markGlowStarted/.test(mod));
check("ובמסך התוכן יש שורה אחת שמקפיצה לרשימה ולא הרשימה עצמה", /setTypeF\("glow"\); setView\("all"\)/.test(mod));
check("הצ׳יפ נוסף רק למי שמגיע לה", /showGlow \? \[\.\.\.FILTER_CHIPS, \["glow", .*GLOW_CHIP.*\]\] : FILTER_CHIPS/.test(mod));
check("ובצ׳יפ הזה שורת השבועות נעלמת", /!isPdf && !isGlow &&/.test(mod));
check("אין מקף ארוך בקופי", !/[–—]/.test(glow));

console.log("\nארבעת הסרטונים\n");
const ids = (glow.match(/videoId: "([0-9a-f-]{36})"/g) || []);
check("ארבעה סרטונים: מבוא ושלושה שיעורים", ids.length === 4, ids.length + " סרטונים");
check("לכל אחד מזהה תקין ושונה", new Set(ids).size === 4);
check("המבוא ראשון", glow.indexOf('"מבוא"') < glow.indexOf('"שיעור 3'));
check("הכותרות בדיוק כפי שרון שלח", ["מבוא", "שיעור 3 - פריימר ובסיס (מייק אפ)", "שיעור 6 - איפור עיניים בסיסי", "שיעור 8 - מראה עיניים מעושן"].every((t) => glow.includes(`title: "${t}"`)));
check("כולם מסוג וידאו ובלי דפים", (glow.match(/type: "video"/g) || []).length === 4 && !/pdf|pageImages/.test(glow));

console.log("\nשני התיקונים שאושרו באותה גרסה\n");
check("שבת נקראת כשישי במסך כל התוכנית", /const openDow = todayDow === 0 \? 6 : todayDow;/.test(mod));
check("והכלל משתמש בו ולא ב-todayDow", /d <= openDow/.test(mod) && !/d <= todayDow/.test(mod));
check("שום יום לא נפתח מעצמו", /const opened = !!dayOpen\[dk\];/.test(mod));
check("ולא נשאר קוד שפותח את היום הנוכחי", !/setDayOpen\(\{ \[`\$\{todayWeek\}/.test(mod));

console.log("\nהסרטונים עצמם חסומים בשרת, ולא רק במסך\n");
const ids2 = read("api/_glow-ids.js");
const token = read("api/bunny-token.js");
// Every video id in the app ships inside the JavaScript bundle, so hiding the rows is not
// protection. The only thing that actually stops a woman without the TRUE is the server
// refusing to sign the playback link.
const listA = (glow.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) || []).sort();
const listB = (ids2.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) || []).sort();
check("רשימת המזהים בשרת זהה לזו שבאפליקציה", listA.length === 4 && JSON.stringify(listA) === JSON.stringify(listB), listA.length + " מול " + listB.length);
check("שליפת הקישור בודקת אם זה סרטון בונוס", /isGlowVideo\(videoId\)/.test(token));
check("ובלי הרשאה מחזירה סירוב", /not_entitled/.test(token) && /status\(403\)/.test(token));
check("ההרשאה נכתבת ונמחקת בכל כניסה", /SET", `glow:\$\{email\}`/.test(access) && /DEL", `glow:\$\{email\}`/.test(access));
check("האפליקציה שולחת את המייל בשליפת הקישור", /email=\$\{encodeURIComponent\(em\)\}/.test(mod));
check("שיעור בונוס אינו נפתח כשאין הרשאה גם במסך", /w === 0 \? \(showGlow \? GLOW_DAY : null\)/.test(mod));
check("88 סרטוני התוכנית לא נגעו ולא נחסמים", !/isGlowVideo/.test(mod) && token.indexOf("isGlowVideo") > 0);

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.");
process.exit(fail ? 1 : 0);
