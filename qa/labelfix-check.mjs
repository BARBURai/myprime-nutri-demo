// שני תיקונים שנולדו מדיווח של משתתפת ב-16 בספטמבר 2026, ושניהם נבדקים כאן בלי רשת.
//
// **מה שקרה לה:** היא רשמה משקה יוגורט מועשר בחלבון דרך חיפוש, וקיבלה 215 קלוריות
// ו-7 גרם חלבון ל-500 מ"ל. על האריזה כתוב 53 קלוריות ו-8.4 גרם חלבון ל-100 מ"ל,
// כלומר **265 ו-42 לקרטון. החלבון היה קטן פי שישה.**
//
// **השורש:** המוצר קיים במאגר העולמי עם ערכי התווית המדויקים, אבל **הוא רשום שם
// באנגלית בלבד**, ולכן חיפוש בעברית אינו יכול להגיע אליו ונופל על הפריט הגנרי שכן
// יש לו שם בעברית. הברקוד אינו משתמש בשם ולכן הוא חסין לזה.
//
// **ומה שמנע ממנה לתקן:** השורה "הערכים לא תואמים לאריזה" הופיעה אך ורק מיד אחרי
// סריקת ברקוד, ובמפורש לא במסך העריכה. היא כתבה "תיקנתי ולא שונה".
//
// הפונקציות נמשכות מ-src/App.jsx לפי מחרוזת ומורצות, ואינן מועתקות לכאן.
//
//   node qa/labelfix-check.mjs

import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const grab = (from, to) => {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  if (a < 0 || b < 0) { console.log("✗ לא נמצא בקוד: " + from); process.exit(1); }
  return src.slice(a, b);
};
const lines = src.split("\n");
const line = (prefix) => {
  const hit = lines.find((l) => l.trimStart().startsWith(prefix));
  if (!hit) { console.log("✗ לא נמצאה בקוד השורה: " + prefix); process.exit(1); }
  return hit.trim();
};

let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (extra ? "  → " + extra : "")); } };

// ---------------------------------------------------------------- קוד אמיתי
const { foodFromEntry } = new Function([
  grab("function measuresForUnit(", "function activityBonus("),
  "return { foodFromEntry };",
].join("\n"))();

// שדות ההזנה הידנית: אותו חישוב שרץ כשהיא מקישה "עדכני".
const manualMath = new Function("mWhole", "amount", "mKcal", "mProt", "mFat", "mCarb", [
  line("const k = mWhole ? 1 : amount / 100;"),
  line("const n = { kcal: Math.round((Number(mKcal)"),
  "return n;",
].join("\n"));

// העיגול שממלא את השדות מתוך per100 של פריט קיים.
const r1 = new Function(line("const r1 = (n) =>") + "\nreturn r1;")();

// הענף שמעדכן פריט קיים במקום להוסיף שורה חדשה.
const editBranch = new Function("modal", "payload", "date", "setLog", line("if (modal?.editEntry) setLog("));

const QTY = grab("<div style={{ background: C.bg, borderRadius: 12, padding: 12, marginBottom: 14 }}>", "<Btn onClick={() => { setQtyText(null);");
const LIST = grab("{step === \"list\" && (", "{step === \"history\" && (");
const MANUAL = grab("{step === \"manual\" && (", "{step === \"list\" && (");

