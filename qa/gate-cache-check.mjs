// השער האמיתי מול המטמון. v7.33
//
//   node qa/gate-cache-check.mjs
//
// **למה זה קיים.** רון, 22 בספטמבר 2026, לפני שמטמון הגיליון עלה לייצור: **"מה הסיכון
// למשתתפות קיימות, זה נראה לי די שינוי רציני ומועד לפורענות."** הוא צדק, וזה הקובץ
// שעונה לו: הוא מריץ את `api/access.js` **האמיתי**, מול גוגל מדומה ומול Redis מדומה,
// ושואל בכל מצב שבור אם אישה קיימת נפגעת.
//
// **וזה כבר החזיר תשובה אחת:** הגרסה הראשונה של השומר דרשה 200 תווים לפחות, **מספר
// שהמצאתי ולא מדדתי**, והבדיקה פסלה בגללו גיליון תקין. הסף הוסר. זה בדיוק כלל 2
// בסעיף 31: מספר שלא נמדד הוא ניחוש בתחפושת.
//
// **הבדיקה היא בלי רשת.** `fetch` מוחלף כולו, ושום קריאה לא יוצאת החוצה.
process.env.UPSTASH_REDIS_REST_TOKEN = "t";

process.env.ACCESS_SHEET_CSV_URL = "https://sheet.test/csv";
process.env.UPSTASH_REDIS_REST_URL = "redis://r";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";

const sunday = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 14); while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); })();
const SHEET = `ID,F_NAME,L_NAME,CF_EMAIL,360 - FINAL  PERSONAL START,ביטלה,קבוצה
0501111111,רונית,לוי,ronit@test.com,${sunday} 12:00:00,,א
0502222222,דנה,כהן,dana@test.com,${sunday} 12:00:00,,ב
`;
const GARBAGE = "<html><head><title>Error</title></head><body>Service unavailable</body></html>" + "z".repeat(400);

let store = {}, googleHits = 0, googleBody = SHEET;
globalThis.fetch = async (url, opt) => {
  const u = String(url);
  if (u.indexOf("redis://") === 0) {
    let cmd;
    if (opt && opt.body) cmd = JSON.parse(opt.body);
    else cmd = decodeURIComponent(u.slice("redis://r/".length)).split("/").map(decodeURIComponent);
    const [c, ...a] = cmd;
    const res = { GET: () => store[a[0]] ?? null, SET: () => { store[a[0]] = a[1]; return "OK"; },
      HGET: () => null, HSET: () => 1, ZREM: () => 1, ZADD: () => 1, ZCARD: () => 1, ZSCORE: () => Date.now(),
      EXPIRE: () => 1, DEL: () => 1, HSETNX: () => 1, ZREMRANGEBYSCORE: () => 0, ZREMRANGEBYRANK: () => 0 };
    return { ok: true, json: async () => ({ result: (res[c] || (() => null))() }) };
  }
  googleHits++;
  return { ok: true, status: 200, text: async () => googleBody };
};

const { default: handler } = await import(new URL("../api/access.js", import.meta.url));
const call = async (email) => {
  let out = null;
  await handler({ query: { email, device: "d1" }, headers: {} },
    { status: () => ({ json: (j) => { out = j; } }), setHeader: () => {} });
  return out;
};

let pass = 0, fail = 0;
const ck = (n, c, x) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x ? "  → " + x : "")); } };

console.log("\nאישה קיימת, המסלול הרגיל\n");
googleHits = 0;
const a = await call("ronit@test.com");
ck("נכנסת", a && a.allowed === true, JSON.stringify(a));
ck("ונמשך מגוגל פעם אחת", googleHits === 1, String(googleHits));

console.log("\nאישה שנייה באותה דקה: לא נוגעים בגוגל בכלל\n");
googleHits = 0;
const b = await call("dana@test.com");
ck("גם היא נכנסת", b && b.allowed === true, JSON.stringify(b));
ck("**ובלי אף משיכה מגוגל**", googleHits === 0, String(googleHits));

console.log("\nוזו השאלה של רון: גוגל נשברת בזמן שהמטמון פעיל\n");
googleBody = GARBAGE;
const c1 = await call("ronit@test.com");
ck("**אישה קיימת עדיין נכנסת, מהמטמון**", c1 && c1.allowed === true, JSON.stringify(c1));

console.log("\nוגוגל נשברת כשהמטמון ריק\n");
store = {};
const c2 = await call("ronit@test.com");
ck("והזבל לא נשמר למטמון", !store["sheet:csv:v1"], "נשמר");
// **המבחן האמיתי כאן אינו "מה התשובה" אלא "האם היא שונה מהייצור".** גוגל שמחזירה
// דף שגיאה עם סטטוס תקין נקראת כאישה שאינה רשומה **גם היום, בלי שום מטמון**, ויש לזה
// מחיר: זה נספר לה כניסיון כושל. **זו תקלה קיימת ואינה נכנסת עכשיו**, ולכן ההשוואה
// היא מול אותה קריאה בלי Redis כלל.
//
// **ולמה לא סוגרים אותה כאן:** התיקון המתבקש הוא לזרוק כשהטקסט אינו נראה כגיליון,
// **וזה היה שובר את מסלול הגיבוי של השער**, שסורק את כל העמודות כשהכותרות לא נמצאו
// (`headerFound`, שורה 179). כלומר גיליון ששמות העמודות בו השתנו עדיין עובד היום,
// וזריקה הייתה נועלת את כולן. **נרשם כמשימה ולא מתוקן בהיסח הדעת.**
store = {};
const noRedis = await (async () => { let o2 = null; await (await import(new URL("../api/access.js", import.meta.url))).default(
  { query: { email: "ronit@test.com", device: "d1", nocache: "1" }, headers: {} },
  { status: () => ({ json: (j) => { o2 = j; } }), setHeader: () => {} }); return o2; })();
ck("**התשובה זהה לזו שבייצור היום, כלומר המטמון לא החמיר דבר**",
   JSON.stringify(c2) === JSON.stringify(noRedis), JSON.stringify(c2) + " מול " + JSON.stringify(noRedis));
googleBody = SHEET;
const c3 = await call("ronit@test.com");
ck("וברגע שגוגל חוזרת, היא נכנסת מיד", c3 && c3.allowed === true, JSON.stringify(c3));

console.log("\nRedis נופל לגמרי\n");
const keep = globalThis.fetch;
globalThis.fetch = async (url, opt) => {
  if (String(url).indexOf("redis://") === 0) throw new Error("Redis נפל");
  googleHits++; return { ok: true, status: 200, text: async () => SHEET };
};
const d = await call("ronit@test.com");
ck("**אישה משלמת אינה נעולה בגלל Redis**", d && d.allowed === true, JSON.stringify(d));
globalThis.fetch = keep;

console.log("\nומי שבאמת אינה רשומה\n");
store = {};
const e = await call("stranger@test.com");
ck("עדיין נדחית כרגיל", e && e.allowed === false && e.reason === "not_registered", JSON.stringify(e));

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.");
process.exit(fail ? 1 : 0);
