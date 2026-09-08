// מסך הוספת המזון: אין הוספה מהירה בכמות של המאגר, וה-✕ במסך הכמות אינו סוגר הכל.
//
//   node qa/addfood-check.mjs
//
// רון, 28 באוגוסט 2026: "ההסתברות שבדיוק מה שרשום במאגר זה בדיוק מה שהיא אכלה
// היא אפסית, היא חייבת בכל מקרה למלא את הכמויות." ולכן הפלוס ירד מתוצאות החיפוש,
// והקשה בכל מקום בשורה פותחת את מסך הכמות.
//
// והפלוס במועדפים ובאחרונים נשאר בכוונה, וזה ההבדל שקובע: שם הכמות היא זו שהיא
// עצמה הזינה בפעם הקודמת (lastG), ובחיפוש היא של המאגר.
//
// ובנוסף: "לחצתי על המוצר עשיתי איקס, לא חזרתי למסך החיפוש." ✕ במסך הכמות עושה
// עכשיו בדיוק מה שחץ החזרה עושה.

import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  ← " + extra : "")); }
};

// שלוש רשימות התוצאות: המאגר המקומי, הקטלוג שלנו, והמאגר החיצוני.
const rows = src.match(/<div key=\{f\.id\} onClick=\{\(\) => pickFood\(f, g\)\} style=\{\{ display: "flex", justifyContent: "space-between"[^\n]*cursor: "pointer" \}\}>/g) || [];

console.log("\nתוצאות החיפוש");
check("שלוש רשימות התוצאות פותחות את מסך הכמות בהקשה על השורה", rows.length === 3, "נמצאו " + rows.length);
const chev = (src.match(/<ChevronLeft size=\{18\} color=\{C\.faint\} style=\{\{ flexShrink: 0 \}\} \/>/g) || []).length;
check("ולכל אחת מהן יש חץ שאומר שהיא נפתחת", chev === 3, "נמצאו " + chev);

// זה מה שירד: הוספה מיידית בכמות של המאגר, בלי שנשאלה כמה אכלה.
check("אין יותר הוספה מיידית מהמאגר המקומי",
  !/commit\(\{ meal, name: f\.name, g, source: "verified", \.\.\.n \}\)/.test(src));