// ============================================================ המקרה של המשתתפת
console.log("\nהמקרה שדווח: משקה יוגורט מועשר בחלבון, 500 מ\"ל");
{
  // מה שהיומן שלה הכיל בפועל, ומה שמסך העריכה גוזר ממנו.
  const per100 = foodFromEntry({ name: "משקה יוגורט", g: 500, unit: "ml", kcal: 215, p: 7, f: 3, c: 40 }).per100;
  check("מסך העריכה גוזר מהפריט שלה 43 קק\"ל ל-100 מ\"ל", Math.round(per100.kcal) === 43, String(per100.kcal));
  check("ו-1.4 גרם חלבון, שזה משקה יוגורט רגיל ולא מועשר", Math.round(per100.p * 10) / 10 === 1.4, String(per100.p));
  // בלי העיגול היא הייתה רואה זנב עשרוני ארוך בשדה.
  check("החלוקה באמת מייצרת זנב עשרוני ארוך", String(per100.p).length > 4, String(per100.p));
  check("והעיגול מציג לה 1.4 ולא את הזנב", r1(per100.p) === "1.4", r1(per100.p));
  check("ואפס אינו הופך ל\"0\" בשדה אלא נשאר ריק", r1(0) === "", JSON.stringify(r1(0)));

  // ומה שהתווית אומרת: 53 ו-8.4 ל-100 מ"ל, על 500 מ"ל.
  const fixed = manualMath(false, 500, "53", "8.4", "0.5", "3.5");
  check("הקלדת ערכי התווית ל-500 מ\"ל נותנת 265 קק\"ל", fixed.kcal === 265, String(fixed.kcal));
  check("ו-42 גרם חלבון, פי שישה ממה שהיא קיבלה", fixed.p === 42, String(fixed.p));

  // המתג הזה הוא לא פרט: אותם מספרים בדיוק נכנסים אחרת לגמרי.
  const whole = manualMath(true, 500, "53", "8.4", "0.5", "3.5");
  check("ובמצב \"לכל המנה\" אותם מספרים היו נכנסים כ-53 ו-8", whole.kcal === 53 && whole.p === 8, JSON.stringify(whole));
  check("ולכן ההפניה מאפסת את המתג ל-100", /setMWhole\(false\)/.test(QTY));
}

