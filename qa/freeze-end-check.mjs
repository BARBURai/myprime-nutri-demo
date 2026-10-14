// סוף הקפאה ביום החזרה, ותאריך תחילת ההקפאה בכל מקום. v8.20
//
// רון: "אני לא רואה עניין בזה שיהיה לה רשום הקפאה כשנגמרה לה הקפאה, זה חיווי לא נכון".
// **ומה שהיה מסוכן:** הדרך היחידה להוריד את התגית הייתה "סיום ההקפאה", **וזו מחקה את
// תאריך ההתחלה המקורי**, ולכן האפליקציה הסתירה ממנה כל יום שמילאה לפני ההקפאה.
//
// מריצה את `api/admin.js` ואת `api/access.js` האמיתיים מול גיליון, Redis ומניצ'ט מדומים,
// ומושכת את שורות היומן מתוך `public/admin.html` ומריצה אותן. בלי רשת.
//
//   node qa/freeze-end-check.mjs

import adminHandler, { freezeSweep } from "../api/admin.js";
import accessHandler from "../api/access.js";
import { readFileSync } from "node:fs";

const KEY = "test-admin-key";
process.env.ADMIN_KEY = KEY;
process.env.ACCESS_SHEET_CSV_URL = "https://sheet.test/csv";
process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";
process.env.MANYCHAT_TOKEN = "mc-test";
process.env.CRON_SECRET = "cron-test";

const HDR = "ID,F_NAME,L_NAME,CF_EMAIL,360 - FINAL  PERSONAL START,ביטלה,קבוצה,חודשי גישה נוספים";
let CSV = HDR;
let store = { hash: {}, kv: {} };
const MC = { tags: [], fail: false, fields: {} };

globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith("https://sheet.test")) return { ok: true, text: async () => CSV };
  if (u.startsWith("https://api.manychat.com")) {
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    if (MC.fail) return { ok: false, status: 500, json: async () => ({ status: "error", message: "down" }) };
    // מניצ'ט מחזיר את מה שנכתב לו, כי מסך הניהול קורא שוב אחרי כל כתיבה של תאריך.
    if (u.includes("setCustomField")) { MC.fields[body.field_id] = body.field_value; return { ok: true, json: async () => ({ status: "success" }) }; }
    if (u.includes("findByCustomField")) return { ok: true, json: async () => ({ status: "success", data: [{ id: 7, custom_fields: Object.entries(MC.fields).map(([id, value]) => ({ id: Number(id), value })), tags: [] }] }) };
    if (u.includes("TagByName")) { MC.tags.push((u.includes("addTag") ? "+" : "-") + (body && body.tag_name)); return { ok: true, json: async () => ({ status: "success" }) }; }
    return { ok: true, json: async () => ({ status: "success" }) };
  }
  const parts = u.replace("https://redis.test/", "").split("/").map(decodeURIComponent);
  const [cmd, a, b, c] = parts;
  const H = (k) => (store.hash[k] = store.hash[k] || {});
  let result = null;
  if (cmd === "HSET") { H(a)[b] = c; result = 1; }
  else if (cmd === "HSETNX") { if (H(a)[b] === undefined) { H(a)[b] = c; result = 1; } else result = 0; }
  else if (cmd === "HGET") result = H(a)[b] ?? null;
  else if (cmd === "HDEL") { delete H(a)[b]; result = 1; }
  else if (cmd === "HGETALL") { const o = H(a); result = Object.keys(o).flatMap((k) => [k, o[k]]); }
  else if (cmd === "SET") { store.kv[a] = b; result = "OK"; }
  else if (cmd === "GET") result = store.kv[a] ?? null;
  else if (cmd === "INCR") { store.kv[a] = String(Number(store.kv[a] || 0) + 1); result = Number(store.kv[a]); }
  else if (cmd === "DEL") { delete store.kv[a]; result = 1; }
  else result = 0;
  if (cmd === "ZRANGE" || cmd === "ZREVRANGE") result = [];
  return { ok: true, json: async () => ({ result }) };
};