check("ואין מהקטלוג שלנו",
  !/commit\(\{ meal, name: f\.name, g, unit: f\.unit \|\| "g", source: f\.source === "verified"/.test(src));

console.log("\nמה שלא נגע: המועדפים והאחרונים");
// שם הכמות היא lastG, כלומר מה שהיא עצמה הזינה בפעם הקודמת, ולכן היא כמעט תמיד נכונה.
check("הפלוס נשאר בשורת פריט של האחרונים והמועדפים",
  /aria-label=\{added \? "ביטול הוספה" : "הוספה"\}/.test(src));
check("והכמות שם היא זו שהיא הזינה בפעם הקודמת", /const g = f\.lastG \?\? f\.measures\[f\.def\]\.g;/.test(src));

console.log("\nה-✕ במסך הכמות");
check("✕ במסך הכמות עושה בדיוק מה שחץ החזרה עושה",
  /onClick=\{step === "qty" && back \? back : guardedClose\}/.test(src));
check("ומכריז על עצמו נכון לקורא מסך",
  /aria-label=\{step === "qty" && back \? "חזרה" : "סגירה"\}/.test(src));
check("והחזרה מובילה לאן שהיא באה ממנו, חיפוש או מועדפים",
  /const back = step === "qty" && !state\.editEntry \? \(\) => setStep\(qtyOrigin\)/.test(src));
check("בעריכת פריט קיים ✕ ממשיך לסגור, כי אין לאן לחזור",
  /const back = step === "qty" && !state\.editEntry/.test(src));


console.log("\nהכמות שנשארה על ברירת המחדל");
// רון: "יש לא מעט נשים שמפספסות את הקטע של כמה גרמים אכלו". ברירת המחדל בחיפוש
// היא של המאגר ולא שלה, ולכן מי שלא נגעה בה רושמת ליומן מספר שמישהו אחר בחר.
check("יש דגל שאומר אם נגעה בכמות", /const \[qtyTouched, setQtyTouched\] = useState\(false\);/.test(src));
check("והוא מתאפס בכל כניסה למסך הכמות", /const pickFood = \(f, g\) => \{ setQtyTouched\(false\); setQtyAsked\(false\); setReachedQty\(true\);/.test(src));
// דגל ולא השוואת מספרים: מי ששינתה ל-150 וחזרה ל-100 כן בחרה את הכמות.
check("כל ארבע דרכי השינוי מסמנות נגיעה", (src.match(/setQtyTouched\(true\)/g) || []).length === 4);
// צ׳יפ של מידה אמיתית קובע כמות, ולכן הוא נגיעה. הצ׳יפ הראשון, של היחידה
// הבסיסית, רק מחליף תצוגה ואינו משנה את המספר, ולכן הקשה עליו אינה נגיעה.
// רון שאל בדיוק על זה: "מה קורה אם היא סתם לחצה על כפתור אבל לא עדכנה כלום".
// רון: "אם היא לחצה על 100 גרם והמשיכה הלאה, מה הסבירות שהיא אכלה בדיוק 100
// גרם? אני מבין כף או כפית." צ׳יפ נחשב בחירה רק אם הוא באמת הזיז את המספר,
// ולכן "100 ג׳" כשהמספר כבר 100 אינו בחירה, ו"כף · 15 ג׳" כן.
check("צ׳יפ נחשב בחירה רק אם הזיז את המספר", /if \(u\.g !== grams\) setQtyTouched\(true\); setQUnit\(u\); setGrams\(u\.g\);/.test(src));
check("והצ׳יפ של היחידה הבסיסית אינו", /onClick=\{\(\) => \{ if \(u\.g <= 1\) setQUnit\(null\);/.test(src));
check("המינוס", /setQtyTouched\(true\); setGrams\(Math\.max\(au\.g, grams - au\.g\)\)/.test(src));
check("הפלוס", /setQtyTouched\(true\); setGrams\(grams \+ au\.g\)/.test(src));
check("וההקלדה", /setQtyTouched\(true\); const c = parseInt/.test(src));
check("כפתור ההוספה עוצר כשלא נגעה", /if \(!state\.editEntry && !qtyTouched && !qtyAsked\) \{ setQtyAsked\(true\); setQtyWarn\(true\); return; \} doAdd\(\);/.test(src));
// בעריכת פריט קיים הכמות כבר שלה, ואין על מה לשאול.
check("ובעריכת פריט קיים אינו עוצר", /!state\.editEntry && !qtyTouched/.test(src));
// שני מסלולים שעושים כמעט אותו דבר הם בדיוק איך שהם מתפצלים.
check("ההוספה עצמה יושבת בפונקציה אחת שגם החלונית קוראת לה", /const doAdd = \(\) => \{/.test(src));
check("והכפתור אינו מכיל עוד עותק של commit", !/<Btn onClick=\{\(\) => \{ const fromHistory = qtyOrigin/.test(src));

console.log("\nיציאה בלי לשמור");
// הכלל הוא על סגירת החלון ולא על דרך יציאה מסוימת, ולכן די בו כדי לכסות גם
// הקשה מחוץ לחלון, גם ✕, וגם את כפתור החזרה של הטלפון.
check("הכלל: הגיעה למסך הכמות ולא הוסיפה כלום", /const unsavedPick = \(\) => reachedQty && !exitAsked && !state\.editEntry && addedKeys\.length === 0;/.test(src));
check("הקשה מחוץ לחלון עוברת דרך השומר", /zIndex: 20 \}\} onClick=\{guardedClose\}/.test(src));
check("וכפתור החזרה של הטלפון גם הוא", /if \(unsavedPick\(\)\) \{ setExitAsked\(true\); setExitWarn\(true\); return true; \}/.test(src));
check("וכשאין מה לאבד הוא מדווח שלא בלע את הלחיצה", /return true; \}\n?\s*return false; \};/.test(src) || /return true; \} return false; \};/.test(src));
check("בעריכת פריט קיים לא שואלים", /reachedQty && !exitAsked && !state\.editEntry/.test(src));

// כשהיא עובדת בכפות, המספר בגרמים הוא מה שבאמת נכנס ליומן, ולכן הוא לא הערת
// שוליים בגופן 14. גדול פי אחד וחצי, ועדיין קטן מהמונה כדי לא להתחרות בו.
check("שורת הגרמים אינה בגופן של הערת שוליים", /`= \$\{grams\} \$\{unitLabel\}`/.test(src) && /fontSize: 18, fontWeight: 500, color: C\.ink, marginBottom: 14, minHeight: 23 \}\}>\{!isBase/.test(src));

console.log("\nכל חלונית שואלת פעם אחת, ולא נכנסת ללופ");
// רון: "ואם בלי לשנות שלא תקפוץ ההתראה כל הזמן, תכניס אותה ללופ ותעצבן אותה."
// תפקיד החלונית להסב את תשומת ליבה פעם אחת. מרגע שנשאלה, ההחלטה שלה.
check("יש דגל לכל אחת מהן", /const \[qtyAsked, setQtyAsked\] = useState\(false\);/.test(src) && /const \[exitAsked, setExitAsked\] = useState\(false\);/.test(src));
check("חלונית הכמות אינה חוזרת על אותו מזון", /!state\.editEntry && !qtyTouched && !qtyAsked/.test(src));
check("והדגל נדלק ברגע שנשאלה", /setQtyAsked\(true\); setQtyWarn\(true\); return;/.test(src));
// מזון חדש הוא שאלה חדשה, ולכן שם היא כן נשאלת שוב.
check("אבל כן חוזרת על מזון אחר", /setQtyTouched\(false\); setQtyAsked\(false\); setReachedQty\(true\)/.test(src));
check("חלונית היציאה אינה חוזרת", /reachedQty && !exitAsked && !state\.editEntry/.test(src));
check("והדגל שלה נדלק בשתי דרכי היציאה", (src.match(/setExitAsked\(true\); setExitWarn\(true\)/g) || []).length === 2);

console.log("\nהקופי, כפי שרון אישר");
check("חשוב למלא את המשקל", src.includes('title="חשוב למלא את המשקל של המזון שאכלת"'));
check("ומצוין בו המספר שנשאר", src.includes('לא שינית את הכמות, והיא עדיין ${grams} ${unitLabel}.'));
check("את יוצאת בלי לשמור", src.includes('title="את יוצאת בלי לשמור"'));
// "סיום" הוא כפתור סגירה שרק מדווח כמה נוספו, והמזון כבר שמור לפניו. הנוסח
// המקורי הפנה אליו כאל שמירה, וזה היה מלמד את הנשים דבר לא נכון.
check("ואינו מפנה ל\"סיום\" כאילו הוא שומר", !/כדי לשמור אותו[^"]*סיום/.test(src));
check("אלא לכפתור ההוספה", src.includes("כדי לשמור אותו יש להקיש על כפתור ההוספה שבתחתית מסך הכמות."));
check("אין מקף ארוך בשתי החלוניות", !/[\u2013\u2014]/.test((src.match(/function AddAsk[\s\S]{0,1200}/) || [""])[0]));
check("ושתיהן עוברות דרך רכיב אחד", (src.match(/<AddAsk/g) || []).length === 2 && /function AddAsk\(/.test(src));

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.");
process.exit(fail ? 1 : 0);
