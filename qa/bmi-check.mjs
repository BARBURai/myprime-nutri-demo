// The lower BMI bound for weight loss: who is offered a deficit and who is offered
// maintenance only. No network, no AI.
//
//   node qa/bmi-check.mjs
//
// The rule is pulled out of src/App.jsx by exact string, not copied here. A copy would
// drift the first time someone edits the app, and then this file would be testing
// something that no longer exists.

import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const lines = src.split("\n");
const line = (prefix) => {
  const hit = lines.find((l) => l.startsWith(prefix));
  if (!hit) { console.log("✗ לא נמצאה בקוד השורה: " + prefix); process.exit(1); }
  return hit;
};

const code = [
  line("const UNDERWEIGHT_BMI ="),
  line("const MIN_LOSS_BMI ="),
  line("function bmiOf("),
  line("function minHealthyKg("),
  line("function noLossRoom("),
  "return { UNDERWEIGHT_BMI, MIN_LOSS_BMI, bmiOf, minHealthyKg, noLossRoom };",
].join("\n");
const { UNDERWEIGHT_BMI, MIN_LOSS_BMI, bmiOf, minHealthyKg, noLossRoom } = new Function(code)();

let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (extra ? "  → " + extra : "")); } };
const near = (a, b) => Math.abs(a - b) < 0.05;

console.log("\nהרף עצמו\n");
check("הרף לירידה הוא BMI 20, החלטה של רון", MIN_LOSS_BMI === 20, "יצא " + MIN_LOSS_BMI);
check("והוא גבוה מקו תת-המשקל של ארגון הבריאות", MIN_LOSS_BMI > UNDERWEIGHT_BMI);
check("קו תת-המשקל עצמו לא זז, כי האזהרה ביומן נשענת עליו", UNDERWEIGHT_BMI === 18.5);

console.log("\nהמשקל הנמוך ביותר שאפשר לכוון אליו\n");
check("בגובה 152 זה 46.5 ק״ג", near(minHealthyKg(152), 46.5), "יצא " + minHealthyKg(152));
check("בגובה 165 זה 54.5 ק״ג", near(minHealthyKg(165), 54.5), "יצא " + minHealthyKg(165));
check("בגובה 175 זה 61.5 ק״ג", near(minHealthyKg(175), 61.5), "יצא " + minHealthyKg(175));
check("והוא תמיד מעוגל כלפי מעלה, אחרת היעד נופל מתחת לרף", bmiOf(minHealthyKg(152), 152) >= MIN_LOSS_BMI && bmiOf(minHealthyKg(165), 165) >= MIN_LOSS_BMI && bmiOf(minHealthyKg(175), 175) >= MIN_LOSS_BMI);
check("בלי גובה אין רף, ולא מספר אקראי", minHealthyKg(0) === 0 && minHealthyKg(null) === 0);

console.log("\nמי מקבלת שמירה בלבד\n");
// רינת: 152 ס״מ, 44 ק״ג, BMI 19.0. הרף הקודם של 50 ק״ג חסם אותה מהאפליקציה לגמרי.
check("152 ס״מ ו-44 ק״ג: שמירה בלבד", noLossRoom(44, 152) === true);
check("152 ס״מ ו-50 ק״ג: ירידה מותרת", noLossRoom(50, 152) === false);
check("בדיוק על הרף נחשב שאין לאן לרדת", noLossRoom(46.5, 152) === true);
// זה בדיוק מה שהרף הקבוע של 50 ק״ג החמיץ: הוא הכניס אותה פנימה עם BMI 16.7.
check("175 ס״מ ו-51 ק״ג: שמירה בלבד, אף שהיא מעל 50", noLossRoom(51, 175) === true);
check("175 ס״מ ו-70 ק״ג: ירידה מותרת", noLossRoom(70, 175) === false);
check("בלי גובה או בלי משקל אין חסימה", noLossRoom(60, 0) === false && noLossRoom(0, 165) === false);

console.log("\nשדה המשקל ברישום הוא בדיקת טעות הקלדה בלבד\n");
const wOk = line("  const weightOk =");
check("הטווח הוא 30 עד 250", /weightN >= 30 && weightN <= 250/.test(wOk), wOk.trim());
check("הוא כבר לא 50 עד 150, שחסם משתתפת אמיתית", !/>= 50/.test(wOk));
check("וההודעה אומרת את הטווח במקום להכריז שהמספר שגוי", src.includes("אפשר להזין משקל בין 30 ל-250 ק״ג") && !src.includes("יש להזין משקל תקין בק״ג"));

console.log("\nמסך היעד\n");
check("הדגל מחושב מהגובה ומהמשקל שהיא הזינה", src.includes("const noLoss = noLossRoom(weightN, heightN);"));
check("והקצב נכפה לשמירה, כך ש-250 שנבחר כברירת מחדל לא נשמר בטיוטה", src.includes("const rateEff = noLoss ? 0 : rate;") && src.includes("weeklyRateG: rateEff") && src.includes("goalWeightKg: rateEff === 0 ? weightN"));
check("הקופי של רון, מילה במילה", src.includes("לפי הנתונים שלך אנו לא ממליצים על ירידה במשקל.") && src.includes("אם המספרים לא נכונים, אפשר לחזור אחורה ולתקן. ואם את רוצה לדבר איתנו על זה, אנא שלחי הודעה לצוות בוואטסאפ."));
check("ויש לה כפתור לצוות, ולא רק משפט", /noLoss \? \([\s\S]{0,1400}wa\.me\/972547304177/.test(src));
check("ארבע אפשרויות הקצב אינן מוצגות לה", /noLoss \? \([\s\S]{0,1800}\) : \(<>[\s\S]{0,400}RATE_OPTIONS\.map/.test(src));
check("ונאמר לה ששאר התוכנית פתוחה", src.includes("כל שאר התוכנית פתוחה לך כרגיל"));
check("וגם גרף התחזית שטוח, ולא מצייר לה ירידה", src.includes("const proj = projection(weightN, rateEff === 0 ? weightN : goalEff, rateEff);"));

console.log("\nמה שלא נסגר בפניה\n");
check("המשקל הנוכחי בפרופיל אינו כבול לרף, כי הוא עובדה ולא יעד", /key: "weightKg"[^}]*min: 30,/.test(src));
check("היעד בפרופיל כן כבול לרף", /key: "goalWeightKg"[^}]*min: minHealthyKg\(profile\.heightCm\)/.test(src));
check("הזנת משקל יומית ממשיכה לקבל כל ערך סביר ורק מזהירה", src.includes("num >= 30 && num <= 400") && src.includes("bmiOf(num, heightCm) < UNDERWEIGHT_BMI"));

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.\n");
process.exit(fail ? 1 : 0);
