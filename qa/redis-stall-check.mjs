// תקרת ההמתנה ל-Upstash בשער. v7.45
//
//   node qa/redis-stall-check.mjs
//
// **למה זה קיים.** כל פנייה ל-Upstash ב-`api/access.js` עטופה ב-try/catch שנכשל לצד הפתוח,
// ולכן תקלה לעולם אינה נועלת אישה. **פנייה שנתקעת ואינה עונה לא הייתה מכוסה**, כי היא אינה
// נכשלת, והאישה ממתינה מול המסך בלי סוף. רון אישר 3 שניות, ושאל: "כמה זה מסוכן האם עשית
// סימולציות האם בדקת כל דבר?" הקובץ הזה עונה על זה.
//
// הוא מריץ את `api/access.js` **האמיתי** מול Redis מדומה שאפשר להגיד לו להיתקע, להאט או
// להיכשל, ומול גוגל מדומה. **בלי רשת**, אבל עם שעון אמיתי, ולכן הוא לוקח כעשרים שניות.
process.env.ACCESS_SHEET_CSV_URL = "https://sheet.test/csv";
process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";

const sunday = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 14); while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); })();
const SHEET = `ID,F_NAME,L_NAME,CF_EMAIL,360 - FINAL  PERSONAL START,ביטלה,קבוצה
0501111111,רונית,לוי,ronit@test.com,${sunday} 12:00:00,,א
0502222222,דנה,כהן,dana@test.com,${sunday} 12:00:00,,ב
`;

// ---------- Redis מדומה ----------
// `mode(cmd)` מחליט לכל פנייה: "ok", "hang" (לא עונה עד שהשער מוותר), "error", או מספר
// מילישניות להמתנה לפני תשובה תקינה.
let mode = () => "ok";
let hash = {}, attempts = [], googleHits = 0, googleUp = true;
const answer = ([c, k, f]) => (c === "HGET" ? (hash[k] || {})[f] ?? null : c === "ZCARD" ? 1 : c === "ZSCORE" ? String(Date.now()) : null);
globalThis.fetch = async (url, opt = {}) => {
  const u = String(url);
  if (u.startsWith("https://redis.test")) {
    const cmd = opt.body ? JSON.parse(opt.body) : u.slice("https://redis.test/".length).split("/").map(decodeURIComponent);
    attempts.push(cmd.slice(0, 3).join(" "));
    const m = mode(cmd);
    const reply = { ok: true, json: async () => ({ result: answer(cmd) }) };
    if (m === "error") throw new Error("redis down");
    if (m === "hang" || typeof m === "number") {
      return new Promise((resolve, reject) => {
        const t = m === "hang" ? null : setTimeout(() => resolve(reply), m);
        if (opt.signal) opt.signal.addEventListener("abort", () => { clearTimeout(t); reject(opt.signal.reason); });
      });
    }
    return reply;
  }
  googleHits++;
  if (!googleUp) throw new Error("google down");
  return { ok: true, status: 200, text: async () => SHEET };
};

const { default: handler, REDIS_WAIT_MS } = await import(new URL("../api/access.js", import.meta.url));
const call = async (query) => {
  let out = null;
  const t = Date.now();
  await handler({ query, headers: {} }, { status: () => ({ json: (j) => { out = j; } }), setHeader: () => {} });
  return { out, ms: Date.now() - t };
};
const login = (email) => call({ email, device: "d1" });
const reset = () => { hash = {}; attempts = []; googleHits = 0; googleUp = true; mode = () => "ok"; };

let pass = 0, fail = 0;
const ck = (n, c, x) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x ? "  → " + x : "")); } };

ck("התקרה היא 3 שניות", REDIS_WAIT_MS === 3000, String(REDIS_WAIT_MS));

console.log("\nUpstash תקין: שום דבר לא משתנה\n");
reset();
let r = await login("ronit@test.com");
ck("נכנסת", r.out && r.out.allowed === true, JSON.stringify(r.out));
ck("ומהר", r.ms < 1000, r.ms + "ms");
const healthyCalls = attempts.length;
ck("ועוברת את כל הפניות הרגילות", healthyCalls >= 10, String(healthyCalls));

console.log("\nUpstash נתקע לגמרי\n");
reset(); mode = () => "hang";
r = await login("ronit@test.com");
ck("**אישה רשומה נכנסת**", r.out && r.out.allowed === true, JSON.stringify(r.out));
ck("**אחרי כ-3 שניות ולא יותר מ-4**", r.ms >= 2900 && r.ms < 4000, r.ms + "ms");
ck("**ניסיון אחד בלבד ל-Upstash**, ואחריו השער מוותר", attempts.length === 1, attempts.join(" | "));
ck("והגיליון נמשך ישר מגוגל", googleHits === 1, String(googleHits));
r = await login("stranger@test.com");
ck("מי שאינה רשומה עדיין נדחית כרגיל, ולא כתקלה", r.out && r.out.allowed === false && r.out.reason === "not_registered", JSON.stringify(r.out));
googleUp = false;
r = await login("ronit@test.com");
ck("וכשגם גוגל נופלת: תקלה זמנית, שאינה נספרת כניסיון כושל", r.out && r.out.reason === "fetch_failed", JSON.stringify(r.out));

