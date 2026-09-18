/* ============================================================================
   הגיבוי ומי שהמשרד הוסיף ביד.

   **מה שנמצא ב-17 בספטמבר 2026, בבדיקה של רון בדב:** מייל שנוסף ביד במסך הניהול
   הציג את השורה "כבר היו לך נתונים באפליקציה?" אף שאין לו גיבוי כלל. השורה הייתה
   הסימפטום, **והשורש חמור בהרבה: `api/backup.js` בדק את הגיליון בלבד**, ולכן אישה
   שאינה בגיליון קיבלה גישה לאפליקציה **ולא קיבלה גיבוי בשום כיוון, לא כתיבה ולא
   קריאה.** החלפת טלפון הייתה מוחקת לה את הכל.

   הבדיקה מריצה את `api/backup.js` ואת `api/access.js` **האמיתיים** מול גיליון
   מדומה ומול Redis מדומה. בלי רשת ובלי עלות.

   node qa/backup-manual-check.mjs
   ========================================================================== */
import backupHandler from "../api/backup.js";
import accessHandler from "../api/access.js";

process.env.ACCESS_SHEET_CSV_URL = "https://sheet.test/csv";
process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";
delete process.env.RESEND_API_KEY;

const HEAD = 'ID,F_NAME,L_NAME,CF_EMAIL,360 - FINAL  PERSONAL START,ביטלה,קבוצה,חודשי גישה נוספים';
const START = (() => { const d = new Date(Date.now() - 10 * 864e5); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d.toISOString().slice(0, 10); })();
const CSV = [HEAD, `972501111111,יפית,קורן,sheet@test.com,${START},FALSE,ב,3`].join("\n");

const store = { hash: {}, kv: {} };
let sheetFails = false, redisFails = false, manualReads = 0;
const H = (k) => (store.hash[k] = store.hash[k] || {});

globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith("https://sheet.test")) {
    if (sheetFails) throw new Error("sheet down");
    return { ok: true, text: async () => CSV };
  }
  if (u.startsWith("https://api.resend.com")) return { ok: true };
  if (redisFails) throw new Error("redis down");
  // שני סגנונות: השער בונה נתיב, והגיבוי שולח מערך בגוף הבקשה.
  let cmd, a, b, c;
  if (opts && opts.method === "POST" && opts.body) [cmd, a, b, c] = JSON.parse(opts.body);
  else [cmd, a, b, c] = u.replace("https://redis.test/", "").split("/").map(decodeURIComponent);
  if (a === "admin:manual" && cmd === "HGET") manualReads++;
  let result = null;
  if (cmd === "HSET") { H(a)[b] = c; result = 1; }
  else if (cmd === "HGET") result = H(a)[b] ?? null;
  else if (cmd === "SET") { store.kv[a] = b; result = "OK"; }
  else if (cmd === "GET") result = store.kv[a] ?? null;
  else if (cmd === "DEL") { delete store.kv[a]; result = 1; }
  else if (cmd === "ZADD" || cmd === "ZREMRANGEBYSCORE" || cmd === "ZREMRANGEBYRANK" || cmd === "EXPIRE" || cmd === "SETEX") result = 1;
  else if (cmd === "ZCARD") result = 0;
  else if (cmd === "ZRANGE") result = [];
  return { ok: true, json: async () => ({ result }) };
};

const call = async (handler, { method = "GET", query = {}, body = null } = {}) => {
  let out = null;
  const res = { status: () => res, json: (d) => { out = d; return res; } };
  await handler({ method, query, body, headers: {} }, res);
  return out;
};
const getBk = (email) => call(backupHandler, { method: "GET", query: { email } });
const putBk = (email, blob) => call(backupHandler, { method: "POST", body: { email, blob } });
const BLOB = { ct: "x", salt: "y", iv: "z" };

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log("עובר  | " + n); } else { fail++; console.log("נכשל  | " + n + (extra !== undefined ? "  → " + JSON.stringify(extra) : "")); } };

