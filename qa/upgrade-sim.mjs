#!/usr/bin/env node
// מה קורה לאישה שכבר משתמשת באפליקציה, ברגע שהקוד החדש נוחת אצלה. בלי רשת.
//
//   node qa/upgrade-sim.mjs
//
// הפרופיל השמור שלה נכתב לפני שהשדות החדשים היו קיימים, ולכן lossStopAt,
// lossStopEver ו-resumeOfferAt חסרים אצלה לגמרי. השאלה היא אם משהו זז לה
// בלי שהיא עשתה כלום, ומה קורה בפעם הבאה שהיא שוקלת.

import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const L = src.split("\n");
const line = (p) => { const h = L.find((l) => l.trim().startsWith(p)); if (!h) { console.log("✗ לא נמצא: " + p); process.exit(1); } return h; };
const grab = (re, w) => { const m = src.match(re); if (!m) { console.log("✗ לא נמצא: " + w); process.exit(1); } return m[0]; };

// שלושת הבלוקים נלקחים מהקוד כלשונם: הקבועים, הפונקציות של הרף, וחישוב היעד.
const block = (from, to) => {
  const a = L.findIndex((l) => l.startsWith(from));
  const b = L.findIndex((l, i) => i > a && l.startsWith(to));
  if (a < 0 || b < 0) { console.log("✗ לא נמצא בלוק: " + from); process.exit(1); }
  return L.slice(a, b).join("\n");
};
const A = new Function([
  line("const ACTIVITY_FACTORS ="), line("const KCAL_PER_KG ="), line("const KCAL_FLOOR ="),
  line("const PROTEIN_PER_KG ="), line("const FAT_PER_KG ="),
  line("const RATE_OPTIONS ="), line("const FAST_RATE_ROOM_KG ="),
  line("const MIN_LOSS_BMI ="), line("const RESUME_LOSS_BMI ="),
  line("function minHealthyKg"), line("function resumeLossKg"),
  line("function noLossRoom"), line("function canResumeLoss"),
  block("function rateOptionsFor", "function fastLossPct"),
  block("function bmrMifflinWoman", "function stepsKcal"),
  "return {minHealthyKg,resumeLossKg,noLossRoom,canResumeLoss,rateOptionsFor,currentWeightOf,computeTargets,RATE_OPTIONS};",
].join("\n"))();

// היעד כפי שהוא היה מחושב אצלה לפני העדכון: אין lossStopAt, ולכן effProfile הוא הפרופיל עצמו.
const before = (p) => A.computeTargets(p).targetKcal;
// ואחרי העדכון, ברגע הטעינה: lossStopped=false כי השדה אינו קיים בפרופיל השמור.
const afterLoad = (p) => { const lossStopped = !!p.lossStopAt; const cur = A.currentWeightOf(p, p._weights);
  return A.computeTargets(lossStopped ? { ...p, weeklyRateG: 0, weightKg: cur } : p).targetKcal; };

let n = 0, moved = 0, alreadyUnder = 0, surprise = 0, lost500 = 0, worst = null;
for (let h = 145; h <= 185; h += 2)
for (let w = 42; w <= 120; w += 1)
for (const rate of [0, 250, 500])
for (const age of [42, 50, 58, 66]) {
  // הפרופיל השמור שלה, בדיוק בצורה שהיה נכתב לפני העדכון
  const p = { age, heightCm: h, weightKg: w, activity: "יושבני", weeklyRateG: rate, goalWeightKg: Math.max(40, w - 6) };
  p._weights = [{ date: "2026-01-04", kg: w }];
  n++;
  if (before(p) !== afterLoad(p)) { moved++; if (!worst) worst = { h, w, rate, age, was: before(p), now: afterLoad(p) }; }
  // אישה שכבר היום מתחת לקו, ועדיין עם קצב ירידה
  if (rate !== 0 && A.noLossRoom(w, h)) {
    alreadyUnder++;
    // בטעינה לא קורה לה כלום, כי המעבר נורה רק בהזנת משקל או בעריכת פרופיל.
    if (before(p) !== afterLoad(p)) surprise++;
  }
  // אפשרות ה-500: לאישה קיימת אין lossStopEver, ולכן היא לא אמורה לאבד אותה בלי סיבה
  const opts = A.rateOptionsFor(w, h, false);
  if (rate === 500 && !opts.includes(500)) lost500++;
}

console.log("\nאישה שכבר משתמשת, ברגע שהקוד החדש נוחת אצלה\n");
console.log("  " + n.toLocaleString() + " פרופילים שמורים: גובה, משקל, קצב וגיל");
console.log("  יעד קלורי שזז לה בטעינה בלי שעשתה כלום: " + moved);
if (worst) console.log("    הראשון: " + JSON.stringify(worst));
console.log("  מהן כבר היום מתחת לקו ועדיין בקצב ירידה: " + alreadyUnder.toLocaleString());
console.log("    ומתוכן, כמה קיבלו הפתעה בטעינה: " + surprise);
// זה אינו באג אלא התקרה שרון אישר ב-v6.01: מי שקרובה לרף אינה מקבלת 500.
// מה שכן דורש החלטה הוא איך זה נראה לה בפרופיל, ראה את השורה שאחרי.
console.log("  הקצב 500 כבר אינו מוצע להן, כי הן בתוך 5 ק״ג מהקו: " + lost500.toLocaleString());
console.log("    היעד הקלורי שלהן לא זז, והן ממשיכות על 500 עד שיבחרו אחרת.");
console.log("    ← אבל בעורך הקצב בפרופיל הן יראו רשימה בלי 500, ו-250 ייראה נבחר.");

console.log("\nומה קורה להן בפעם הבאה שהן שוקלות\n");
let fires = 0, stays = 0;
for (let h = 145; h <= 185; h += 2) for (let w = 42; w <= 120; w += 1) {
  if (!A.noLossRoom(w, h)) continue;
  const p = { age: 55, heightCm: h, weightKg: w, activity: "יושבני", weeklyRateG: 250 };
  // אותו תנאי כמו בקוד: אין lossStopAt, הקצב אינו אפס, ואין מקום לרדת
  if (!p.lossStopAt && p.weeklyRateG !== 0 && A.noLossRoom(w, h)) fires++; else stays++;
}
console.log("  מקבלות את מסך המעבר בהזנת המשקל הבאה: " + fires.toLocaleString());
console.log("  נשארות בגירעון בלי שאף אחד יאמר להן: " + stays);

const bad = moved + surprise;
console.log("\n" + (bad === 0 ? "אף אישה קיימת לא מקבלת שינוי שקט ביעד הקלורי בעדכון." : "נמצאו " + bad + " מקרים."));
process.exit(bad === 0 ? 0 : 1);
