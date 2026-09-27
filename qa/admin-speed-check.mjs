// מהירות מסך הניהול, v7.53. מריצה את api/admin.js ואת api/_pushaudit.js האמיתיים מול
// גיליון מדומה ומול Redis מדומה, בלי רשת. שלושה שינויים, ולכל אחד השאלה שקובעת:
//
//   1. נתוני השימוש: הרשימה אינה מושכת אותם, והכרטיס מושך אישה אחת.
//   2. מי באפליקציה החדשה: **אותה תשובה בדיוק לכל אישה** כמו בסריקה הישנה, בלי סריקה.
//   3. הגיליון: מהעותק המשותף, ונופל לגוגל בכל תקלה.
//
//   node qa/admin-speed-check.mjs

import { readFileSync } from "node:fs";

const KEY = "speed-key";
process.env.ADMIN_KEY = KEY;
process.env.ACCESS_SHEET_CSV_URL = "https://sheet.test/csv";
process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name + (extra !== undefined ? "  →  " + extra : "")); } };

// 12 נשים. כל אחת משאירה עקבה אחרת, כדי שכל מקור ייבדק בנפרד.
const WOMEN = ["seen", "bk", "dev", "sub", "seenbk", "none1", "none2", "old", "caps", "x1", "x2", "x3"];
const HEAD = "ID,F_NAME,L_NAME,CF_EMAIL,360 - FINAL  PERSONAL START,ביטלה,קבוצה,חודשי גישה נוספים";
const csvOf = (list) => [HEAD, ...list.map((w, i) => `97250000${String(i).padStart(4, "0")},${w},ל,${w}@t.co,2026-09-06 12:00:00,FALSE,א,3`)].join("\n");
let CSV = csvOf(WOMEN);

const db = { kv: {}, hash: {}, sets: {} };
const MCX = {};
process.env.MANYCHAT_TOKEN = "mc-test";
const log = [];            // כל פקודה שנשלחה, לפי הסדר
let sheetFetches = 0, keysFails = false, keysJunk = false, cacheGetFails = false;
function reset() {
  db.kv = {}; db.hash = {}; db.sets = {}; log.length = 0; sheetFetches = 0; keysFails = false; keysJunk = false; cacheGetFails = false;
  db.hash["admin:seen"] = { "seen@t.co": "2026-09-20", "seenbk@t.co": "2026-09-21" };
  db.kv["bk:bk@t.co"] = "cipher"; db.kv["bk:seenbk@t.co"] = "cipher"; db.kv["bk:old@t.co"] = "cipher";
  db.kv["bk:CAPS@t.co"] = "cipher";   // כתובת שנשמרה פעם באותיות גדולות
  db.kv["devices:dev@t.co"] = "z";
  db.hash["push:subs"] = { k1: JSON.stringify({ email: "sub@t.co", sub: {} }) };
  db.hash["admin:usage"] = { "seen@t.co": JSON.stringify({ days: { "1-1": [2, 3] }, trackerDays: 7, standalone: 1 }) };
}
function run(cmd) {
  const [c, a, ...rest] = cmd;
  log.push(c + " " + (a ?? ""));
  const H = (k) => (db.hash[k] = db.hash[k] || {});
  const S = (k) => (db.sets[k] = db.sets[k] || new Set());
  switch (c) {
    case "GET": if (a === "sheet:csv:v1" && cacheGetFails) throw new Error("down"); return db.kv[a] ?? null;
    case "SET": db.kv[a] = rest[0]; return "OK";
    case "DEL": delete db.kv[a]; return 1;
    case "HGET": return H(a)[rest[0]] ?? null;
    case "HSET": H(a)[rest[0]] = rest[1]; return 1;
    case "HDEL": delete H(a)[rest[0]]; return 1;
    case "HGETALL": return Object.entries(H(a)).flat();
    case "KEYS": {
      if (keysFails) throw new Error("NOPERM");
      if (keysJunk) return undefined;
      const pre = String(a).replace(/\*$/, "");
      return Object.keys(db.kv).filter((k) => k.startsWith(pre));
    }
    case "SADD": rest.forEach((m) => S(a).add(m)); return rest.length;
    case "SREM": rest.forEach((m) => S(a).delete(m)); return 1;
    case "SMEMBERS": return [...S(a)];
    case "SISMEMBER": return S(a).has(rest[0]) ? 1 : 0;
    case "MGET": return [a, ...rest].map((k) => db.kv[k] ?? null);
    default: return 0;
  }
}
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith("https://sheet.test")) { sheetFetches++; return { ok: true, status: 200, text: async () => CSV }; }
  // מניצ'ט מדומה, רק בשביל החלפת הכתובת: שומר את מה שנכתב ומחזיר אותו בקריאה החוזרת.
  if (u.startsWith("https://api.manychat.com")) {
    const b = opts && opts.body ? JSON.parse(opts.body) : {};
    if (u.includes("setCustomField")) { MCX.fid = b.field_id; MCX.email = b.field_value; }
    return { ok: true, status: 200, json: async () => ({ status: "success", data: { id: 5, custom_fields: MCX.fid ? [{ id: MCX.fid, name: "CF_EMAIL", value: MCX.email }] : [] } }) };
  }
  let cmd;
  if (opts && opts.method === "POST" && opts.body) cmd = JSON.parse(opts.body);
  else cmd = u.replace("https://redis.test/", "").split("/").map(decodeURIComponent);
  try { const result = run(cmd); return { ok: true, status: 200, json: async () => ({ result }) }; }
  catch (e) { return { ok: false, status: 500, json: async () => ({ error: String(e.message) }) }; }
};

