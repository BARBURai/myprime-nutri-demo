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

const grab = (from, to) => {
  const a = src.indexOf(from), b = src.indexOf(to, a);
  if (a < 0 || b < 0) { console.log("✗ לא נמצא בקוד: " + from); process.exit(1); }
  return src.slice(a, b);
};

const code = [
  line("const UNDERWEIGHT_BMI ="),
  line("const MIN_LOSS_BMI ="),
  line("const RESUME_LOSS_BMI ="),
  line("const FAST_LOSS_PCT ="),
  line("const FAST_LOSS_DAYS ="),
  "const pad2 = (n) => String(n).padStart(2, '0');",
  line("function parseDay("), line("function fmtDay("), line("function addDays("),
  line("function bmiOf("),
  line("function minHealthyKg("),
  line("function noLossRoom("),
  line("function resumeLossKg("),
  line("function canResumeLoss("),
  line("const RATE_OPTIONS ="), line("const FAST_RATE_ROOM_KG ="),
  grab("function rateOptionsFor(", "\n}\n") + "\n}\n",
  grab("function currentWeightOf(", "// ירידה מהירה מדי"),
  grab("function fastLossPct(", "\n}\n") + "\n}\n",
  "return { UNDERWEIGHT_BMI, MIN_LOSS_BMI, RESUME_LOSS_BMI, FAST_LOSS_PCT, FAST_RATE_ROOM_KG, bmiOf, minHealthyKg, noLossRoom, resumeLossKg, canResumeLoss, currentWeightOf, fastLossPct, rateOptionsFor, addDays };",
].join("\n");
const { UNDERWEIGHT_BMI, MIN_LOSS_BMI, RESUME_LOSS_BMI, FAST_RATE_ROOM_KG, bmiOf, minHealthyKg, noLossRoom, resumeLossKg, canResumeLoss, currentWeightOf, fastLossPct, rateOptionsFor, addDays } = new Function(code)();

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
check("הטווח הוא 35 עד 200, ומתחתיו כלל ה-BMI עושה את העבודה", /weightN >= 35 && weightN <= 200/.test(wOk), wOk.trim());
check("הוא כבר לא 50 עד 150, שחסם משתתפת אמיתית", !/>= 50/.test(wOk));
check("וההודעה אומרת את הטווח במקום להכריז שהמספר שגוי", src.includes("אפשר להזין משקל בין 35 ל-200 ק״ג") && !src.includes("יש להזין משקל תקין בק״ג"));

console.log("\nמסך היעד\n");
check("הדגל מחושב מהגובה ומהמשקל שהיא הזינה", src.includes("const noLoss = noLossRoom(weightN, heightN);"));
check("והקצב נכפה לשמירה, כך ש-250 שנבחר כברירת מחדל לא נשמר בטיוטה", src.includes("const rateEff = noLoss ? 0 : (rateChoices.indexOf(rate) === -1 ? 250 : rate);") && src.includes("weeklyRateG: rateEff") && src.includes("goalWeightKg: rateEff === 0 ? weightN"));
check("הקופי של רון, מילה במילה", src.includes("לפי הנתונים שלך אנו לא ממליצים על ירידה במשקל.") && src.includes("אם המספרים לא נכונים, אפשר לחזור אחורה ולתקן. ואם את רוצה לדבר איתנו על זה, אנא שלחי הודעה לצוות בוואטסאפ."));
check("ויש לה כפתור לצוות, ולא רק משפט", /noLoss \? \([\s\S]{0,1400}wa\.me\/972547304177/.test(src));
check("אפשרויות הקצב אינן מוצגות לה", /noLoss \? \([\s\S]{0,1800}\) : \(<>[\s\S]{0,400}rateChoices\.map/.test(src));
check("ונאמר לה ששאר התוכנית פתוחה", src.includes("כל שאר התוכנית פתוחה לך כרגיל"));
check("וגם גרף התחזית שטוח, ולא מצייר לה ירידה", src.includes("const proj = projection(weightN, rateEff === 0 ? weightN : goalEff, rateEff);"));

console.log("\nמה שלא נסגר בפניה\n");
check("המשקל הנוכחי בפרופיל אינו כבול לרף, כי הוא עובדה ולא יעד", /key: "weightKg"[^}]*min: 35,/.test(src));
check("היעד בפרופיל כן כבול לרף", /key: "goalWeightKg"[^}]*min: minHealthyKg\(profile\.heightCm\)/.test(src));
check("הזנת משקל יומית ממשיכה לקבל כל ערך סביר ורק מזהירה", src.includes("num >= 30 && num <= 400") && src.includes("bmiOf(num, heightCm) < UNDERWEIGHT_BMI"));

