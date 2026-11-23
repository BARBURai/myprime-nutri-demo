// **v8.66: שנה אחורה (365 יום), המקסימום של דף התשלום. רון: "תשנה ל-365 יום".**
// **v8.65: התשלומים של אישה אחת בקארדקום, ללשונית "תשלומים" בכרטיס במסך הניהול.**
// רון, 23.11.2026: "מאשר, לשונית נפרדת, גם לפקידות, תבנה בדב".
//
// הנתונים אינם אצלנו. דף התשלום (myprime-pay) מושך אותם מקארדקום ומחזיר אותם ב-
// `GET /api/stats?format=cctx`, עם `APP_REF_KEY` בכותרת `x-ref-key`, אותו מפתח שדף התשלום
// כבר שולח אלינו ב-refcharge. **הבקשה עוברת דרך השרת שלנו**, כדי שהמפתח לא יגיע לדפדפן.
//
// **תמיד אל דף התשלום בייצור**, גם מהדב: הדב של דף התשלום מוגן בכניסה לוורסל, והנתונים
// האמיתיים של קארדקום נמצאים בייצור. זו קריאה בלבד. `PAY_STATS_URL` קיים לבדיקות.
//
// **מה שעובר לדפדפן מסונן כאן**, שדה אחרי שדה, גם אם דף התשלום ישלח יותר: תאריך, סכום,
// תשלומים, זיכוי, סוג העסקה, מספר חשבונית, קישור לחשבונית (https בלבד), וארבע ספרות.

export const PAY_STATS_URL = "https://pay.myprime.co.il/api/stats";
// דף התשלום אמר 4 עד 10 שניות בקריאה הראשונה. **לא נמדד אצלנו**, ולכן מרווח גדול.
export const PAY_STATS_TIMEOUT_MS = 25000;
export const PAY_DAYS = 365;
const MAX_ROWS = 200;

const str = (v, n) => String(v == null ? "" : v).slice(0, n);

export function cleanTx(t) {
  if (!t || typeof t !== "object") return null;
  const amount = Number(t.amount);
  if (!Number.isFinite(amount)) return null;
  const at = str(t.at, 40);
  if (!/^\d{4}-\d{2}-\d{2}/.test(at)) return null;
  const payments = Math.max(1, Math.min(36, parseInt(t.payments, 10) || 1));
  const docUrl = /^https:\/\//i.test(String(t.docUrl || "")) ? str(t.docUrl, 600) : "";
  const last4 = /^\d{4}$/.test(String(t.last4 || "")) ? String(t.last4) : "";
  return {
    at, amount, payments,
    refund: t.refund === true || amount < 0,
    dealType: str(t.dealType, 30),
    doc: str(t.doc, 40),
    docUrl, last4,
  };
}

// מחזיר { ok: true, transactions } או { ok: false, error }. לעולם אינו זורק.
export async function fetchPayments({ phone, email }, { fetchImpl = fetch, key = process.env.APP_REF_KEY || "", url = process.env.PAY_STATS_URL || PAY_STATS_URL, timeoutMs = PAY_STATS_TIMEOUT_MS } = {}) {
  if (!key) return { ok: false, error: "off" };
  const ph = String(phone || "").replace(/[^\d]/g, "");
  const em = String(email || "").trim().toLowerCase();
  if (!ph && !em) return { ok: false, error: "bad_request" };
  const q = new URLSearchParams({ format: "cctx", days: String(PAY_DAYS) });
  if (ph) q.set("phone", ph);
  if (em) q.set("email", em);
  const ctl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = setTimeout(() => { if (ctl) ctl.abort(); }, timeoutMs);
  try {
    const r = await fetchImpl(url + "?" + q.toString(), { headers: { "x-ref-key": key }, signal: ctl ? ctl.signal : undefined });
    if (!r || !r.ok) return { ok: false, error: "pay_failed" };
    const d = await r.json();
    if (!d || d.ok !== true || !Array.isArray(d.transactions)) return { ok: false, error: "pay_failed" };
    const transactions = d.transactions.map(cleanTx).filter(Boolean).slice(0, MAX_ROWS);
    return { ok: true, days: PAY_DAYS, transactions };
  } catch (e) {
    return { ok: false, error: "pay_failed" };
  } finally {
    clearTimeout(timer);
  }
}
