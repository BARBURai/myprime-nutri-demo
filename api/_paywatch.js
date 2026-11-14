// **"שילמו ולא נרשמו". v8.50.** רון, 14.11.2026, על מורן שקל: שילמה על סמארט ב-13.11 בשעה
// 22:25, דף התשלום דיווח לנו מיד, **ומניצ'ט רשם אותה רק כ-15 שעות אחרי**, ועד אז האפליקציה
// אמרה לה "לא רשומה". רון: "אני רוצה לקבל חיווי על אחת שנרשמה". אישר: "מאשר את הבנייה של
// ההתראה ואת הנוסחים ב-20 דקות."
//
// **המקור הוא דף התשלום ולא רב מסר או קארדקום:** הוא כבר מדווח על כל קנייה של סמארט
// (`?promocharge`) ושל 360 (`?promo360`). כל דיווח נרשם כאן, **גם מחוץ לחלון של ההטבה**,
// לפני כל בדיקה אחרת, ולעולם אינו משנה את התשובה לדף התשלום.
//
// **"נרשמה" פירושו שיש לה שורה בשרת שהיא חברה** (`isMember`, תאריך התחלה או תג קנייה), או
// שהמשרד הוסיף אותה ביד. זה מה שהיה חסר אצל מורן. אחרי 20 דקות בלי זה היא ברשימה, ומייל
// אחד יוצא לרון. **ברגע שהיא נרשמת היא יוצאת מהרשימה לבד.**
import { isMember } from "./_mcsync.js";

export const PAY_LOG = "pay:recent";
export const PAY_WAIT_MIN = 20;
// אחרי שבועיים קנייה שעדיין לא נרשמה אינה "עכשיו" יותר, והרשימה לא גדלה לנצח.
export const PAY_KEEP_DAYS = 14;

const cleanEmail = (v) => String(v || "").trim().toLowerCase();
const parse = (v) => { try { return v ? JSON.parse(v) : null; } catch (e) { return null; } };

// נקרא מנתיבי הקנייה. **שגיאה כאן לעולם אינה עוצרת את הקנייה עצמה**, ולכן היא נבלעת.
// HSETNX: הקנייה הראשונה נשמרת, וקנייה חוזרת של אותה אישה אינה מזיזה את השעה.
export async function recordPurchase(body, product, rpost) {
  try {
    const b = body && typeof body === "object" ? body : {};
    const email = cleanEmail(b.email);
    const paid = Date.parse(String(b.paidAt || ""));
    if (!email || !Number.isFinite(paid)) return false;
    const rec = { paidAt: new Date(paid).toISOString(), order: String(b.orderId || b.order || "").slice(0, 80), product };
    const name = [b.firstName, b.lastName].filter(Boolean).join(" ").trim() || String(b.name || "").trim();
    if (name) rec.name = name.slice(0, 80);
    const phone = String(b.phone || "").replace(/[^\d]/g, "");
    if (phone) rec.phone = phone.slice(0, 20);
    await rpost(["HSETNX", PAY_LOG, email, JSON.stringify(rec)]);
    return true;
  } catch (e) { return false; }
}

const flatHash = (v) => {
  if (!v) return {};
  if (!Array.isArray(v)) return v;
  const o = {};
  for (let i = 0; i < v.length; i += 2) o[v[i]] = v[i + 1];
  return o;
};

// השם והטלפון מהשורה בשרת כשדף התשלום לא שלח אותם, כדי שבשורה יהיה לרון במה לחפש.
function pickFromRows(rows) {
  let name = "", phone = "";
  for (const [ph, c] of Object.entries(rows || {})) {
    if (!c || typeof c !== "object") continue;
    if (!phone) phone = String(c.WA_PHONE || c.ID || ph || "").replace(/[^\d]/g, "");
    if (!name) name = [c.F_NAME, c.L_NAME].filter((x) => x && x !== ".").join(" ").trim();
  }
  return { name, phone };
}