function mkRes() {
  const r = { code: 0, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = () => {};
  return r;
}
const save = async (em, patch) => {
  const res = mkRes();
  await adminHandler({ query: { key: KEY }, method: "POST", headers: {}, body: { email: em, by: "טלי", phone: "972500000001", ...patch } }, res);
  return res;
};
const gate = async (em) => {
  const res = mkRes();
  await accessHandler({ query: { email: em, device: "d1" }, method: "GET", headers: {} }, res);
  return res.body || {};
};
const rec = (em) => JSON.parse(store.hash["admin:overrides"][em]);
const ilDay = (off = 0) => { const d = new Date(Date.now() + off * 86400000); return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(d); };
const sundayFrom = (off) => { const d = new Date(ilDay(off) + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d.toISOString().slice(0, 10); };
const TODAY = ilDay(0);
const ORIG = sundayFrom(-10);       // התחילה לפני כשבוע וחצי
const BACK = sundayFrom(21);        // חוזרת בעוד כשלושה שבועות, ביום ראשון
const row = (email) => `972500000001,שרון,כהן,${email},${ORIG} 0:00:00,FALSE,,3`;
const sweep = (today, extra = {}) => freezeSweep({ RU: "https://redis.test", RT: "t", today, at: new Date().toISOString(), writeMc: true, untag: async () => { if (MC.fail) return false; MC.tags.push("-הקפאה"); return true; }, ...extra });

let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (extra ? "  → " + extra : "")); } };
const reset = () => { store = { hash: {}, kv: {} }; MC.tags = []; MC.fail = false; MC.fields = {}; };
const freezeHer = async (em) => {
  CSV = [HDR, row(em)].join("\n");
  store.hash["mc:byemail"] = { [em]: JSON.stringify({ "972500000001": {} }) };
  return save(em, { freeze: { back: BACK, week: 2 } });
};

console.log("\nהכניסה להקפאה");
{
  reset();
  const r = await freezeHer("s@t.com");
  check("השמירה עוברת", r.body && r.body.ok === true, JSON.stringify(r.body));
  const o = rec("s@t.com");
  check("ההקפאה מתחילה היום", o.freeze.from === TODAY, o.freeze.from);
  check("תאריך ההתחלה המקורי נשמר", o.freeze.origStart === ORIG, o.freeze.origStart);
  check("**ושורת היומן נושאת את תאריך תחילת ההקפאה**", o.log[0].field === "freeze" && o.log[0].since === TODAY, JSON.stringify(o.log[0]));
  check("והתגית נוספה במניצ'ט", MC.tags.includes("+הקפאה"), MC.tags.join(",") + " mc=" + JSON.stringify(r.body));
  const g = await gate("s@t.com");
  check("ובזמן ההקפאה היא בחוץ", g.allowed === false && g.reason === "frozen", JSON.stringify(g).slice(0, 120));
}

