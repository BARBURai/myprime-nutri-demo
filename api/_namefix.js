// ===== תיקון שמות שבועי מהאקסל של הפקידה. v8.00 =====
//
// **הבעיה:** אצל חלק מהנשים השם במסך הניהול הוא שם של מכשיר ("ה-iPhone של מיה"), מספר
// טלפון, או ריק. זה מגיע מהשדות F_NAME ו-L_NAME במניצ'ט, שמתמלאים לפעמים משם הטלפון
// בוואטסאפ או בזום. **באקסל של הפקידה יש לרובן שם מלא נכון**, כי היא מקלידה אותו ביד.
//
// **רון אישר ב-11.10.2026:** פעם בשבוע, ביום חמישי, הקוד קורא את האקסל ומתקן. **שינוי של
// F_NAME ו-L_NAME אינו מפעיל אוטומציה במניצ'ט**, לפי רון. **והקובץ של הפקידה אינו משתנה**:
// הוא משותף עם חשבון השירות כצופה בלבד.
//
// | מצב | מה קורה |
// |---|---|
// | באקסל שם מלא אחד, ומניצ'ט מסכים או שאין בו שם מלא | תיקון אוטומטי ("excel") |
// | השם תקין, רק עם תווים נסתרים | ניקוי אוטומטי ("clean") |
// | באקסל ובמניצ'ט שני שמות מלאים שונים, או כמה שמות באקסל | לרשימה לאישור ("conflict") |
// | לא נמצאה באקסל, ובמניצ'ט יש שם מלא תקין | לרשימה לאישור ("mc") |
// | אין שם תקין באף מקום, או כמה אנשי קשר במניצ'ט | לבירור ידני ("manual") |
//
// **אישה שהשם שלה תקין לא נבדקת בכלל**, גם אם באקסל כתוב משהו אחר. **ואישה שהמשרד כבר תיקן
// לה שם במסך הניהול לא נוגעים בה**, כי זו החלטה של אדם.

// תווי כיוון ותווים נסתרים שוואטסאפ מכניס סביב שמות.
export const INVISIBLE = /[​-‏‪-‮⁦-⁩﻿]/g;
// שם של מכשיר, מספר, או סימן שאינו שייך לשם. נגזר מהשמות האמיתיים שנמצאו ב-11.10.2026.
const BAD = /iphone|samsung|galaxy|android|poco|redmi|xiaomi|huawei|oppo|vivo|pixel|win\d*\b|\d|!|’s\b|'s\b|ה-|prime|פריים/i;

export const clean = (s) => String(s || "").replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
export function isBad(first, last) {
  const f = clean(first), l = clean(last);
  // שם משפחה שהוא רק נקודה או מקף ("אלה .") הוא שם חסר, ולא שם תקין.
  return !f || BAD.test((f + " " + l).trim()) || (!!l && !/\p{L}/u.test(l));
}
const letters = (s) => clean(s).replace(/[^\p{L}]/gu, "");
// שם שאפשר לכתוב: שם פרטי ושם משפחה, כל אחד שתי אותיות לפחות, ושום דבר חשוד.
export function usable(first, last) {
  return !isBad(first, last) && letters(first).length >= 2 && letters(last).length >= 2;
}
// "נטע-לי רעיני" ו"נטע לי רעיני" הם אותו שם, וכך גם "לחינו מיכל" ו"מיכל לחינו".
export function sameName(a, b) {
  const flat = (x) => letters(x.first + x.last).toLowerCase();
  const toks = (x) => clean(x.first + " " + x.last).toLowerCase().split(/[^\p{L}]+/u).filter(Boolean).sort().join(" ");
  return flat(a) === flat(b) || toks(a) === toks(b);
}

export function localPhone(p) {
  let d = String(p || "").replace(/\D/g, "");
  if (d.startsWith("972")) d = "0" + d.slice(3);
  else if (d.length === 9 && d[0] === "5") d = "0" + d;
  return d.length >= 9 ? d : "";
}

// חשבונות של בדיקות ושל המשרד. **לא נוגעים**, לפי התוכנית שרון אישר.
export const SKIP = new Set([
  "rhsegal@gmail.com", "rhsegal3@gmail.com", "rhsegal19@gmail.com",
  "b19@gmail.com", "mosheasaraf55@gmail.com", "efidovrat@gmail.com",
]);