const admin = (await import("../api/admin.js")).default;
const call = async (query, method = "GET", body = null) => {
  const r = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, setHeader() {} };
  await admin({ query: { key: KEY, ...query }, method, body, headers: {} }, r); return r;
};
const newApp = (r) => Object.fromEntries((r.body.women || []).map((w) => [w.email, !!w.newApp]));

// **הכלל הישן, כתוב כאן במפורש**: admin:seen ∪ bk:* ∪ devices:* ∪ push:subs, באותיות קטנות.
// זו התשובה שכל אישה קיבלה עד v7.52, וממנה אסור לזוז.
function oldRule() {
  const s = new Set(Object.keys(db.hash["admin:seen"] || {}).map((e) => e.toLowerCase()));
  Object.keys(db.kv).forEach((k) => {
    if (k.startsWith("bk:")) s.add(k.slice(3).toLowerCase());
    if (k.startsWith("devices:")) s.add(k.slice(8).toLowerCase());
  });
  Object.values(db.hash["push:subs"] || {}).forEach((v) => { try { s.add(JSON.parse(v).email.toLowerCase()); } catch (e) {} });
  return Object.fromEntries(WOMEN.map((w) => [`${w}@t.co`, s.has(`${w}@t.co`)]));
}
const same = (a, b) => WOMEN.every((w) => a[`${w}@t.co`] === b[`${w}@t.co`]);
const diff = (a, b) => WOMEN.filter((w) => a[`${w}@t.co`] !== b[`${w}@t.co`]).join(",");

console.log("\n1. נתוני השימוש");
reset();
let r = await call({});
ok("הרשימה נטענת", r.code === 200 && r.body.ok, JSON.stringify(r.body).slice(0, 120));
ok("**הרשימה אינה קוראת את admin:usage בכלל**", !log.some((l) => l.includes("admin:usage")), log.filter((l) => l.includes("usage")).join("|"));
ok("**ואינה נושאת נתוני שימוש לאף אישה**", r.body.women.every((w) => !("usage" in w)));
r = await call({ usage: "seen@t.co" });
ok("הכרטיס מקבל את נתוני השימוש של האישה", r.body.ok && r.body.usage && r.body.usage.trackerDays === 7, JSON.stringify(r.body));
ok("בפקודה אחת בלבד", log.slice(-1)[0] === "HGET admin:usage");
r = await call({ usage: "none1@t.co" });
ok("אישה בלי נתונים: null ולא שגיאה", r.body.ok && r.body.usage === null);
r = await call({ usage: "seen@t.co", key: "nope" });
ok("בלי מפתח נכון: 401", r.code === 401);

