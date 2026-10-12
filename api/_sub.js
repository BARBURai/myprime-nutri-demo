// ===== מנוי חודשי מדף התשלום. v8.10 =====
//
// **הרקע:** `pay.myprime.co.il/monthly-smart1` גובה 49 ₪ לחודש בהוראת קבע בקארדקום,
// ממסיימות סמארט או 360. **החלוקה, החלטת רון:** דף התשלום אחראי על הכסף בלבד, והאפליקציה
// ומסך הניהול מנהלים את המנויה: גישה, תגית במניצ'ט, ביטול ותצוגה למשרד.
//
// **ההחלטות של רון, 12 באוקטובר 2026:**
// 1. מי שאינה קיימת אצלנו **אינה נוצרת.** החיוב נרשם ורון מקבל מייל
// 2. המייל לא נמצא והטלפון כן: **מאריכים לפי הטלפון**, ורון מקבל מייל שהמיילים שונים
// 3. **המנוי גובר על ביטול ועל הקפאה.** מי שמשלמת נכנסת
// 4. מנויה מקבלת צילום ארוחות ותזכורות ערב גם אחרי יום 70
// 5. **30 צילומים בחודש**, ומתחילים מחדש בכל חיוב
// 6. קורס Glow שניתן במתנה או בהטבת סולו **אינו** ממשיך בזמן המנוי
//
// **המפתח:** admin:subs, שדה = המייל שבתוקף, ערך = JSON של הרשומה למטה. **נפרד מהגיליון
// ומהשורות שמגיעות ממניצ'ט**, ולכן שום ייבוא ושום טריגר אינם יכולים לדרוס אותו.
//
// קובץ שמתחיל בקו תחתון אינו נספר כפונקציה בוורסל. ראה v5.21.

export const SUB_HASH = "admin:subs";
export const SUB_TAG_ID = 98746811;
export const SUB_TAG_NAME = "מנוי חודשי - פעיל";
export const SUB_PHOTO_LIMIT = 30;
// כמה מזהי חיוב נשמרים כדי לזהות חיוב שהגיע פעמיים. חמש שנים של חיובים חודשיים.
const ROWS_KEEP = 60;
const HIST_KEEP = 24;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const PAY_RECURRING_PROD = "https://pay.myprime.co.il/api/recurring";
export const PAY_RECURRING_DEV = "https://myprime-pay-git-dev-barburais-projects.vercel.app/api/recurring";
// הדב של האפליקציה מדבר עם הדב של דף התשלום, והייצור עם הייצור. בלי משתנה סביבה נוסף.
export function payRecurringUrl(env) {
  if (env.PAY_RECURRING_URL) return env.PAY_RECURRING_URL;
  return env.VERCEL_ENV === "production" ? PAY_RECURRING_PROD : PAY_RECURRING_DEV;
}

const low = (s) => String(s || "").trim().toLowerCase();

// הטלפון בגיליון ובמניצ'ט הוא 9725XXXXXXXX, ודף התשלום שולח 05XXXXXXXX.
export function normPhone(p) {
  let d = String(p || "").replace(/[^\d]/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) d = "972" + d.slice(1);
  return d;
}

export function parseRec(raw) {
  if (!raw) return null;
  try { const r = JSON.parse(raw); return r && typeof r === "object" ? r : null; } catch (e) { return null; }
}

// **האם המנוי פותח לה את האפליקציה היום.** `paidUntil` כבר כולל את ארבעת ימי החסד, והיום
// האחרון עצמו בכלל.
export function subOpen(rec, today) {
  return !!(rec && DATE_RE.test(String(rec.paidUntil || "")) && String(today) <= rec.paidUntil);
}

// מה מוצג לפקידה. **"בוטל" רק כל עוד הגישה עדיין רצה**, ומשם זה "הסתיים", כמו בנוסח של רון.
export function subStatus(rec, today) {
  if (!rec || !rec.paidUntil) return "";
  if (!subOpen(rec, today)) return "ended";
  return rec.cancelledAt ? "cancelled" : "active";
}

// המונה של הצילומים בחודש הנוכחי. **מתחיל מחדש בכל חיוב**, כי המפתח נושא את תאריך החיוב.
export function subPhotoKey(email, rec) {
  return `ai:subphotos:${low(email)}:${(rec && rec.lastCharge) || "none"}`;
}

export function secretOk(req, env) {
  const want = String(env.APP_SUB_KEY || "");
  const got = String((req.headers && req.headers["x-sub-key"]) || "");
  if (!want || got.length !== want.length) return false;
  let d = 0;
  for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return d === 0;
}