console.log("\nהקו השני: איך היא חוזרת, ולמה אין יו-יו\n");
check("החזרה היא ב-BMI 21 ולא באותו קו שממנו יצאה", RESUME_LOSS_BMI === 21 && RESUME_LOSS_BMI > MIN_LOSS_BMI);
// הפער הוא כל מנגנון ההגנה מפני תנודה, ולכן הוא חייב להיות גדול מתנודה יומית
let minGap = Infinity, gapWhere = "";
for (let h = 140; h <= 200; h++) { const g = resumeLossKg(h) - minHealthyKg(h); if (g < minGap) { minGap = g; gapWhere = h + " ס״מ"; } }
check("הפער בין הקווים לפחות 2 ק״ג בכל גובה, מעבר לתנודה יומית", minGap >= 2, "המינימום " + minGap + " ב-" + gapWhere);
check("בגובה 152 היא יוצאת ב-46.5 וחוזרת ב-49", near(minHealthyKg(152), 46.5) && near(resumeLossKg(152), 49));
check("בגובה 175 היא יוצאת ב-61.5 וחוזרת ב-64.5", near(minHealthyKg(175), 61.5) && near(resumeLossKg(175), 64.5));
// שני המצבים לא יכולים לחיות יחד באף נקודה, אחרת המסך היה סותר את עצמו
let overlap = 0;
for (let h = 140; h <= 200; h++) for (let w2 = 70; w2 <= 400; w2++) { const w = w2 / 2; if (noLossRoom(w, h) && canResumeLoss(w, h)) overlap++; }
check("אין אף נקודה שבה היא גם מתחת לקו וגם רשאית לחזור", overlap === 0, overlap + " נקודות");
check("בדיוק על הקו השני אפשר לחזור", canResumeLoss(49, 152) === true);
check("חצי קילו מתחתיו עדיין לא", canResumeLoss(48.5, 152) === false);
check("החזרה היא לחיצה שלה ולא חישוב שלנו", src.includes("const resumeLoss = () => setProfile(") && src.includes("חזרה לירידה במשקל"));
check("ולידה נכתבת שורת ההתייעצות שרון ביקש", src.includes("כדאי להתייעץ עם דיאטנית קלינית לפני שחוזרים."));
check("והמעבר לשמירה הוא היחיד שקורה לבד", src.includes('setSheet("lossStop")'));

console.log("\nהמשקל החי: הכלל קורא את מה שהיא דיווחה, לא את הרישום\n");
check("בלי דיווח נופלים חזרה למשקל הרישום", currentWeightOf({ weightKg: 72 }, []) === 72 && currentWeightOf({ weightKg: 72 }, null) === 72);
check("ועם דיווח נלקח האחרון", currentWeightOf({ weightKg: 72 }, [{ date: "2026-08-01", kg: 70 }, { date: "2026-08-15", kg: 66 }]) === 66);
check("הזנת משקל בדוח בודקת את הכלל", src.includes("if (!profile.lossStopAt && profile.weeklyRateG !== 0 && noLossRoom(cur, profile.heightCm))"));
check("והיא בודקת את המשקל העדכני ולא את מה שהוקלד, בגלל מילוי לאחור", src.includes("const cur = next[next.length - 1].kg;"));
check("היעד בשמירה מחושב מהמשקל האמיתי שלה עכשיו", src.includes("const effProfile = lossStopped ? { ...profile, weeklyRateG: 0, weightKg: curWeight } : profile;"));
check("והמסך מוצג פעם אחת, כי הדגל נשמר", src.includes("lossStopAt: date"));
check("מי שנרשמת כשאין לה לאן לרדת מסומנת כבר ברישום", src.includes("lossStopAt: noLoss ? startDate : null"));