// ============================================================ השורה מגיעה לכל מסלול
console.log("\n\"הערכים לא תואמים לאריזה\" בכל מסלול, ולא רק אחרי סריקה");
{
  check("השורה קיימת", /הערכים לא תואמים לאריזה\? עדכני מהתווית/.test(QTY));
  // פעמיים בקובץ, וזה תקין: הכפתור עצמו, והציטוט שלו בתשובה שבשאלות ותשובות.
  check("והיא מופיעה פעם אחת במסך הכמות", (QTY.match(/הערכים לא תואמים לאריזה\? עדכני מהתווית/g) || []).length === 1);
  check("ופעם אחת בשאלות ותשובות, שמצטטת אותה", (src.match(/הערכים לא תואמים לאריזה\? עדכני מהתווית/g) || []).length === 2);
  // **התנאי עצמו ולא חלון של תווים סביבו.** ניסוח רופף היה עובר גם על הקוד הישן,
  // שבו שלושת החוסמים יושבים עשר שורות מעל הכיתוב.
  const qLines = QTY.split("\n");
  const hit = qLines.findIndex((l) => l.includes("הערכים לא תואמים לאריזה"));
  let open = "";
  for (let i = hit; i >= 0; i--) if (/&& \($/.test(qLines[i].trim())) { open = qLines[i].trim(); break; }
  check("התנאי שמעל השורה נמצא", !!open, open);
  check("והוא שואל רק אם יש למוצר ערכים", open === "{food.per100 && (", open);
  check("אינה מותנית יותר בסריקת ברקוד", !open.includes("scannedCode"), open);
  check("אינה מותנית במוצר שהגיע מהברקוד", !open.includes("bc_"), open);
  check("ומוצגת גם במסך עריכת פריט", !open.includes("editEntry"), open);
  check("היא פותחת את מסך ההזנה הידנית", /setStep\("manual"\)/.test(QTY));
  check("ומסמנת שהיא הגיעה משם", /setLabelFix\(true\)/.test(QTY));
  check("ומנקה הודעת תודה שנשארה מפתיחה קודמת", /setLabelSaved\(false\)/.test(QTY));
}

// ============================================================ עריכה מעדכנת ולא מוסיפה
console.log("\nתיקון של פריט שכבר ביומן מחליף אותו ולא מוסיף שורה");
{
  let out = null;
  const log = [{ id: "x", date: "2026-09-16", name: "משקה יוגורט", g: 500, unit: "ml", kcal: 215, p: 7 }];
  editBranch({ editEntry: { id: "x", date: "2026-09-16" } },
    { meal: "בוקר", name: "משקה יוגורט", g: 500, unit: "ml", source: "manual", kcal: 265, p: 42 },
    "2026-09-16", (fn) => { out = fn(log); });
  check("נשארה שורה אחת ביומן", out && out.length === 1, out ? String(out.length) : "לא רץ");
  check("עם אותו מזהה", out && out[0].id === "x");
  check("והמספרים התחלפו ל-265 ו-42", out && out[0].kcal === 265 && out[0].p === 42, out ? JSON.stringify(out[0]) : "");
  check("וכפתור השמירה אומר \"עדכני\" בעריכה", /state\.editEntry \? "עדכני" : "הוסיפי ליומן"/.test(MANUAL));
  check("והכותרת אומרת \"עדכון מהתווית\"", /labelFix \|\| scannedCode \? "עדכון מהתווית"/.test(MANUAL));
}

// ============================================================ תיקון אישי נשאר אישי
console.log("\nתיקון שהיא הקלידה אינו דולף למאגר המשותף");
{
  // **זה מה שמאפשר להציג את השורה בכל מסלול.** אילו תיקון ידני היה נכנס למאגר
  // המשותף, פתיחת השורה לכל פריט הייתה נותנת לכל אישה לשנות מספרים לכולן.
  const ADD = grab("function catalogAdd(", "// What WE hold for a scanned barcode");
  check("catalogAdd מדלג על מה שהוקלד ביד", /item\.source === "manual"/.test(ADD), "");
  // למאגר הברקודים נכנס רק מה שנסרק, וגם אז לא ערכים של מנה שלמה.
  const SAVE = grab("const saveManual = () => {", "const unsavedPick =");
  check("ולמאגר הברקודים נכתב רק מה שנסרק", /if \(scannedCode && !mWhole\) \{[\s\S]{0,200}catalogBarcodePut\(/.test(SAVE), "");
  check("ושמירה ידנית מסומנת manual, ולכן catalogAdd מדלג עליה", /source: "manual"/.test(SAVE), "");
}

// ============================================================ ההפניה לברקוד בחיפוש
console.log("\nההפניה לברקוד, במסך החיפוש עצמו");
{
  const NUDGE = "יש לך את האריזה ביד? סריקת הברקוד תיתן את המספרים המדויקים";
  check("הכיתוב שרון אישר קיים", src.includes(NUDGE));
  check("והוא יושב במסך החיפוש", LIST.includes(NUDGE));
  check("ההקשה עליו קופצת לסורק", /onClick=\{\(\) => \{ usageBump\("barcode"\); setStep\("barcode"\); \}\}[\s\S]{0,400}/.test(LIST));
  // הכותרת של מסך החיפוש אינה נגללת (flexShrink: 0), והתוצאות כן. שורה שנגללת
  // החוצה ברגע שהיא מקלידה אינה מפנה אף אחת.
  const headEnd = LIST.indexOf("<div style={{ overflowY: \"auto\", flex: 1, minHeight: 0 }}>");
  check("והוא בכותרת הקבועה ולא ברשימה שנגללת", headEnd > 0 && LIST.indexOf(NUDGE) < headEnd);
  check("מתחת לשדה החיפוש ולא מעליו", LIST.indexOf(NUDGE) > LIST.indexOf("placeholder=\"חיפוש מזון…\""));
}

// ============================================================ כפתור החזרה
console.log("\nחזרה ממסך התיקון חוזרת למסך הכמות ולא לתפריט");
{
  const BACK = line("const back = step ===");
  check("מסך ההזנה הידנית מקבל חזרה משלו כשהגיעה מהתיקון", /step === "manual" && labelFix/.test(BACK));
  check("והיא מחזירה אותו למסך הכמות", /step === "manual" && labelFix \? \(\) => \{ setLabelFix\(false\); setStep\("qty"\); \}/.test(BACK));
  check("והשרשרת הקיימת לא נדרסה", /step === "qty" && !state\.editEntry \? \(\) => setStep\(qtyOrigin\)/.test(BACK));
  check("וגם כפתור \"חזרה\" שבמסך עצמו", /if \(labelFix\) \{ setLabelFix\(false\); setStep\("qty"\); \}/.test(MANUAL));
}

console.log("\n" + (fail ? "✗" : "✓") + " " + pass + " מתוך " + (pass + fail));
process.exit(fail ? 1 : 0);