// הגוף שדף התשלום שולח. **כל שדה חובה נבדק כאן**, ומה שחסר מחזיר 400, כלומר דף התשלום
// אינו מנסה שוב עם אותו גוף פגום לנצח.
export function parseCharge(body) {
  let b = body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = null; } }
  if (!b || typeof b !== "object") return { error: "bad_body" };
  if (b.event !== "charge") return { error: "bad_event" };
  const email = low(b.email);
  const paidUntil = String(b.paidUntil || "").trim();
  const chargedAt = String(b.chargedAt || "").trim();
  const rowId = String(b.rowId || "").trim().slice(0, 80);
  if (!EMAIL_RE.test(email)) return { error: "bad_email" };
  if (!DATE_RE.test(paidUntil)) return { error: "bad_paid_until" };
  if (!DATE_RE.test(chargedAt)) return { error: "bad_charged_at" };
  if (!rowId) return { error: "no_row_id" };
  return {
    c: {
      email, paidUntil, chargedAt, rowId,
      phone: normPhone(b.phone),
      first: String(b.firstName || "").trim().slice(0, 60),
      last: String(b.lastName || "").trim().slice(0, 60),
      product: String(b.product || "").slice(0, 60),
      amount: Number(b.amount) || 0,
      paymentNum: parseInt(b.paymentNum, 10) || 0,
      recurringId: String(b.recurringId == null ? "" : b.recurringId).slice(0, 40),
    },
  };
}

// **החיוב עצמו, בלי רשת.** אותו `rowId` משפיע פעם אחת בלבד, וסוף הגישה הוא הגדול מבין מה
// שכבר יש לבין `paidUntil`. **לא מוסיפים חודש בעצמנו**, דף התשלום כבר חישב.
export function applyCharge(prev, c, nowIso) {
  const rec = prev ? { ...prev } : {};
  const rows = Array.isArray(rec.rows) ? rec.rows.slice() : [];
  if (rows.includes(c.rowId)) return { rec: prev, dup: true };
  rows.unshift(c.rowId);
  rec.rows = rows.slice(0, ROWS_KEEP);
  rec.paidUntil = (rec.paidUntil && rec.paidUntil > c.paidUntil) ? rec.paidUntil : c.paidUntil;
  rec.lastCharge = (rec.lastCharge && rec.lastCharge > c.chargedAt) ? rec.lastCharge : c.chargedAt;
  if (!rec.firstCharge || c.chargedAt < rec.firstCharge) rec.firstCharge = c.chargedAt;
  rec.count = (Number(rec.count) || 0) + 1;
  rec.payEmail = c.email;
  if (c.phone) rec.phone = c.phone;
  if (c.recurringId) rec.recurringId = c.recurringId;
  if (c.product) rec.product = c.product;
  const hist = Array.isArray(rec.hist) ? rec.hist.slice() : [];
  hist.unshift({ at: c.chargedAt, until: c.paidUntil, amount: c.amount, n: c.paymentNum, row: c.rowId });
  rec.hist = hist.slice(0, HIST_KEEP);
  // חיוב שמגיע אחרי שהמנוי הסתיים פותח אותו מחדש, ואז התגית צריכה לחזור.
  if (rec.endedAt && rec.paidUntil >= c.chargedAt) delete rec.endedAt;
  // וחיוב שמגיע אחרי ביטול הוא הרשמה מחדש, כי הוראה שבוטלה אינה גובה יותר.
  if (rec.cancelledAt && c.chargedAt > rec.cancelledAt) { delete rec.cancelledAt; delete rec.cancelledBy; }
  rec.at = nowIso;
  return { rec, dup: false };
}

// **מי היא אצלנו.** `list` הוא [{ email, phone }] של כל מי שרשומה, מהשרת או מהגיליון ומההוספה
// הידנית. `emailOld` הוא { ישן: חדש } של כתובות שהמשרד החליף, כדי שהרשומה תשב תחת הכתובת
// שהיא באמת נכנסת איתה.
export function resolveWoman({ email, phone, list, emailOld }) {
  const inForce = (em) => low((emailOld && emailOld[low(em)]) || em);
  const paid = low(email);
  if (emailOld && emailOld[paid]) return { email: inForce(paid), how: "email" };
  if ((list || []).some((w) => low(w.email) === paid)) return { email: paid, how: "email" };
  const p = normPhone(phone);
  if (p) {
    const hits = [...new Set((list || []).filter((w) => w.email && normPhone(w.phone) === p).map((w) => inForce(w.email)))];
    if (hits.length === 1) return { email: hits[0], how: "phone" };
    if (hits.length > 1) return { email: paid, how: "none", ambiguous: hits };
  }
  return { email: paid, how: "none" };
}

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