console.log("\n2. מי באפליקציה החדשה, בלי סריקה");
reset();
const truth = oldRule();
ok("הבדיקה עצמה מבחינה בין הנשים", Object.values(truth).filter(Boolean).length === 7 && Object.values(truth).includes(false), JSON.stringify(truth));
r = await call({});
ok("**טעינה ראשונה: אותה תשובה בדיוק לכל אחת מ-12 הנשים**", same(newApp(r), truth), diff(newApp(r), truth));
ok("הרשימה נאספה ונשמרה", db.kv["admin:appold:done"] && db.sets["admin:appold"] && db.sets["admin:appold"].has("bk@t.co"));
ok("ואינה נוגעת בשום נתון של אישה", Object.keys(db.kv).filter((k) => k.startsWith("bk:")).length === 4 && db.kv["bk:bk@t.co"] === "cipher");
log.length = 0;
r = await call({});
ok("**טעינה שנייה: בלי KEYS בכלל**", !log.some((l) => l.startsWith("KEYS")), log.filter((l) => l.startsWith("KEYS")).join("|"));
ok("**ואותה תשובה בדיוק לכל אחת**", same(newApp(r), truth), diff(newApp(r), truth));
// אישה חדשה שנכנסת אחרי האיסוף: השער כותב admin:seen באותה בקשה שבה נוצר devices:.
db.hash["admin:seen"]["x1@t.co"] = "2026-09-27"; db.kv["devices:x1@t.co"] = "z"; db.kv["bk:x1@t.co"] = "c";
r = await call({});
ok("מי שנכנסה אחרי האיסוף נספרת, דרך admin:seen", newApp(r)["x1@t.co"] === true && same(newApp(r), oldRule()), diff(newApp(r), oldRule()));

reset(); keysFails = true;
r = await call({});
ok("KEYS נכשל: הרשימה עדיין נטענת עם admin:seen ו-push:subs", r.body.ok && newApp(r)["seen@t.co"] && newApp(r)["sub@t.co"]);
ok("**ושום סימון 'הושלם' לא נכתב**", !db.kv["admin:appold:done"]);
keysFails = false;
r = await call({});
ok("ובטעינה הבאה האיסוף מושלם, ואותה תשובה כמו הכלל הישן", db.kv["admin:appold:done"] && same(newApp(r), oldRule()), diff(newApp(r), oldRule()));

reset(); keysJunk = true;
r = await call({});
ok("**תשובה שאינה מערך אינה נשמרת כרשימה ריקה**", !db.kv["admin:appold:done"]);

console.log("\nהחלפת כתובת");
reset();
await call({});                                   // האיסוף
delete db.hash["admin:seen"]["seenbk@t.co"];      // אישה שיש לה רק גיבוי ישן
const mv = await call({}, "POST", { email: "bk@t.co", newEmail: "moved@t.co", phone: "972500000001" });
CSV = csvOf(WOMEN.map((w) => (w === "bk" ? "moved" : w)));
delete db.kv["sheet:csv:v1"];                    // עברה דקה, והייצוא הביא את הכתובת החדשה
r = await call({});
ok("**מי שנכנסה רק לפני v4.87 והוחלפה לה כתובת נשארת באפליקציה החדשה**", (r.body.women.find((w) => w.email === "moved@t.co") || {}).newApp === true, JSON.stringify(mv.body));
ok("והרשימה הישנה עברה לכתובת החדשה", db.sets["admin:appold"].has("moved@t.co") && !db.sets["admin:appold"].has("bk@t.co"));
CSV = csvOf(WOMEN);

console.log("\n3. הגיליון מהעותק המשותף");
reset();
await call({}); await call({}); await call({});
ok("**שלוש טעינות רצופות: גוגל נקרא פעם אחת**", sheetFetches === 1, sheetFetches);
reset(); cacheGetFails = true;
r = await call({}); await call({});
ok("**המטמון לא עונה: הרשימה נטענת ישר מגוגל, כמו קודם**", r.body.ok && r.body.women.length === 12 && sheetFetches === 2, sheetFetches);
reset(); db.kv["sheet:csv:v1"] = "<html>error</html>";
r = await call({});
ok("עותק פגום במטמון אינו מוגש, והרשימה נטענת מגוגל", r.body.ok && r.body.women.length === 12 && sheetFetches === 1);

console.log("\nהדוח היומי");
reset();
const audit = await import("../api/_pushaudit.js");
{
  const { loadSheet } = await import("../api/_sheet.js");
  const args = { redisCmd: async (b, t, cmd) => run(cmd), base: "https://redis.test", token: "t", loadSheet, csvUrl: "https://sheet.test/csv" };
  const a1 = await audit.loadAuditInputs(args); log.length = 0;
  const a2 = await audit.loadAuditInputs(args);
  // בדוח push:subs נספר בנפרד (subEmails), ולכן הכלל הישן שלו הוא בלי המנויות.
  const want = Object.entries(oldRule()).filter(([k, v]) => v && k !== "sub@t.co").map(([k]) => k).sort().join(",");
  const got = (s) => [...s.appEmails].filter((e) => WOMEN.some((w) => e === `${w}@t.co`)).sort().join(",");
  ok("הדוח רואה אותן נשים כמו הכלל הישן", got(a1) === want, got(a1) + " / " + want);
  ok("**ובהרצה השנייה בלי KEYS**", !log.some((l) => l.startsWith("KEYS")) && got(a2) === want);
}