// האקסל של הפקידה, כמפתחות לפי מייל ולפי טלפון. **כל הלשוניות**, כי נשים ממחזורים קודמים
// נמצאות בלשוניות קודמות. בכל לשונית מחפשים את שורת הכותרות שבה "שם פרטי".
export function excelIndex(sheets) {
  const byEmail = new Map(), byPhone = new Map();
  let rows = 0;
  const add = (map, k, v) => { if (!k) return; if (!map.has(k)) map.set(k, []); map.get(k).push(v); };
  for (const sh of sheets || []) {
    let col = null;
    for (const row of sh.rows || []) {
      const cells = row.map((c) => clean(c));
      const fi = cells.indexOf("שם פרטי");
      if (fi !== -1) {
        col = { first: fi, last: cells.indexOf("שם משפחה"), email: cells.findIndex((c) => c.startsWith("מייל")), phones: [] };
        cells.forEach((c, i) => { if (c.includes("טלפון")) col.phones.push(i); });
        continue;
      }
      if (!col) continue;
      const first = clean(row[col.first]), last = col.last >= 0 ? clean(row[col.last]) : "";
      if (!first) continue;
      const email = col.email >= 0 ? clean(row[col.email]).toLowerCase() : "";
      const phones = col.phones.map((i) => localPhone(row[i])).filter(Boolean);
      if (!/@/.test(email) && !phones.length) continue;
      rows++;
      const v = { first, last };
      if (/@/.test(email)) add(byEmail, email, v);
      for (const p of new Set(phones)) add(byPhone, p, v);
    }
  }
  return { byEmail, byPhone, rows };
}

// השמות באקסל לאישה: קודם לפי המייל, ורק אם לא נמצאה, לפי הטלפון. כל שם פעם אחת.
export function excelNames(idx, email, phone) {
  let got = (email && idx.byEmail.get(String(email).toLowerCase())) || [];
  if (!got.length) got = idx.byPhone.get(localPhone(phone)) || [];
  const out = [];
  for (const n of got) if (usable(n.first, n.last) && !out.some((o) => sameName(o, n))) out.push({ first: n.first, last: n.last });
  return out;
}

// ההחלטה לאישה אחת. `mc` הוא השם הראשי במניצ'ט: { first, last }, או "multi" כשיש כמה אנשי
// קשר עם הטלפון שלה, או null כשלא נמצאה.
export function decide(cur, xl, mc) {
  if (mc === "multi") return { cat: "manual", why: "multi" };
  if (!isBad(cur.first, cur.last)) return { cat: "clean", to: { first: clean(cur.first), last: clean(cur.last) } };
  const mcOk = mc && usable(mc.first, mc.last) ? { first: clean(mc.first), last: clean(mc.last) } : null;
  if (xl.length === 1) {
    if (mcOk && !sameName(mcOk, xl[0])) return { cat: "conflict", suggest: xl[0], mc: mcOk };
    return { cat: "excel", to: xl[0] };
  }
  if (xl.length > 1) return { cat: "conflict", suggest: xl[0], options: xl, mc: mcOk };
  if (mcOk) return { cat: "mc", suggest: mcOk };
  return { cat: "manual", mc: mc && mc.first ? { first: clean(mc.first), last: clean(mc.last) } : null };
}

// מי נבדקת: עם תאריך התחלה, שהשם שלה משובש או עם תווים נסתרים, ושהמשרד לא תיקן לה שם.
export const START_KEY = "360 - FINAL PERSONAL START";
export function targets(slim, overrides) {
  const out = [];
  for (const [phone, raw] of Object.entries(slim || {})) {
    let c = raw;
    if (typeof c === "string") { try { c = JSON.parse(c); } catch (e) { continue; } }
    if (!c || !String(c[START_KEY] || "").trim()) continue;
    const email = String(c.CF_EMAIL || "").trim().toLowerCase();
    if (email && SKIP.has(email)) continue;
    const ov = email && overrides ? overrides[email] : null;
    if (ov && (ov.first || ov.last)) continue;
    const first = String(c.F_NAME || ""), last = String(c.L_NAME || "");
    if (!isBad(first, last) && !/[​-‏‪-‮⁦-⁩﻿]/.test(first + last)) continue;
    out.push({ phone, email, first, last, start: String(c[START_KEY]).slice(0, 10) });
  }
  return out;
}

export const AUTO = new Set(["excel", "clean"]);
export const CAP = 50;

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

