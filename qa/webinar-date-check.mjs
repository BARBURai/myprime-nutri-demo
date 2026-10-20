// תאריך הוובינר אינו נקרא כתאריך התחלה. v8.31
//
//   node qa/webinar-date-check.mjs
//
// **למה זה קיים.** 20.10.2026: אישה נרשמה בערב הוובינר, ומניצ'ט הוסיף לה שורה בגיליון לפני
// שכתב לה תאריך התחלה. בשורה ישב רק תאריך הוובינר, **והשער שלף אותו משאר השורה** ונתן לה את
// המחזור של 18.10, כלומר היא הייתה נכנסת ליום 3 של מחזור שכבר התחיל. **רון שאל אם מחיקת עמודת
// הוובינר תפתור.** התשובה היא לא: אז נשלף "מועד הרשמה לתוכנית", שכתוב חודש לפני יום ונקרא
// כיולי בשנה הבאה. **לכן הבדיקה כאן מכסה גם את המקרה הזה.**
//
// מריצה את `api/access.js` **האמיתי** מול גיליון מדומה ומול Redis מדומה. **בלי רשת.**
process.env.ACCESS_SHEET_CSV_URL = "https://sheet.test/csv";
process.env.UPSTASH_REDIS_REST_URL = "redis://r";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";

const sun = (weeks) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + weeks * 7); while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
const past = sun(-2), next = sun(1), mon = (() => { const d = new Date(past + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();
const usDate = (() => { const d = new Date(); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()} 23:16:18`; })();

const HEAD = "ID,F_NAME,L_NAME,CF_EMAIL,360 - FINAL  PERSONAL START,ביטלה,PERSONAL WEBINAR DATE AND TIME,מועד הרשמה לתוכנית ";
const NOWEB = "ID,F_NAME,L_NAME,CF_EMAIL,360 - FINAL  PERSONAL START,ביטלה,מועד הרשמה לתוכנית ";
let SHEET = "";
globalThis.fetch = async (url, opt) => {
  const u = String(url);
  if (u.indexOf("redis://") === 0) {
    const cmd = opt && opt.body ? JSON.parse(opt.body) : decodeURIComponent(u.slice("redis://r/".length)).split("/");
    const c = cmd[0];
    const res = { GET: () => null, SET: () => "OK", HGET: () => null, HSET: () => 1, ZREM: () => 1, ZADD: () => 1, ZCARD: () => 1, ZSCORE: () => Date.now(),
      EXPIRE: () => 1, DEL: () => 1, HSETNX: () => 1, ZREMRANGEBYSCORE: () => 0, ZREMRANGEBYRANK: () => 0 };
    return { ok: true, json: async () => ({ result: (res[c] || (() => null))() }) };
  }
  return { ok: true, status: 200, text: async () => SHEET };
};

const { default: handler } = await import(new URL("../api/access.js", import.meta.url));
const call = async (email) => {
  let out = null;
  await handler({ query: { email, device: "d1", login: "1" }, headers: {} },
    { status: () => ({ json: (j) => { out = j; } }), setHeader: () => {} });
  return out;
};

let pass = 0, fail = 0;
const ck = (n, c, x) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x ? "  → " + x : "")); } };

console.log("\nשורה עם תאריך וובינר בלבד, בלי תאריך התחלה\n");
SHEET = `${HEAD}\n0501111111,ציונה,כהן,web@test.com,,,${mon} 20:00:00,${usDate}\n`;
let r = await call("web@test.com");
ck("**אינה מקבלת את מחזור הוובינר**", r && r.startDate !== past, JSON.stringify(r));
ck("ואינה מקבלת שום מחזור", r && !r.startDate, JSON.stringify(r));

console.log("\nואותה שורה אחרי מחיקת עמודת הוובינר, ההצעה של רון\n");
SHEET = `${NOWEB}\n0501111111,ציונה,כהן,noweb@test.com,,,${usDate}\n`;
r = await call("noweb@test.com");
ck("**מועד ההרשמה אינו נקרא כתאריך התחלה**", r && !r.startDate, JSON.stringify(r));

console.log("\nהצד השני: שום דבר אינו משתנה למי שיש לה תאריך התחלה\n");
SHEET = `${HEAD}\n0502222222,דנה,לוי,dana@test.com,${next} 12:00:00,,${mon} 20:00:00,${usDate}\n0503333333,רות,בר,ruth@test.com,${past} 12:00:00,,${mon} 20:00:00,${usDate}\n`;
r = await call("dana@test.com");
ck("מחזור עתידי נקרא מהעמודה", r && r.allowed === true && r.startDate === next, JSON.stringify(r));
r = await call("ruth@test.com");
ck("מחזור שהתחיל נקרא מהעמודה", r && r.allowed === true && r.startDate === past, JSON.stringify(r));

console.log("\nושתי שורות לאותה אישה, אחת בלי תאריך: המחזור מהשורה שיש בה\n");
SHEET = `${HEAD}\n0504444444,מיכל,גל,two@test.com,,,${mon} 20:00:00,${usDate}\n0504444444,מיכל,גל,two@test.com,${next} 12:00:00,,${mon} 20:00:00,${usDate}\n`;
r = await call("two@test.com");
ck("המחזור הוא מעמודת ההתחלה", r && r.startDate === next, JSON.stringify(r));

console.log("\nגיליון בלי עמודת תאריך התחלה בכלל: הסריקה הישנה נשארת\n");
SHEET = `ID,F_NAME,CF_EMAIL,תאריך\n0505555555,נועה,old@test.com,${next} 12:00:00\n`;
r = await call("old@test.com");
ck("נקרא מהשורה, כמו קודם", r && r.startDate === next, JSON.stringify(r));

console.log(`\n${pass} עברו, ${fail} נכשלו\n`);
process.exit(fail ? 1 : 0);
