// מריץ את api/bunny-token.js האמיתי מול Redis מדומה, ומוודא שסרטוני הבונוס לא נחתמים
// לאישה שאין לה TRUE בעמודה, ושכל 88 סרטוני התוכנית ממשיכים לעבוד בכל מצב.
//
//   node qa/bunny-token-check.mjs

process.env.BUNNY_TOKEN_KEY = "test-key";
process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";

const GLOW = "405fc049-0e7a-4447-9f1d-193845c0b4b9"; // מבוא
const COURSE = "18b03d75-b3ff-4d85-b021-aedfe40d156e"; // שיעור רגיל מהתוכנית

// Only this address carries the flag.
let redisDown = false;
globalThis.fetch = async (url) => {
  if (redisDown) throw new Error("redis down");
  const u = decodeURIComponent(String(url));
  const ok = u.includes("GET/glow:yes@test.com");
  return { ok: true, json: async () => ({ result: ok ? "1" : null }) };
};

const { default: handler } = await import("../api/bunny-token.js");

async function call(videoId, email) {
  const res = { code: 0, body: null, headers: {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, setHeader(k, v) { this.headers[k] = v; } };
  await handler({ query: { videoId, ...(email ? { email } : {}) } }, res);
  return res;
}

let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (extra ? "  → " + extra : "")); } };

console.log("\nסרטוני הבונוס\n");
let r = await call(GLOW, "yes@test.com");
check("מי שיש לה TRUE מקבלת קישור", r.code === 200 && !!(r.body && r.body.url), JSON.stringify(r.body));
r = await call(GLOW, "no@test.com");
check("מי שאין לה TRUE נחסמת", r.code === 403 && r.body.error === "not_entitled", r.code + " " + JSON.stringify(r.body));
r = await call(GLOW, "");
check("בלי מייל בכלל נחסמת", r.code === 403);
r = await call(GLOW, "YES@TEST.COM");
check("אותיות גדולות במייל אינן משנות", r.code === 200);

console.log("\nסרטוני התוכנית לא נפגעו\n");
r = await call(COURSE, "no@test.com");
check("שיעור רגיל עובד גם למי שאין לה בונוס", r.code === 200 && !!(r.body && r.body.url));
r = await call(COURSE, "");
check("ואפילו בלי מייל", r.code === 200);

console.log("\nכשה-Redis נופל\n");
redisDown = true;
r = await call(COURSE, "yes@test.com");
check("שיעור רגיל ממשיך לעבוד. תקלה אצלנו לא נועלת אישה מהתוכנית ששילמה עליה", r.code === 200);
r = await call(GLOW, "yes@test.com");
check("והבונוס נחסם, כלומר נכשל לצד הבטוח", r.code === 403);
redisDown = false;

console.log("\nקלט לא תקין\n");
r = await call("../../etc/passwd", "yes@test.com");
check("מזהה לא תקין נדחה", r.code === 400);
r = await call("", "yes@test.com");
check("מזהה ריק נדחה", r.code === 400);

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.");
process.exit(fail ? 1 : 0);