// הריצה. **בלי `live` שום דבר אינו נכתב**, וזו הדרך לראות מה היא הייתה עושה.
// deps: { mcMain(phone), write(t, to), log(entry) }
export async function run({ list, idx, live, cap = CAP, deps }) {
  // אחת אחרי השנייה, כי מניצ'ט מגביל קריאות בשנייה. **תקלה בקריאה למניצ'ט מעבירה אותה
  // לבירור ידני**, ולעולם אינה נקראת כ"אין שם במניצ'ט".
  const items = await pool(list, 1, async (t) => {
    let mc;
    try { mc = await deps.mcMain(t.phone); } catch (e) { return { ...t, cat: "manual", why: "mc_error" }; }
    const d = decide(t, excelNames(idx, t.email, t.phone), mc);
    return { ...t, ...d };
  });
  const auto = items.filter((x) => AUTO.has(x.cat));
  const report = { live: !!live, total: items.length, items, fixed: [], failed: [], stopped: false, cap };
  if (!live) return report;
  if (auto.length > cap) { report.stopped = true; return report; }
  for (const x of auto) {
    try {
      // **השם הישן נשמר לפני הכתיבה**, כדי שאפשר יהיה להחזיר כל תיקון.
      await deps.log({ at: new Date().toISOString(), phone: x.phone, email: x.email, from: { first: x.first, last: x.last }, to: x.to, cat: x.cat });
      const r = await deps.write(x, x.to);
      if (r === "ok") report.fixed.push(x); else report.failed.push({ ...x, error: r });
    } catch (e) { report.failed.push({ ...x, error: "failed" }); }
  }
  return report;
}

// ===== הדוח במייל =====
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// מספרי טלפון שנכנסו לתוך שמות אינם מוצגים, כמו בתצוגה המקדימה.
const hidePhones = (s) => String(s || "").replace(/\d{6,}/g, "[טלפון]");
const full = (n) => (n ? (clean(n.first) + " " + clean(n.last)).trim() : "");
const nowName = (x) => hidePhones(full(x)) || "ריק";

function table(head, rows) {
  if (!rows.length) return "";
  const th = head.map((h) => `<th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd">${esc(h)}</th>`).join("");
  const tr = rows.map((r) => "<tr>" + r.map((c) => `<td style="padding:6px 8px;border-bottom:1px solid #f0f0f0">${esc(c)}</td>`).join("") + "</tr>").join("");
  return `<table style="border-collapse:collapse;font-size:13px;margin:6px 0 16px">${"<tr>" + th + "</tr>"}${tr}</table>`;
}

export function mailHtml(rep, excelRows) {
  const by = (c) => rep.items.filter((x) => x.cat === c);
  const pending = [...by("conflict"), ...by("mc")];
  const manual = by("manual");
  const auto = rep.items.filter((x) => AUTO.has(x.cat));
  const done = rep.live ? rep.fixed : auto;
  const lines = [];
  lines.push(`<h2 style="margin:0 0 10px">תיקון שמות שבועי</h2>`);
  if (!rep.live) lines.push(`<p><b>תצוגה מקדימה בלבד. שום דבר לא שונה.</b> אלה השמות שהיו מתוקנים.</p>`);
  if (rep.stopped) {
    lines.push(`<p><b>לא תוקן כלום.</b> נמצאו ${auto.length} שמות לתיקון, יותר מהתקרה של ${rep.cap}. ייתכן שמשהו השתבש באקסל.</p>`);
  } else {
    lines.push(`<p>תוקנו ${done.length} שמות.</p>`);
  }
  lines.push(`<p>ממתינות לאישורך: ${pending.length}. לכל אחת מופיעים השם היום, השם באקסל והשם במניצ'ט.</p>`);
  lines.push(`<p>לבירור ידני: ${manual.length}.</p>`);
  if (rep.failed.length) lines.push(`<p><b>לא נשמרו: ${rep.failed.length}.</b></p>`);
  lines.push(table(["היום", rep.live && !rep.stopped ? "תוקן ל" : "יהיה", "מייל"], (rep.stopped ? auto : done).map((x) => [nowName(x), full(x.to), x.email || "אין מייל"])));
  if (rep.failed.length) lines.push(table(["היום", "יהיה", "מייל"], rep.failed.map((x) => [nowName(x), full(x.to), x.email || "אין מייל"])));
  if (pending.length) lines.push(`<h3>ממתינות לאישורך</h3>` + table(["היום", "באקסל", "במניצ'ט", "מייל"],
    pending.map((x) => [nowName(x), (x.options || (x.cat === "conflict" ? [x.suggest] : [])).map(full).join(" / ") || "—", full(x.mc || (x.cat === "mc" ? x.suggest : null)) || "—", x.email || "אין מייל"])));
  if (manual.length) lines.push(`<h3>לבירור ידני</h3>` + table(["היום", "במניצ'ט", "מייל"],
    manual.map((x) => [nowName(x), x.why === "multi" ? "כמה אנשי קשר" : x.why === "mc_error" ? "לא נקרא" : (full(x.mc) || "—"), x.email || "אין מייל"])));
  lines.push(`<p style="color:#888;font-size:12px">נקראו ${excelRows} שורות מהאקסל של הפקידה.</p>`);
  return `<div dir="rtl" style="font-family:Arial,sans-serif;color:#222;line-height:1.6">${lines.join("\n")}</div>`;
}
