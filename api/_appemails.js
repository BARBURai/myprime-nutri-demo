// **מי פתחה פעם את האפליקציה החדשה, בלי לסרוק את כל מסד הנתונים. v7.53.**
//
// עד כאן מסך הניהול והדוח היומי הריצו `KEYS bk:*` ו-`KEYS devices:*` בכל טעינה, כלומר
// סריקה של כל המפתחות במסד. **ב-10,000 נשים אלה מאות אלפי מפתחות**, בכל פתיחה של המסך.
//
// **ולמה אין בזה צורך מעבר לפעם אחת:** השער כותב `admin:seen` בכל כניסה, באותה בקשה
// שבה הוא כותב את `devices:` (שחי 24 שעות בלבד). כלומר כל מי שנכנסה מאז v4.87 כבר שם.
// **מה שחסר ב-admin:seen הם רק נשים שנכנסו לפני v4.87 ולא חזרו מאז**, ואלה רשימה סגורה
// שאינה גדלה. לכן היא נאספת פעם אחת לתוך `admin:appold`, ומשם נקראת.
//
// **נכשל לצד הישן:** אם האיסוף לא הושלם, למשל כי אחת הסריקות נכשלה, הסימון אינו נכתב,
// מה שנאסף מוחזר, והאיסוף ינוסה שוב בטעינה הבאה. **שום תקלה כאן אינה מרוקנת את הרשימה.**
// והכתיבה היא הוספה בלבד למפתח חדש, ואינה נוגעת בשום נתון של אף אישה.
//
// קובץ שמתחיל בקו תחתון אינו נספר כפונקציה בוורסל. ראה v5.21.

export const APPOLD_KEY = "admin:appold";
export const APPOLD_DONE = "admin:appold:done";

// cmd: async (arr) => result, כלומר פנייה אחת ל-Upstash.
export async function oldAppEmails(cmd, today) {
  const out = new Set();
  const add = (e) => { e = String(e || "").trim().toLowerCase(); if (e.includes("@")) out.add(e); };
  try {
    if (await cmd(["GET", APPOLD_DONE])) {
      ((await cmd(["SMEMBERS", APPOLD_KEY])) || []).forEach(add);
      return out;
    }
  } catch (e) { /* נופל לאיסוף, כמו קודם */ }

  let complete = true;
  for (const [pattern, cut] of [["bk:*", 3], ["devices:*", 8]]) {
    try {
      const keys = await cmd(["KEYS", pattern]);
      // **רק מערך הוא תשובה.** שגיאה של Upstash מגיעה לפעמים כתשובה ריקה ולא כחריגה,
      // ובלי הבדיקה הזאת היא הייתה נשמרת לנצח כרשימה ריקה.
      if (!Array.isArray(keys)) { complete = false; continue; }
      keys.forEach((k) => add(String(k).slice(cut)));
    } catch (e) { complete = false; }
  }
  if (complete) {
    try {
      // בקבוצות של 100, כי מסך הניהול שולח פקודות בכתובת ולא בגוף הבקשה, ו-2,000
      // מפתחות בכתובת אחת חורגים מהאורך שהשרת מקבל (v7.41).
      const all = [...out];
      for (let i = 0; i < all.length; i += 100) await cmd(["SADD", APPOLD_KEY, ...all.slice(i, i + 100)]);
      await cmd(["SET", APPOLD_DONE, String(today || "1")]);
    } catch (e) { /* ננסה שוב בפעם הבאה, והרשימה שהוחזרה כבר מלאה */ }
  }
  return out;
}
