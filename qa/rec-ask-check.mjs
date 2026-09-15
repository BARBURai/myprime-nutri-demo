// "מה כדאי לאכול": חלונית הכמות, חלונית היציאה, וכפתור החזרה.
//
//   node qa/rec-ask-check.mjs
//
// רון, 9 בספטמבר 2026: "כששמתי במה כדאי לאכול בחרתי באפשרות לא קיבלתי שום דבר
// שקופץ למרות שלא שיניתי את הכמות." הוא צדק: החלוניות של v6.89 ו-v6.90 נבנו
// בחלון הוספת המזון בלבד, וכאן לא היה כלום.
//
// **ההבדל היחיד בין שני המסכים הוא מאיפה הגיע המספר**: בחיפוש הוא של המאגר,
// וכאן הוא ההערכה של הבינה למנה שהיא הציעה. בשני המקרים הוא לא נבחר על ידה.
//
// ושלוש הכרעות שהבדיקה נועלת:
//   1. "ביטול" הוא בחירה מפורשת ואינו שואל. הקשה מחוץ לחלונית וכפתור החזרה כן.
//   2. חזרה סוגרת שכבה אחת ואינה סוגרת את כל המסך עם השיחה שבתוכו.
//   3. חלונית שואלת פעם אחת לכל אופציה, ואופציה חדשה היא שאלה חדשה.

import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  ← " + extra : "")); }
};
// גוף הפונקציה בלבד, כדי ששום התאמה לא תיפול בטעות על חלון הוספת המזון.
const start = src.indexOf("function RecommendModal(");
const rec = src.slice(start, src.indexOf("\nfunction ", start + 10));
check("אותר גוף RecommendModal", start > 0 && rec.length > 2000, rec.length + " תווים");

console.log("\nחלונית הכמות");
check("קיימת חלונית עם מזהה משלה", /id="recqty"/.test(rec));
check("והיא נפתחת מכפתור ההוספה כשלא נגעה בכמות",
  /if \(!chosenTouched && !chosenAsked\) \{ setChosenAsked\(true\); setQtyWarn\(true\); return; \} logChosen\(\);/.test(rec));
check("הכותרת זהה לזו של הוספת מזון", /title="חשוב למלא את המשקל של המזון שאכלת"/.test(rec));
check("והגוף אומר שזו הערכה של המנה שהוצעה",
  /זו הערכה של המנה שהוצעה, ולא בהכרח מה שאכלת/.test(rec));
check("הכפתור הראשי מחזיר לתיקון", /primary="אתקן את הכמות"/.test(rec));
check("והמשני נוקב במספר עצמו", /secondary=\{`אכלתי \$\{chosen\.grams\} \$\{unitLabelFor\(chosen\.unit\)\}`\}/.test(rec));
check("ואישור הכמות באמת רושם ליומן", /onSecondary=\{\(\) => \{ setQtyWarn\(false\); logChosen\(\); \}\}/.test(rec));

