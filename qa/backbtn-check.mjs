// כפתור החזרה של הטלפון: כל חלונית שחוסמת את המסך היא שכבה, ואף לחיצה אינה מתה.
//
// משתתפת דיווחה ב-9 בספטמבר 2026: "כשמוסיפים ארוחה מהאחרונים והמועדפים שלי,
// כפתור back מעיף מהאפליקציה". שוחזר בדפדפן על הקוד שבייצור, ונמצאו שני דברים
// שונים באותו מקום:
//
//   1. החלוניות שחיות ברמת האפליקציה, ובראשן "לשמור למועדפים?", לא נחשבו שכבה,
//      ולכן לא היה מה לסגור: הלחיצה נבלעה והבאה סגרה את האפליקציה כשהחלונית
//      עדיין על המסך.
//   2. ורשומה שנשארה בהיסטוריה אחרי שחלון נסגר ב-✕ או מפני שהמזון נוסף הפכה את
//      הלחיצה הראשונה ללחיצה מתה גם ביומן.
//
// הבדיקה קוראת את הקוד ואינה מריצה דפדפן. התרחיש בשכבה 3 הוא זה שמריץ.
//
//   node qa/backbtn-check.mjs

import { readFileSync } from "node:fs";
const src = readFileSync("src/App.jsx", "utf8");

let pass = 0, fail = 0;
const check = (name, cond, got) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (got === undefined ? "" : "   התקבל: " + got)); }
};
const head = (t) => console.log("\n" + t + "\n");

head("כל חלונית חוסמת נחשבת שכבה");

const POPUPS = ["lockMsg", "futureConfirm", "futureData", "favPrompt", "notifyPrompt", "replyPop", "tour"];
const layerLine = (src.match(/const popupOpen = !!\([^)]*\);/) || [""])[0];
check("יש רשימה אחת של החלוניות", /const popupOpen = !!\(/.test(src), layerLine.slice(0, 40));
for (const p of POPUPS) check(`  ${p} ברשימה`, layerLine.includes(p));
// בלי זה לא נדחפת רשומה בהיסטוריה כשהחלונית נפתחת, ואז אין מה לצרוך.
check("והרשימה מזינה את מה שנשמר בהיסטוריה", /const layered = popupOpen \|\| !!\(modal \|\| sheet \|\| recipeSel \|\| tab !== "day"\);/.test(src));
check("והיא בין התלויות של האפקט", /\}, \[popupOpen, modal, sheet, recipeSel, tab\]\);/.test(src));

head("חזרה סוגרת אותן, וכל אחת כמו כפתור הביטול שלה");

// המאזין נרשם פעם אחת ולכן אינו רואה ערכים חדשים. אותו דפוס של modalRef.
check("המצב נקרא דרך ref ולא מתוך הסגירה", /popupRef\.current = \{ lockMsg, futureConfirm, futureData, favPrompt, notifyPrompt, replyPop, tour \};/.test(src));
check("החלוניות נבדקות לפני חלון ההוספה", src.indexOf("if (P.lockMsg)") < src.indexOf("if (modalRef.current && addBackRef.current"));
check("lockMsg", /if \(P\.lockMsg\) \{ setLockMsg\(null\); pushSentinel\(\); return; \}/.test(src));
check("שני אישורי הימים העתידיים", /if \(P\.futureConfirm\) \{ setFutureConfirm\(false\);/.test(src) && /if \(P\.futureData\) \{ setFutureData\(false\);/.test(src));
// זו החלונית שהמשתתפת נתקעה בה. חזרה עושה מה ש"לא תודה" עושה.
check('"לשמור למועדפים?" נסגרת כמו "לא תודה"', /if \(P\.favPrompt\) \{ setFavPrompt\(null\); setFavName\(""\); pushSentinel\(\); return; \}/.test(src));
check("ולא נשמרת בטעות", !/if \(P\.favPrompt\)[^\n]*saveFavorite/.test(src));
check("שאלת ההתראות נדחית ולא מאושרת", /if \(P\.notifyPrompt\) \{ dismissNotifyRef\.current\(\);/.test(src) && !/if \(P\.notifyPrompt\)[^\n]*acceptNotify/.test(src));
// "אחר כך" ולא "תודה, הבנתי": תשובה שלא אושרה חייבת לחזור בפתיחה הבאה.
check("תשובת המשרד נדחית ואינה מסומנת כנקראה", /if \(P\.replyPop\) \{ setReplyLater\(/.test(src) && !/if \(P\.replyPop\)[^\n]*readReply/.test(src));

head("ובסיור, שלב אחד אחורה. החלטת רון");

check("חזרה בסיור היא שלב אחד אחורה", /if \(P\.tour\) \{ if \(P\.tour\.i > 0\) tourBackRef\.current\(\);/.test(src));
// בשלב הראשון אין לאן, ולכן היא עושה מה שכפתור הסיום שבמסך עושה. לא לחיצה מתה.
check("ובשלב הראשון היא מסיימת אותו", /if \(P\.tour\.i > 0\) tourBackRef\.current\(\); else tourEndRef\.current\(\);/.test(src));
check("שתי הפונקציות נקראות דרך ref", /tourBackRef\.current = tourBack;/.test(src) && /tourEndRef\.current = tourEnd;/.test(src));
// זו בדיוק אותה פונקציה שהחצים שעל המסך קוראים להן, ולא חישוב שני.
check("והן אותן פונקציות שהמסך עצמו קורא להן", /onBack=\{tourBack\}/.test(src) && /onEnd=\{tourEnd\}/.test(src));

head("ואף לחיצה אינה מתה");

check("לחיצה שאין לה מה לסגור מועברת הלאה", /else if \(wasOurs\) \{ try \{ window\.history\.back\(\); \} catch \(e\) \{\} \}/.test(src));
check("והיא מועברת רק כשהרשומה הייתה שלנו", /const wasOurs = sentinelRef\.current;/.test(src));
check("ולפני כן נבדקו כל השכבות", src.indexOf('else if (tabRef.current !== "day") setTab("day");') < src.indexOf("else if (wasOurs)"));
// כל שכבה שנסגרה בלי ששום מצב השתנה חייבת לדחוף רשומה חדשה, אחרת הלחיצה הבאה יוצאת.
check("סגירת חלונית דוחפת רשומה חדשה", (src.match(/pushSentinel\(\); return; \}/g) || []).length === 7);
check("ופונקציה אחת עושה את זה", /const pushSentinel = \(\) => \{ try \{ window\.history\.pushState\(\{ mp: 1 \}, ""\); sentinelRef\.current = true; \} catch \(e\) \{\} \};/.test(src));

head("ומה שלא זז");

check("חלון ההוספה עדיין יורד שכבה בכל לחיצה", /if \(modalRef\.current && addBackRef\.current && addBackRef\.current\(\)\)/.test(src));
check("מודול התוכן גם הוא", /sheetRef\.current === "content" && contentBackRef\.current && contentBackRef\.current\(\)/.test(src));
check("והלשונית חוזרת ליומן לפני היציאה", /else if \(tabRef\.current !== "day"\) setTab\("day"\);/.test(src));

console.log(`\n${pass} מתוך ${pass + fail} עברו.`);
process.exit(fail ? 1 : 0);
