// החלבון, הצעדים והאימונים לפי המשקל האחרון, ויעד שקבעה לעצמה במעבר לשמירה. v8.33
//
//   node qa/weight-now-check.mjs
//
// **למה זה קיים.** 20.10.2026: דנה ירדה 6 ק"ג, שוקלת 69, והאפליקציה המשיכה לתת לה יעד
// חלבון של 120 גרם, לפי משקל הרישום. ובבדיקה נמצא שיעד שאישה קבעה לעצמה עוקף את המעבר
// לשמירה ואת התקרה של 250, ולכן היא ממשיכה לקבל גירעון שהמערכת הפסיקה לתת.
//
// הפונקציות נמשכות מ-`src/App.jsx` לפי מחרוזת ומורצות. **בלי רשת.**
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const lines = src.split("\n");
const line = (p) => { const h = lines.find((l) => l.startsWith(p)); if (!h) { console.log("✗ לא נמצאה בקוד השורה: " + p); process.exit(1); } return h; };
const grab = (from) => { const a = src.indexOf(from), b = src.indexOf("\n}\n", a); if (a < 0 || b < 0) { console.log("✗ לא נמצא בקוד: " + from); process.exit(1); } return src.slice(a, b) + "\n}\n"; };

const code = [
  line("const KCAL_PER_KG ="), line("const KCAL_FLOOR ="), line("const PROTEIN_PER_KG ="), line("const FAT_PER_KG ="),
  line("const ACTIVITY_FACTORS ="),
  grab("function bmrMifflinWoman("), grab("function dailyDeficit("), grab("function computeTargets("),
  grab("function effectiveProfile("), grab("function dropLowOverride("), grab("function stepsKcal("),
  "return { computeTargets, effectiveProfile, dropLowOverride, stepsKcal };",
].join("\n");
const A = new Function(code)();

let pass = 0, fail = 0;
const ck = (n, c, x) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x != null ? "  → " + x : "")); } };

const dana = { age: 52, heightCm: 165, weightKg: 75, weeklyRateG: 250, lossStopAt: null, calorieOverride: null };
console.log("\nהחלבון לפי המשקל האחרון\n");
const t = A.computeTargets(A.effectiveProfile(dana, 69));
ck("דנה, 69 ק\"ג: 110 גרם ולא 120", t.protein === 110, t.protein);
ck("**היעד הקלורי לא זז**", t.targetKcal === A.computeTargets(dana).targetKcal, t.targetKcal);
ck("בלי משקל ידוע: לפי משקל הרישום", A.computeTargets(A.effectiveProfile(dana, 0)).protein === 120);
const m = { ...dana, lossStopAt: "2026-10-01", weeklyRateG: 0 };
ck("בשמירה הכל לפי המשקל עכשיו, כמו קודם", A.computeTargets(A.effectiveProfile(m, 69)).targetKcal === A.computeTargets({ ...m, weightKg: 69 }).targetKcal);

console.log("\nיעד שקבעה לעצמה, במעבר לשמירה או ל-250\n");
const big = { ...dana, heightCm: 175, weightKg: 95, weeklyRateG: 500 };
const rec = (p, kg) => A.computeTargets(A.effectiveProfile(p, kg)).targetKcal;
let p = A.dropLowOverride({ ...big, weeklyRateG: 250, calorieOverride: 1300 }, 90);
ck("נמוך מהמומלץ החדש: נמחק", p.calorieOverride === null, p.calorieOverride);
const hi = rec({ ...big, weeklyRateG: 250 }, 90) + 200;
p = A.dropLowOverride({ ...big, weeklyRateG: 250, calorieOverride: hi }, 90);
ck("**גבוה מהמומלץ: נשאר**", p.calorieOverride === hi, p.calorieOverride);
p = A.dropLowOverride({ ...big, lossStopAt: "2026-10-01", weeklyRateG: 0, calorieOverride: 1300 }, 60);
ck("מעבר לשמירה, נמוך מתחזוקה: נמחק", p.calorieOverride === null, p.calorieOverride);
p = A.dropLowOverride({ ...big, weeklyRateG: 250, calorieOverride: null }, 90);
ck("בלי יעד משלה: שום דבר לא משתנה", p.calorieOverride === null && p.weeklyRateG === 250);

console.log("\nהחיבור באפליקציה\n");
ck("שני מסלולי הזנת המשקל עוברים דרכו", (src.match(/setProfile\(\(pr\) => dropLowOverride\(/g) || []).length === 2);
ck("**עריכת משקל בפרופיל: רק כשהיה מעבר**", src.includes("setProfile(moved ? dropLowOverride(next, nextCur) : next);"));
ck("היומן, הדוח, הצעדים והאימון לפי המשקל עכשיו",
  /<DayScreen[^>]*weightNow=\{curWeight\}/.test(src) && /<ReportScreen[^>]*weightKg=\{curWeight\}/.test(src)
  && /<StepsModal[^>]*weightKg=\{curWeight\}/.test(src) && src.includes("onAdd={addActivity} weightKg={curWeight} />"));
ck("הצעדים מ-70 ל-64 ק\"ג יורדים", A.stepsKcal(10000, 64) < A.stepsKcal(10000, 70));
ck("השורה במסך המעבר לשמירה, מילה במילה", src.includes(">היעד הקלורי היומי עודכן בהתאם למשקל שלך עכשיו.</div>"));

console.log(`\n${pass} עברו, ${fail} נכשלו\n`);
process.exit(fail ? 1 : 0);
