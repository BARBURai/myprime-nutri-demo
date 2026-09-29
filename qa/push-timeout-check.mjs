// התראה אחת שנתקעת לא עוצרת את כל השאר. v7.68
//
//   node qa/push-timeout-check.mjs
//
// **נמדד ב-29.09.2026:** שליחה רגילה לוקחת 5.5 עד 7 שניות, והערב של אותו יום עבר את 30 השניות
// ש-cron-job.org מחכה. **לא היה שום תקרת המתנה לשרתים של גוגל ושל אפל**, והשליחה הלכה בקבוצות
// של 25 שכל אחת חיכתה לאיטית שבה.
//
// **מריצה את api/notify.js האמיתי** מול Redis מדומה ושירות התראות מדומה שאפשר להגיד לו להיתקע,
// להאט, או ליפול בפעם הראשונה. התקרה מוקטנת כאן ל-300 מילישניות דרך PUSH_TIMEOUT_MS, כדי
// שהבדיקה לא תימשך דקה. **בוורסל המשתנה אינו מוגדר, והתקרה היא 10 שניות.**

process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";
process.env.NOTIFY_SECRET = "s";
process.env.PUSH_TIMEOUT_MS = "300";
const webpush = (await import("web-push")).default;
const keys = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC = keys.publicKey;
process.env.VAPID_PRIVATE = keys.privateKey;

// יום רביעי 12.08.2026, 19:30 בישראל. השעון זז קדימה בזמן אמת, כדי שמשך השליחה יימדד.
const FIXED = new Date("2026-08-12T16:30:00Z").getTime();
const RealDate = Date, T0 = RealDate.now();
globalThis.Date = class extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(FIXED + (RealDate.now() - T0)); }
  static now() { return FIXED + (RealDate.now() - T0); }
};

const START = "2026-07-26";
let subs = {}, H = {};
const mk = (n) => { subs = {}; for (let i = 0; i < n; i++) { const endpoint = `https://push.test/sub-${i}`; subs[endpoint] = JSON.stringify({ email: `w${i}@test.com`, startDate: START, hour: 19, sub: { endpoint, keys: { p256dh: "x", auth: "y" } } }); } };
const redisCalls = [];
globalThis.fetch = async (url, opts) => {
  const cmd = JSON.parse((opts && opts.body) || "[]");
  redisCalls.push(cmd);
  const op = cmd[0];
  if (op === "HGETALL" && cmd[1] === "push:subs") return { ok: true, json: async () => ({ result: Object.entries(subs).flat() }) };
  if (op === "MGET") return { ok: true, json: async () => ({ result: cmd.slice(1).map(() => null) }) };
  if (op === "SET") return { ok: true, json: async () => ({ result: "OK" }) };
  if (op === "HSET") { (H[cmd[1]] = H[cmd[1]] || {})[cmd[2]] = cmd[3]; return { ok: true, json: async () => ({ result: 1 }) }; }
  return { ok: true, json: async () => ({ result: null }) };
};

// השירות המדומה: לכל מכשיר התנהגות משלו.
let behave = () => "ok", calls = {}, inFlight = 0, peak = 0, optsSeen = [];
webpush.sendNotification = (sub, payload, opts) => {
  optsSeen.push(opts);
  const n = Number(sub.endpoint.match(/sub-(\d+)$/)[1]);
  calls[n] = (calls[n] || 0) + 1;
  const b = behave(n, calls[n]);
  inFlight++; if (inFlight > peak) peak = inFlight;
  const done = (f) => { inFlight--; return f(); };
  if (b === "hang") return new Promise(() => {});           // לעולם אינו עונה
  if (b === "drop") return new Promise((_, rej) => setTimeout(() => done(() => rej(new Error("ECONNRESET"))), 5));
  if (b === "gone") return new Promise((_, rej) => setTimeout(() => done(() => { const e = new Error("gone"); e.statusCode = 410; rej(e); }), 5));
  const ms = typeof b === "number" ? b : 10;
  return new Promise((res) => setTimeout(() => done(() => res({ statusCode: 201 })), ms));
};