// מחזיר את מי ששילמה לפני 20 דקות לפחות ואינה רשומה. **קריאה בלבד**, חוץ מניקוי רשומות:
// מי שנרשמה, ומי שעברו שבועיים מהתשלום שלה. בלי `clean` אין שום כתיבה (מסך הניהול).
export async function paidUnregistered(rpost, now = Date.now(), { clean = false } = {}) {
  const all = flatHash(await rpost(["HGETALL", PAY_LOG]));
  const emails = Object.keys(all);
  if (!emails.length) return [];
  const rows = await rpost(["HMGET", "mc:byemail", ...emails]);
  const manual = await rpost(["HMGET", "admin:manual", ...emails]);
  if (!Array.isArray(rows) || !Array.isArray(manual)) throw new Error("bad_read");
  const out = [], drop = [];
  emails.forEach((email, i) => {
    const rec = parse(all[email]);
    const paid = rec ? Date.parse(rec.paidAt) : NaN;
    if (!rec || !Number.isFinite(paid)) { drop.push(email); return; }
    const mine = parse(rows[i]) || {};
    const member = Object.values(mine).some((c) => isMember(c)) || !!manual[i];
    if (member || now - paid > PAY_KEEP_DAYS * 86400000) { drop.push(email); return; }
    if (now - paid < PAY_WAIT_MIN * 60000) return;
    const fromRows = pickFromRows(mine);
    out.push({ email, paidAt: rec.paidAt, product: rec.product || "", order: rec.order || "",
      name: rec.name || fromRows.name, phone: rec.phone || fromRows.phone, alerted: !!rec.alerted });
  });
  if (clean && drop.length) { try { await rpost(["HDEL", PAY_LOG, ...drop]); } catch (e) {} }
  out.sort((a, b) => a.paidAt.localeCompare(b.paidAt));
  return out;
}

// השעה בישראל, "13.11 22:25", כמו בנוסח שאושר.
export function paidLabel(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.day}.${p.month}`, time: `${p.hour}:${p.minute}` };
}

const escHtml = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// הנוסח שרון אישר, 14.11.2026.
export function alertMail(w, chatUrl) {
  const t = paidLabel(w.paidAt);
  const subject = `שילמה ולא נרשמה: ${w.email}`;
  const line = `שילמה ב-${t.date} בשעה ${t.time}, ועד עכשיו אין לה תאריך התחלה במניצ'ט, ולכן היא לא יכולה להיכנס לאפליקציה.`;
  const who = [w.name, w.email, w.phone].filter(Boolean).map(escHtml).join(" · ");
  const html = `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6">` +
    `<p><b>${who}</b></p><p>${escHtml(line)}</p>` +
    (chatUrl ? `<p><a href="${escHtml(chatUrl)}">השיחה שלה במניצ'ט</a></p>` : "") + `</div>`;
  return { subject, html, text: line };
}

// הריצה המתוזמנת: מייל אחד לכל אישה, **והסימון "נשלח" נכתב רק אחרי שהמייל יצא**, כדי
// שתקלה במייל תנסה שוב בריצה הבאה ולא תבלע את ההתראה.
export async function payWatch(rpost, { now = Date.now(), send, chatOf } = {}) {
  const list = await paidUnregistered(rpost, now, { clean: true });
  let mailed = 0, failed = 0;
  for (const w of list) {
    if (w.alerted) continue;
    let url = "";
    try { url = chatOf ? (await chatOf(w.phone)) || "" : ""; } catch (e) { url = ""; }
    const m = alertMail(w, url);
    const ok = send ? await send(m.subject, m.html) : false;
    if (!ok) { failed++; continue; }
    mailed++;
    try {
      const rec = parse(await rpost(["HGET", PAY_LOG, w.email]));
      if (rec) await rpost(["HSET", PAY_LOG, w.email, JSON.stringify({ ...rec, alerted: new Date(now).toISOString() })]);
    } catch (e) {}
  }
  return { pending: list.length, mailed, failed };
}
