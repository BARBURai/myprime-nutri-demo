// שתי תקלות במסך הניהול, v8.46.
//
// **1. שמירה במסך הניהול אינה מוחקת שדות שהיא אינה מכירה.** עד v8.46 כל שמירה בנתה את
// הרשומה מחדש ומחקה את `bf26`, מבצע בלאק נובמבר.
//
// **2. שדה "גישה עד" נפתח על התאריך לפני התוספות**, ושורה אומרת מה יתווסף. עד כאן הוא נפתח
// על התאריך שכבר כולל אותן, ושמירה בלי שינוי הוסיפה אותן פעם שנייה (shellysherf, 10.11).
//
// מריצה את `api/admin.js` ואת `api/access.js` האמיתיים מול גיליון ו-Redis מדומים. בלי רשת.
//
//   node qa/admin-until-check.mjs

import adminHandler from "../api/admin.js";
import accessHandler from "../api/access.js";
import { readFileSync } from "node:fs";

const KEY = "test-admin-key";
process.env.ADMIN_KEY = KEY;
process.env.ACCESS_SHEET_CSV_URL = "https://sheet.test/csv";
process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";
delete process.env.MANYCHAT_TOKEN;
delete process.env.MC_SYNC_SECRET;

const HDR = "ID,F_NAME,L_NAME,CF_EMAIL,360 - FINAL  PERSONAL START,ביטלה,קבוצה,חודשי גישה נוספים,SMART,GLOW-FULL,אפליקציית תזונה";
let CSV = HDR;
let store = { hash: {}, kv: {} };
let mcCalls = 0;

function run(cmd, a, b, c) {
  const H = (k) => (store.hash[k] = store.hash[k] || {});
  if (cmd === "HSET") { H(a)[b] = c; return 1; }
  if (cmd === "HSETNX") { if (H(a)[b] === undefined) { H(a)[b] = c; return 1; } return 0; }
  if (cmd === "HGET") return H(a)[b] ?? null;
  if (cmd === "HDEL") { delete H(a)[b]; return 1; }
  if (cmd === "HGETALL") { const o = H(a); return Object.keys(o).flatMap((k) => [k, o[k]]); }
  if (cmd === "SET") { store.kv[a] = b; return "OK"; }
  if (cmd === "GET") return store.kv[a] ?? null;
  if (cmd === "DEL") { delete store.kv[a]; return 1; }
  if (cmd === "ZRANGE" || cmd === "ZREVRANGE" || cmd === "KEYS" || cmd === "SMEMBERS") return [];
  return 0;
}
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith("https://sheet.test")) return { ok: true, text: async () => CSV };
  if (u.startsWith("https://api.manychat.com")) { mcCalls++; return { ok: true, json: async () => ({ status: "success" }) }; }
  const path = u.replace(/^https:\/\/redis\.test\/?/, "");
  if (!path && opts && opts.body) {
    const body = JSON.parse(opts.body);
    if (Array.isArray(body[0])) return { ok: true, json: async () => body.map((c) => ({ result: run(...c.map(String)) })) };
    return { ok: true, json: async () => ({ result: run(...body.map(String)) }) };
  }
  const p = path.split("/").map(decodeURIComponent);
  if (p[0] === "pipeline" || p[0] === "multi-exec") {
    const body = JSON.parse(opts.body);
    return { ok: true, json: async () => body.map((c) => ({ result: run(...c.map(String)) })) };
  }
  return { ok: true, json: async () => ({ result: run(...p) }) };
};

function mkRes() {
  const r = { code: 0, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.send = (b) => { r.body = typeof b === "string" ? JSON.parse(b) : b; return r; };
  r.end = (b) => { if (b) { try { r.body = JSON.parse(String(b)); } catch (e) {} } return r; };
  return r;
}
const women = async () => {
  const res = mkRes();
  await adminHandler({ query: { key: KEY, all: "1" }, method: "GET", headers: {}, body: null }, res);
  return (res.body && res.body.women) || [];
};
const one = async (em) => (await women()).find((w) => w.email === em) || null;
const save = async (em, patch) => {
  const res = mkRes();
  await adminHandler({ query: { key: KEY }, method: "POST", headers: {}, body: { email: em, by: "טלי", ...patch } }, res);
  return res;
};
const gate = async (em) => {
  const res = mkRes();
  await accessHandler({ query: { email: em, device: "d1" }, method: "GET", headers: {} }, res);
  return res.body || {};
};
const sundayWeeksAgo = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 7 * n); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d.toISOString().slice(0, 10); };
const row = ({ phone = "972500000001", email, start = "", smart = "", full = "" }) => `${phone},רונית,לוי,${email},${start ? start + " 12:00:00" : ""},FALSE,א,3,${smart},${full},TRUE`;

let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (extra ? "  → " + extra : "")); } };
const reset = () => { store = { hash: {}, kv: {} }; mcCalls = 0; };
const ovr = (em) => { try { return JSON.parse(store.hash["admin:overrides"][em]); } catch (e) { return null; } };