console.log("\nשתי הדלתות בפרופיל\n");
check("עריכת המשקל בפרופיל עוברת דרך אותו כלל", src.includes('if (pendingWeight.key === "weightKg" && next.weeklyRateG !== 0 && noLossRoom(nextCur, profile.heightCm))'));
// אם יש לה דיווח מאוחר יותר בדוח הוא הקובע, אחרת עריכת נקודת הפתיחה כלפי מטה
// הייתה מעבירה אותה לשמירה ומיד מציעה לה לחזור.
check("והבדיקה היא על המשקל שיהיה הקובע, לא על מה שהוקלד", src.includes("const nextCur = latestIsBase ? pendingWeight.value : curWeight;") && src.includes("const latestIsBase = !weights.length || weights[weights.length - 1].date === profile.startDate;"));
check("ומציגה לה את אותו מסך", src.includes("setShowLossStop(true)"));
check("קצב הירידה בשמירה מציג שמירה בלבד", src.includes("{(inMaintain ? [0] : rateOptionsFor("));
// הבאג שרון תפס: הנעילה נשענה על "היא מתחת לקו עכשיו" ולא על "העברנו אותה
// לשמירה", ולכן בטווח שבין שני הקווים הרשימה נפתחה והיא יכלה לבחור 250 לבד.
check("והנעילה נשענת על המצב ולא על המשקל של הרגע", src.includes("const inMaintain = !!profile.lossStopAt;") && !/const noLoss = noLossRoom\(curWeight/.test(src));
check("שלושת המסכים בפרופיל שואלים את אותו דגל", (src.match(/inMaintain/g) || []).length >= 5);

console.log("\nהקצב, ולא רק המספר\n");
const wk = (n, kg) => ({ date: addDays("2026-08-21", -n), kg });
// 60 ק״ג שיורדת ל-57 בשלושה שבועות: קילו בשבוע, שהוא 1.67 אחוז
check("ירידה של קילו בשבוע על 60 ק״ג מדליקה", fastLossPct([wk(21, 60), wk(0, 57)], "2026-08-21") >= 1);
// אותה ירידה על 100 ק״ג היא 1 אחוז בדיוק, ולכן על הסף
check("אותה ירידה על 100 ק״ג היא בדיוק על הסף", Math.abs(fastLossPct([wk(21, 100), wk(0, 97)], "2026-08-21") - 1) < 0.01);
check("חצי קילו בשבוע על 80 ק״ג לא מדליקה", fastLossPct([wk(21, 80), wk(0, 78.5)], "2026-08-21") < 1);
check("עלייה במשקל לא מדליקה", fastLossPct([wk(21, 70), wk(0, 72)], "2026-08-21") === 0);
check("פחות משבועיים אינו קצב, כי השבוע הראשון יורד מנוזלים", fastLossPct([wk(10, 70), wk(0, 66)], "2026-08-21") === 0);
check("דיווח אחד בלבד אינו קצב", fastLossPct([wk(0, 66)], "2026-08-21") === 0);
check("ההתרעה לא חוזרת יותר מפעם בשלושה שבועות", src.includes("profile.fastLossAt > addDays(TODAY, -FAST_LOSS_DAYS)"));
check("והיא אינה חוסמת כלום", src.includes("function FastLossSheet(") && !src.includes("fastLossBlock"));

console.log("\nהקופי, מילה במילה\n");
check("שתי השורות של רון במסך המעבר לשמירה", src.includes("לפי הנתונים שלך אנו לא ממליצים על ירידה נוספת במשקל ללא התייעצות עם דיאטנית קלינית.") && src.includes("המערכת לא יכולה לתת ערכים של ירידה נוספת במשקל."));
check('ובלי "הורדה", שאינה עברית תקנית כאן', !src.includes("הורדה נוספת במשקל"));
check("ומסך הרישום נשאר בנוסח שלו, בלי נוספת", src.includes("לפי הנתונים שלך אנו לא ממליצים על ירידה במשקל."));
// במסך הרישום הכפתור נשאר, כי הקופי של רון שם אומר במפורש "שלחי הודעה לצוות".
check("במסך הרישום יש כפתור לצוות", /noLoss \? \([\s\S]{0,1400}wa\.me\/972547304177/.test(src));

console.log("\nמסך ההצעה לחזור, שסוגר את הפער בכיוון למעלה\n");
// בלי שורות ההערה, אחרת ההסבר בקוד ("ולא קולה של ענת") נתפס ככתוב על המסך
const noComments = (t) => t.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
const offer = noComments(src.slice(src.indexOf("function ResumeOfferSheet("), src.indexOf("function FastLossSheet(")));
check("הקופי, מילה במילה", offer.includes("אפשר לחזור לירידה במשקל") && offer.includes("לפי המשקל שהזנת, אפשר לחזור לירידה מתונה. הקצב המרבי מכאן הוא 250 גרם בשבוע.") && offer.includes("כדאי להתייעץ עם דיאטנית קלינית לפני שחוזרים."));
check("שני כפתורים, כי זו הצעה ולא אישור", offer.includes("חזרה לירידה במשקל") && offer.includes("לא עכשיו"));
check("בקול המערכת, בלי חתימה ובלי אמוג'י", !/ענת/.test(offer) && !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(offer));
check("נורה מהזנת משקל בדוח, ולא רק בפרופיל", src.includes("if (profile.lossStopAt && !profile.resumeOfferAt && canResumeLoss(cur, profile.heightCm))"));
check("ומוצג פעם אחת לכל עלייה", src.includes("setProfile((pr) => ({ ...pr, resumeOfferAt: date }));"));
check("ומתאפס בחצייה כלפי מטה, כדי שעלייה עתידית תציג אותו שוב", src.includes("lossStopEver: true, resumeOfferAt: null") && src.includes("next.resumeOfferAt = null;"));
check("והחזרה מנקה את שניהם", src.includes("lossStopAt: null, resumeOfferAt: null, weeklyRateG: 250"));

console.log("\nמסך הקצב המהיר: קול המערכת ולא קולה של ענת\n");
const fast = noComments(src.slice(src.indexOf("function FastLossSheet("), src.indexOf("function CheckinCheer(")));
check("הקופי של רון, מילה במילה", fast.includes("הקצב שלך מהיר מהמומלץ") && fast.includes("לפי המשקל שהזנת, הירידה בשבועות האחרונים מהירה מהקצב שאנחנו ממליצים עליו. ירידה מהירה יכולה לבוא על חשבון מסת השריר ולהקשות על השמירה בהמשך.") && fast.includes("כדאי להתייעץ עם דיאטנית קלינית."));
check("בלי חתימה של ענת", !/ענת/.test(fast));
check("בלי אמוג'י", !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(fast));
check("ובלי גוף ראשון", !/שמתי לב|אני |שלי\b/.test(fast));
check("כפתור אחד, בלי דרך מילוט שנייה", (fast.match(/<Btn |<a href=/g) || []).length === 1);

console.log("\nשום דבר לא עוזב את המכשיר שלה\n");
// רון ביקש תגית "אישרה BMI" במסך הניהול, נשאלה שאלת הפרטיות, והוא ויתר עליה:
// מי שרואה תגית כזאת יודע שה-BMI שלה מתחת ל-20, ומסכי ההסכמה אינם מכסים את זה.
const usage = readFileSync(new URL("../api/usage.js", import.meta.url), "utf8");
const admin = readFileSync(new URL("../api/admin.js", import.meta.url), "utf8");
const adminHtml = readFileSync(new URL("../public/admin.html", import.meta.url), "utf8");
check("שרת השימוש אינו יודע מה זה משקל או גובה", !/weightKg|heightCm|\bkg\b/i.test(usage));
check("ואינו יודע דבר על כלל ה-BMI", !/bmi/i.test(usage));
check("מסך הניהול אינו קורא ואינו מציג שום דבר מזה", !/bmi/i.test(admin) && !/bmiAck|אישרה BMI/.test(adminHtml));
check("והאפליקציה אינה שולחת את האישור לשום מקום", !/bmiAck/.test(src));
check("היא לא שולחת את מצב השמירה עצמו", !/body:[^;]*lossStopAt/.test(src));

console.log("\nמסך המעבר: כפתור אחד, והאישור נשמר אצלה\n");
check("ההמלצה על הדיאטנית היא טקסט ולא כפתור", src.includes("אנחנו ממליצים לך ליצור קשר עם הדיאטנית לקבלת הנחיות.") && !/LossStopSheet[\s\S]{0,1200}wa\.me/.test(src));
check("ומעל הכפתור כתוב שהלחיצה היא אישור", src.includes('בלחיצה על "הבנתי" את מאשרת שקראת את ההודעה הזאת.'));
check("יש בו כפתור אחד בלבד", (src.slice(src.indexOf("function LossStopSheet("), src.indexOf("function ResumeOfferSheet(")).match(/<Btn |<a href=/g) || []).length === 1);
check("הלחיצה נרשמת גם אצלה, כדי שלא תלוי ברשת", src.includes("lossAckAt: TODAY"));
check("והאישור נשאר אצלה בלבד", src.includes("setProfile((pr) => ({ ...pr, lossAckAt: TODAY }));"));

console.log("\nשורת משקל היעד\n");
check("אינה מוצגת למי שבשמירה, כי אין לה יעד", src.includes('{!inMaintain && <EditRow label="משקל יעד"'));

console.log("\nאילו קצבים מוצעים לה\n");
const opts = (w, h, ever) => JSON.stringify(rateOptionsFor(w, h, ever));
check("500 מוצע רק כשיש לה חמישה קילו עד הקו", FAST_RATE_ROOM_KG === 5);
check("בגובה 155, ב-53.5 ק״ג היא מקבלת גם 500", opts(53.5, 155, false) === "[0,250,500]");
check("וב-53 כבר לא, כי הקצב הזה היה מביא אותה לקו לפני סוף התוכנית", opts(53, 155, false) === "[0,250]");
check("מי שכבר ירדה מתחת לקו פעם אחת נשארת על 250, בכל משקל", opts(80, 155, true) === "[0,250]" && opts(60, 175, true) === "[0,250]");
check("ושמירה תמיד מוצעת", [ [44,155], [60,155], [90,175] ].every((c) => rateOptionsFor(c[0], c[1], false).indexOf(0) === 0));
check("הרשימה נגזרת מ-RATE_OPTIONS ואינה מועתקת", src.includes("RATE_OPTIONS.filter((g) => g !== 500 || fastOk)"));
check("הסימון שנשאר לתמיד נכתב בכל שלוש נקודות החצייה", (src.match(/lossStopEver/g) || []).length >= 4);
check("והפרופיל שואל אותו", src.includes("rateOptionsFor(curWeight != null ? curWeight : profile.weightKg, profile.heightCm, !!profile.lossStopEver)"));
check("ברישום, בחירה שנעלמה מתחתיה אינה נשמרת בטיוטה", src.includes("rateChoices.indexOf(rate) === -1 ? 250 : rate"));

console.log("\nשני באגים שרון תפס בבדיקה\n");
check("עריכת המשקל בפרופיל מזיזה גם את נקודת הפתיחה", src.includes("if (pendingWeight.key === \"weightKg\" && onBaseWeight) onBaseWeight(pendingWeight.value);") && src.includes("const setBaseWeight = (kg) => setWeights("));
check("וכל דיווח שהיא עשתה מאז נשאר במקומו", src.includes("const rest = (w || []).filter((x) => x.date !== start);"));
check("האזהרה על קצב מהיר אינה מוצגת למי שבשמירה", src.includes("{targets.floored && rateEff !== 0 && ("));

console.log("\nהטווח שבין שני הקווים, וזה מה שנשבר\n");
// בגובה 155: הקו התחתון 48.5, הקו לחזרה 50.5. ב-50 היא בין שניהם.
check("ב-50 ק״ג בגובה 155 היא כבר לא מתחת לקו", noLossRoom(50, 155) === false);
check("ועדיין לא רשאית לחזור", canResumeLoss(50, 155) === false);
check("ולכן המסכים חייבים להישאר נעולים, כי הם נשענים על lossStopAt", src.includes("const inMaintain = !!profile.lossStopAt;"));
check("והחזרה נבדקת מול הקו השני ולא מול הראשון", src.includes("canResume = inMaintain && canResumeLoss("));

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.\n");
process.exit(fail ? 1 : 0);
