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
// **ומה שמנע ממנה לתקן:** השורה "הערכים לא נכונים" הופיעה אך ורק מיד אחרי
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
console.log("\n\"הערכים לא נכונים\" בכל מסלול, ולא רק אחרי סריקה");
{
  check("השורה קיימת", /הערכים לא נכונים\? עדכני מהתווית/.test(QTY));
  // פעמיים בקובץ, וזה תקין: הכפתור עצמו, והציטוט שלו בתשובה שבשאלות ותשובות.
  check("והיא מופיעה פעם אחת במסך הכמות", (QTY.match(/הערכים לא נכונים\? עדכני מהתווית/g) || []).length === 1);
  check("ופעם אחת בשאלות ותשובות, שמצטטת אותה", (src.match(/הערכים לא נכונים\? עדכני מהתווית/g) || []).length === 2);
  // **התנאי עצמו ולא חלון של תווים סביבו.** ניסוח רופף היה עובר גם על הקוד הישן,
  // שבו שלושת החוסמים יושבים עשר שורות מעל הכיתוב.
  const qLines = QTY.split("\n");
  const hit = qLines.findIndex((l) => l.includes("הערכים לא נכונים"));
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

// ============================================================ הכיתוב, ומי מצטט אותו
console.log("\nהכיתוב זהה בשלושת המקומות שמזכירים אותו");
{
  const html = readFileSync(new URL("../public/admin.html", import.meta.url), "utf8");
  // **זה מה שהיה שביר:** הכיתוב מדבר על אריזה, ולכן הוא נקרא מוזר על סלט ביתי
  // או על ארוחה שהבינה רשמה. רון אישר את הנוסח הזה ב-16 בספטמבר 2026.
  check("הנוסח הישן ירד מהאפליקציה", !src.includes("הערכים לא תואמים לאריזה"), "");
  check("וגם הציטוט שבבנק התשובות של המשרד", !html.includes("הערכים לא תואמים לאריזה? עדכני מהתווית"), "");
  // **ובבנק השאלה נשארת בלשון שהמשתתפת כתבה**, כי זה מה שהדירוג נתפס עליו.
  // רק התשובה מתחלפת. ראה v6.45.
  check("והשאלה שם נשארה בלשון שלה", html.includes("סרקתי ברקוד והערכים לא תואמים לאריזה, הקלוריות שגויות"), "");
  // **התשובה מצטטת את הכיתוב מילה במילה**, ולכן שינוי של אחד בלי השני שולח
  // אישה לחפש שורה שאינה קיימת. זו הדרך היחידה למנוע את זה.
  const LINE = "הערכים לא נכונים? עדכני מהתווית";
  const faq = grab('{ q: "הערכים של המוצר לא נכונים. מה עושים?"', "},");
  check("התשובה בשאלות ותשובות מצטטת את הכיתוב שעל המסך", faq.includes(LINE), "");
  check("והיא מפנה לברקוד, שהוא מה שבאמת פותר", faq.includes("סריקת ברקוד"), "");
  check("ואומרת שאפשר לתקן גם פריט שכבר ביומן", faq.includes("שכבר רשמת ביומן"), "");
  check("ובנק המשרד נושא את אותו ציטוט, בשתי הרשומות", (html.match(new RegExp(LINE.replace("?", "\\?"), "g")) || []).length === 2, "");
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


// ---------------------------------------------------------- v7.18: העיגול והמתג
// שני דברים שרון תפס ב-17 בספטמבר 2026 כשבדק את v7.17 בטלפון.
{
  // א. **הברקוד נתן 40 גרם חלבון במקום 42.** כל ערך תזונתי שנסרק עוגל למספר שלם,
  // ולכן 8.4 הפך ל-8 וגביע של 500 מ"ל נרשם חסר. הפונקציה נמשכת מהקוד ומורצת.
  const per100Round = new Function("n", line("const per100Round = (n) =>").replace(/^const per100Round = \(n\) =>/, "return") .replace(/;$/, ";"));
  check("עיגול לעשירית שומר את 8.4", per100Round(8.4) === 8.4, "יצא " + per100Round(8.4));
  check("והמקרה של רון: גביע 500 מ\"ל נותן 42 ולא 40", Math.round(per100Round(8.4) * 5) === 42, "יצא " + Math.round(per100Round(8.4) * 5));
  check("וערך קטן אינו נמחק: 1.4 נשאר 1.4", per100Round(1.4) === 1.4, "יצא " + per100Round(1.4));
  check("וקלט ריק עדיין נותן 0", per100Round(undefined) === 0 && per100Round("") === 0);

  // ב. **חמישה מקומות עיגלו לשלם, לא אחד.** תיקון של הסריקה בלבד היה נדרס שוב
  // בכתיבה למאגר, ואישה שנייה הייתה מקבלת את הערך המעוגל.
  const server = readFileSync(new URL("../api/catalog.js", import.meta.url), "utf8");
  check("סריקת הברקוד אינה מעגלת לשלם", !/Math\.round\(n\.proteins_100g/.test(src));
  check("ומשתמשת בעיגול המשותף", /per100Round\(n\.proteins_100g\)/.test(src));
  check("גם כתיבה למאגר המשותף באפליקציה", !/Math\.round\(\(Number\(item\.p\) \|\| 0\)/.test(src));
  check("וגם שחזור פריט מהיומן", !/Math\.round\(\(p\.p \|\| 0\) \/ g \* 100\)/.test(src));
  check("והשרת אינו מעגל לשלם בשתי נקודות הכתיבה", !/Math\.round\(Number\(per100\.p\)/.test(server));
  check("ויש לו עיגול משותף משלו", /const per100Round = \(n\) =>/.test(server));

  // ג. **המתג ירד ממסך התיקון מהתווית.** התווית תמיד נותנת ערכים ל-100, השדות כבר
  // מלאים ל-100, והעברתו הפכה את אותם 53 ל"53 לכל הגביע" בלי לשנות ספרה על המסך.
  const TOGGLE = grab('הערכים שאת מזינה הם:', 'ככה כתוב על האריזה');
  check("המתג עטוף בתנאי שמסתיר אותו בתיקון מהתווית", /\{!labelFix && \(<>/.test(src));
  check("ושתי האפשרויות עדיין קיימות להזנה ידנית רגילה", /לכל המנה/.test(TOGGLE) && /ל-100 \$\{mUnit/.test(TOGGLE));
  // ההסבר עצמו נשאר מחוץ לתנאי: בלעדיו היא לא יודעת לפי מה המספרים מחושבים.
  const EXPL = src.indexOf('ככה כתוב על האריזה. נחשב לפי הכמות');
  const GUARD = src.indexOf('{!labelFix && (<>');
  const CLOSE = src.indexOf('</>)}', GUARD);
  check("וההסבר נשאר מוצג גם בתיקון מהתווית", EXPL > CLOSE, "ההסבר נבלע בתוך התנאי");
}

console.log("\n" + (fail ? "✗" : "✓") + " " + pass + " מתוך " + (pass + fail));
process.exit(fail ? 1 : 0);
