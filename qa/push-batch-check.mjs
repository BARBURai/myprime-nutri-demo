// The evening and morning pushes must go out in parallel batches, not one phone at a time.
//
// Why this exists: on 8 September 2026 the morning job started failing. cron-job.org waits
// thirty seconds for an answer and gives up; the run before it had finished in 29.63 seconds.
// The cause was not the server being slow, it was the loop: every phone was one network round
// trip, awaited before the next began, so the whole job grew in a straight line with the number
// of women. It worked at 26 registered devices and ran out of road at 350.
//
// Left alone it would not have stayed a failed run in a log. cron-job.org is set to disable a
// job that keeps failing, so the reminders would have stopped altogether, quietly.
//
// This runs the real api/notify.js against a fake Redis and a fake push service. The push is
// given a deliberate delay so that sequential sending cannot possibly pass on time alone.
//
//   node qa/push-batch-check.mjs

process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";
process.env.NOTIFY_SECRET = "s";
const webpush = (await import("web-push")).default;
const keys = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC = keys.publicKey;
process.env.VAPID_PRIVATE = keys.privateKey;

// Wednesday 12.08.2026, 19:30 Jerusalem. Pinned before notify.js is imported, otherwise a run
// on a Saturday would send nothing at all and the whole file would pass by doing nothing.
const FIXED = new Date("2026-08-12T16:30:00Z").getTime();
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(FIXED); }
  static now() { return FIXED; }
};

const START = "2026-07-26";   // a Sunday, so everyone is on day 18 and the tracker is open
const N = 200;                // roughly the number of registered devices when this broke
const DEAD_EVERY = 20;        // one subscription in twenty is gone, as after an uninstall
const DELAY_MS = 20;          // what one real push round trip costs, near enough

const subs = {};
for (let i = 0; i < N; i++) {
  const endpoint = `https://push.test/sub-${i}`;
  subs[endpoint] = JSON.stringify({
    email: `w${i}@test.com`, name: "רונית", startDate: START, hour: 19,
    sub: { endpoint, keys: { p256dh: "x", auth: "y" } },
  });
}

const redisCalls = [];
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith("https://redis.test")) {
    const cmd = JSON.parse((opts && opts.body) || "[]");
    redisCalls.push(cmd);
    const op = cmd[0];
    if (op === "HGETALL") return { ok: true, json: async () => ({ result: Object.entries(subs).flat() }) };
    if (op === "MGET") return { ok: true, json: async () => ({ result: cmd.slice(1).map(() => null) }) };
    if (op === "SET") return { ok: true, json: async () => ({ result: "OK" }) };
    return { ok: true, json: async () => ({ result: null }) };
  }
  return { ok: true, status: 201, text: async () => "" };
};

// The fake push service. It records how many calls are in flight at once, which is the only
// way to tell parallel sending from a sequential loop that simply happens to be quick.
let inFlight = 0, peak = 0;
const sentTo = [];
webpush.sendNotification = async (sub, payload) => {
  inFlight++; if (inFlight > peak) peak = inFlight;
  await new Promise((r) => setTimeout(r, DELAY_MS));
  inFlight--;
  const n = Number((sub.endpoint.match(/sub-(\d+)$/) || [])[1]);
  if (n % DEAD_EVERY === 0) { const e = new Error("gone"); e.statusCode = 410; throw e; }
  sentTo.push(sub.endpoint);
  return { statusCode: 201 };
};

const { default: handler } = await import("../api/notify.js");
const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };

const t0 = RealDate.now();
await handler({ query: { secret: "s", force: "1" }, headers: {} }, res);
const elapsed = RealDate.now() - t0;

let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (extra !== undefined ? "   → " + extra : "")); } };

console.log("\nכולן נשלחות, ואף אחת לא נופלת בדרך\n");

const deadCount = Math.floor((N - 1) / DEAD_EVERY) + 1;
const liveCount = N - deadCount;
check(`כל ${liveCount} המנויות החיות קיבלו`, res.body && res.body.sent === liveCount, res.body && res.body.sent);
check("ואף אחת לא נשלחה פעמיים", new Set(sentTo).size === sentTo.length, sentTo.length + " שליחות, " + new Set(sentTo).size + " שונות");
// allSettled and not all: one refused subscription must not abandon the rest of its batch.
check("מנוי שנעלם אינו מפיל את שאר הקבוצה", sentTo.length === liveCount, sentTo.length);
check("ומי שנעלמה נספרת כניקוי ולא ככישלון", res.body && res.body.pruned === deadCount && res.body.failed === 0, res.body && `pruned=${res.body.pruned} failed=${res.body.failed}`);

console.log("\nוהשליחה מקבילה, שזה כל העניין\n");

// The number that matters. Sequentially this run is 200 x 20ms = 4 seconds and cron-job.org
// allows thirty for everything together. In batches of 25 it is eight rounds, about 160ms.
const sequential = N * DELAY_MS;
check(`הרבה מהר יותר מאחת-אחת (${elapsed}ms מול ${sequential}ms בטור)`, elapsed < sequential / 3, elapsed + "ms");
check("יותר משליחה אחת בו זמנית", peak > 1, "שיא של " + peak);
check("אבל לא הכל בבת אחת, שזו דרך אחרת להיכשל", peak <= 25, "שיא של " + peak);

console.log("\nוהניקוי ב-Redis הוא קריאה אחת ולא אחת לכל טלפון\n");

const hdels = redisCalls.filter((c) => c[0] === "HDEL");
check("יש מחיקה", hdels.length >= 1, hdels.length);
check("והיא נעשית בקריאה אחת, לא " + deadCount, hdels.length === 1, hdels.length + " קריאות");
check("ובה כל המנויות שנעלמו", hdels.length === 1 && hdels[0].length - 2 === deadCount, hdels[0] && hdels[0].length - 2);
const idOf = (e) => Number((String(e).match(/sub-(\d+)$/) || [])[1]);
check("ואף מנוי חי לא נמחק בטעות", hdels.length === 1 && hdels[0].slice(2).every((e) => Number.isFinite(idOf(e)) && idOf(e) % DEAD_EVERY === 0));

console.log("\nוהצורה בקוד, כדי שלא תיסחף חזרה\n");

const src = (await import("node:fs")).readFileSync("api/notify.js", "utf8");
check("אין יותר await על שליחה בודדת בתוך לולאה", !/for \([\s\S]{0,2500}await webpush\.sendNotification/.test(src));
check("השליחה עוברת דרך Promise.allSettled", src.includes("Promise.allSettled"));
check("ההחלטה מי מקבלת מופרדת מהשליחה עצמה", src.includes("outbox.push({ endpoint, sub, payload })"));
// The response is what tells us afterwards whether a night went out whole. Losing a counter
// would make a partial run indistinguishable from a complete one.
check("התשובה עדיין מדווחת את כל המונים", ["sent", "pruned", "failed", "quiet", "total"].every((k) => res.body && typeof res.body[k] === "number"), JSON.stringify(res.body));

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.");
process.exit(fail ? 1 : 0);