console.log("\nהכרטיס במסך");
// attachUsage נמשך מהקובץ ולא מועתק, ומורץ מול fetch מדומה.
const html = readFileSync(new URL("../public/admin.html", import.meta.url), "utf8");
const grab = (name) => { const i = html.indexOf("function " + name + "("); let d = 0, j = html.indexOf("{", i); for (; j < html.length; j++) { if (html[j] === "{") d++; else if (html[j] === "}" && --d === 0) break; } return html.slice(i, j + 1); };
let fetches = 0, renders = 0, answer = null;
const env = { KEY: "k", render: () => { renders++; }, fetch: () => { fetches++; return Promise.resolve({ json: () => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)) }); } };
const box = new Function("env", "var KEY=env.KEY, render=env.render, fetch=env.fetch; var USE = {};" + grab("usageLoad") + grab("attachUsage") + grab("usagePanel") + "function usageBars(){return []} function days(){return 1} var STATSMODE='day', DATA={today:'2026-09-27'}, VIEWS_SINCE=''; function il(x){return x} function esc(x){return x}" + "return { USE, attachUsage, usagePanel };")(env);
const w1 = { email: "a@t.co" };
answer = { ok: true, usage: { trackerDays: 4, days: {}, videosDone: 1 } };
box.attachUsage(w1);
ok("פתיחת כרטיס מושכת פעם אחת, ובינתיים 'טוען...'", fetches === 1 && w1.usageLoading && box.usagePanel(w1).includes("טוען..."));
box.attachUsage(w1);
ok("ציור נוסף באמצע הטעינה אינו מושך שוב", fetches === 1);
await new Promise((res) => setTimeout(res, 5));
const w1b = { email: "a@t.co" }; box.attachUsage(w1b);
ok("**אחרי הטעינה הנתונים יושבים על w.usage, וטעינה מחדש של הרשימה אינה מושכת שוב**", fetches === 1 && w1b.usage && w1b.usage.trackerDays === 4 && !w1b.usageLoading && renders === 1);
answer = new Error("net");
const w2 = { email: "b@t.co" }; box.attachUsage(w2);
await new Promise((res) => setTimeout(res, 5));
box.attachUsage(w2);
ok("טעינה שנכשלה: 'לא נטענו' ולא 'אין עדיין נתונים'", w2.usageFailed && w2.usage === null && box.usagePanel(w2).includes("לא נטענו"));
ok("ואינה מנסה שוב מיד", fetches === 2);
box.USE["b@t.co"].t -= 16000; box.attachUsage(w2);
ok("אחרי 15 שניות מנסה שוב", fetches === 3);

console.log("\nהיקף: 10,000 נשים");
reset();
const BIG = Array.from({ length: 10000 }, (_, i) => `w${i}`);
CSV = csvOf(BIG);
db.hash["admin:usage"] = Object.fromEntries(BIG.map((w) => [`${w}@t.co`, JSON.stringify({ days: Object.fromEntries(Array.from({ length: 60 }, (_, d) => [`${Math.floor(d / 7) + 1}-${(d % 7) + 1}`, [2, 3]])), videosDone: 40, trackerDays: 50, views: 9 })]));
const usageBytes = Buffer.byteLength(JSON.stringify(db.hash["admin:usage"]));
const t0 = Date.now();
r = await call({});
const bytes = Buffer.byteLength(JSON.stringify(r.body));
ok("המסך נטען עם 10,000 נשים", r.body.ok && r.body.women.length === 10000);
ok(`**נתוני השימוש, ${(usageBytes / 1e6).toFixed(1)} מיליון בתים, אינם נקראים ואינם נשלחים**`, !log.some((l) => l.includes("admin:usage")) && !JSON.stringify(r.body).includes("trackerDays"));
console.log(`  (תשובת הרשימה: ${(bytes / 1e6).toFixed(2)} מיליון בתים, ${Date.now() - t0} מילישניות על המחשב הזה)`);
CSV = csvOf(WOMEN);

console.log(`\n${pass} מתוך ${pass + fail} עברו.`);
process.exit(fail ? 1 : 0);