const HTML = readFileSync(new URL("../public/admin.html", import.meta.url), "utf8");

console.log("\n1. שמירה אינה מוחקת שדות שהמסך אינו מכיר");
{
  reset();
  CSV = [HDR, row({ email: "b@t.com", start: sundayWeeksAgo(2) })].join("\n");
  store.hash["admin:overrides"] = { "b@t.com": JSON.stringify({ bf26: { order: "X1", paidAt: "2026-11-05T10:00:00Z" }, log: [] }) };
  await save("b@t.com", { group: "ב" });
  const o = ovr("b@t.com");
  check("**bf26 נשמר אחרי שינוי קבוצה**", o && o.bf26 && o.bf26.order === "X1", JSON.stringify(o));
  check("והקבוצה נשמרה", o.group === "ב");
  await save("b@t.com", { until: "2027-05-01" });
  check("ו-bf26 נשמר גם אחרי שינוי תאריך", ovr("b@t.com").bf26 && ovr("b@t.com").bf26.order === "X1");
}

console.log("\n2. שדה \"גישה עד\"");
{
  reset();
  CSV = [HDR, row({ email: "r@t.com", start: "2026-11-15", smart: "TRUE" })].join("\n");
  store.hash["ref:bonus"] = { "r@t.com": JSON.stringify({ pd: 28 }) };
  await save("r@t.com", { until: "2027-02-20" });
  let w = await one("r@t.com");
  check("גישה עד כוללת את 28 הימים", w.until === "2027-03-20", w.until);
  check("**השדה נפתח על התאריך שהוקלד, לפני התוספת**", w.untilBase === "2027-02-20", w.untilBase);
  // שמירה בלי שינוי: מה שהשדה נפתח עליו נשלח בחזרה.
  await save("r@t.com", { until: w.untilBase });
  w = await one("r@t.com");
  check("**ושמירה בלי שינוי אינה מוסיפה פעם שנייה**", w.until === "2027-03-20", w.until);
}
{
  reset();
  CSV = [HDR, row({ email: "n@t.com", start: "2026-11-15", smart: "TRUE" })].join("\n");
  store.hash["ref:bonus"] = { "n@t.com": JSON.stringify({ pd: 28 }) };
  const w = await one("n@t.com");
  check("בלי תאריך של המשרד, השדה נפתח על סוף התוכנית לפני התוספת", w.untilBase && w.until > w.untilBase, JSON.stringify({ b: w.untilBase, u: w.until }));
  const r = await save("n@t.com", { until: w.untilBase });
  const w2 = await one("n@t.com");
  check("ושמירה בלי שינוי משאירה את אותו סוף", r.body.ok && w2.until === w.until, JSON.stringify({ before: w.until, after: w2.until }));
}
{
  reset();
  CSV = [HDR, row({ email: "p@t.com", start: sundayWeeksAgo(2) })].join("\n");
  const w = await one("p@t.com");
  check("בלי תוספות, השדה נפתח על גישה עד עצמה", w.untilBase === w.until, JSON.stringify({ b: w.untilBase, u: w.until }));
}
// הפונקציות מהמסך עצמו.
const pick = (name) => { const i = HTML.indexOf("function " + name + "("); let d = 0, j = HTML.indexOf("{", i); for (; j < HTML.length; j++) { if (HTML[j] === "{") d++; else if (HTML[j] === "}" && --d === 0) break; } return HTML.slice(i, j + 1); };
const il = (d) => { const p = d.split("-"); return p[2] + "." + p[1] + "." + p[0]; };
const untilAddText = new Function("il", pick("untilAddText") + "; return untilAddText;")(il);
check("**הנוסח שאושר, 28 יום**", untilAddText("2027-02-20", 0, 28) === "לתאריך הזה יתווספו 28 יום של הטבת נובמבר. הגישה בפועל: עד 20.03.2027.", untilAddText("2027-02-20", 0, 28));
check("חודש אחד", untilAddText("2027-01-31", 1, 0) === "לתאריך הזה יתווספו חודש אחד של חברה מביאה חברה. הגישה בפועל: עד 03.03.2027.", untilAddText("2027-01-31", 1, 0));
check("שני חודשים ו-28 יום", untilAddText("2027-01-10", 2, 28) === "לתאריך הזה יתווספו 2 חודשים של חברה מביאה חברה ו-28 יום של הטבת נובמבר. הגישה בפועל: עד 07.04.2027.", untilAddText("2027-01-10", 2, 28));
check("בלי תוספות אין שורה", untilAddText("2027-01-10", 0, 0) === "");
check("השדה נפתח על untilBase", /dateBox\(w\.email, w\.untilBase \|\| w\.until \|\| DATA\.today\)/.test(HTML));
check("והשורה מתעדכנת בכל שינוי תאריך", /untilAddRefresh\(em\);\n\}/.test(HTML));

console.log(`\n${pass} עברו, ${fail} נכשלו`);
process.exit(fail ? 1 : 0);
