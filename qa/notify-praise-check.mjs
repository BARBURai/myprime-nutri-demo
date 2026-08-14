// The evening push has two forms. A woman who finished today's tasks must get the medal
// message with her name, and everyone else the ordinary reminder. Getting this backwards
// would either nag a woman who just finished, or congratulate one who did nothing.
//
//   node qa/notify-praise-check.mjs

process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";
process.env.NOTIFY_SECRET = "s";
// Real VAPID keys: web-push validates them before it will sign anything.
const webpush = (await import("web-push")).default;
const keys = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC = keys.publicKey;
process.env.VAPID_PRIVATE = keys.privateKey;

const israelDay = (o = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() - o * 86400000));
const today = israelDay(0);
// Day 10 of a programme that started on a Sunday, so the tracker is well open for both.
const start = (() => { const d = new Date(today + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 10 - d.getUTCDay()); return d.toISOString().slice(0, 10); })();

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

let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (extra ? "  → " + extra : "")); } };

const sentTo = (frag) => pushed.find((p) => p.url.includes(frag));
check("נשלחה התראה לשתי הנשים", pushed.length === 2, "נשלחו " + pushed.length);

const done = sentTo("/done"), open = sentTo("/open");
check("מי שסיימה קיבלה מדליה ולא תזכורת", !!done && /מדליה/.test(done.body) && !/דוח המעקב/.test(done.body));
check("והשם שלה מופיע", !!done && /רונית/.test(done.body), done && done.body.slice(0, 120));
check("וחתום על ידי ענת", !!done && /ענת/.test(done.body));
check("מי שלא סיימה קיבלה את התזכורת הרגילה", !!open && /דוח המעקב/.test(open.body) && !/מדליה/.test(open.body));
check("ובלי שמה", !!open && !/מיכל/.test(open.body));

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.");
process.exit(fail ? 1 : 0);
