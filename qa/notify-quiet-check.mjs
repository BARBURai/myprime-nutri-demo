// A woman who already finished today's tasks must get nothing in the evening, and everyone
// else the ordinary reminder. Getting this backwards would either nag a woman who just
// finished, or silence one who has not started.
//
// The congratulation itself is not sent from here at all: it lives on the celebration screen
// inside the app. If a praise payload ever reappears in api/notify.js, this fails.
//
//   node qa/notify-quiet-check.mjs

process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";
process.env.NOTIFY_SECRET = "s";
// Real VAPID keys: web-push validates them before it will sign anything.
const webpush = (await import("web-push")).default;
const keys = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC = keys.publicKey;
process.env.VAPID_PRIVATE = keys.privateKey;

// The clock is pinned before notify.js is imported. Without this the run is date dependent:
// on a Saturday nobody is served at all, and the whole file would pass by sending nothing.
// Wednesday 12.08.2026, 19:30 Jerusalem.
const FIXED = new Date("2026-08-12T16:30:00Z").getTime();
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(FIXED); }
  static now() { return FIXED; }
};

const israelDay = (o = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new RealDate(FIXED - o * 86400000));
const today = israelDay(0);
const start = "2026-07-26"; // a Sunday, so both women are on day 18 and the tracker is open

const subs = {
  "https://push.test/done": JSON.stringify({ email: "done@test.com", name: "רונית", startDate: start, hour: 19, sub: { endpoint: "https://push.test/done", keys: { p256dh: "x", auth: "y" } } }),
  "https://push.test/open": JSON.stringify({ email: "open@test.com", name: "מיכל", startDate: start, hour: 19, sub: { endpoint: "https://push.test/open", keys: { p256dh: "x", auth: "y" } } }),
};

const pushed = [];
// notify.js talks to Redis by POSTing the command array to the base URL, unlike the admin
// endpoints which use the path form. Stub the shape it actually uses.
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith("https://redis.test")) {
    const cmd = JSON.parse((opts && opts.body) || "[]");
    const [op, a] = cmd;
    if (op === "HGETALL") return { ok: true, json: async () => ({ result: Object.entries(subs).flat() }) };
    if (op === "MGET") return { ok: true, json: async () => ({ result: cmd.slice(1).map((k) => (k === `trk:${today}:done@test.com` ? "1" : null)) }) };
    if (op === "SET") return { ok: true, json: async () => ({ result: "OK" }) };
    return { ok: true, json: async () => ({ result: null }) };
  }
  pushed.push({ url: u, body: (opts && opts.body) || "" });
  return { ok: true, status: 201, text: async () => "" };
};

// web-push sends over Node's https module, not fetch, so intercept it at the library. Both
// notify.js and this file import the same module instance.
webpush.sendNotification = async (sub, payload) => { pushed.push({ url: sub.endpoint, body: String(payload) }); return { statusCode: 201 }; };

const { default: handler } = await import("../api/notify.js");
const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
await handler({ query: { secret: "s", force: "1" }, headers: {} }, res);

if (process.env.QA_DEBUG) console.log(JSON.stringify(res.body), "start=" + start, "today=" + today);
let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (extra ? "  → " + extra : "")); } };

const sentTo = (frag) => pushed.find((p) => p.url.includes(frag));
check("נשלחה התראה אחת בלבד", pushed.length === 1, "נשלחו " + pushed.length);

const done = sentTo("/done"), open = sentTo("/open");
check("מי שסיימה לא קיבלה כלום", !done);
check("מי שלא סיימה קיבלה את התזכורת הרגילה", !!open && /דוח המעקב/.test(open.body));
check("ובלי שמה", !!open && !/מיכל/.test(open.body));
check("ואין יותר הודעת מדליה בהתראות", !pushed.some((p) => /מדליה|כל הכבוד/.test(p.body)));
check("והשתיקה נספרה ולא נחשבה כשליחה", res.body && res.body.quiet >= 1, JSON.stringify(res.body));

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.");
process.exit(fail ? 1 : 0);
