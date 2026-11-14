// "שילמו ולא נרשמו", v8.50. בלי רשת: Redis מדומה בזיכרון.
import fs from "node:fs";
import { recordPurchase, paidUnregistered, payWatch, alertMail, PAY_LOG } from "../api/_paywatch.js";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("✗", m); } };

function store(init = {}) {
  const h = JSON.parse(JSON.stringify(init));
  const calls = [];
  const rpost = async (cmd) => {
    calls.push(cmd);
    const [op, key, ...a] = cmd;
    const t = (h[key] = h[key] || {});
    if (op === "HSETNX") { if (a[0] in t) return 0; t[a[0]] = a[1]; return 1; }
    if (op === "HSET") { t[a[0]] = a[1]; return 1; }
    if (op === "HGET") return t[a[0]] ?? null;
    if (op === "HGETALL") return Object.entries(t).flat();
    if (op === "HMGET") return a.map((f) => t[f] ?? null);
    if (op === "HDEL") { let n = 0; a.forEach((f) => { if (f in t) { delete t[f]; n++; } }); return n; }
    throw new Error("unknown " + op);
  };
  return { h, rpost, calls };
}

const NOW = Date.parse("2026-11-14T10:00:00Z");
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const member = (start) => JSON.stringify({ "972501111111": { F_NAME: "דנה", L_NAME: "כהן", WA_PHONE: "972501111111", "360 - FINAL  PERSONAL START": start || "" } });

// 1. רישום הקנייה
{
  const s = store();
  await recordPurchase({ email: " A@X.com ", paidAt: ago(30), orderId: "o1", phone: "050-111" }, "SMART", s.rpost);
  await recordPurchase({ email: "a@x.com", paidAt: ago(5), orderId: "o2" }, "SMART", s.rpost);
  const r = JSON.parse(s.h[PAY_LOG]["a@x.com"]);
  ok(r.order === "o1" && r.paidAt === ago(30), "קנייה חוזרת אינה מזיזה את השעה הראשונה");
  ok(r.phone === "050111".replace(/^/, "") || r.phone === "050111", "הטלפון נשמר בספרות בלבד");
  ok(await recordPurchase({ email: "", paidAt: ago(1) }, "SMART", s.rpost) === false, "בלי מייל אין רישום");
  const boom = async () => { throw new Error("down"); };
  ok(await recordPurchase({ email: "b@x.com", paidAt: ago(1) }, "SMART", boom) === false, "תקלה ב-Redis נבלעת ואינה זורקת");
}

// 2. מי ברשימה
const base = () => store({
  [PAY_LOG]: {
    "fresh@x.com": JSON.stringify({ paidAt: ago(10), product: "SMART" }),
    "late@x.com": JSON.stringify({ paidAt: ago(25), product: "SMART", name: "מורן שקל", phone: "972507000000" }),
    "lead@x.com": JSON.stringify({ paidAt: ago(60), product: "SMART" }),
    "ok@x.com": JSON.stringify({ paidAt: ago(60), product: "SMART" }),
    "manual@x.com": JSON.stringify({ paidAt: ago(60), product: "360" }),
    "old@x.com": JSON.stringify({ paidAt: ago(15 * 1440), product: "SMART" }),
  },
  "mc:byemail": { "lead@x.com": member(""), "ok@x.com": member("2026-11-15T12:00:00+02:00") },
  "admin:manual": { "manual@x.com": JSON.stringify({ start: "2026-11-15" }) },
});
{
  const s = base();
  const list = await paidUnregistered(s.rpost, NOW);
  const em = list.map((w) => w.email);
  ok(!em.includes("fresh@x.com"), "פחות מ-20 דקות: עוד לא ברשימה");
  ok(em.includes("late@x.com"), "25 דקות בלי שורה בשרת: ברשימה");
  ok(em.includes("lead@x.com"), "שורה של ליד בלי תאריך התחלה: ברשימה");
  ok(!em.includes("ok@x.com"), "יש לה תאריך התחלה בשרת: לא ברשימה");
  ok(!em.includes("manual@x.com"), "המשרד הוסיף אותה ביד: לא ברשימה");
  ok(!em.includes("old@x.com"), "יותר משבועיים: לא ברשימה");
  ok(em.length === 2, "בדיוק שתיים ברשימה");
  const lead = list.find((w) => w.email === "lead@x.com");
  ok(lead.name === "דנה כהן" && lead.phone === "972501111111", "שם וטלפון נלקחים מהשורה בשרת כשדף התשלום לא שלח");
  ok(!s.calls.some((c) => c[0] === "HDEL" || c[0] === "HSET"), "בלי clean אין שום כתיבה");
  ok(Object.keys(s.h[PAY_LOG]).length === 6, "הרשומות נשארו");
}
{
  const s = base();
  await paidUnregistered(s.rpost, NOW, { clean: true });
  const left = Object.keys(s.h[PAY_LOG]).sort();
  ok(JSON.stringify(left) === JSON.stringify(["fresh@x.com", "late@x.com", "lead@x.com"]), "clean מוחק את מי שנרשמה ואת הישנות בלבד: " + left);
}
{
  const s = base();
  const bad = async (cmd) => (cmd[0] === "HMGET" ? { error: "x" } : s.rpost(cmd));
  let threw = false;
  try { await paidUnregistered(bad, NOW); } catch (e) { threw = true; }
  ok(threw, "קריאה שבורה זורקת ולא מחזירה רשימה ריקה שנראית תקינה");
}