console.log("\nמה נחשב נגיעה בכמות");
check("הקלדה נחשבת", /if \(c >= 1\) setChosenTouched\(true\);/.test(rec));
const pm = (rec.match(/setChosenTouched\(true\); setChosen\(\{ \.\.\.chosen, grams:/g) || []).length;
check("הפלוס והמינוס נחשבים", pm === 2, "נמצאו " + pm);
check("וצ׳יפ של מידה נחשב רק כשהוא באמת מזיז את המספר",
  /if \(u\.g !== chosen\.grams\) setChosenTouched\(true\);/.test(rec));
check("אופציה חדשה מאפסת את שלושת השומרים",
  /setChosenTouched\(false\); setChosenAsked\(false\); setExitAsked\(false\);/.test(rec));

console.log("\nחלונית היציאה");
check("קיימת חלונית עם מזהה משלה", /id="recexit"/.test(rec));
check("הכותרת זהה לזו של הוספת מזון", /title="את יוצאת בלי לשמור"/.test(rec));
check("והגוף מפנה לשם האמיתי של הכפתור, ולא ל\"שמירה\"",
  /כדי לשמור אותה יש להקיש על "הוסיפי ליומן"/.test(rec));
check("הכפתור הראשי הוא חזרה ואינו מוסיף ליומן",
  /primary="חזרה"\n\s*onPrimary=\{\(\) => setExitWarn\(false\)\}/.test(rec));
check("והיציאה סוגרת את חלונית הכמות בלבד",
  /onSecondary=\{\(\) => \{ setExitWarn\(false\); setChosen\(null\); \}\}/.test(rec));
check("שואלים פעם אחת לכל אופציה", /const unsavedChosen = \(\) => !!chosen && !exitAsked;/.test(rec));

console.log("\nמי שואל ומי לא");
check("הקשה מחוץ לחלונית עוברת דרך השומר", /<div onClick=\{closeChosen\}/.test(rec));
check("ו\"ביטול\" סוגר מיד, כי הוא בחירה מפורשת",
  /<Btn variant="ghost" onClick=\{\(\) => setChosen\(null\)\} style=\{\{ marginTop: 8 \}\}>ביטול<\/Btn>/.test(rec));
check("ואין יותר סגירה ישירה בהקשה על הרקע", !/<div onClick=\{\(\) => setChosen\(null\)\} style=\{\{ position: "absolute", inset: 0/.test(rec));

console.log("\nכפתור החזרה של הטלפון");
check("המסך מוסר פונקציית חזרה כלפי מעלה", /backRef\.current = \(\) => \{/.test(rec));
check("חלונית פתוחה נסגרת קודם", /if \(qtyWarn\) \{ setQtyWarn\(false\); return true; \}[\s\S]{0,90}if \(exitWarn\) \{ setExitWarn\(false\); return true; \}/.test(rec));
check("ואז חלונית הכמות, דרך אותו שומר של ההקשה מבחוץ",
  /if \(chosen\) \{ closeChosen\(\); return true; \}/.test(rec));
check("וכשאין מה לסגור הלחיצה מועברת הלאה", /return false;\n\s*\};\n\s*return \(\) => \{ backRef\.current = null; \};/.test(rec));
check("האפליקציה מחזיקה ref למסך הזה", /const recBackRef = useRef\(null\);/.test(src));
check("ומעבירה אותו אליו", /backRef=\{recBackRef\} \/>\}/.test(src));
check("ומנגנון החזרה בודק אותו לפני שהוא סוגר את המסך",
  /sheetRef\.current === "recommend" && recBackRef\.current && recBackRef\.current\(\)/.test(src));
const order = src.indexOf('sheetRef.current === "recommend"') < src.indexOf('else if (sheetRef.current) { setSheet(null)');
check("והבדיקה הזאת קודמת לסגירת המסך", order);

console.log("\nהשיחה נזכרת כל עוד האפליקציה פתוחה");
// רון, 9 בספטמבר 2026: "מקבל המלצה, לא לוחץ על שום המלצה, יוצא החוצה והשיחה נמחקה."
// המסך השני עושה בדיוק את זה מ-v4.81, וכאן זה מעולם לא הוכנס.
check("יש זיכרון ברמת המודול, ולא בתוך הרכיב", /^let recSession = null;$/m.test(src));
check("השלב נטען ממנו", /useState\(recSession \? recSession\.stage : \(recIntroSeen \? "confirm" : "intro"\)\)/.test(rec));
check("וגם השיחה עצמה", /useState\(\(\) => \(recSession && recSession\.msgs\) \|\| \[\]\)/.test(rec));
check("וגם כרטיסי הרעיונות שעל המסך", /useState\(\(\) => \(recSession && recSession\.replies\) \|\| \[\]\)/.test(rec));
check("והוא נשמר בכל שינוי", /if \(stage === "chat"\) recSession = \{ stage, msgs, replies \};/.test(rec));
// אחרי שהמנה נרשמה ליומן השיחה הסתיימה, ואחרת הרעיונות הישנים היו חוזרים מחר.
check("ונמחק ברגע שנרשמה מנה ליומן", /recSession = null;[\s\S]{0,80}const v = scaled\(chosen\);/.test(rec));
check("ואינו נוגע ב-replies של האפליקציה עצמה",
  (src.match(/const \[replies, setReplies\] = useState\(\[\]\);/g) || []).length === 1);

console.log("\nמה שלא זז");
check("חלונית הכמות של הוספת המזון עדיין קיימת", /id="qty"/.test(src));
check("וחלונית היציאה שלה", /id="exit"/.test(src));
check("ורכיב החלונית משותף לשתי המסכים", (src.match(/<AddAsk\n/g) || []).length >= 4, "נמצאו " + (src.match(/<AddAsk\n/g) || []).length);
check("והחלוניות כאן מצוירות מעל חלונית הכמות", (rec.match(/z=\{70\}/g) || []).length === 2);

console.log(`\n${pass} עברו, ${fail} נכשלו\n`);
process.exit(fail ? 1 : 0);
