// v8.62: התראת ניסיון ממסך הניהול. נשלחת רק למכשירים של המייל שהוקלד, מנהל בלבד, ומעל
// התקרה אינה נשלחת בכלל. מריצה את api/admin.js האמיתי, ושירות ההתראות מדומה. בלי רשת.
//
//   node qa/test-push-check.mjs

import webpush from "web-push";
import adminHandler from "../api/admin.js";

const KEY = "test-admin-key";
process.env.ADMIN_KEY = KEY;
process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";
process.env.VAPID_PUBLIC = "pub";
process.env.VAPID_PRIVATE = "priv";

const store = { hash: { "push:subs": {
  e1: JSON.stringify({ email: "ron@test.com", sub: { endpoint: "https://push.test/1" } }),
  e2: JSON.stringify({ email: "Ron@Test.com", sub: { endpoint: "https://push.test/2" } }),
  e3: JSON.stringify({ email: "dana@test.com", sub: { endpoint: "https://push.test/3" } }),
} }, kv: {} };
globalThis.fetch = async (url) => {
  const [cmd, a, b, c] = String(url).replace("https://redis.test/", "").split("/").map(decodeURIComponent);
  const H = (k) => (store.hash[k] = store.hash[k] || {});
  let result = null;
  if (cmd === "HGETALL") { const o = H(a); result = Object.keys(o).flatMap((k) => [k, o[k]]); }
  else if (cmd === "HGET") result = H(a)[b] ?? null;
  else if (cmd === "HSET") { H(a)[b] = c; result = 1; }
  else if (cmd === "GET") result = store.kv[a] ?? null;
  return { ok: true, json: async () => ({ result }) };
};

let sent = [], mode = "ok";
webpush.setVapidDetails = () => {};
webpush.sendNotification = async (sub, payload) => {
  if (mode === "413") { const e = new Error("Received unexpected response code"); e.statusCode = 413; throw e; }
  if (mode === "fail") { const e = new Error("boom"); e.statusCode = 500; throw e; }
  sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
  return { statusCode: 201 };
};

const mkRes = () => { const r = { code: 0, body: null }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.setHeader = () => {}; return r; };
const call = async (key, body) => { const res = mkRes(); await adminHandler({ query: { key }, method: "POST", body: { testPush: true, ...body } }, res); return res; };

let pass = 0, fail = 0;
const check = (name, cond, extra) => { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); } };

console.log("\nהתראת ניסיון");
{
  sent = []; mode = "ok";
  const r = await call(KEY, { email: "RON@test.com", title: "כותרת", text: "גוף" });
  check("נשלחה", r.body.ok === true && r.body.sent === 2, JSON.stringify(r.body));
  check("**רק למכשירים של המייל שהוקלד**", sent.length === 2 && sent.every((x) => x.endpoint !== "https://push.test/3"), JSON.stringify(sent.map((x) => x.endpoint)));
  check("הכותרת והגוף כמו שהוקלדו", sent[0].payload.title === "כותרת" && sent[0].payload.body === "גוף");
  check("תגית נפרדת, כדי שלא תחליף את התראת היום", sent[0].payload.tag === "test-push");
  check("שום דבר לא נרשם ב-Redis", Object.keys(store.kv).length === 0 && Object.keys(store.hash).length === 1);
}
{
  sent = [];
  const r = await call(KEY, { email: "nobody@test.com", title: "x", text: "y" });
  check("מייל בלי מכשיר: no_devices ושום שליחה", r.body.error === "no_devices" && sent.length === 0, JSON.stringify(r.body));
}
{
  sent = [];
  const r = await call(KEY, { email: "ron@test.com", title: "x", text: "א".repeat(2600) });
  check("**מעל התקרה אינה נשלחת בכלל**", r.body.error === "too_long" && sent.length === 0, JSON.stringify(r.body));
  const ok = await call(KEY, { email: "ron@test.com", title: "x".repeat(30), text: "משפט ".repeat(360) });
  check("1,800 תווים בעברית עדיין נשלחים", ok.body.ok === true, JSON.stringify(ok.body));
}
{
  sent = []; mode = "413";
  const r = await call(KEY, { email: "ron@test.com", title: "x", text: "y" });
  check("שירות שמסרב באורך נקרא כ'ארוכה מדי'", r.body.error === "too_long", JSON.stringify(r.body));
  mode = "fail";
  const f = await call(KEY, { email: "ron@test.com", title: "x", text: "y" });
  check("תקלה אחרת נקראת כתקלה", f.body.ok === false && f.body.error === "send_failed", JSON.stringify(f.body));
  mode = "ok";
}
{
  const made = mkRes();
  await adminHandler({ query: { key: KEY }, method: "POST", body: { newCode: "טלי", by: "רון" } }, made);
  const tali = made.body && made.body.code;
  sent = [];
  const r = await call(tali, { email: "ron@test.com", title: "x", text: "y" });
  check("**קוד של עובדת אינו שולח**", r.code === 403 && sent.length === 0, JSON.stringify(r.body));
  const n = await call("made-up", { email: "ron@test.com", title: "x", text: "y" });
  check("בלי מפתח אינו שולח", n.code === 401 && sent.length === 0);
  const bad = await call(KEY, { email: "לא מייל", title: "x", text: "y" });
  check("מייל לא תקין נדחה", bad.code === 400);
}

console.log(`\n${pass} עברו, ${fail} נכשלו`);
process.exit(fail ? 1 : 0);