// ===== החיוב, מדף התשלום =====
//
// deps:
//   cmd(arr)                 פקודה אחת ל-Redis, מחזירה את התוצאה או זורקת
//   loadList()               [{ email, phone }], או זורקת כשאין ממה לקרוא
//   tag(phone, on)           "ok" | "not_found" | "failed" | "off"
//   mail(subject, html)      מייל לרון. לעולם אינו מכשיל את החיוב
//   log(email, entry)        שורה ביומן השינויים של הכרטיס
//   bump()                   מסכים פתוחים מתעדכנים
//
// **200 רק אחרי שהשינוי נשמר.** כל תשובה אחרת אומרת לדף התשלום לנסות שוב בסבב הבא.
export async function handleCharge(body, deps, nowIso) {
  const p = parseCharge(body);
  if (p.error) return { status: 400, json: { ok: false, error: p.error } };
  const c = p.c;
  let emailOld = {};
  let list;
  try {
    list = await deps.loadList();
    emailOld = (deps.loadEmailOld ? await deps.loadEmailOld() : {}) || {};
  } catch (e) { return { status: 503, json: { ok: false, error: "list_failed" } }; }
  const who = resolveWoman({ email: c.email, phone: c.phone, list, emailOld });
  // הרשומה יושבת תחת הכתובת שבתוקף. **ומי שלא נמצאה נרשמת תחת הכתובת ששילמה בה**, כך
  // שאם המשרד יוסיף אותה אחר כך באותה כתובת, המנוי כבר שם.
  let prev = null;
  try { prev = parseRec(await deps.cmd(["HGET", SUB_HASH, who.email])); }
  catch (e) { return { status: 503, json: { ok: false, error: "store_failed" } }; }
  const { rec, dup } = applyCharge(prev, c, nowIso);
  if (dup) return { status: 200, json: { ok: true, dup: true, email: who.email, paidUntil: prev.paidUntil } };
  rec.matched = who.how;
  try { await deps.cmd(["HSET", SUB_HASH, who.email, JSON.stringify(rec)]); }
  catch (e) { return { status: 503, json: { ok: false, error: "store_failed" } }; }

  // **מכאן הכל הוא תוספת, ושום דבר כבר אינו משנה את התשובה לדף התשלום.**
  const notes = [];
  if (who.how !== "none") {
    try { await deps.log(who.email, { field: "sub", to: rec.paidUntil, n: rec.count }); } catch (e) {}
    // התגית: בחיוב הראשון, ובכל חיוב שבא אחרי שלא הצליחה או אחרי שהמנוי הסתיים.
    if (!rec.tagged) {
      let t = "failed";
      try { t = await deps.tag(rec.phone || c.phone, true); } catch (e) {}
      if (t === "ok") {
        rec.tagged = true;
        try { await deps.cmd(["HSET", SUB_HASH, who.email, JSON.stringify(rec)]); } catch (e) {}
      } else if (t !== "off") notes.push(t === "not_found" ? "התגית במניצ'ט לא נוספה: לא נמצאה שם רשומה לפי הטלפון " + (rec.phone || c.phone || "(אין)") : "התגית במניצ'ט לא נוספה: מניצ'ט לא ענה. ננסה שוב בחיוב הבא");
    }
    try { await deps.bump(); } catch (e) {}
  }
  const name = [c.first, c.last].filter(Boolean).join(" ") || "(בלי שם)";
  const line = `${esc(name)} · ${esc(c.email)} · ${esc(c.phone || "בלי טלפון")} · חיוב ${esc(c.chargedAt)} · גישה עד ${esc(c.paidUntil)}`;
  let subject = "";
  let body2 = "";
  if (who.how === "none") {
    subject = "מנוי חודשי: חיוב של מי שאינה רשומה אצלנו";
    body2 = `<p>${line}</p><p><b>היא לא נמצאה אצלנו, לא לפי המייל ולא לפי הטלפון${who.ambiguous ? ` (הטלפון רשום אצל כמה כתובות: ${esc(who.ambiguous.join(", "))})` : ""}, ולכן לא נוצרה.</b> החיוב נרשם. אם מוסיפים אותה במסך הניהול בכתובת הזאת, המנוי כבר יחול עליה.</p>`;
  } else if (who.how === "phone") {
    subject = "מנוי חודשי: המייל בדף התשלום שונה מהרשום אצלנו";
    body2 = `<p>${line}</p><p>היא נמצאה לפי הטלפון, והגישה הוארכה לכתובת הרשומה אצלנו: <b>${esc(who.email)}</b>. היא צריכה להיכנס לאפליקציה עם הכתובת הזאת ולא עם זו ששילמה בה.</p>`;
  }
  if (notes.length) {
    if (!subject) subject = "מנוי חודשי: התגית במניצ'ט לא נוספה";
    body2 += (body2 ? "" : `<p>${line}</p>`) + notes.map((n) => `<p>${esc(n)}</p>`).join("");
  }
  if (subject) { try { await deps.mail(subject, body2); } catch (e) {} }
  return { status: 200, json: { ok: true, email: who.email, matched: who.how, paidUntil: rec.paidUntil, count: rec.count } };
}