// 3. המייל
{
  const m = alertMail({ email: "moran_atlas@yahoo.com", paidAt: "2026-11-13T20:25:25.790Z", name: "מורן שקל", phone: "972507000000" }, "https://app.manychat.com/fb111742985290180/chat/1");
  ok(m.subject === "שילמה ולא נרשמה: moran_atlas@yahoo.com", "נושא המייל בנוסח שאושר");
  ok(m.text === "שילמה ב-13.11 בשעה 22:25, ועד עכשיו אין לה תאריך התחלה במניצ'ט, ולכן היא לא יכולה להיכנס לאפליקציה.", "גוף המייל בנוסח שאושר, בשעון ישראל: " + m.text);
  ok(m.html.includes("chat/1"), "הקישור לשיחה במניצ'ט");
  ok(!/[–—]/.test(m.subject + m.html), "בלי מקף ארוך");
}
{
  const s = base(); const sent = [];
  const send = async (subj) => { sent.push(subj); return true; };
  const r1 = await payWatch(s.rpost, { now: NOW, send });
  ok(r1.mailed === 2 && sent.length === 2, "מייל אחד לכל אחת ברשימה");
  const r2 = await payWatch(s.rpost, { now: NOW + 300000, send });
  ok(r2.mailed === 0 && sent.length === 2, "בריצה הבאה לא נשלח שוב");
  ok(r2.pending === 2, "אבל הן עדיין ברשימה עד שנרשמו");
  s.h["mc:byemail"]["late@x.com"] = member("2026-11-15T12:00:00+02:00");
  const r3 = await payWatch(s.rpost, { now: NOW + 600000, send });
  ok(!("late@x.com" in s.h[PAY_LOG]) && r3.pending === 2 && r3.mailed === 1, "ברגע שנרשמה היא יוצאת לבד, ו-fresh שעברה עכשיו 20 דקות מקבלת מייל");
}
{
  const s = base(); let n = 0;
  const r1 = await payWatch(s.rpost, { now: NOW, send: async () => false });
  ok(r1.mailed === 0 && r1.failed === 2, "מייל שנכשל אינו נספר");
  const r2 = await payWatch(s.rpost, { now: NOW, send: async () => { n++; return true; } });
  ok(r2.mailed === 2 && n === 2, "ונשלח בריצה הבאה, כי הסימון לא נכתב");
}

// 4. החיבור בקבצים
const admin = fs.readFileSync(new URL("../api/admin.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../public/admin.html", import.meta.url), "utf8");
const vercel = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
const pc = admin.slice(admin.indexOf("req.query.promocharge !== undefined"), admin.indexOf("const out = await promoCharge("));
ok(pc.includes('recordPurchase(body, "SMART"'), "קניית סמארט נרשמת לפני בדיקת החלון");
const p3 = admin.slice(admin.indexOf("req.query.promo360 !== undefined"), admin.indexOf("const out = await promo360Charge("));
ok(p3.includes('recordPurchase(body, "360"'), "קניית 360 נרשמת לפני בדיקת החלון");
const pw = admin.slice(admin.indexOf("req.query.paywatch !== undefined"), admin.indexOf("req.query.subsweep !== undefined"));
ok(pw.includes("CRON_SECRET"), "הריצה המתוזמנת מוורסל בלבד");
ok(vercel.crons.some((c) => c.path === "/api/admin?paywatch" && c.schedule === "*/5 * * * *"), "משימה מתוזמנת כל 5 דקות");
ok(admin.includes("paidUnreg,") && admin.includes("paidUnreg = null"), "הרשימה נשלחת למסך, ותקלה היא null");
ok(html.includes("שילמו ולא נרשמו (") && html.includes("' · שילמה ב-'") && html.includes("data-mcopen"), "האריח בנוסח שאושר, עם כפתור מניצ'ט");
ok(html.includes("paidBlock()+"), "האריח מוצג בראש המסך");

console.log(`${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
