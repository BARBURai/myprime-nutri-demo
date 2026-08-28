// הגביע השבועי. בלי רשת ובלי עלות.
//
//   node qa/trophy-check.mjs
//
// נכתבה אחרי דיווח של הילה, 22 באוגוסט 2026: "לא ביצעתי את אימון הכוח ביום חמישי,
// ביצעתי אותו ביום שישי וסימנתי אותו כאילו ביצעתי ביום חמישי. למרות שקיבלתי מדליה
// על כל הימים לא קיבלתי גביע. ואז אחרי שלחצתי על אימון הכוח גם ביום שישי פתאום
// הופיע הגביע." הבדיקה מריצה את הכלל האמיתי על המסלול שלה, כדי שהתשובה אליה תהיה
// עובדה ולא הסבר.
//
// weekTrophyEarned נמשכת מ-src/App.jsx לפי מחרוזת ואינה מועתקת.

import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  ← " + extra : "")); }
};

const grab = (re, label) => {
  const m = src.match(re);
  if (!m) { console.log("  ✗ " + label + " לא נמצאה ב-App.jsx"); process.exit(1); }
  return m[0];
};
const helpers =
  grab(/function pad2\([^\n]*\n/, "pad2") + "\n" +
  grab(/function fmtDay\([\s\S]*?\n\}/, "fmtDay") + "\n" +
  grab(/function parseDay\(dateStr\)[^\n]*\n/, "parseDay") + "\n" +
  grab(/function addDays\(dateStr, n\)[^\n]*\n/, "addDays") + "\n" +
  grab(/function weekTrophyEarned\(checkins, startDate, w, today\) \{[\s\S]*?\n\}/, "weekTrophyEarned");
const weekTrophyEarned = new Function(helpers + "; return weekTrophyEarned;")();

// מחזור מתחיל תמיד ביום ראשון. 2026-08-16 הוא יום ראשון, ולכן שבוע 2 הוא 23 עד 29.
const START = "2026-08-16";
const d = (n) => { const t = new Date(Date.UTC(2026, 7, 16)); t.setUTCDate(t.getUTCDate() + n - 1); return t.toISOString().slice(0, 10); };
const W2 = [8, 9, 10, 11, 12, 13, 14];   // ראשון עד שבת של שבוע 2
const done = (days) => { const c = {}; days.forEach((n) => { c[d(n)] = { _done: true }; }); return c; };

console.log("\nהגביע השבועי, ומה שהילה תיארה");

check("יום ראשון של שבוע 2 הוא ה-23 בחודש", d(8) === "2026-08-23");
check("ויום שישי הוא ה-28", d(13) === "2026-08-28");

// כל ששת ימי החול סגורים, ביום שישי. שבת אינה נדרשת.
check("שישה ימים סגורים ביום שישי מזכים בגביע",
  weekTrophyEarned(done([8, 9, 10, 11, 12, 13]), START, 2, d(13)) === true);
check("ושבת אינה נדרשת גם בסוף השבוע",
  weekTrophyEarned(done([8, 9, 10, 11, 12, 13]), START, 2, d(14)) === true);

// זה בדיוק המסלול שלה: חמישי לא היה סגור, והיא סגרה אותו ביום שישי.
const beforeMakeup = done([8, 9, 10, 11, 13]);          // חמישי (12) חסר
check("בלי יום חמישי אין גביע", weekTrophyEarned(beforeMakeup, START, 2, d(13)) === false);
const afterMakeup = done([8, 9, 10, 11, 12, 13]);
check("ברגע שחמישי נסגר, הגביע מגיע באותו יום שישי",
  weekTrophyEarned(afterMakeup, START, 2, d(13)) === true);

// והנקודה שמסבירה למה אצלה הוא לא הגיע מיד: יום שישי עצמו חייב להיות סגור.
const fridayOpen = done([8, 9, 10, 11, 12]);            // שישי (13) עדיין פתוח
check("חמישי הושלם אבל שישי עוד פתוח - אין גביע",
  weekTrophyEarned(fridayOpen, START, 2, d(13)) === false);
check("וברגע ששישי נסגר, הגביע מופיע",
  weekTrophyEarned(done([8, 9, 10, 11, 12, 13]), START, 2, d(13)) === true);

// יום אחד חסר מבטל את הגביע של כל השבוע. זו החלטת מוצר ולא תקלה, וכאן היא נעולה
// כדי שאם רון ישנה אותה, השינוי יהיה מפורש.
for (const miss of [8, 9, 10, 11, 12, 13]) {
  const days = [8, 9, 10, 11, 12, 13].filter((n) => n !== miss);
  check("יום " + (miss - 7) + " חסר מבטל את הגביע", weekTrophyEarned(done(days), START, 2, d(13)) === false);
}

// לפני יום שישי אין גביע גם כשכל מה שעבר סגור, כי השבוע עוד לא נגמר.
check("ביום חמישי עוד אין גביע גם כשהכל סגור",
  weekTrophyEarned(done([8, 9, 10, 11, 12]), START, 2, d(12)) === false);

// שבוע 1: היומן נפתח ביום 3, ולכן נדרשים ימים 3 עד 6 בלבד.
check("בשבוע 1 נדרשים ארבעה ימים בלבד, מיום 3",
  weekTrophyEarned(done([3, 4, 5, 6]), START, 1, d(6)) === true);
check("ובשבוע 1 יום 3 חסר מבטל אותו",
  weekTrophyEarned(done([4, 5, 6]), START, 1, d(6)) === false);
check("ויום 1 ויום 2 אינם נדרשים",
  weekTrophyEarned(done([3, 4, 5, 6]), START, 1, d(6)) === true);

// שבוע ריק לגמרי אינו מזכה, גם כשעברה כל התקופה.
check("שבוע בלי אף יום סגור אינו מזכה", weekTrophyEarned({}, START, 2, d(14)) === false);


// ─────────────────────────────────────────────────────────────────────────────
// סימולציה של הרצף עצמו, ולא של הכלל לבדו. זה מה שרון ביקש: לקרוא בדיוק את
// התהליך שהילה תיארה ולהריץ אותו, עם הפונקציות האמיתיות של האפליקציה.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nהרצף שהילה תיארה, מריצים אותו");

const sim =
  grab(/function pad2\([^\n]*\n/, "pad2") + "\n" +
  grab(/function fmtDay\([\s\S]*?\n\}/, "fmtDay") + "\n" +
  grab(/function parseDay\(dateStr\)[^\n]*\n/, "parseDay") + "\n" +
  grab(/function addDays\(dateStr, n\)[^\n]*\n/, "addDays") + "\n" +
  grab(/function dowOf\(dateStr\)[^\n]*\n/, "dowOf") + "\n" +
  grab(/function waterMlOf\(v\)[^\n]*\n/, "waterMlOf") + "\n" +
  grab(/function programWeekFor\(startDate, onDate\) \{[\s\S]*?\n\}/, "programWeekFor") + "\n" +
  grab(/function programDayNumber\(startDate, onDate\) \{[\s\S]*?\n\}/, "programDayNumber") + "\n" +
  grab(/function unlockedOn\(startDate, onDate, u\) \{[\s\S]*?\n\}/, "unlockedOn") + "\n" +
  grab(/function autoStatusFor\(date, stepsByDate[\s\S]*?\n\}/, "autoStatusFor") + "\n" +
  grab(/function taskDone\(task, answers, auto\) \{[\s\S]*?\n\}/, "taskDone") + "\n" +
  grab(/function tasksForDate\(startDate, date, keepShabbat, fasting\) \{[\s\S]*?\n\}/, "tasksForDate") + "\n" +
  grab(/function dayComplete\(startDate, date, keepShabbat[\s\S]*?\n\}/, "dayComplete") + "\n" +
  grab(/function weekTrophyEarned\(checkins, startDate, w, today\) \{[\s\S]*?\n\}/, "weekTrophyEarned") + "\n" +
  grab(/function missingForWeek\(week, startDate, today[\s\S]*?\n\}/, "missingForWeek") + "\n" +
  grab(/function weekTrophyLevel\(checkins, startDate, w, today\) \{[\s\S]*?\n\}/, "weekTrophyLevel");

const { activeTasks } = await import("../src/checkins.js");
const api = new Function("activeTasks",
  "const TRACKER_ENABLED = true; const DEFAULT_CUP_ML = 250; const CHECKIN_UNLOCK = { week: 1, day: 3 };" +
  sim + "; return { tasksForDate, dayComplete, weekTrophyEarned, programDayNumber, taskDone, autoStatusFor, missingForWeek, weekTrophyLevel };")(activeTasks);

const TARGETS = { protein: 100 };
// אישה בשבוע 2 שממלאת הכל: צעדים, מים, יומן, ובכל משימה ידנית מסמנת.
function seedWeek(missStrengthOn) {
  const checkins = {}, stepsByDate = {}, waterByDate = {}, log = [], activityLog = [];
  for (let n = 8; n <= 13; n++) {
    const date = d(n);
    stepsByDate[date] = 8000;
    waterByDate[date] = 2000;
    log.push({ date, kcal: 500, p: 120 });           // יומן מלא, וחלבון מעל היעד
    const ans = {};
    for (const t of api.tasksForDate(START, date, false)) {
      if (t.auto) continue;                           // צעדים, מים, יומן וחלבון מגיעים מהנתונים
      if (t.id === "strength" && date === missStrengthOn) continue;   // זה מה שהיא פספסה
      ans[t.id] = t.type === "number" ? 3 : true;
    }
    checkins[date] = ans;
  }
  return { checkins, stepsByDate, waterByDate, log, activityLog };
}
// ההשפעה שסוגרת ימים, בדיוק כמו ב-App.jsx: כל יום שהושלם מקבל _done.
function closeDays(st, today) {
  const total = api.programDayNumber(START, today);
  for (let n = 1; n <= total; n++) {
    const date = d(n);
    if (api.dayComplete(START, date, false, st.checkins, st.stepsByDate, st.waterByDate, st.log, TARGETS, 250, st.activityLog)
        && !(st.checkins[date] && st.checkins[date]._done)) {
      st.checkins[date] = { ...(st.checkins[date] || {}), _done: true };
    }
  }
  return st;
}

const THU = d(12), FRI = d(13);
check("חמישי של שבוע 2 הוא יום 12 בתוכנית", THU === "2026-08-27");
// יום חמישי הוא אחד משלושת ימי אימון הכוח, ראשון שלישי וחמישי.
check("ליום חמישי יש משימת אימון כוח",
  api.tasksForDate(START, THU, false).some((t) => t.id === "strength"));
check("וליום שישי אין משימת אימון כוח",
  !api.tasksForDate(START, FRI, false).some((t) => t.id === "strength"));

// שלב 1: יום שישי, היא מילאה הכל, ובחמישי חסר רק אימון הכוח.
let st = closeDays(seedWeek(THU), FRI);
check("חמישי אינו סגור, כי חסר בו אימון הכוח", !(st.checkins[THU] && st.checkins[THU]._done));
check("שישי כן סגור", !!(st.checkins[FRI] && st.checkins[FRI]._done));
check("ואין גביע", api.weekTrophyEarned(st.checkins, START, 2, FRI) === false);

// שלב 2: היא לוחצת על שורת ההשלמה ביום שישי, וזה מסמן את אימון הכוח של חמישי.
st.checkins[THU] = { ...st.checkins[THU], strength: true };
st = closeDays(st, FRI);
check("אחרי ההשלמה חמישי נסגר", !!(st.checkins[THU] && st.checkins[THU]._done));
// זו השאלה עצמה: האם הגביע מגיע באותו רגע, או רק אחרי פעולה נוספת.
const trophyAfterMakeup = api.weekTrophyEarned(st.checkins, START, 2, FRI);
check("והגביע מגיע באותו רגע, בלי שום לחיצה נוספת", trophyAfterMakeup === true,
  trophyAfterMakeup ? "" : "הגביע לא הגיע - יש כאן באג");

// שלב 3, לוודא שזה לא במקרה: אותו רצף כשגם שישי עצמו עדיין פתוח.
let st2 = seedWeek(THU);
delete st2.checkins[FRI].veg;                      // שישי חסר משימה אחת
st2 = closeDays(st2, FRI);
check("כששישי פתוח, ההשלמה של חמישי לבדה אינה מספיקה",
  api.weekTrophyEarned(st2.checkins, START, 2, FRI) === false);
st2.checkins[THU] = { ...st2.checkins[THU], strength: true };
st2.checkins[FRI] = { ...st2.checkins[FRI], veg: 3 };
st2 = closeDays(st2, FRI);
check("וברגע ששישי הושלם, הגביע מגיע",
  api.weekTrophyEarned(st2.checkins, START, 2, FRI) === true);


// ─────────────────────────────────────────────────────────────────────────────
// שאלת רון: האם שורת ההשלמה לאחור משבשת את חישוב המדליה של היום שבו לחצו עליה,
// והאם היום שהושלם לאחור באמת נחשב כהושלם.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nשורת ההשלמה לאחור, ומה היא נוגעת בו");

// 1. השורה כותבת ליום הקודם ולעולם לא ליום שבו לוחצים עליה.
check("ההשלמה נכתבת ליום הקודם בלבד",
  /setPrevValue=\{\(id, v\) => setCheckinValue\(addDays\(selectedDate, -1\), id, v\)\}/.test(src));
// 2. השורה מרונדרת בנפרד ואינה חלק מרשימת המשימות של היום.
check("השורה מרונדרת בנפרד ואינה משימה של היום",
  /\{g\.id === "move" && showMakeup && \(/.test(src));
check("ומצב הפתיחה שלה נקרא פעם אחת ואינו חי",
  /const \[showMakeup\] = useState\(\(\) =>/.test(src));

// 3. ליום שישי אין משימת אימון כוח, ולכן אין דרך שהשורה תיכנס לספירה שלו.
const fridayTasks = api.tasksForDate(START, FRI, false).filter((t) => !t.optional);
check("ברשימת המשימות של שישי אין אימון כוח", !fridayTasks.some((t) => t.id === "strength"));

// 4. המבחן עצמו: לסמן ולבטל את אימון הכוח של חמישי, ולראות שיום שישי לא זז.
{
  const st = closeDays(seedWeek(THU), FRI);
  const friBefore = api.dayComplete(START, FRI, false, st.checkins, st.stepsByDate, st.waterByDate, st.log, TARGETS, 250, st.activityLog);
  st.checkins[THU] = { ...st.checkins[THU], strength: true };
  const friAfter = api.dayComplete(START, FRI, false, st.checkins, st.stepsByDate, st.waterByDate, st.log, TARGETS, 250, st.activityLog);
  delete st.checkins[THU].strength;
  const friUndone = api.dayComplete(START, FRI, false, st.checkins, st.stepsByDate, st.waterByDate, st.log, TARGETS, 250, st.activityLog);
  check("המדליה של שישי אינה מושפעת מההשלמה", friBefore === true && friAfter === true && friUndone === true,
    `לפני ${friBefore} · אחרי ${friAfter} · אחרי ביטול ${friUndone}`);
  check("ומספר המשימות של שישי אינו משתנה",
    api.tasksForDate(START, FRI, false).filter((t) => !t.optional).length === fridayTasks.length);
}

// 5. והכיוון השני: היום שהושלם לאחור באמת נחשב כהושלם, ורק בגלל הסימון הזה.
{
  const st = seedWeek(THU);
  const thuBefore = api.dayComplete(START, THU, false, st.checkins, st.stepsByDate, st.waterByDate, st.log, TARGETS, 250, st.activityLog);
  st.checkins[THU] = { ...st.checkins[THU], strength: true };
  const thuAfter = api.dayComplete(START, THU, false, st.checkins, st.stepsByDate, st.waterByDate, st.log, TARGETS, 250, st.activityLog);
  check("חמישי אינו סגור לפני ההשלמה", thuBefore === false);
  check("וסגור אחריה", thuAfter === true);
  // ומה שנשאר אחרי הסימון הוא בדיוק אפס משימות חסרות, כלומר ההודעה שהיא רואה נכונה.
  const st2 = closeDays(st, FRI);
  check("ומהרגע הזה הוא נספר גם לגביע",
    api.weekTrophyEarned(st2.checkins, START, 2, FRI) === true);
}

// 6. מה שכן יכול לקרות, וזה מה שההודעה אמורה לומר לה: בחמישי חסרה עוד משימה.
{
  const st = seedWeek(THU);
  delete st.checkins[THU].veg;                  // חסרה עוד משימה באותו יום
  st.checkins[THU] = { ...st.checkins[THU], strength: true };
  const closed = api.dayComplete(START, THU, false, st.checkins, st.stepsByDate, st.waterByDate, st.log, TARGETS, 250, st.activityLog);
  check("כשחסרה בחמישי עוד משימה, ההשלמה לבדה אינה סוגרת אותו", closed === false);
  const st2 = closeDays(st, FRI);
  check("ואז גם אין גביע", api.weekTrophyEarned(st2.checkins, START, 2, FRI) === false);
  check("והמסך אומר לה שחסרה שם עוד משימה", /חסרה שם עוד משימה אחת/.test(src));
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. "מה נשאר לגביע?" - רעיון של רון, 28 באוגוסט 2026. מוצג בשישי ובשבת בלבד.
//    המסך אינו מחשב מחדש: הוא מריץ בדיוק את המשימות שסוגרות את היום.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nמה נשאר לגביע");
{
  const miss = (st, today) => api.missingForWeek(2, START, today, false, st.checkins, st.stepsByDate, st.waterByDate, st.log, TARGETS, 250, st.activityLog);
  const full = closeDays(seedWeek(null), FRI);
  check("שבוע מלא מחזיר רשימה ריקה", miss(full, FRI).length === 0);

  const st = seedWeek(THU);
  const one = miss(st, FRI);
  check("יום אחד חסר מחזיר יום אחד", one.length === 1 && one[0].date === THU, JSON.stringify(one));
  check("ובשמות המשימות, לא במספרים", one.length === 1 && one[0].tasks.includes("אימון כוח"), JSON.stringify(one[0] && one[0].tasks));

  const two = seedWeek(THU);
  delete two.checkins[THU].veg;
  const t2 = miss(two, FRI);
  check("שתי משימות חסרות באותו יום מוצגות שתיהן",
    t2.length === 1 && t2[0].tasks.length === 2 && t2[0].tasks.includes("צבעים של ירקות היום"), JSON.stringify(t2[0] && t2[0].tasks));

  // שבת אינה נדרשת לגביע, ולכן היא אינה מופיעה ברשימה גם כשלא מולאה
  const sat = d(14);
  check("שבת אינה מופיעה ברשימה", miss(seedWeek(null), sat).every((x) => x.date !== sat), sat);
  // יום שעוד לא הגיע אינו נחשב חסר. ברביעי, חמישי עדיין לא היה.
  const wed = d(11);
  check("יום עתידי אינו נחשב חסר", miss(seedWeek(THU), wed).every((x) => x.date <= wed));
}

console.log("\nהמסך עצמו");
check("הכפתור מוצג בשישי ובשבת בלבד", /const endOfWeek = dw === 6 \|\| dw === 0;/.test(src));
check("והשבוע נגזר מהיום שממנו נפתח הארון ולא מהיום הנוכחי",
  /const dayInView = viewDate \|\| today;/.test(src)
  && /const dw = dowOf\(dayInView\);/.test(src)
  && /const week = Math\.min\(programWeekFor\(startDate, dayInView\), 10\);/.test(src));
check("והארון מקבל את היום שנבחר", /<CollectionModal checkins=\{checkins\} startDate=\{profile\.startDate\} today=\{today\} viewDate=\{selectedDate\}/.test(src));
check("והקשה על גביע פותחת את השבוע שלו ולא את הנוכחי", /onClick=\{\(\) => \{ if \(started && TRACKER_ENABLED\) setMissWeek\(w\); \}\}/.test(src));
check("גביע של שבוע שעוד לא התחיל אינו נפתח", /const started = addDays\(startDate, \(w - 1\) \* 7\) <= today;/.test(src));
check("המסך מחשב לפי השבוע שנפתח", /missingForWeek\(missWeek, startDate, today/.test(src));
check("וכתוב בארון שאפשר להקיש על גביע", src.includes("הקישי על גביע כדי לראות מה נשאר בשבוע שלו."));
check("הכותרת נוקבת בשבוע שנפתח", /מה נשאר לגביע של שבוע \{missWeek\}\?/.test(src));
check("והכפתור נוקב בשבוע הנוכחי", /<Btn variant="ghost" onClick=\{\(\) => setMissWeek\(week\)\}>מה נשאר לגביע של שבוע \{week\}\?<\/Btn>/.test(src));
check("הרשימה גוללת וההסבר והסגירה נשארים במקומם",
  /<div style=\{\{ overflowY: "auto", flex: 1, minHeight: 0 \}\}>/.test(src.slice(src.indexOf("מה נשאר לגביע של שבוע {missWeek}?")))
  && /marginTop: 14, flexShrink: 0 \}\}><Btn onClick=\{\(\) => setMissWeek\(0\)\}>סגירה/.test(src));
check("ליד כל יום מופיע התאריך שלו", /pad2\(parseDay\(d\.date\)\.getUTCDate\(\)\)\}\.\{pad2\(parseDay\(d\.date\)\.getUTCMonth\(\) \+ 1\)/.test(src));
check("וכשלא חסר כלום נאמר את זה במפורש", src.includes("לא נשאר כלום, כל ימי השבוע הושלמו."));
check("שם היום נכתב במלואו", /יום \{HE_DAYS_FULL\[parseDay\(d\.date\)\.getUTCDay\(\)\]\}/.test(src));
check("משימות אופציונליות אינן נספרות", /tasksForDate\(startDate, date, keepShabbat\)\.filter\(\(t\) => !t\.optional\)/.test(src.slice(src.indexOf("function missingForWeek"))));
check('"הגביעים שלך" היא כותרת ולא שורת הסבר', /fontSize: 17, fontWeight: 700, color: C\.ink, margin: "10px 0 8px" \}\}>הגביעים שלך/.test(src));


// ─────────────────────────────────────────────────────────────────────────────
// 8. גביע כסף. החלטה של רון, 28 באוגוסט 2026: יום אחד אפשר לפספס.
//    ההקלה היא על החיים ולא על ההתנהגות: היום עצמו עדיין חייב להיות שלם.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nזהב וכסף");
{
  const lvl = (st, today) => api.weekTrophyLevel(st.checkins, START, 2, today);
  check("שבוע שלם הוא זהב", lvl(closeDays(seedWeek(null), FRI), FRI) === "gold");
  check("יום אחד חסר הוא כסף", lvl(closeDays(seedWeek(THU), FRI), FRI) === "silver", String(lvl(closeDays(seedWeek(THU), FRI), FRI)));

  // שני ימים חסרים אינם גביע בכלל
  const two = seedWeek(THU);
  delete two.checkins[d(10)];
  check("שני ימים חסרים אינם גביע", lvl(closeDays(two, FRI), FRI) === null, String(lvl(closeDays(two, FRI), FRI)));

  // לפני שישי אין הכרעה, בדיוק כמו קודם
  check("לפני שישי אין גביע בכלל", lvl(closeDays(seedWeek(null), d(11)), d(11)) === null);

  // וזהב נשאר בדיוק מה שהיה: weekTrophyEarned לא זז
  check("weekTrophyEarned נשאר זהב בלבד",
    api.weekTrophyEarned(closeDays(seedWeek(THU), FRI).checkins, START, 2, FRI) === false
    && api.weekTrophyEarned(closeDays(seedWeek(null), FRI).checkins, START, 2, FRI) === true);
}

console.log("\nהתמונות והמסכים");
import { existsSync } from "node:fs";
for (const w of [1, 5, 9, "champion"]) {
  check("קובץ הכסף קיים: trophy-" + w,
    existsSync(new URL("../public/medals/trophy-" + w + "-silver.webp", import.meta.url)));
}
check("הארון מצייר לפי הדרגה", /const level = weekTrophyLevel\(checkins, startDate, w, today\);/.test(src));
check("ותמונת הכסף נבחרת מהדרגה", /function trophyForWeek\(w, level\) \{[\s\S]*?level === "silver" \? "-silver" : ""/.test(src));
check("כתוב מתחת לגביע שהוא כסף", /level === "silver" && <div[^>]*>כסף<\/div>/.test(src));
check("שורת ההסבר בארון מסבירה את שתי הדרגות",
  src.includes("גביע זהב נכנס לארון על שבוע שכל ימיו הושלמו, ראשון עד שישי. אם פספסת יום אחד, נכנס גביע כסף. שבת אינה נחשבת."));
check("וגם המסך של מה נשאר", src.includes("יום אחד אפשר לפספס ועדיין לקבל גביע כסף. שבוע שכולו הושלם מקבל זהב."));
check("מסך החגיגה של הכסף בקופי שרון אישר",
  /גביע כסף נכנס לארון!/.test(src) && /יום אחד אפשר לפספס, וזה עדיין שבוע חזק/.test(src));
check("והחגיגה נורית גם על כסף", /const lv = weekTrophyLevel\(next, profile\.startDate, w, today\)/.test(src));
check("השאלות ותשובות מסבירות את שתי הדרגות",
  src.includes("מקבלים גביע זהב, ואם פספסת יום אחד מקבלים גביע כסף"));


console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.");
process.exit(fail ? 1 : 0);