console.log("\nהסריקה הלילית");
{
  reset(); await freezeHer("s@t.com"); MC.tags = [];
  let out = await sweep(TODAY);
  check("לפני תאריך החזרה היא לא נוגעת בשום דבר", out.ended.length === 0 && !rec("s@t.com").freeze.ended && MC.tags.length === 0);
  out = await sweep(BACK);
  const o = rec("s@t.com");
  check("**ביום החזרה ההקפאה מסומנת שהסתיימה**", o.freeze.ended === BACK && out.ended.length === 1, JSON.stringify(o.freeze));
  check("**והיא לא נמחקת: תאריך ההתחלה המקורי נשאר**", o.freeze.origStart === ORIG);
  check("וההקפאה עצמה נשארת עם התאריכים שלה", o.freeze.from === TODAY && o.freeze.back === BACK && o.freeze.week === 2);
  check("התגית הוסרה במניצ'ט", MC.tags.join(",") === "-הקפאה", MC.tags.join(","));
  check("ושורה ביומן בשם מערכת", o.log[0].field === "freezeEnd" && o.log[0].by === "מערכת" && o.log[0].from === TODAY && o.log[0].to === BACK + "|2" && o.log[0].tag === "1", JSON.stringify(o.log[0]));
  check("השורה הקודמת ביומן לא נמחקה", o.log[1] && o.log[1].field === "freeze");
  out = await sweep(BACK);
  check("סריקה שנייה לא עושה כלום שוב", out.ended.length === 0 && MC.tags.length === 1 && rec("s@t.com").log.length === o.log.length);
}
{
  reset(); await freezeHer("s@t.com"); MC.tags = []; MC.fail = true;
  const out = await sweep(BACK);
  check("**מניצ'ט נופל: ההקפאה אינה מסומנת שהסתיימה**, וננסה בלילה הבא", !rec("s@t.com").freeze.ended && out.failed.length === 1);
  MC.fail = false;
  const out2 = await sweep(BACK);
  check("ובלילה הבא זה עובר", rec("s@t.com").freeze.ended === BACK && out2.ended.length === 1);
}
{
  reset(); await freezeHer("s@t.com"); delete store.hash["mc:byemail"]; MC.tags = [];
  await sweep(BACK);
  const o = rec("s@t.com");
  check("בלי טלפון בשרת: מסתיימת, והיומן לא אומר שהתגית הוסרה", o.freeze.ended === BACK && o.log[0].tag === "", JSON.stringify(o.log[0]));
}
{
  reset(); await freezeHer("s@t.com"); MC.tags = [];
  await sweep(BACK, { writeMc: false });
  check("בדב, בלי כתיבה למניצ'ט: לא יוצאת שום קריאה", MC.tags.length === 0 && rec("s@t.com").freeze.ended === BACK);
}
{
  reset(); await freezeHer("s@t.com");
  await save("s@t.com", { freeze: { back: "", week: "" } });
  const out = await sweep(BACK);
  check("הקפאה בלי תאריך חזרה לעולם אינה מסתיימת לבד", out.ended.length === 0 && !rec("s@t.com").freeze.ended);
}

console.log("\nאחרי החזרה, באפליקציה");
{
  reset(); await freezeHer("s@t.com");
  // מזיזים את החזרה לאחור, כאילו היום הוא יום החזרה ואילך
  const o = rec("s@t.com"); const past = sundayFrom(-3);
  o.freeze.back = past; store.hash["admin:overrides"]["s@t.com"] = JSON.stringify(o);
  await sweep(TODAY);
  const g = await gate("s@t.com");
  check("היא נכנסת", g.allowed === true, JSON.stringify(g).slice(0, 120));
  check("**והאפליקציה עדיין מקבלת את תאריך ההתחלה המקורי**, כך שהיומן שלה שלם", g.freeze && g.freeze.origStart === ORIG, JSON.stringify(g.freeze));
}

console.log("\nסיום ההקפאה ביד");
{
  reset(); await freezeHer("s@t.com"); MC.tags = [];
  const r = await save("s@t.com", { freeze: { off: true } });
  const o = rec("s@t.com");
  check("השמירה עוברת", r.body && r.body.ok === true);
  check("**ההקפאה אינה נמחקת, ותאריך ההתחלה המקורי נשאר**", o.freeze && o.freeze.origStart === ORIG, JSON.stringify(o.freeze));
  check("היא מסתיימת היום", o.freeze.ended === TODAY && o.freeze.back === TODAY, JSON.stringify(o.freeze));
  check("התגית הוסרה במניצ'ט ולא נוספה", MC.tags.join(",") === "-הקפאה", MC.tags.join(","));
  check("השורה ביומן נושאת ממתי ולאן הייתה אמורה לחזור", o.log[0].since === TODAY && o.log[0].from === BACK, JSON.stringify(o.log[0]));
  const g = await gate("s@t.com");
  check("והשער כבר לא אומר שהיא בהקפאה", g.reason !== "frozen", g.reason);
  check("וסריקה אחר כך לא נוגעת בה", (await sweep(BACK)).ended.length === 0);
  await save("s@t.com", { freeze: { back: BACK, week: 3 } });
  const n = rec("s@t.com");
  check("**הקפאה חדשה אחרי שקודמת הסתיימה מתחילה היום**", n.freeze.from === TODAY && !n.freeze.ended, JSON.stringify(n.freeze));
  check("ושומרת את תאריך ההתחלה המקורי", n.freeze.origStart === ORIG, n.freeze.origStart);
}
{
  reset(); CSV = [HDR, row("n@t.com")].join("\n");
  await save("n@t.com", { freeze: { back: "", week: "" } });
  await save("n@t.com", { freeze: { off: true } });
  check("הקפאה בלי תאריך, שלא הזיזה כלום, נמחקת כמו קודם", rec("n@t.com").freeze === null);
}