console.log("\nנתקע באמצע הכניסה בלבד\n");
reset();
mode = ([c, k]) => (c === "HGET" && k === "admin:overrides" ? "hang" : "ok");
r = await login("ronit@test.com");
ck("נכנסת", r.out && r.out.allowed === true, JSON.stringify(r.out));
ck("אחרי כ-3 שניות", r.ms >= 2900 && r.ms < 4000, r.ms + "ms");
const after = attempts.slice(attempts.findIndex((a) => a.includes("admin:overrides")) + 1);
ck("**ואף פנייה אחריו**", after.length === 0, after.join(" | "));

console.log("\nאיטי אבל עונה, 2.9 שניות: לא נחתך\n");
reset();
hash["admin:overrides"] = { "ronit@test.com": JSON.stringify({ blocked: "1" }) };
mode = ([c, k]) => (c === "HGET" && k === "admin:overrides" ? 2900 : "ok");
r = await login("ronit@test.com");
ck("**ההכרעה של המשרד עדיין נאכפת**: מי שסומנה כחסומה נשארת בחוץ", r.out && r.out.allowed === false, JSON.stringify(r.out));
ck("והפניות שאחריו ממשיכות כרגיל", attempts.length > attempts.findIndex((a) => a.includes("admin:overrides")) + 1, attempts.join(" | "));

console.log("\nוזה המחיר שרון קיבל: בתקיעה, סימון של המשרד אינו נקרא\n");
reset();
hash["admin:overrides"] = { "ronit@test.com": JSON.stringify({ blocked: "1" }) };
mode = () => "hang";
r = await login("ronit@test.com");
ck("מי שסומנה כחסומה נכנסת בזמן תקיעה, כמו בכל תקלה אחרת של Upstash היום", r.out && r.out.allowed === true, JSON.stringify(r.out));
reset();
hash["admin:manual"] = { "manual@test.com": JSON.stringify({ start: sunday }) };
mode = () => "hang";
r = await login("manual@test.com");
ck("ומי שנוספה ביד ואינה בגיליון אינה נכנסת בזמן תקיעה", r.out && r.out.allowed === false, JSON.stringify(r.out));
mode = () => "ok";
r = await login("manual@test.com");
ck("ונכנסת מיד כש-Upstash חוזר", r.out && r.out.allowed === true, JSON.stringify(r.out));

console.log("\nשגיאה מיידית, לא תקיעה: בדיוק כמו היום\n");
reset(); mode = () => "error";
r = await login("ronit@test.com");
ck("נכנסת", r.out && r.out.allowed === true, JSON.stringify(r.out));
ck("מהר", r.ms < 1000, r.ms + "ms");
// **9 ולא 16, וזה גם המספר בקוד שלפני השינוי:** כמה פניות חולקות try אחד, ושגיאה בראשונה
// מדלגת על השאר. נמדד על שתי הגרסאות. מה שנבדק כאן הוא ששגיאה אינה נחשבת תקיעה.
ck("**והפניות ממשיכות להיות מנוסות**, כי שגיאה אינה תקיעה", attempts.length === 9, String(attempts.length));

console.log("\nשתי כניסות במקביל: תקיעה אצל אחת אינה נוגעת בשנייה\n");
reset();
mode = ([c, k, f]) => (c === "HGET" && k === "admin:emailold" && f === "ronit@test.com" ? "hang" : "ok");
const [ra, rb] = await Promise.all([login("ronit@test.com"), login("dana@test.com")]);
ck("שתיהן נכנסות", ra.out.allowed === true && rb.out.allowed === true, JSON.stringify([ra.out, rb.out]));
const danaCalls = attempts.filter((a) => a.includes("dana@test.com")).length;
ck("**והשנייה עברה את כל הפניות שלה**", danaCalls >= 8, String(danaCalls));
ck("והשנייה לא המתינה", rb.ms < 1000, rb.ms + "ms");

console.log("\nהתנתקות בזמן תקיעה\n");
reset(); mode = () => "hang";
r = await call({ email: "ronit@test.com", device: "d1", logout: "1" });
ck("עונה, ואחרי כ-3 שניות", r.out && r.out.ok === true && r.ms < 4000, JSON.stringify(r.out) + " " + r.ms + "ms");

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.");
process.exit(fail ? 1 : 0);
