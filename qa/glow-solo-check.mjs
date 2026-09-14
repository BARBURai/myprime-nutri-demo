// מסך הקורס העצמאי, למי שקנתה את קורס האיפור לבדו בלי 360. בלי רשת.
//
// מה שהיא נועלת, וכל פריט כאן הוא החלטה של רון שאושרה על הדמו:
// אין סרגל תחתון, אין יומן ואין מסכי הרשמה; המסך נעול על הקורס ואי אפשר לצאת
// ממנו לתוכנית; שורת ההתקדמות מוצגת רק מעל אפס; וההגדרות מכילות בדיוק את מה
// שיש לה, בלי תאריך גישה ובלי שום שדה שהיא לא מילאה.
import fs from "node:fs";

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name); } };

const APP = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const CM = fs.readFileSync(new URL("../src/content/ContentModule.jsx", import.meta.url), "utf8");
const GLOW = fs.readFileSync(new URL("../src/content/glow.js", import.meta.url), "utf8");

console.log("\n- הסימון מגיע מהשער ונכתב מחדש בכל כניסה -");
check("השער מחזיר product", /product: glowOnly \? "glow" : "360"/.test(fs.readFileSync(new URL("../api/access.js", import.meta.url), "utf8")));
check("האפליקציה קולטת אותו", /setProduct\(d\.product === "glow" \? "glow" : "360"\)/.test(APP));
check("ונשמר על המכשיר", /myprime_product/.test(APP));
// זה מה שמבטיח את שני הכיוונים: אין סימון שמישהו מתחזק, הוא נגזר מהגיליון בכל
// כניסה, ולכן קונת גלו שנרשמת ל-360 וגם אישה של 360 שמסומן לה GLOW-FULL זזות לבד.
check("הערך נקבע בכל תשובה של השער ולא רק כשהוא glow", (APP.match(/setProduct\(/g) || []).length === 1 && !/if \(d\.product\) setProduct/.test(APP));

console.log("\n- מה שהיא לא רואה -");
const branch = APP.slice(APP.indexOf('product === "glow" ? ('), APP.indexOf(') : !onboarded ? ('));
check("המסלול קיים ויושב לפני מסכי ההרשמה", branch.length > 200 && branch.length < 3000);
check("אין בו סרגל תחתון", !/tabs\.slice/.test(branch));
check("אין בו יומן", !/DayScreen/.test(branch));
check("אין בו מסכי הרשמה", !/Onboarding/.test(branch));
check("אין בו דוח ומדדים", !/ReportScreen/.test(branch));
check("ואין בו בועת הערות", !/NotesFab/.test(branch));

console.log("\n- המסך נעול על הקורס -");
check("נפתח על הקורס", /useState\(solo \|\| startGlow \? "glow" : "today"\)/.test(CM));
check("ואי אפשר לצאת ממנו", /const setView = \(v\) => setViewRaw\(solo \? "glow" : v\)/.test(CM));
check("הוא מקבל את הקורס המלא ולא את הדמו", /<ContentModule solo glow glowFull/.test(branch));
check("סרגל הלשוניות אינו מרונדר בסולו", /\{solo \? <SoloHead \/> : <Segmented \/>\}/.test(CM));
check("וגם לא שורת הכותרת העליונה", /\{!solo && <div style=\{head\}>/.test(CM));

console.log("\n- ראש המסך -");
check("התמונה מוגדרת בקובץ אחד", /export const GLOW_HERO = "\/glow-hero\.jpg";/.test(GLOW));
check("והקובץ קיים תחת public", fs.existsSync(new URL("../public/glow-hero.jpg", import.meta.url)));
const solo = CM.slice(CM.indexOf("function SoloHead()"), CM.indexOf("// ---------- ALL PROGRAM"));
check("התמונה מוצגת", /<img src=\{GLOW_HERO\}/.test(solo));
check("ואין בה כיתוב ברכה", !/ברוכה הבאה|היי /.test(solo));
check("גלגל ההגדרות בפינה", /onClick=\{onSettings\}/.test(solo) && /<Settings size/.test(solo));
check("שורת ההתקדמות נוקבת בשני המספרים", /צפית ב-\{watched\} מתוך \{list\.lessons\.length\} שיעורים/.test(solo));
check("ואינה מוצגת כשהיא על אפס", /\{watched > 0 && \(/.test(solo));
const progLine = solo.slice(solo.indexOf("{watched > 0 &&"));
check("בלי אחוזים ובלי פס התקדמות", !/%|יעד|נשאר/.test(progLine));
check("והמספר נספר מהרשימה שהיא רואה", /showFull \? GLOW_FULL_DAY : GLOW_DAY/.test(solo));

console.log("\n- ההגדרות -");
const set = APP.slice(APP.indexOf("function GlowSoloSettings"), APP.indexOf("function ActivityModal"));
check("מכילות את השם ואת המייל", /\{name\}/.test(set) && /\{email\}/.test(set));
check("התנתקות מהמכשיר", /התנתקות מהמכשיר/.test(set));
check("התקנה על הטלפון", /התקנת האפליקציה על הטלפון/.test(set));
// רון: "אל תרשום לה עד מתי יש לה גישה."
check("בלי תאריך גישה", !/גישה עד|עד מתי/.test(set));
check("ובלי שום שדה שהיא לא מילאה", !/משקל|גובה|יעד|מחזור|קבוצה/.test(set));
check("ההתקנה מוצגת רק בטלפון שטרם התקין", /appIsPhone && !appStandalone \? \(\) => setSheet\("install"\) : null/.test(branch));
check("וסגירת ההתקנה מחזירה להגדרות", /sheet === "install" && <InstallGuideModal onClose=\{\(\) => setSheet\("glowSettings"\)\}/.test(branch));

console.log(`\n${pass} מתוך ${pass + fail}`);
process.exit(fail ? 1 : 0);
