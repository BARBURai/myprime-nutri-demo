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
const usage = read("api/usage.js");
const admin = read("public/admin.html");

let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (extra ? "  → " + extra : "")); } };

console.log("\nהבונוס מחוץ לכל ספירה\n");
check("שיעורי הבונוס יושבים בקובץ נפרד", /export const GLOW_DAY/.test(glow));
check("והם אינם חלק מ-60 ימי התוכנית", !/GLOW|בונוס איפור/.test(data));
check("הם נושאים שבוע 0 ויום 0", /week: 0,\s*\n\s*day: 0,/.test(glow));
// The bonus IS counted now, but only in fields of its own. What must never happen is that
// it leaks into the programme's own totals, because those are the denominator of "how much
// she watched" on the office screen.
{
  const us = mod.slice(mod.indexOf("export function usageSummary"));
  const beforeGlow = us.slice(0, us.indexOf("GLOW_DAY"));
  const glowLoop = us.slice(us.indexOf("GLOW_DAY.lessons.forEach"), us.indexOf("return {"));
  check("ספירת התוכנית אינה נוגעת בבונוס", !/GLOW/.test(beforeGlow) && /CONTENT_DAYS\.forEach/.test(beforeGlow));
  check("וספירת הבונוס אינה נוגעת בספירת התוכנית",
    !/vDone|vTotal|vViews|days\[/.test(glowLoop) && /gDone|gViews/.test(glowLoop));
  check("הבונוס מדווח בשדות נפרדים משלו", /glowDone/.test(us) && /glowViews/.test(us) && /glowTotal/.test(us));
}
check("והשרת מקבל אותם כשדות נפרדים ובגבולות", /glowDone: num\(/.test(usage) && /glowViews: num\(/.test(usage));
check("ומסך הניהול מציג אותם בשורה משלהם", /glowLine/.test(admin) && /שיעורי Glow/.test(admin));
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
// The started flag is one way. Without a reset there is no way back to what a new woman sees.
check("יש כפתור איפוס לסימון הצפייה בסרגל הבדיקות", /איפוס Glow/.test(app) && /removeItem\(GLOW_STARTED_KEY\)/.test(app));
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

console.log("\nמסך ההמתנה, לפני שהתוכנית מתחילה\n");
check("מסך ההמתנה מקבל את הסימון", /function PreStartScreen\(\{ name, startDate, glow = false, onOpenGlow \}\)/.test(app));
check("והכרטיס מוצג רק למי שמגיע לה", /\{glow && hasGlow\(\) && \(/.test(app));
check("הקופי של הכרטיס בדיוק כפי שאושר",
  app.includes("💄 בונוס שמחכה לך כבר עכשיו") &&
  app.includes("שלושה שיעורי איפור וטיפוח מתוך תוכנית מיי פריים Glow, עם ורד ספיבק.") &&
  app.includes(">לצפייה בשיעורים</Btn>"));
check("הכפתור פותח ישירות את רשימת הבונוס", /setGlowDirect\(true\); setSheet\("content"\)/.test(app));
// Before her start date NOTHING of the programme is unlocked, so the ordinary content view
// would be an empty screen. Landing her on the bonus list is what makes the button safe as
// well as useful: there is no day there to press.
check("ומסך התוכן נפתח על הבונוס ולא על היום", /useState\(startGlow \? "all" : "today"\)/.test(mod) && /useState\(startGlow \? "glow" : "all"\)/.test(mod));
check("והדגל מתאפס בסגירה, כדי שפתיחה רגילה לא תיפתח על הבונוס",
  /setSheet\(null\); setGlowDirect\(false\)/.test(app));
check("מסך הניהול מציג את הבונוס גם למי שהמחזור שלה טרם התחיל",
  /glowLine\+'<div class="meta">המחזור שלה עוד לא התחיל/.test(admin));

console.log("\nהסימון הידני במסך הניהול\n");
const adminApi = read("api/admin.js");
const adminUi = read("public/admin.html");
// Google serves the published sheet from a cache and lags by minutes. Our own store does not,
// which is the whole reason the clerk can set this here at all.
check("הניהול מקבל ושומר את הסימון", /hasOwnProperty\.call\(body, "glow"\)/.test(adminApi) && /glow: hasGlow \? glow/.test(adminApi));
check("רק 1, 0 או ריק מתקבלים", /glow !== "1" && glow !== "0"/.test(adminApi));
check("הניהול מחזיר גם את מה שכתוב בגיליון", /sheetGlow: !!w\.glow/.test(adminApi));
check("והשער מעדיף את הסימון הידני", /ovr\.glow === "1"\) glow = true/.test(access) && /ovr\.glow === "0"\) glow = false/.test(access));
check("כל שינוי נרשם ביומן", /field: "glow"/.test(adminApi));
check("המסך מציג את שני הערכים זה לצד זה", adminUi.includes("בגיליון: ") && adminUi.includes("שיעורי בונוס Glow"));
// Ron, 19 August 2026: the bonus lessons of a woman on Kajabi are granted there, so for her
// this is a read-out and not a control. The row still shows, because the state is true either
// way; only the buttons are behind the flag.
check("השורה מוצגת לכל אישה, גם למי שבקג'אבי", adminUi.includes("'<div class=\"edit\"><span>שיעורי בונוס Glow'"));
check("אבל הכפתורים רק למי שבאפליקציה החדשה", /\(w\.newApp\s*\n?\s*\?\s*'<button class="btn'\+\(w\.glow\?" p":""\)\+'" data-glow="1"/.test(adminUi));
check("ולמי שבקג'אבי נכתב שזה מוגדר שם", adminUi.includes("שיעורי הבונוס שלה <b>מוגדרים שם ולא כאן</b>"));
check('"חזרה לגיליון" מופיע רק כשיש מה לבטל', /w\.glowOverride\?'<button class="btn" data-glow=""/.test(adminUi));

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.");
process.exit(fail ? 1 : 0);
