// ההכרעה על שני המוצרים, במקום אחד לשער ולמסך הניהול גם יחד.
//
// **למה זה קובץ משותף ולא שני עותקים:** ב-v6.77 השער ומסך הניהול בחרו שורה אחרת
// מאותו גיליון, ולכן המסך הציג מחזור אחד והאפליקציה נתנה אחר, **ואף מסך לא אמר
// שיש בעיה.** מרגע שיש שני מוצרים ההזדמנות לאותה תקלה גדולה בהרבה, ולכן הכלל
// יושב כאן והשניים קוראים אותו.
//
// קובץ שמתחיל בקו תחתון אינו נספר כפונקציה בוורסל. ראה v5.21.

// סוף חלון 360: 70 יום ועוד N חודשים מתאריך ההתחלה, כולל היום האחרון.
// סולו הוא שימוש באפליקציה בלבד, בלי ליווי ובלי קבוצה, ושם החלון נמדד מתאריך
// ההתחלה ולמשך שישה חודשים או שנה, **בלי 70 הימים ובלי חודשי גישה נוספים.**
export function end360(startSunday, extraMonths, solo) {
  if (!startSunday) return null;
  const exp = new Date(startSunday.getTime());
  if (solo === 6 || solo === 12) {
    exp.setUTCMonth(exp.getUTCMonth() + solo);
  } else {
    const months = (Number.isFinite(extraMonths) && extraMonths > 0) ? Math.floor(extraMonths) : 3;
    exp.setUTCDate(exp.getUTCDate() + 70);
    exp.setUTCMonth(exp.getUTCMonth() + months);
  }
  return exp;
}

// סוף חלון הקורס. **הוא נמדד מהיום הראשון שהיא נכנסה לקורס ולא מתאריך קנייה**,
// כי תאריך קנייה אינו קיים אצלנו בשום מקום. ברירת המחדל 12 חודשים, ו-GLOW-FULL-M
// גוברת עליה.
export function endGlow(glowStartYmd, months) {
  const p = String(glowStartYmd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!p) return null;
  const m = (Number.isFinite(months) && months > 0) ? Math.floor(months) : 12;
  const exp = new Date(Date.UTC(+p[1], +p[2] - 1, +p[3]));
  exp.setUTCMonth(exp.getUTCMonth() + m);
  return exp;
}

function ymdOf(dt) { return dt ? dt.toISOString().slice(0, 10) : ""; }

// ============================================================================
// שני מוצרים, שתי שאלות, והמסך נגזר מהן.
//
// עד 15 בספטמבר 2026 נשאלה שאלה אחת, "יש לה תאריך התחלה?", והמוצר הוסק ממנה.
// **זה היה נכון רק כל עוד אף אחת עוד לא סיימה 360**, כי התאריך נשאר בגיליון
// לנצח. מי שסיימה וקנתה את קורס האיפור נחסמה מקורס ששילמה עליו, וכך גם מי
// שביטלה ומי שבהקפאה.
// ============================================================================
export function decideAccess(f) {
  const today = String(f.today || "");
  const startSunday = f.startSunday || null;
  const has360 = !!startSunday;

  // הקפאה שלא ניתנת לפתרון, בלי תאריך חזרה או בלי שבוע, מחזיקה אותה בחוץ ולא
  // מכניסה אותה לשבוע שאף אחד לא בחר לה.
  const fr = f.freeze || null;
  const frozenNow = !!(fr && (!fr.back || !fr.week || today < fr.back));
  // ביטול בגיליון וביטול בתהליך מהמשרד מסיימים את 360 באותה צורה בדיוק.
  const stopped360 = !!f.cancelled || !!f.clerkBlocked;

  const end360At = end360(startSunday, f.extraMonths, f.solo);
  const expired360 = f.clerkUntil
    ? today > f.clerkUntil
    : !!(end360At && today > ymdOf(end360At));
  const open360 = has360 && !stopped360 && !frozenNow && !expired360;

  // **הקורס שנקנה בכסף שורד את סיום 360; הקורס שניתן במתנה בוובינר נגמר איתו.**
  // החלטת רון מ-v7.03 נשמרת כאן במלואה. ומי שמעולם לא הייתה ב-360 היא קונה מעצם
  // העובדה שאין לה מחזור, גם זה כמו ב-v7.03.
  //
  // **וכדי לשלול קורס בתשלום מורידים את GLOW-FULL.** ביטול של 360 אינו הלֶוֶר לזה,
  // כי הוא מדבר על מוצר אחר.
  const glowOwned = !!f.glowFull && (!has360 || !!f.glowPaid);
  // ביטול אצל מי שמעולם לא הייתה ב-360 יכול לדבר רק על הקורס עצמו, כי אין לה שום
  // מוצר אחר לבטל, ולכן שם הוא סוגר גם אותו.
  const glowStopped = !has360 && stopped360;
  const glowStandalone = glowOwned && !glowStopped && !open360;

  const endGlowAt = endGlow(f.glowStart, f.glowMonths);
  // הארכה ידנית מהמשרד גוברת על חלון הקורס **רק אצל מי שאין לה 360 בכלל**, כי שם
  // היא ברורה עליו; אצל מי שסיימה 360 ההארכה מדברת על התוכנית ואסור לה לקחת קורס
  // בתשלום. ותקלה אצלנו לעולם אינה סוגרת חלון: בלי glowStart הוא פתוח.
  const glowPast = (!has360 && f.clerkUntil)
    ? today > f.clerkUntil
    : !!(endGlowAt && today > ymdOf(endGlowAt));
  const glowOnly = glowStandalone && !glowPast;
  const glowOpen = glowOwned && !glowStopped && (open360 || glowOnly);

  // אישה רשומה שעדיין לא שובצה למחזור: אין לה 360 ואין לה מה לפוג, והיא נכנסת
  // כמו תמיד ומקבלת את מסכי ההרשמה וההמתנה. **זה המצב היחיד שבו אין מוצר פתוח
  // ובכל זאת אין מה לחסום.** `expired360` נכלל כי הוא נושא גם הארכה ידנית
  // שנגמרה, ו-`glowOwned` כי מי שיש לה קורס אינה ממתינה למחזור אלא קונה שהחלון
  // שלה נגמר.
  const waiting360 = !has360 && !stopped360 && !frozenNow && !expired360 && !glowOwned;

  // **חוסמים רק כששני המוצרים סגורים**, וההודעה היא של הסיבה שסגרה את 360, כדי
  // שהיא תראה את המסכים שכבר קיימים ולא נוסח שני לאותו דבר.
  const allowed = open360 || glowOnly || waiting360;
  let reason = "ok";
  if (!allowed) reason = stopped360 ? "cancelled" : frozenNow ? "frozen" : "expired";

  return {
    has360, open360, stopped360, frozenNow, expired360, waiting360,
    glowOwned, glowStopped, glowStandalone, glowPast, glowOnly, glowOpen,
    // מתנה מול קנייה, כפי שהמשרד צריך לראות את זה.
    glowSource: !f.glowFull ? "" : (!has360 ? "solo" : (f.glowPaid ? "paid" : "gift")),
    end360: ymdOf(end360At),
    endGlow: ymdOf(endGlowAt),
    allowed, reason,
    product: glowOnly ? "glow" : "360",
  };
}
