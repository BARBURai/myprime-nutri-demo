// GLOW-SOLO, הטבת Glow לקונות סולו. v7.54.
//
// **הכלל של רון, 27 בספטמבר 2026:** "יהיה להן תאריך התחלה של סולו, וזה תאריך ההתחלה ותאריך
// הסיום של גלו." כלומר הקורס פתוח לה בדיוק כמו התוכנית שלה. **התווית לבדה מספיקה**, ו-GLOW-FULL
// עם GLOW-PAID תמיד גובר: "זה אומר שהיא שילמה לשנה, למה אתה שובר את זה."
//
// מריצה את api/access.js ואת api/admin.js האמיתיים על אותו גיליון, ואת stateBox מתוך
// public/admin.html. **ובכל מצב השער והמסך חייבים להסכים.** בלי רשת.
//
//   node qa/glow-solo-benefit-check.mjs

import { readFileSync } from "node:fs";

const KEY = "gs-key";
process.env.ADMIN_KEY = KEY;
process.env.ACCESS_SHEET_CSV_URL = "https://sheet.test/csv";
process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name + (extra !== undefined ? "  →  " + extra : "")); } };

// ── תאריכים, לפי ישראל ולא UTC (סעיף 20) ────────────────────────────────────
const ilToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
const addDays = (ymd, n) => { const d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const sundayWeeksAgo = (w) => { const t = new Date(ilToday() + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() - t.getUTCDay() - 7 * w); return t.toISOString().slice(0, 10); };
const il = (s) => { const p = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/); return p ? `${p[3]}.${p[2]}.${p[1]}` : s; };

// ── הגיליון ────────────────────────────────────────────────────────────────
const HDR = "ID,F_NAME,L_NAME,CF_EMAIL,360 - FINAL  PERSONAL START,ביטלה,קבוצה,חודשי גישה נוספים,בונוס איפור,GLOW-FULL,GLOW-FULL-M,GLOW-PAID,SOLO10WEEK,GLOW-SOLO";
let n = 0;
const row = ({ email, start = "", cancel = "", full = "", paid = "", solo10 = "TRUE", gs = "" }) =>
  `97250000${String(++n).padStart(4, "0")},א,ב,${email},${start ? start + " 12:00:00" : ""},${cancel || "FALSE"},א,,FALSE,${full},,${paid},${solo10},${gs}`;

const now3 = sundayWeeksAgo(3), past11 = sundayWeeksAgo(11), future = addDays(sundayWeeksAgo(0), 7), past20 = sundayWeeksAgo(20);
const W = {
  benefit:     row({ email: "benefit@t.co", start: now3, gs: "TRUE" }),
  soon:        row({ email: "soon@t.co", start: future, gs: "TRUE" }),
  done:        row({ email: "done@t.co", start: past11, gs: "TRUE" }),
  paidToo:     row({ email: "paidtoo@t.co", start: past11, gs: "TRUE", full: "TRUE", paid: "TRUE" }),
  paidOnly:    row({ email: "paidonly@t.co", start: past11, full: "TRUE", paid: "TRUE" }),
  fullToo:     row({ email: "fulltoo@t.co", start: past11, gs: "TRUE", full: "TRUE" }),
  nostart:     row({ email: "nostart@t.co", gs: "TRUE", solo10: "" }),
  nostartFull: row({ email: "nostartfull@t.co", gs: "TRUE", full: "TRUE", solo10: "" }),
  extended:    row({ email: "extended@t.co", start: past11, gs: "TRUE" }),
  cancelled:   row({ email: "cancelled@t.co", start: now3, gs: "TRUE", cancel: "TRUE" }),
  plain:       row({ email: "plain@t.co", start: now3 }),
  gift:        row({ email: "gift@t.co", start: now3, full: "TRUE", solo10: "" }),
  giftDone:    row({ email: "giftdone@t.co", start: past20, full: "TRUE", solo10: "" }),
  buyer:       row({ email: "buyer@t.co", full: "TRUE", solo10: "" }),
};
let CSV = [HDR, ...Object.values(W)].join("\n");

