#!/usr/bin/env node
// שני הדברים שנבנו ב-v6.57, בלי רשת:
//   1. פס "יש גרסה חדשה", למי שלא סוגרת את האפליקציה וממשיכה להריץ קוד ישן.
//   2. חלונית "תשובה מצוות מיי פריים", שקופצת מעצמה במקום לחכות בבועה.
//
//   node qa/update-reply-check.mjs
//
// שתי ההבטחות שהבדיקה הזאת קיימת בשבילן:
//   **לעולם לא מרעננים לבד**, כי אישה באמצע הקלדה תאבד את מה שכתבה.
//   **החלונית קופצת רק כשאין שום דבר אחר על המסך**, אחרת היא גוזלת פעולה באמצע.

import { readFileSync } from "node:fs";
const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (extra ? "  → " + extra : "")); } };
const between = (from, to) => { const a = app.indexOf(from); const b = app.indexOf(to, a); return a < 0 || b < 0 ? "" : app.slice(a, b); };

const bar = between("function UpdateBar(", "function ReplyPopup(");
const pop = between("function ReplyPopup(", "function DevViewportBar(");

console.log("\nפס הרענון, וההבטחה שלא מרעננים לבד\n");
check("הרכיב קיים", bar.length > 300);
check("הרענון היחיד הוא בהקשה על הכפתור",
  (bar.match(/location\.reload/g) || []).length === 1 && /onClick=\{\(\) => \{ try \{ window\.location\.reload\(\)/.test(bar));
check("אין רענון בטיימר ואין רענון באפקט",
  !/setTimeout\([^)]*reload/.test(bar) && !/setInterval\([^)]*reload/.test(bar));
check("הפס מוסתר כשחלון פתוח, כדי שלא תקיש רענון באמצע הזנה",
  /if \(!stale \|\| hidden \|\| dismissed\) return null;/.test(bar) &&
  /<UpdateBar hidden=\{!!\(sheet \|\| modal \|\| tour \|\| favPrompt \|\| notifyPrompt\)\} \/>/.test(app));

console.log("\nאיך הוא מזהה גרסה חדשה\n");
check("משווה את שם קובץ הקוד שבדף מול זה שנטען", /CURRENT_BUNDLE/.test(bar) && /cache: "no-store"/.test(bar));
check("בלי פונקציה חדשה בשרת: הבדיקה היא על הדף עצמו",
  /fetch\("\/index\.html"/.test(bar) && !/fetch\("\/api\//.test(bar));
check("נבדק בחזרה לאפליקציה ולא בלולאה",
  /visibilitychange/.test(bar) && /addEventListener\("focus", check\)/.test(bar));
check("ולא יותר מפעם בחמש דקות", /UPDATE_CHECK_MS = 5 \* 60 \* 1000/.test(app) && /now - lastRef\.current < UPDATE_CHECK_MS/.test(bar));
// **הסף שמונע ניג'וז.** רון מעלה כמה גרסאות ביום, ובלי זה אישה שפתחה בבוקר
// וחזרה בצהריים הייתה מקבלת פס בלי שהיא תקועה על כלום.
check("ומופיע רק אחרי 12 שעות שהאפליקציה פתוחה אצלה",
  /UPDATE_MIN_OPEN_MS = 12 \* 60 \* 60 \* 1000/.test(app) && /now - LOADED_AT < UPDATE_MIN_OPEN_MS/.test(bar));
// נמדד בדפדפן: הפס צויר ב-y=55 והכפתור "קבע יום 1" של סרגל הבדיקות ישב מעליו,
// ולכן הכפתור נראה מת. הסרגל נשבר לשלוש שורות בטלפון, ולכן מספר קבוע לא יעבוד.
check("בסרגל הבדיקות הוא יושב מתחתיו לפי הגובה האמיתי ולא לפי מספר קבוע",
  /getElementById\("mp-devbar"\)/.test(bar) && /\$\{devTop\}px/.test(bar) && /id="mp-devbar"/.test(app));
check("ויש ✕ שמסתיר לסשן הזה בלבד",
  /setDismissed\(true\)/.test(bar) && /if \(!stale \|\| hidden \|\| dismissed\) return null;/.test(bar) &&
  !/dismissed[\s\S]{0,120}localStorage/.test(bar));
check("וכשלון של הבדיקה שקט ואינו מציג כלום", /\} catch \(e\) \{\}/.test(bar));
check("הקופי שאושר, מילה במילה", bar.includes("יש גרסה חדשה של האפליקציה") && bar.includes(">רענון<"));

console.log("\nחלונית התשובה\n");
check("הרכיב קיים", pop.length > 200);
check("הכותרת שרון אישר", pop.includes("תשובה מצוות מיי פריים"));
check("שני הכפתורים שאושרו", pop.includes("תודה, הבנתי") && pop.includes("אחר כך"));
check("מציגה את הטקסט של התשובה כפי שנכתב", /whiteSpace: "pre-wrap"/.test(pop) && /\{reply\.text\}/.test(pop));
// ענת לא כותבת את התשובות האלה, רון וטלי כותבים. חתימה בשמה היא ייחוס של דבר
// שהיא לא אמרה, וזה בדיוק הכלל שנקבע ב-v5.74. ראה סעיף 8.
check("אינה חתומה בשמה של ענת", !pop.includes("ענת"));

console.log("\nמתי היא קופצת, וזו ההגנה העיקרית\n");
const guard = between('{gate === "ok" && onboarded && replyPop', "<ReplyPopup");
check("רק אחרי שהיא סיימה את הרישום", /gate === "ok" && onboarded/.test(guard));
for (const g of ["!sheet", "!modal", "!tour", "!favPrompt", "!notifyPrompt"])
  check("לא קופצת מעל " + g, guard.includes(g));
check("אחת בכל פעם ולא שתיים", /const replyPop = \(replies \|\| \[\]\)\.find\(/.test(app));

console.log('\n"אחר כך", ומה שאסור לו לעשות\n');
check("דוחה לסשן הזה בלבד", /const \[replyLater, setReplyLater\] = useState\(\[\]\);/.test(app));
// אם הדחייה נשמרת, התשובה נעלמת ממנה לתמיד בלי שהיא אישרה אותה, והמשרד רואה
// "ממתין שהיא תפתח" לנצח.
check("ואינו נשמר במכשיר, ולכן היא חוזרת בפתיחה הבאה",
  !/replyLater[\s\S]{0,200}localStorage/.test(app) && !/localStorage[^\n]*replyLater/.test(app));
check('"אחר כך" אינו מסמן למשרד שהיא קראה',
  /onLater=\{\(\) => setReplyLater\(\(a\) => \[\.\.\.a, replyPop\.id\]\)\}/.test(app));
check('ורק "תודה, הבנתי" מסמן', /onAck=\{\(\) => readReply\(replyPop\.id\)\}/.test(app));

console.log("\nוהבועה ממשיכה לעבוד כמו קודם\n");
check("התשובה ממשיכה להופיע גם בתוך בועת ההערות", /תשובה מהצוות 💜/.test(app));
check("והעיגול הירוק לא נגע", /background: \(replies \|\| \[\]\)\.length \? "#16a34a"/.test(app));

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.");
process.exit(fail ? 1 : 0);