// ===== הסריקה היומית =====
//
// **התגית יורדת כש-`paidUntil` עבר ולא הגיע חיוב חדש**, וזה כולל ביטול מהמסך, ביטול ישירות
// בקארדקום, וכרטיס שנדחה. **לא ברגע הביטול.** ומי שהתגית שלה לא ירדה נשארת מסומנת, ומנסים
// שוב מחר.
export async function sweep(deps, today, nowIso) {
  const raw = await deps.cmd(["HGETALL", SUB_HASH]);
  const flat = {};
  if (Array.isArray(raw)) { for (let i = 0; i < raw.length; i += 2) flat[raw[i]] = raw[i + 1]; }
  else if (raw && typeof raw === "object") Object.assign(flat, raw);
  const out = { checked: 0, ended: [], untagged: [], failed: [] };
  for (const em of Object.keys(flat)) {
    const rec = parseRec(flat[em]);
    if (!rec || !rec.paidUntil) continue;
    out.checked++;
    if (subOpen(rec, today)) continue;
    let changed = false;
    if (!rec.endedAt) { rec.endedAt = today; changed = true; out.ended.push(em); }
    if (rec.tagged) {
      let t = "failed";
      try { t = await deps.tag(rec.phone, false); } catch (e) {}
      if (t === "ok" || t === "not_found") { rec.tagged = false; changed = true; out.untagged.push(em); }
      else if (t !== "off") out.failed.push(em);
    }
    if (changed) {
      rec.at = nowIso;
      try { await deps.cmd(["HSET", SUB_HASH, em, JSON.stringify(rec)]); } catch (e) { out.failed.push(em); }
      if (out.ended.includes(em) && rec.matched !== "none") { try { await deps.log(em, { field: "sub_end", to: rec.paidUntil }); } catch (e) {} }
    }
  }
  if (out.failed.length) {
    try { await deps.mail("מנוי חודשי: התגית לא ירדה במניצ'ט", `<p>המנוי הסתיים והתגית "${esc(SUB_TAG_NAME)}" לא ירדה אצל: ${esc(out.failed.join(", "))}. ננסה שוב מחר.</p>`); } catch (e) {}
  }
  return out;
}

// ===== ביטול מהמסך, אל דף התשלום =====
//
// deps.pay(body) מחזיר { status, json }. **רק 200 משנה משהו אצלנו.** 502 אומר שקארדקום לא
// ענתה ושום דבר לא בוטל, ולכן המסך חייב לומר שהביטול נכשל.
export async function cancelSub({ email, by }, deps, nowIso) {
  const em = low(email);
  let rec;
  try { rec = parseRec(await deps.cmd(["HGET", SUB_HASH, em])); }
  catch (e) { return { status: 500, json: { ok: false, error: "store_failed" } }; }
  if (!rec) return { status: 404, json: { ok: false, error: "no_sub" } };
  let r;
  try { r = await deps.pay({ action: "cancel", email: rec.payEmail || em, by }); }
  catch (e) { return { status: 502, json: { ok: false, error: "pay_failed" } }; }
  if (r.status === 404) return { status: 404, json: { ok: false, error: "no_sub_at_pay" } };
  if (r.status !== 200 || !r.json || r.json.ok !== true) return { status: 502, json: { ok: false, error: "pay_failed" } };
  const j = r.json;
  if (!rec.cancelledAt) {
    rec.cancelledAt = String(j.cancelledAt || nowIso).slice(0, 10);
    rec.cancelledBy = String(by || "").slice(0, 40);
  }
  if (DATE_RE.test(String(j.paidUntil || "")) && j.paidUntil > (rec.paidUntil || "")) rec.paidUntil = j.paidUntil;
  rec.at = nowIso;
  try { await deps.cmd(["HSET", SUB_HASH, em, JSON.stringify(rec)]); }
  catch (e) {
    // ההוראה בקארדקום כבר נעצרה. **המסך אומר את זה**, ולא מציג ביטול שנכשל.
    return { status: 200, json: { ok: true, already: !!j.already, paidUntil: rec.paidUntil, saved: false } };
  }
  try { await deps.log(em, { field: "sub_cancel", to: rec.paidUntil }); } catch (e) {}
  try { await deps.bump(); } catch (e) {}
  return { status: 200, json: { ok: true, already: !!j.already, paidUntil: rec.paidUntil, cancelledAt: rec.cancelledAt, saved: true } };
}