// ── Redis מדומה, GET בנתיב ו-POST בגוף ─────────────────────────────────────
let db;
const reset = () => { db = { kv: {}, hash: {}, sets: {} }; };
reset();
function run(cmd) {
  const [c, a, ...r] = cmd;
  const H = (k) => (db.hash[k] = db.hash[k] || {});
  const S = (k) => (db.sets[k] = db.sets[k] || new Set());
  switch (c) {
    case "GET": return db.kv[a] ?? null;
    case "SET": db.kv[a] = r[0]; return "OK";
    case "DEL": delete db.kv[a]; return 1;
    case "HGET": return H(a)[r[0]] ?? null;
    case "HSET": H(a)[r[0]] = r[1]; return 1;
    case "HSETNX": if (H(a)[r[0]] === undefined) { H(a)[r[0]] = r[1]; return 1; } return 0;
    case "HDEL": delete H(a)[r[0]]; return 1;
    case "HGETALL": return Object.entries(H(a)).flat();
    case "KEYS": return [];
    case "SADD": r.forEach((m) => S(a).add(m)); return 1;
    case "SMEMBERS": return [...S(a)];
    case "SISMEMBER": return S(a).has(r[0]) ? 1 : 0;
    case "MGET": return [a, ...r].map((k) => db.kv[k] ?? null);
    case "ZSCORE": return null;
    default: return 0;
  }
}
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith("https://sheet.test")) return { ok: true, status: 200, text: async () => CSV };
  const cmd = (opts && opts.method === "POST" && opts.body) ? JSON.parse(opts.body) : u.replace("https://redis.test/", "").split("/").map(decodeURIComponent);
  return { ok: true, status: 200, json: async () => ({ result: run(cmd) }) };
};

const access = (await import("../api/access.js")).default;
const admin = (await import("../api/admin.js")).default;
const res = () => ({ code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, setHeader() {} });
const gate = async (email) => { db.kv = Object.fromEntries(Object.entries(db.kv).filter(([k]) => !k.startsWith("sheet:"))); const r = res(); await access({ query: { email, device: "d1" }, method: "GET" }, r); return r.body || {}; };
const list = async () => { const r = res(); await admin({ query: { key: KEY }, method: "GET", body: null, headers: {} }, r); return r.body; };

// ── stateBox מתוך המסך, לא מועתק ───────────────────────────────────────────
const HTML = readFileSync(new URL("../public/admin.html", import.meta.url), "utf8");
const grab = (name) => {
  const at = HTML.indexOf("\n  function " + name + "(w){");
  let i = HTML.indexOf("{", HTML.indexOf("(w)", at)), d = 0, e = i;
  for (; e < HTML.length; e++) { if (HTML[e] === "{") d++; else if (HTML[e] === "}" && --d === 0) break; }
  return HTML.slice(at, e + 1);
};
const helpers = `const esc = (s) => String(s == null ? "" : s); const il = (s) => { const p = String(s || "").match(/^(\\d{4})-(\\d{2})-(\\d{2})$/); return p ? p[3] + "." + p[2] + "." + p[1] : String(s || ""); };`;
const box = new Function("return (function(){" + helpers + grab("stateBox") + grab("entryOf") + "return stateBox; })()")();
const glowLine = (w) => { const m = box(w).match(/קורס האיפור המלא<\/span><b>([^<]*)</); return m ? m[1] : "?"; };

const L = await list();
const A = (em) => (L.women || []).find((w) => w.email === em) || {};
const end70 = (s) => addDays(s, 70);

console.log("\nהטבת סולו רגילה");
let g = await gate("benefit@t.co");
ok("**שבוע 4 בסולו: הקורס פתוח**", g.allowed && g.glowFull === true, JSON.stringify(g));
ok("**במסך: 'הטבת סולו · פעיל עד' ותאריך סוף התוכנית**", glowLine(A("benefit@t.co")) === "הטבת סולו · פעיל עד " + il(end70(now3)), glowLine(A("benefit@t.co")));
ok("השרת חותם לה על הסרטונים", db.kv["glowfull:benefit@t.co"] === "1");
ok("**התווית לבדה מספיקה, בלי GLOW-FULL**", A("benefit@t.co").glowFull === false && A("benefit@t.co").state.glowOpen === true);

console.log("\nלפני יום 1");
g = await gate("soon@t.co");
ok("**הקורס מחכה ליום 1, כמו המתנה**", g.allowed && g.glowFull === false);
ok("**ואין לה את השורה 'במתנה', כי היא שילמה עליו**", g.glowSoon === false);
ok("במסך: 'הטבת סולו · נפתח ב-' ותאריך ההתחלה", glowLine(A("soon@t.co")) === "הטבת סולו · נפתח ב-" + il(future), glowLine(A("soon@t.co")));

console.log("\nאחרי שבוע 10");
db.kv["glowfull:done@t.co"] = "1";
g = await gate("done@t.co");
ok("**הסולו נגמר, והקורס נגמר איתו**", g.allowed === false, JSON.stringify(g));
ok("והיתר הצפייה נמחק מיד", !db.kv["glowfull:done@t.co"]);
ok("במסך: 'הטבת סולו · הסתיים'", glowLine(A("done@t.co")) === "הטבת סולו · הסתיים", glowLine(A("done@t.co")));