console.log("\nהכתובת של הסריקה");
{
  const res = mkRes();
  await adminHandler({ query: { freezesweep: "" }, method: "GET", headers: {} }, res);
  check("בלי המפתח של וורסל: 401", res.code === 401);
  const res2 = mkRes();
  await adminHandler({ query: { freezesweep: "", key: KEY }, method: "GET", headers: {} }, res2);
  check("גם מפתח המנהל אינו מפעיל אותה", res2.code === 401);
  const vj = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  check("ויש לה משימה יומית בוורסל", vj.crons.some((c) => c.path === "/api/admin?freezesweep"));
}

console.log("\nהנוסחים במסך הניהול, שרון אישר מילה במילה");
{
  const HTML = readFileSync(new URL("../public/admin.html", import.meta.url), "utf8");
  const grab = (name) => { const i = HTML.indexOf("function " + name + "("); let d = 0, j = HTML.indexOf("{", i); for (let k = j; k < HTML.length; k++) { if (HTML[k] === "{") d++; else if (HTML[k] === "}") { d--; if (!d) return HTML.slice(i, k + 1); } } return ""; };
  const src = ["esc", "il", "ilDayOf", "freezeLogText", "freezeEndText"].map(grab).join("\n");
  const f = new Function(src + "\nreturn { freezeLogText, freezeEndText };")();
  check("כניסה", f.freezeLogText({ at: "2026-10-14T10:45:13.434Z", to: "2026-11-01 · שבוע 2", since: "2026-10-14" }) === "הכניסה אותה להקפאה מ-14.10.2026 · חוזרת 01.11.2026 לשבוע 2");
  check("**והשורה שכבר רשומה אצל שרון, בלי since**", f.freezeLogText({ at: "2026-10-14T10:45:13.434Z", to: "2026-11-01 · שבוע 2" }) === "הכניסה אותה להקפאה מ-14.10.2026 · חוזרת 01.11.2026 לשבוע 2");
  check("סיום ביום החזרה", f.freezeEndText({ from: "2026-10-14", to: "2026-11-01|2", tag: "1" }) === "ההקפאה מ-14.10.2026 הסתיימה ב-01.11.2026, חזרה לשבוע 2. תגית ההקפאה הוסרה במניצ'ט.");
  check("סיום ביד", f.freezeLogText({ to: "", from: "2026-11-01", since: "2026-10-14" }) === "סיימה לה את ההקפאה מ-14.10.2026 (הייתה אמורה לחזור ב-01.11.2026)");
  check("בכרטיס בזמן ההקפאה", /"בהקפאה"\+fzSince/.test(HTML) && HTML.includes("'חוזרת '+il(w.freeze.back)+' לשבוע '"));
  check("בכרטיס אחרי שחזרה", HTML.includes("'הקפאה'+fzSince") && HTML.includes("'חזרה מהקפאה ב-'+il(w.freeze.back)+' לשבוע '+w.freeze.week"));
  check("**ואחרי שחזרה אין כפתור סיום הקפאה**", HTML.includes("((w.freeze&&!fzPast)?'<button class=\"btn dng\" data-unfreeze="));
}

console.log(`\n${pass} עברו, ${fail} נכשלו`);
process.exit(fail ? 1 : 0);
