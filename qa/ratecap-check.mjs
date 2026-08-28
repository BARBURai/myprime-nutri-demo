// התקרה שמזיזה בפועל את מי שבחרה 500 ומתקרבת לקו. בלי רשת.
//
//   node qa/ratecap-check.mjs
//
// v6.01 הפסיקה להציע 500 למי שבתוך 5 ק״ג מהקו, אבל מי שכבר בחרה 500 המשיכה לקבל
// את הגירעון המלא: הרשימה בפרופיל אמרה דבר אחד והיעד הקלורי אמר אחר. רון,
// 28 באוגוסט 2026: "אין לי בעיה שתהיה ב-250 בלבד."
//
// המספר שעל המסך שלה עולה בכ-275 קלוריות, ולכן זה לעולם לא קורה בשקט.

import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  ← " + extra : "")); }
};

const grab = (re, label) => { const m = src.match(re); check(label + " נמצא ב-App.jsx", !!m); return m ? m[0] : ""; };
const consts = [
  grab(/const RATE_OPTIONS = \[0, 250, 500\];/, "RATE_OPTIONS"),
  grab(/const MIN_LOSS_BMI = 20;/, "MIN_LOSS_BMI"),
  grab(/const FAST_RATE_ROOM_KG = 5;/, "FAST_RATE_ROOM_KG"),
  grab(/function minHealthyKg\(heightCm\) \{[^\n]*\}/, "minHealthyKg"),
  grab(/function rateOptionsFor\(weightKg, heightCm, everStopped\) \{[\s\S]*?\n\}/, "rateOptionsFor"),
  grab(/function rateCapFor\(profile, weightKg\) \{[\s\S]*?\n\}/, "rateCapFor"),
].join("\n");
const rateCapFor = consts.includes("rateCapFor") ? new Function(consts + "; return rateCapFor;")() : () => null;

const P = (o) => ({ heightCm: 165, weeklyRateG: 500, lossStopAt: null, lossStopEver: false, ...o });

console.log("\nמתי התקרה תופסת");
// בגובה 165 הקו הוא BMI 20, כלומר כ-54.5 ק״ג. 5 ק״ג מעליו הם כ-59.5.
check("מי שרחוקה מהקו נשארת על 500", rateCapFor(P({}), 75) === null);
check("מי שבתוך 5 ק״ג מהקו יורדת ל-250", rateCapFor(P({}), 57) === 250, String(rateCapFor(P({}), 57)));
check("מי שכבר ירדה מתחת לקו פעם אחת יורדת ל-250 בכל משקל",
  rateCapFor(P({ lossStopEver: true }), 75) === 250);
check("מי שכבר על 250 לא זזה", rateCapFor(P({ weeklyRateG: 250 }), 57) === null);
check("מי שבשמירה לא נוגעים בה כאן", rateCapFor(P({ weeklyRateG: 0 }), 57) === null);
check("ומי שכבר הועברה לשמירה גם לא", rateCapFor(P({ lossStopAt: "2026-08-01" }), 57) === null);
check("פרופיל ריק אינו מפיל", rateCapFor(null, 57) === null);

console.log("\nשני המסלולים, ומקום אחד לכלל");
check("הכלל יושב בפונקציה אחת", (src.match(/function rateCapFor\(/g) || []).length === 1);
check("הזנת משקל בדוח עוברת בו", /const capped = rateCapFor\(profile, cur\);/.test(src));
check("ועריכת המשקל בפרופיל גם", /const capped = rateCapFor\(next, nextCur\);/.test(src));
check("ובפרופיל הבדיקה היא על המשקל הקובע ולא על מה שהוקלד", /rateCapFor\(next, nextCur\)/.test(src));
check("המעבר לשמירה גובר, ואינו מוצג יחד עם התקרה", /setShowLossStop\(true\);\n      \} else if \(pendingWeight\.key === "weightKg"\) \{/.test(src));

console.log("\nהמסך");
check("המסך קיים ומרונדר משני המקומות",
  /function RateCapSheet\(\{ onClose \}\)/.test(src)
  && /\{sheet === "rateCap" && <RateCapSheet/.test(src)
  && /\{showRateCap && <RateCapSheet/.test(src));
const sheet = (src.match(/function RateCapSheet\(\{ onClose \}\) \{[\s\S]*?\n\}\n/) || [""])[0];
check("הכותרת היא זו שרון אישר", sheet.includes("הקצב שלך עודכן"));
check("והטקסט כלשונו", sheet.includes("ככל שמתקרבים למשקל תקין אנחנו ממליצים על ירידה מתונה יותר. הקצב שלך עודכן ל-250 גרם בשבוע, והיעד הקלורי היומי עלה בהתאם."));
// סעיף 8: מה שהאפליקציה מחליטה מעצמה נאמר בקול המערכת.
check("בקול המערכת: בלי חתימה של ענת", !sheet.includes("ענת"));
check("ובלי אמוג'י", !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(sheet));
check("כפתור אחד בלבד", (sheet.match(/<Btn /g) || []).length === 1);

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.");
process.exit(fail ? 1 : 0);
