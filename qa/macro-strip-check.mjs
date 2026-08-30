#!/usr/bin/env node
// סכימת המאקרו היומית ביומן, בלי רשת.
//
//   node qa/macro-strip-check.mjs
//
// ההחלטה של רון, 30 באוגוסט 2026: "אל תשים שם בכלל יעדים, פשוט תרשום סכימה של
// מה שהיא אכלה, שומן פחמימות חלבון, ובלי סיבים." **יעד קיים רק לחלבון, והוא
// כבר יושב בטבעת שמעל.** ושורת המאקרו ירדה מהפרופיל, כי שם היא רק בלבלה.

import { readFileSync } from "node:fs";
const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (extra ? "  → " + extra : "")); } };

const i = app.indexOf("{macroOpen && (");
const strip = i < 0 ? "" : app.slice(i, app.indexOf("{dayAct.length > 0 && (", i));

console.log("\nמה מוצג ברצועה\n");
check("הרצועה קיימת", strip.length > 200);
check("שלושת המאקרו", /label: "חלבון"/.test(strip) && /label: "שומן"/.test(strip) && /label: "פחמימות"/.test(strip));
check("בלי סיבים", !/סיבים/.test(strip));
// **בלי יעדים.** יעד לשומן ולפחמימות מעולם לא היה משהו שהתוכנית מתייחסת אליו,
// והצגתו הופכת מספר ניטרלי לשיפוט.
check("ובלי שום יעד: אין מכנה בתא ואין קריאה ליעדים", !/\bt:/.test(strip) && !/\{m\.v\}[^<]*\//.test(strip) && !/ \/ /.test(strip) && !/targets\./.test(strip));
check("מספרים שלמים ולא שברים", /Math\.round\(m\.v\)/.test(strip));

console.log("\nמתי היא נפתחת\n");
check("ביום שמשימת החלבון נפתחת, ולא לפני", /\{macroOpen && \(/.test(app) && /const macroOpen = unlockedOn\(profile\.startDate, date, MACRO_UNLOCK\)/.test(app));
check("MACRO_UNLOCK הוא שבוע 3 יום 4", /MACRO_UNLOCK = \{ week: 3, day: 4 \}/.test(app));
// הדגל הישן שהחזיק אותה כבויה ירד, כדי שלא יישאר מתג מת שמישהו ידליק בטעות.
check("הדגל הישן שהשאיר אותה כבויה ירד", !/SHOW_MACRO_STRIP/.test(app));

console.log("\nאיפה היא יושבת\n");
const posCard = app.indexOf("{checkinOpen && ciTasks.length > 0 && <CheckinCard");
const posStrip = app.indexOf("{macroOpen && (");
const posList = app.indexOf("מה שהוזן היום");
check("מתחת לכרטיס יומן המעקב", posCard > 0 && posStrip > posCard);
check("ומעל 'מה שהוזן היום'", posList > posStrip);

console.log("\nוהפרופיל\n");
// רון: "בפרופיל זה סתם מבלבל, אני לא צריך את זה שם בכלל."
check("שורת המאקרו ירדה מהפרופיל", !/<MacroRow /.test(app));
check("והיעד הקלורי נשאר שם", /יעד קלורי יומי/.test(app));

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.");
process.exit(fail ? 1 : 0);