/* 1. מי שבגיליון, וזה המסלול שאסור היה לזוז */
let r = await getBk("sheet@test.com");
ok("מי שבגיליון: אינה נדחית", r.reason !== "not_registered", r);
ok("ואין לה גיבוי עדיין, והתשובה היא ok ולא כישלון", r.ok === true && r.exists === false, r);
r = await putBk("sheet@test.com", BLOB);
ok("הגיבוי שלה נשמר", r.ok === true, r);
ok("ונקרא בחזרה", (await getBk("sheet@test.com")).exists === true);

/* 2. **הלב: מי שהמשרד הוסיף ביד** */
H("admin:manual")["manual@test.com"] = JSON.stringify({ start: START, phone: "972509999999" });
r = await getBk("manual@test.com");
ok("מי שנוספה ביד: אינה נדחית יותר", r.reason !== "not_registered", r);
ok("והתשובה היא 'בדקנו ואין לה' ולא 'לא הצלחנו לברר'", r.ok === true && r.exists === false, r);
r = await putBk("manual@test.com", BLOB);
ok("**והגיבוי שלה באמת נשמר**", r.ok === true && !!store.kv["bk:manual@test.com"], r);
ok("ונקרא בחזרה, כלומר יש לה מה לשחזר", (await getBk("manual@test.com")).exists === true);

/* 3. השער והגיבוי חייבים להסכים על אותה אישה */
const gate = await call(accessHandler, { query: { email: "manual@test.com", device: "d1" } });
ok("השער מאשר אותה", gate.allowed === true, gate);
ok("והגיבוי מאשר אותה גם הוא, כלומר שניהם מסכימים", (await getBk("manual@test.com")).ok === true);

/* 4. מי שאינה בשום מקום נשארת דחויה, ושום דבר לא נכתב עליה */
r = await getBk("nobody@test.com");
ok("מי שאינה בגיליון ואינה ברשימה: נדחית", r.reason === "not_registered", r);
r = await putBk("nobody@test.com", BLOB);
ok("וכתיבה עבורה נדחית", r.reason === "not_registered", r);
ok("ושום דבר לא נשמר עליה", !store.kv["bk:nobody@test.com"]);

/* 5. **אותו תנאי בדיוק שהשער בודק**: רשומה בלי תאריך התחלה אינה נותנת כלום */
H("admin:manual")["nostart@test.com"] = JSON.stringify({ phone: "972508888888" });
ok("רשומה ידנית בלי תאריך התחלה: הגיבוי דוחה", (await getBk("nostart@test.com")).reason === "not_registered");
const g2 = await call(accessHandler, { query: { email: "nostart@test.com", device: "d1" } });
ok("והשער דוחה אותה גם הוא, כלומר אין פער בין השניים", g2.allowed !== true, g2);

/* 6. הגיליון קודם ותמיד מנצח: מי שבו אינה נשאלת ברשימה הידנית בכלל */
manualReads = 0;
await getBk("sheet@test.com");
ok("מי שבגיליון: הרשימה הידנית אינה נשאלת עליה", manualReads === 0, manualReads);
manualReads = 0;
await getBk("manual@test.com");
ok("ומי שאינה בו: כן נשאלת", manualReads === 1, manualReads);

/* 7. **ונכשל לצד הסגור:** תקלה אצלנו אינה פותחת גיבוי לאיש */
redisFails = true;
r = await getBk("manual@test.com");
ok("Redis נופל: אינו מרחיב גישה לאף אחת", r.ok === false, r);
redisFails = false;
sheetFails = true;
ok("הגיליון נופל: מי שנוספה ביד עדיין מקבלת גיבוי", (await getBk("manual@test.com")).ok === true);
ok("והגיליון נופל: מי שאינה בשום מקום נדחית", (await getBk("nobody@test.com")).reason === "not_registered");
sheetFails = false;

/* 8. רשומה ידנית פגומה אינה מפילה את הקריאה */
H("admin:manual")["broken@test.com"] = "{not json";
ok("רשומה ידנית פגומה: נדחית בשקט ובלי קריסה", (await getBk("broken@test.com")).reason === "not_registered");

console.log(`\nסה"כ: ${pass} עוברים, ${fail} נכשלים\n`);
process.exit(fail ? 1 : 0);