console.log("\nGLOW-FULL + GLOW-PAID תמיד גובר");
const gp = await gate("paidtoo@t.co"), go = await gate("paidonly@t.co");
ok("**שילמה לשנה: הקורס ממשיך אחרי שבוע 10, גם כשמסומן GLOW-SOLO**", gp.allowed && gp.glowFull === true && gp.product === "glow", JSON.stringify(gp));
ok("**ובדיוק כמו אישה בלי GLOW-SOLO**", JSON.stringify({ ...gp, phone: 0 }) === JSON.stringify({ ...go, phone: 0 }), JSON.stringify(go));
ok("במסך: 'נקנה', כמו כל קנייה", glowLine(A("paidtoo@t.co")).startsWith("נקנה") && glowLine(A("paidtoo@t.co")) === glowLine(A("paidonly@t.co")), glowLine(A("paidtoo@t.co")));

console.log("\nGLOW-SOLO עם GLOW-FULL, בלי קנייה");
g = await gate("fulltoo@t.co");
ok("**אחרי שבוע 10 הקורס נגמר, ולא 12 חודשים**", g.allowed === false, JSON.stringify(g));

console.log("\nבלי תאריך התחלה");
g = await gate("nostart@t.co");
ok("**הקורס אינו נפתח**", g.glowFull === false, JSON.stringify(g));
ok("והיא נכנסת למסכי ההרשמה כמו כל רשומה בלי מחזור", g.allowed === true && g.product === "360");
g = await gate("nostartfull@t.co");
ok("**וגם עם GLOW-FULL: לא הופכת לקונה של 12 חודשים**", g.glowFull === false && g.product !== "glow", JSON.stringify(g));
ok("ושעון קורס עצמאי אינו נתפס לה", !(db.hash["glow:start"] || {})["nostartfull@t.co"]);

console.log("\nהארכה של המשרד");
db.hash["admin:overrides"] = { "extended@t.co": JSON.stringify({ until: addDays(ilToday(), 30), by: "טלי" }) };
g = await gate("extended@t.co");
ok("**המשרד האריך את התוכנית: גם הקורס מתארך**", g.allowed && g.glowFull === true, JSON.stringify(g));
const L2 = await list();
const ext = (L2.women || []).find((w) => w.email === "extended@t.co");
ok("ובמסך התאריך הוא של ההארכה", glowLine(ext) === "הטבת סולו · פעיל עד " + il(addDays(ilToday(), 30)), glowLine(ext));
delete db.hash["admin:overrides"];

console.log("\nביטול");
g = await gate("cancelled@t.co");
ok("**ביטלה: הקורס נסגר יחד עם התוכנית**", g.allowed === false && g.reason === "cancelled");

console.log("\nמי שאין לה GLOW-SOLO: שום דבר לא זז");
const before = {};
for (const em of ["plain@t.co", "gift@t.co", "giftdone@t.co", "buyer@t.co", "paidonly@t.co"]) before[em] = await gate(em);
const csvWith = CSV;
CSV = csvWith.split("\n").map((l) => l.split(",").slice(0, -1).join(",")).join("\n");   // בלי העמודה בכלל
reset();
let same = true, which = "";
for (const em of Object.keys(before)) {
  const a = await gate(em);
  if (JSON.stringify({ ...a, phone: 0 }) !== JSON.stringify({ ...before[em], phone: 0 })) { same = false; which += em + " "; }
}
ok("**גיליון בלי העמודה: חמש נשים בלי ההטבה מקבלות תשובה זהה**", same, which);
CSV = csvWith; reset();

console.log("\nהשער והמסך מסכימים");
const L3 = await list();
let agree = true, bad = "";
for (const em of ["benefit@t.co", "soon@t.co", "done@t.co", "paidtoo@t.co", "fulltoo@t.co", "nostart@t.co", "cancelled@t.co", "gift@t.co", "buyer@t.co"]) {
  const a = await gate(em), w = (L3.women || []).find((x) => x.email === em);
  if (!w || !!a.allowed !== !!w.state.allowed || !!a.glowFull !== !!w.state.glowFullOpen) { agree = false; bad += em + " "; }
}
ok("**לכל אישה: אותה גישה ואותו קורס בשני הקבצים**", agree, bad);

console.log(`\n${pass} מתוך ${pass + fail} עברו.`);
process.exit(fail ? 1 : 0);