const { default: handler } = await import("../api/notify.js");
async function run() {
  calls = {}; inFlight = 0; peak = 0; optsSeen = []; H = {}; redisCalls.length = 0;
  const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  const t = RealDate.now();
  await handler({ query: { secret: "s", force: "1" }, headers: {} }, res);
  const log = H["push:log:2026-08-12"] || {};
  const stamp = JSON.parse(Object.values(log)[0] || "{}");
  return { body: res.body, elapsed: RealDate.now() - t, stamp };
}

let pass = 0, fail = 0;
const ck = (n, c, x) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x !== undefined ? "  → " + x : "")); } };

console.log("\nמכשיר אחד שלעולם אינו עונה, מתוך 100\n");
mk(100); behave = (n) => (n === 7 ? "hang" : "ok");
let r = await run();
ck("**כל 99 האחרות קיבלו**", r.body.sent === 99, JSON.stringify(r.body));
ck("והתקועה נספרת כתקלה, לא כמי שהסירה", r.body.failed === 1 && r.body.pruned === 0, JSON.stringify(r.body));
ck("**והמנוי שלה לא נמחק**, כדי שתקבל מחר", !redisCalls.some((c) => c[0] === "HDEL"));
ck("היא קיבלה ניסיון שני אחד, ולא יותר", calls[7] === 2, calls[7]);
ck("**השליחה כולה נגמרה בתוך שתי תקרות ועוד מעט**, ולא חיכתה לה לנצח", r.elapsed < 300 * 2 + 400, r.elapsed + "ms");
ck("ברישום: כמה זמן, האיטית ביותר, וכמה נוסו שוב", r.stamp.retried === 1 && r.stamp.slowMs >= 290 && typeof r.stamp.ms === "number" && r.stamp.ms >= 290, JSON.stringify(r.stamp));

console.log("\nחיבור שנפל בפעם הראשונה\n");
mk(50); behave = (n, k) => (n === 3 && k === 1 ? "drop" : "ok");
r = await run();
ck("**קיבלה בניסיון השני**, ואין תקלה", r.body.sent === 50 && r.body.failed === 0, JSON.stringify(r.body));
ck("ונרשם שנוסתה שוב", r.stamp.retried === 1, JSON.stringify(r.stamp));

console.log("\nמי שהסירה את האפליקציה\n");
mk(50); behave = (n) => (n % 10 === 0 ? "gone" : "ok");
r = await run();
ck("**אינה מנוסה שוב**, כי זו תשובה ולא עיכוב", [0, 10, 20, 30, 40].every((n) => calls[n] === 1), JSON.stringify([0, 10, 20, 30, 40].map((n) => calls[n])));
ck("ונמחקת כמו קודם", r.body.pruned === 5 && redisCalls.some((c) => c[0] === "HDEL" && c.length === 7), JSON.stringify(r.body));
ck("ואין ניסיון שני לאף אחת", r.stamp.retried === 0);

console.log("\nאיטית מעכבת רק את עצמה\n");
// חמש איטיות, אחת בכל קבוצה של 25 בשיטה הישנה. **שם כל קבוצה חיכתה לאיטית שבה**, כלומר
// חמש פעמים 250 מילישניות. כאן הן רצות במקביל לשאר.
mk(125); behave = (n) => (n % 25 === 0 ? 250 : 10);
r = await run();
ck(`**הרבה פחות מחמש המתנות בטור** (${r.elapsed}ms מול 1,250 בשיטה הקודמת)`, r.elapsed < 700, r.elapsed + "ms");
ck("וכולן קיבלו", r.body.sent === 125);
ck("עדיין לא יותר מ-25 בבת אחת", peak <= 25 && peak > 1, peak);

console.log("\nהתקרה עוברת גם לספרייה עצמה\n");
ck("כל שליחה מקבלת timeout", optsSeen.length > 0 && optsSeen.every((o) => o && o.timeout === 300), JSON.stringify(optsSeen[0]));

console.log(`\n${pass} מתוך ${pass + fail} עברו.`);
process.exit(fail ? 1 : 0);
