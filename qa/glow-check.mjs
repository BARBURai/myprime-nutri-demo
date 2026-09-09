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
  const beforeGlow = us.slice(0, us.indexOf("GLOW"));
  const glowLoop = us.slice(us.indexOf(".lessons.forEach"), us.indexOf("return {"));
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
check("בלי סימון לא מוצג כלום", /const showGlow = showFull \|\| \(!!glow && hasGlow\(\)\);/.test(mod));
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
check("שנייה אחת של צפייה מורידה את השורה מהיומן", /if \(!startedRef\.current && t > 0\)/.test(mod) && /onStart=\{openL\.week === 0 \?/.test(mod) && /markGlowStarted\(\)/.test(mod));
check("ובמסך התוכן יש שורה אחת שמקפיצה לרשימה ולא הרשימה עצמה", /onClick=\{\(\) => setView\("glow"\)\}/.test(mod));
check("הכפתור בסרגל העליון נוסף רק למי שמגיע לה", /if \(showGlow\) tabs\.push\(\[\"glow\", `\$\{GLOW_EMOJI\} Glow`\]\);/.test(mod));
check("ואינו צ׳יפ סינון יותר", !/FILTER_CHIPS, \["glow"/.test(mod));
check("ולמסך שלו אין שורת שבועות בכלל", /if \(view === "glow"\) \{/.test(mod) && !/isGlow/.test(mod));
check("אין מקף ארוך בקופי", !/[–—]/.test(glow));

console.log("\nארבעת הסרטונים\n");
const tasterBlock = glow.slice(glow.indexOf("export const GLOW_DAY"), glow.indexOf("export const hasGlow ="));
const fullBlock = glow.slice(glow.indexOf("const FULL_SECTIONS_RAW"));
const ids = (tasterBlock.match(/videoId: "([0-9a-f-]{36})"/g) || []);
check("ארבעה סרטונים: מבוא ושלושה שיעורים", ids.length === 4, ids.length + " סרטונים");
check("לכל אחד מזהה תקין ושונה", new Set(ids).size === 4);
check("המבוא ראשון", tasterBlock.indexOf('"מבוא"') < tasterBlock.indexOf('"שיעור 3'));
check("הכותרות בדיוק כפי שרון שלח", ["מבוא", "שיעור 3 - פריימר ובסיס (מייק אפ)", "שיעור 6 - איפור עיניים בסיסי", "שיעור 8 - מראה עיניים מעושן"].every((t) => tasterBlock.includes(`title: "${t}"`)));
check("כולם מסוג וידאו ובלי דפים", (tasterBlock.match(/type: "video"/g) || []).length === 4 && !/pdf|pageImages/.test(glow));

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
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const idsIn = (t) => (t.match(UUID) || []).sort();
const listA = idsIn(tasterBlock);
const listB = idsIn(ids2.slice(0, ids2.indexOf("GLOW_FULL_VIDEO_IDS")));
check("רשימת המזהים בשרת זהה לזו שבאפליקציה", listA.length === 4 && JSON.stringify(listA) === JSON.stringify(listB), listA.length + " מול " + listB.length);
// ואותה השוואה לקורס המלא, וזו ההגנה האמיתית עליו: מזהה שנוסף רק באפליקציה
// יהיה בלתי ניתן לצפייה, ומזהה שנוסף רק בשרת ייחתם לכל אישה בתוכנית.
const fullA = idsIn(fullBlock);
const fullB = idsIn(ids2.slice(ids2.indexOf("GLOW_FULL_VIDEO_IDS")));
check("וגם רשימת הקורס המלא זהה בשני הצדדים", fullA.length > 0 && JSON.stringify(fullA) === JSON.stringify(fullB), fullA.length + " מול " + fullB.length);
check("שלושת החינמיים נמצאים גם ברשימת הקורס המלא", listA.every((id) => fullA.includes(id)));
check("שליפת הקישור בודקת אם זה סרטון בונוס", /isGlowVideo\(videoId\)/.test(token));
check("ובלי הרשאה מחזירה סירוב", /not_entitled/.test(token) && /status\(403\)/.test(token));
check("ההרשאה נכתבת ונמחקת בכל כניסה", /SET", `glow:\$\{email\}`/.test(access) && /DEL", `glow:\$\{email\}`/.test(access));
check("האפליקציה שולחת את המייל בשליפת הקישור", /email=\$\{encodeURIComponent\(em\)\}/.test(mod));
check("שיעור בונוס אינו נפתח כשאין הרשאה גם במסך", /w === 0 \? \(showGlow \? glowDay : null\)/.test(mod));
check("88 סרטוני התוכנית לא נגעו ולא נחסמים", !/isGlowVideo/.test(mod) && token.indexOf("isGlowVideo") > 0);

console.log("\nהקורס המלא\n");
// רון, 9 בספטמבר 2026: וובינר שנותן את הקורס המלא במתנה, לפי עמודת GLOW-FULL.
check("העמודה נקראת בשער", access.includes('findCol(header, ["glow-full"])'));
check("והשער מחזיר את הסימון", /phone, glow, glowFull/.test(access));
check("ההרשאה נכתבת ונמחקת בכל כניסה, כמו הבונוס",
  /SET", `glowfull:\$\{email\}`/.test(access) && /DEL", `glowfull:\$\{email\}`/.test(access));
check("האפליקציה שומרת אותו בנפרד מהבונוס", /myprime_glow_full/.test(app));
// שתי רמות: החינמיים נפתחים לשתיהן, ושאר הקורס למי שיש לה את המלא בלבד.
check("החתימה מכירה את שתי הרשימות", /isGlowVideo\(videoId\) \|\| isGlowFullVideo\(videoId\)/.test(token));
check("מי שיש לה את המלא רשאית גם לחינמיים", /ok = await flag\("glowfull"\);/.test(token));
check("ומי שיש לה את הבונוס בלבד רשאית לחינמיים בלבד",
  /if \(!ok && isGlowVideo\(videoId\)\) ok = await flag\("glow"\);/.test(token));
// שלושת החינמיים הם חלק מהקורס, ולכן מי שקיבלה אותו רואה רשימה אחת ולא שתיים.
check("הקורס המלא מחליף את הבונוס ואינו נוסף לצידו", /const showFull = !!glowFull && hasGlowFull\(\);/.test(mod));
check("ומוצג בסעיפים ולא ברשימה שטוחה", /GLOW_FULL_SECTIONS\.map\(\(sec\) =>/.test(mod));
check("המספר שמסמן הושלם נגזר מהרשימה השטוחה", /sec\.idx\.map\(\(i\) => <LessonRow key=\{"g" \+ i\} w=\{0\} d=\{0\} l=\{GLOW_FULL_DAY\.lessons\[i\]\} i=\{i\}/.test(mod));
check("שיעור בלי מזהה אינו מרונדר", /if \(!l\.videoId\) continue;/.test(glow));
// החלטת רון: "לא הייתי שם את זה ביומן".
check("הקורס המלא אינו מופיע בכרטיס היומן", /glow=\{glow && !glowFull\}/.test(app));
check("ומסך ההמתנה כן פותח אותו", /glow=\{glow \|\| glowFull\}/.test(app));
check("הכיתוב הוא זה שרון אישר",
  glow.includes('export const GLOW_FULL_TITLE = "מיי פריים Glow - הקורס המלא"')
  && glow.includes('export const GLOW_FULL_ROW = "קורס האיפור המלא שלך במיי פריים Glow"'));
check("ואין לו שורה בכרטיס היומן בכלל", !/GLOW_FULL_CARD/.test(glow));

console.log("\nהפריסה של הקורס המלא\n");
// רון בדק בטלפון: "הכותרות קטנות מאוד, צריכות להיות מודגשות ויפות ואולי עם אייקון...
// והם צריכים להיות בדרופדאון... ומתחת לנושא בסוגריים באותיות קטנות את השיעורים העיקריים."
check("לכל סעיף אייקון ותיאור קצר", /icon: "[^"]+", sub: "[^"]+"/.test(glow));
check("ושמונת הסעיפים נושאים אותם", (glow.match(/icon: "/g) || []).length === 8);
check("והם עוברים לרכיב ולא נשארים בקובץ", /title: sec\.title, icon: sec\.icon \|\| "", sub: sec\.sub \|\| ""/.test(glow));
check("הסעיף נפתח בהקשה", /setOpenSec\(\(o\) => \(\{ \.\.\.o, \[sec\.title\]: !o\[sec\.title\] \}\)\)/.test(mod));
check("וסגור כברירת מחדל", /const \[openSec, setOpenSec\] = useState\(\{\}\);/.test(mod));
check("השיעורים מרונדרים רק כשהסעיף פתוח", /\{open && <div style=\{\{ padding: "0 10px 6px" \}\}>\{sec\.idx\.map/.test(mod));
// רון: "לא צריך לרשום מספר שיעורים."
check("ואין מספר שיעורים בשום מקום", !/שיעורים`/.test(mod) && !/sec\.idx\.length/.test(mod));
check("כפתור החזרה משיעור יודע לחזור לשם", /origin === "glow" \? "חזרה לשיעורי Glow"/.test(mod));
// רון: "במקום כל התוכנית הייתי רושם מיי פריים 360", בכפתור שבסרגל בלבד.
check("הכפתור בסרגל נקרא מיי פריים 360", /\["all", "מיי פריים 360"\]/.test(mod));
check("וכפתורי החזרה לא נגעו", mod.includes("חזרה לכל התוכנית"));
// שני תיקוני קופי מהבדיקה שלו.
check("שיעור 12 הוא הארות ולא האדרות", glow.includes("שיעור 12 - הארות") && !/האדרות/.test(glow));
check("ו-4MUST צמוד, כדי שהספרה לא תתהפך", (glow.match(/שיטת 4MUST/g) || []).length === 4 && !/4 MUST/.test(glow));

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
check("ומסך התוכן נפתח על הבונוס ולא על היום", /useState\(startGlow \? "glow" : "today"\)/.test(mod));
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
check("השורה מוצגת לכל אישה, גם למי שבקג'אבי", /'<div class="edit"[^']*>?<span>שיעורי בונוס Glow'/.test(adminUi));
check("אבל הכפתורים רק למי שבאפליקציה החדשה", /\(w\.newApp\s*\n?\s*\?\s*'<button class="btn'\+\(w\.glow\?" p":""\)\+'" data-glow="1"/.test(adminUi));
check("ולמי שבקג'אבי נכתב שזה מוגדר שם", adminUi.includes("שיעורי הבונוס שלה <b>מוגדרים שם ולא כאן</b>"));
check('"חזרה לגיליון" מופיע רק כשיש מה לבטל', /w\.glowOverride\?'<button class="btn[^"]*" data-glow=""/.test(adminUi));

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.");
process.exit(fail ? 1 : 0);
