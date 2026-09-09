// ערכים שהאישה מסרה בעצמה מהאריזה, ומה שקורה להם אחר כך.
//
//   node qa/stated-values-check.mjs
//
// רון בדק ב-9 בספטמבר 2026 בדיוק את מה שמשתתפת דיווחה: הוא כתב "אכלתי יוגורט 0
// אחוז שומן לגביע 200 גרם 112 קלוריות חלבון 20 שומן 0", **הבינה רשמה בדיוק את
// זה**, ומיד אחריה הגיעה הודעה שלנו: "עדכנתי את הקלוריות לפי המאגר: סה״כ 76
// קק״ל", והכרטיס סומן "מהמאגר".
//
// **הבעיה לא הייתה בהנחיות אלא ב-`reconcileWithDb`**, שמחליף כל פריט בערכים
// מהמאגר. השומר שם פוסל התאמה רק כשהיא רחוקה ביותר מ-40 אחוז, **ו-76 מול 112
// הוא 32 אחוז.**
//
// ההחלטה של רון: ערכים שהיא מסרה גוברים, יש להם תג משלהם, **ומה שחסר נשאל
// אותה ולא מנוחש.**

import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const qa = readFileSync(new URL("./run-qa.mjs", import.meta.url), "utf8");
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  ← " + extra : "")); }
};

console.log("\nהמאגר לא נוגע במה שהיא מסרה");
check("יש שער שמחזיר מיד פריט שנמסרו ערכיו", /if \(it\.stated\) return \{ \.\.\.it, source: "stated" \};/.test(src));
// הסדר הוא כל הבדיקה: שער שיושב אחרי החיפוש היה מחליף את הערכים ואז מחזיר.
const gate = src.indexOf('if (it.stated) return { ...it, source: "stated" };');
const lookup = src.indexOf("const m = await lookupProduct(it.name, it.en);");
check("והוא קודם לחיפוש במאגר עצמו", gate > 0 && lookup > 0 && gate < lookup, `שער ${gate}, חיפוש ${lookup}`);
check("ואין מסלול שני שמחליף ערכים בלי לעבור דרכו",
  (src.match(/kcal: dbKcal,/g) || []).length === 1);

console.log("\nהדגל עצמו");
check("נקרא מהתשובה של הבינה", /\.\.\.\(it\.stated === true \? \{ stated: true \} : \{\}\)/.test(src));
check("ורק כשהוא true, כדי ש\"false\" לא ייחשב סימון", /it\.stated === true/.test(src));

console.log("\nההנחיות לבינה");
const RULE = "אם המשתמשת מסרה בעצמה ערכים תזונתיים של מאכל";
check("הכלל קיים באפליקציה", src.includes(RULE));
check("וגם בהעתק של שכבה 2", qa.includes(RULE));
check("הערכים נלקחים כפי שנמסרו", src.includes("קחי אותם בדיוק כפי שנמסרו, אל תשני אותם ואל תחליפי אותם בהערכה שלך"));
// החלטת רון: "ואם חסר ב-AI נתון למשל כמה חלבון או שומן שישאל אותה לנתון החסר."
check("ומה שחסר נשאל ולא מנוחש", src.includes("אם חסר לך אחד מהם, שאלי אותה עליו לפני הסיכום"));
check("וכל מה שחסר בהודעה אחת", src.includes("בהודעה אחת ולא אחד אחרי השני"));
check("ומי שאינה יודעת אינה נתקעת", src.includes("אם היא אומרת שאינה יודעת או שאין לה את הנתון, השלימי אותו בהערכה סבירה והמשיכי"));
check("והשדה מוגדר בסכימה", src.includes('\\"stated\\":true'));
check("ובכל פריט אחר הוא אינו נכתב", src.includes("ובכל פריט אחר אל תוסיפי את השדה הזה כלל"));

console.log("\nהתג");
check("קיים תג שלישי", /source === "stated"/.test(src));
check("והכיתוב הוא זה שרון אישר", /לפי מה שהזנת<\/span>/.test(src));
check("והוא אינו נצבע כמו המאגר", !/source === "stated"[\s\S]{0,140}#E7F4EC/.test(src));
check("וההסבר מתחת לכרטיס מזכיר אותו", src.includes('"לפי מה שהזנת" = המספרים שמסרת מהאריזה'));
check("ושלושת התגים נשארו באותו הסבר",
  src.includes('"מהמאגר" = ערכים אמיתיים ממאגר מוצרים') && src.includes('"מוערך" = הערכת AI'));

console.log("\nמה שלא זז");
check("ההודעה על עדכון מהמאגר עדיין קיימת למי שלא מסרה ערכים",
  src.includes("עדכנתי את הקלוריות לפי המאגר"));
check("והשומר של 40 האחוז לא בוטל", /dbKcal > aiKcal \* 1\.4 \|\| dbKcal < aiKcal \* 0\.6/.test(src));
check("ומאכל ביתי שמתחלק לחתיכות עדיין נשאר הערכה",
  /if \(it\._pieces\) return \{ \.\.\.it, source: "estimated" \};/.test(src));

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.");
process.exit(fail ? 1 : 0);
