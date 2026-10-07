// בדיקת הפרטים שהגיעו מהדף. השרת בודק מחדש, כי הדפדפן אינו מקור אמין.

const clip = (v, n) => String(v == null ? "" : v).trim().slice(0, n);

// ספרת ביקורת של תעודת זהות ישראלית. אותו חישוב תקף גם למספר ח.פ.
export function idOk(raw) {
  const s = String(raw || "").replace(/\D/g, "");
  if (s.length < 5 || s.length > 9) return false;
  const d = s.padStart(9, "0");
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let x = Number(d[i]) * (i % 2 ? 2 : 1);
    if (x > 9) x -= 9;
    sum += x;
  }
  return sum % 10 === 0;
}

export function phoneOk(raw) {
  const s = String(raw || "").replace(/[^\d]/g, "");
  return s.length >= 9 && s.length <= 15;
}

export function emailOk(raw) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(raw || "").trim());
}

// מחזיר { buyer } או { missing: [...] } בשמות שמופיעים בהודעה "כדי להמשיך חסר:".
export function parseBuyer(b) {
  b = b || {};
  const buyer = {
    firstName: clip(b.firstName, 40),
    lastName: clip(b.lastName, 40),
    phone: clip(b.phone, 20),
    email: clip(b.email, 120).toLowerCase(),
    tz: clip(b.tz, 12).replace(/\D/g, ""),
    mkt: b.mkt === true,
    terms: b.terms === true,
    biz: b.biz ? { name: clip(b.biz.name, 80), id: clip(b.biz.id, 12).replace(/\D/g, "") } : null,
  };
  const missing = [];
  if (!buyer.firstName) missing.push("שם פרטי");
  if (!buyer.lastName) missing.push("שם משפחה");
  if (!phoneOk(buyer.phone)) missing.push("טלפון נייד");
  if (!emailOk(buyer.email)) missing.push("אימייל");
  if (!idOk(buyer.tz)) missing.push("תעודת זהות");
  if (!buyer.mkt) missing.push("אישור הדיוור");
  if (!buyer.terms) missing.push("אישור התקנון");
  if (buyer.biz && (!buyer.biz.name || !idOk(buyer.biz.id))) missing.push("שם העסק ומספר ח.פ");
  return missing.length ? { missing } : { buyer };
}
