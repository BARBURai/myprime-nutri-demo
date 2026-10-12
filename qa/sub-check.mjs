// המנוי החודשי מדף התשלום. v8.10
//
//   node qa/sub-check.mjs
//
// **מה שנבדק, ובלי רשת:** החיוב (פעם אחת לכל `rowId`, הגדול מבין התאריכים, 200 רק אחרי
// שנשמר), שש ההחלטות של רון מ-12 באוקטובר 2026, הסריקה שמורידה את התגית, הביטול מול דף
// התשלום, **והשער האמיתי** (`api/access.js`) מול גיליון מדומה ומול Redis מדומה, **וגם
// `api/ai.js` האמיתי** על 30 הצילומים בחודש.
//
// **והשאלה שחשובה מכולן: האם זה משנה משהו לאישה שאין לה מנוי.** כל קבוצה כאן בודקת גם
// את הצד הזה, כי מנוי שנפתח תמיד נראה בדיוק כמו מנוי שאינו קיים אף פעם.

import { decideAccess } from "../api/_product.js";
import { normPhone, parseCharge, applyCharge, subOpen, subStatus, resolveWoman, handleCharge, sweep, cancelSub, secretOk, SUB_HASH, subPhotoKey, payRecurringUrl, PAY_RECURRING_PROD, PAY_RECURRING_DEV } from "../api/_sub.js";
import { auditPush } from "../api/_pushaudit.js";

let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (extra ? "  → " + extra : "")); } };
const NOW = "2026-10-12T10:00:00.000Z";
const israelDay = (off = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + off * 86400000));
const TODAY = israelDay(0);

// ===== 1. הכלים הקטנים =====
console.log("\nטלפון, גוף החיוב, ומפתח\n");
check("05X הופך ל-9725X", normPhone("054-730-4177") === "972547304177");
check("972 נשאר כמו שהוא", normPhone("972547304177") === "972547304177");
check("00972 מאבד את האפסים", normPhone("00972547304177") === "972547304177");
const GOOD = { event: "charge", product: "monthly-smart1", email: "Dana@X.com ", phone: "0541234567", firstName: "דנה", lastName: "כהן", chargedAt: "2026-10-12", paidUntil: "2026-11-16", amount: 49, paymentNum: 1, recurringId: 12345, rowId: "r1" };
check("גוף תקין נקרא, והמייל באותיות קטנות", parseCharge(GOOD).c && parseCharge(GOOD).c.email === "dana@x.com");
check("גוף שהגיע כמחרוזת נקרא גם הוא", !!parseCharge(JSON.stringify(GOOD)).c);
for (const [k, v, err] of [["event", "refund", "bad_event"], ["email", "x", "bad_email"], ["paidUntil", "16.11.2026", "bad_paid_until"], ["chargedAt", "", "bad_charged_at"], ["rowId", "", "no_row_id"]]) {
  check(`${k} פגום מחזיר ${err}`, parseCharge({ ...GOOD, [k]: v }).error === err);
}
check("בלי APP_SUB_KEY הכתובת סגורה לכולם", !secretOk({ headers: { "x-sub-key": "" } }, {}));
check("מפתח נכון עובר", secretOk({ headers: { "x-sub-key": "abc123" } }, { APP_SUB_KEY: "abc123" }));
check("מפתח שגוי באותו אורך נדחה", !secretOk({ headers: { "x-sub-key": "abc124" } }, { APP_SUB_KEY: "abc123" }));
check("הדב מדבר עם הדב של דף התשלום", payRecurringUrl({ VERCEL_ENV: "preview" }) === PAY_RECURRING_DEV);
check("והייצור עם הייצור", payRecurringUrl({ VERCEL_ENV: "production" }) === PAY_RECURRING_PROD);

// ===== 2. החיוב עצמו, בלי רשת =====
console.log("\nחיוב: פעם אחת לכל rowId, והגדול מבין התאריכים\n");
const c1 = parseCharge(GOOD).c;
const a1 = applyCharge(null, c1, NOW);
check("חיוב ראשון נקלט", !a1.dup && a1.rec.paidUntil === "2026-11-16" && a1.rec.count === 1);
const a1b = applyCharge(a1.rec, c1, NOW);
check("אותו rowId פעם שנייה אינו משנה דבר", a1b.dup && a1b.rec === a1.rec);
const c2 = parseCharge({ ...GOOD, rowId: "r2", chargedAt: "2026-11-12", paidUntil: "2026-12-16", paymentNum: 2 }).c;
const a2 = applyCharge(a1.rec, c2, NOW);
check("חיוב שני מאריך ל-paidUntil שלו ולא מוסיף חודש משלנו", a2.rec.paidUntil === "2026-12-16" && a2.rec.count === 2);
const cOld = parseCharge({ ...GOOD, rowId: "r0", chargedAt: "2026-09-12", paidUntil: "2026-10-16" }).c;
check("חיוב ישן שמגיע באיחור אינו מקצר", applyCharge(a2.rec, cOld, NOW).rec.paidUntil === "2026-12-16");
const cancelled = { ...a2.rec, cancelledAt: "2026-11-20", cancelledBy: "טלי" };
const c3 = parseCharge({ ...GOOD, rowId: "r3", chargedAt: "2026-12-01", paidUntil: "2027-01-05" }).c;
check("חיוב אחרי ביטול הוא הרשמה מחדש, והביטול יורד", !applyCharge(cancelled, c3, NOW).rec.cancelledAt);
check("המנוי פתוח עד היום האחרון כולל", subOpen({ paidUntil: "2026-11-16" }, "2026-11-16") && !subOpen({ paidUntil: "2026-11-16" }, "2026-11-17"));
check("סטטוס: פעיל · בוטל · הסתיים", subStatus({ paidUntil: "2026-11-16" }, "2026-11-01") === "active"
  && subStatus({ paidUntil: "2026-11-16", cancelledAt: "2026-11-02" }, "2026-11-03") === "cancelled"
  && subStatus({ paidUntil: "2026-11-16", cancelledAt: "2026-11-02" }, "2026-11-17") === "ended");
check("המונה של הצילומים מתחלף עם כל חיוב", subPhotoKey("a@b.com", a1.rec) !== subPhotoKey("a@b.com", a2.rec));

// ===== 3. מי היא אצלנו =====
console.log("\nזיהוי: מייל, ואם לא אז טלפון, ואם לא אז לא נוצרת\n");
const LIST = [{ email: "reg@x.com", phone: "972541234567" }, { email: "old@x.com", phone: "972500000001" }, { email: "twin1@x.com", phone: "972522222222" }, { email: "twin2@x.com", phone: "972522222222" }];
check("לפי מייל", resolveWoman({ email: "reg@x.com", phone: "", list: LIST }).how === "email");
const byPhone = resolveWoman({ email: "other@gmail.com", phone: "0541234567", list: LIST });
check("מייל אחר והטלפון רשום: לפי הטלפון, תחת הכתובת הרשומה", byPhone.how === "phone" && byPhone.email === "reg@x.com");
check("לא נמצאה בכלל: none, תחת הכתובת ששילמה", resolveWoman({ email: "nobody@x.com", phone: "0599999999", list: LIST }).how === "none");
check("טלפון שרשום אצל שתי כתובות אינו מנוחש", resolveWoman({ email: "n@x.com", phone: "0522222222", list: LIST }).how === "none");
check("כתובת שהמשרד החליף: הרשומה תחת החדשה", resolveWoman({ email: "x@y.com", phone: "0500000001", list: LIST, emailOld: { "old@x.com": "new@x.com" } }).email === "new@x.com");

// ===== 4. handleCharge, עם תלויות מדומות =====
console.log("\nהחיוב מקצה לקצה: שמירה, תגית, מייל לרון\n");
function fakeDeps(opt = {}) {
  const st = { hash: {}, tags: [], mails: [], logs: [], bumps: 0 };
  const deps = {
    st,
    cmd: async (arr) => {
      const [c, k, f, v] = arr;
      if (opt.storeDown || (opt.hsetDown && c === "HSET")) throw new Error("down");
      const H = (st.hash[k] = st.hash[k] || {});
      if (c === "HGET") return H[f] ?? null;
      if (c === "HSET") { H[f] = v; return 1; }
      if (c === "HGETALL") return Object.entries(H).flat();
      return null;
    },
    loadList: async () => { if (opt.listDown) throw new Error("down"); return LIST; },
    loadEmailOld: async () => ({}),
    tag: async (phone, on) => { st.tags.push([phone, on]); return opt.tag || "ok"; },
    mail: async (s, h) => { st.mails.push(s); },
    log: async (em, e) => { st.logs.push([em, e.field]); },
    bump: async () => { st.bumps++; },
    pay: async (b) => { st.paid = b; if (opt.payThrow) throw new Error("t"); return opt.pay || { status: 200, json: { ok: true, paidUntil: "2026-11-16", cancelledAt: "2026-10-20" } }; },
  };
  return deps;
}
let d = fakeDeps();
let r = await handleCharge({ ...GOOD, email: "reg@x.com" }, d, NOW);
const saved = JSON.parse(d.st.hash[SUB_HASH]["reg@x.com"]);
check("רשומה: 200 ונשמרה תחת המייל", r.status === 200 && saved.paidUntil === "2026-11-16");
check("התגית נוספה בחיוב הראשון, לפי הטלפון", d.st.tags.length === 1 && d.st.tags[0][1] === true && saved.tagged === true);
check("שורה ביומן השינויים של הכרטיס", d.st.logs.some((l) => l[0] === "reg@x.com" && l[1] === "sub"));
check("ולרון לא נשלח מייל, כי אין מה לדווח", d.st.mails.length === 0);
r = await handleCharge({ ...GOOD, email: "reg@x.com" }, d, NOW);
check("אותו rowId שוב: 200, dup, והתגית לא נקראה שוב", r.status === 200 && r.json.dup && d.st.tags.length === 1);
r = await handleCharge({ ...GOOD, email: "reg@x.com", rowId: "r2", chargedAt: "2026-11-12", paidUntil: "2026-12-16" }, d, NOW);
check("חיוב חודשי: מאריך, והתגית לא נקראת שוב", r.json.paidUntil === "2026-12-16" && d.st.tags.length === 1);

d = fakeDeps();
r = await handleCharge({ ...GOOD, email: "other@gmail.com" }, d, NOW);
check("החלטה 2: לפי הטלפון, תחת הכתובת הרשומה", r.status === 200 && r.json.matched === "phone" && !!d.st.hash[SUB_HASH]["reg@x.com"]);
check("ורון מקבל מייל שהמיילים שונים", d.st.mails.length === 1 && /שונה/.test(d.st.mails[0]));

d = fakeDeps();
r = await handleCharge({ ...GOOD, email: "nobody@x.com", phone: "0599999999" }, d, NOW);
check("החלטה 1: לא נמצאה: 200, כדי שדף התשלום לא ינסה לנצח", r.status === 200 && r.json.matched === "none");
check("החיוב נרשם תחת הכתובת ששילמה", !!d.st.hash[SUB_HASH]["nobody@x.com"]);
check("ולא נוצרה: אין תגית, אין שורה ביומן", d.st.tags.length === 0 && d.st.logs.length === 0);
check("ורון מקבל מייל", d.st.mails.length === 1 && /אינה רשומה/.test(d.st.mails[0]));

d = fakeDeps({ hsetDown: true });
r = await handleCharge({ ...GOOD, email: "reg@x.com" }, d, NOW);
check("שמירה שנכשלה: לא 200, כדי שדף התשלום ינסה שוב", r.status === 503);
check("ושום תגית לא נוספה על חיוב שלא נשמר", d.st.tags.length === 0);
d = fakeDeps({ listDown: true });
r = await handleCharge({ ...GOOD, email: "reg@x.com" }, d, NOW);
check("רשימה שלא נקראה: 503, ולא 'לא רשומה'", r.status === 503 && !d.st.hash[SUB_HASH]);
d = fakeDeps({ tag: "failed" });
r = await handleCharge({ ...GOOD, email: "reg@x.com" }, d, NOW);
check("מניצ'ט לא ענה: החיוב עדיין 200 ונשמר", r.status === 200 && !!d.st.hash[SUB_HASH]["reg@x.com"]);
check("ורון מקבל מייל שהתגית לא נוספה", d.st.mails.length === 1);
r = await handleCharge({ ...GOOD, email: "reg@x.com", rowId: "r2", chargedAt: "2026-11-12", paidUntil: "2026-12-16" }, d, NOW);
check("והחיוב הבא מנסה את התגית שוב", d.st.tags.length === 2);
r = await handleCharge({ ...GOOD, rowId: "" }, fakeDeps(), NOW);
check("גוף פגום: 400", r.status === 400);

// ===== 5. הסריקה היומית =====
console.log("\nהסריקה: התגית יורדת כש-paidUntil עבר, לא ברגע הביטול\n");
d = fakeDeps();
d.st.hash[SUB_HASH] = {
  "live@x.com": JSON.stringify({ paidUntil: "2026-11-16", tagged: true, phone: "1", cancelledAt: "2026-10-20" }),
  "done@x.com": JSON.stringify({ paidUntil: "2026-10-11", tagged: true, phone: "2" }),
};
let sw = await sweep(d, "2026-10-12", NOW);
check("מי שביטלה ועדיין בתוקף: התגית נשארת", !d.st.tags.some((t) => t[0] === "1"));
check("מי שהתאריך שלה עבר: התגית יורדת והמנוי מסומן כהסתיים", d.st.tags.some((t) => t[0] === "2" && t[1] === false) && JSON.parse(d.st.hash[SUB_HASH]["done@x.com"]).endedAt === "2026-10-12");
sw = await sweep(d, "2026-10-13", NOW);
check("ולמחרת לא נוגעים בה שוב", d.st.tags.filter((t) => t[0] === "2").length === 1);
d = fakeDeps({ tag: "failed" });
d.st.hash[SUB_HASH] = { "done@x.com": JSON.stringify({ paidUntil: "2026-10-11", tagged: true, phone: "2" }) };
sw = await sweep(d, "2026-10-12", NOW);
check("מניצ'ט לא ענה: נשארת מסומנת וננסה מחר, ורון מקבל מייל", JSON.parse(d.st.hash[SUB_HASH]["done@x.com"]).tagged === true && d.st.mails.length === 1);
const back = applyCharge(JSON.parse(d.st.hash[SUB_HASH]["done@x.com"]), parseCharge({ ...GOOD, rowId: "r9", chargedAt: "2026-10-20", paidUntil: "2026-11-24" }).c, NOW).rec;
check("חוזרת לשלם אחרי שהסתיים: המנוי נפתח שוב", !back.endedAt && subOpen(back, "2026-10-21"));

// ===== 6. ביטול מול דף התשלום =====
console.log("\nביטול: רק 200 משם משנה משהו אצלנו\n");
const withSub = () => { const x = fakeDeps(); x.st.hash[SUB_HASH] = { "reg@x.com": JSON.stringify({ paidUntil: "2026-11-16", payEmail: "pay@gmail.com", tagged: true }) }; return x; };
d = withSub();
r = await cancelSub({ email: "reg@x.com", by: "טלי" }, d, NOW);
const cs = JSON.parse(d.st.hash[SUB_HASH]["reg@x.com"]);
check("200: מסומן כבוטל, ומי ביטלה", r.status === 200 && cs.cancelledAt === "2026-10-20" && cs.cancelledBy === "טלי");
check("הביטול נשלח עם המייל ששילמה בו", d.st.paid.email === "pay@gmail.com" && d.st.paid.action === "cancel");
check("הגישה נשארת עד paidUntil, והתגית לא ירדה", subOpen(cs, "2026-11-16") && d.st.tags.length === 0);
check("שורה ביומן: מי ביטלה", d.st.logs.some((l) => l[1] === "sub_cancel"));
for (const [label, pay, code] of [["502, קארדקום לא ענתה", { status: 502, json: { ok: false } }, 502], ["404, אין לה מנוי שם", { status: 404, json: { ok: false } }, 404]]) {
  d = withSub(); d.st.hash[SUB_HASH]["reg@x.com"] = d.st.hash[SUB_HASH]["reg@x.com"];
  const dd = fakeDeps({ pay }); dd.st.hash = d.st.hash;
  r = await cancelSub({ email: "reg@x.com", by: "טלי" }, dd, NOW);
  check(`${label}: לא מוצג כמבוטל`, r.status === code && !r.json.ok && !JSON.parse(dd.st.hash[SUB_HASH]["reg@x.com"]).cancelledAt);
}
{ const dd = fakeDeps({ payThrow: true }); dd.st.hash = withSub().st.hash;
  r = await cancelSub({ email: "reg@x.com", by: "טלי" }, dd, NOW);
  check("דף התשלום לא ענה בכלל: נכשל, ושום דבר לא השתנה", r.status === 502 && !JSON.parse(dd.st.hash[SUB_HASH]["reg@x.com"]).cancelledAt); }
{ const dd = fakeDeps({ pay: { status: 200, json: { ok: true, already: true, paidUntil: "2026-11-16" } } }); dd.st.hash = withSub().st.hash;
  r = await cancelSub({ email: "reg@x.com", by: "טלי" }, dd, NOW);
  check("already: נאמר לפקידה שכבר בוטל", r.status === 200 && r.json.already === true); }
r = await cancelSub({ email: "none@x.com", by: "טלי" }, fakeDeps(), NOW);
check("אין לה מנוי אצלנו: 404, ושום קריאה לדף התשלום", r.status === 404);

// ===== 7. ההכרעה, decideAccess =====
console.log("\nההכרעה: המנוי רק מאריך, גובר על ביטול והקפאה, ולא נוגע ב-Glow\n");
const sun = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const base = { startSunday: sun(2025, 1, 5), solo: 10, today: "2026-10-12" };
check("בלי מנוי: סמארט שנגמר חסום", decideAccess(base).allowed === false);
check("החלטה: מנוי פעיל פותח אותה", decideAccess({ ...base, subUntil: "2026-11-16" }).allowed === true);
check("מנוי שהסתיים: חסומה שוב", decideAccess({ ...base, subUntil: "2026-10-11" }).allowed === false);
check("החלטה 3: מנוי גובר על ביטול", decideAccess({ ...base, cancelled: true, subUntil: "2026-11-16" }).allowed === true);
check("החלטה 3: ועל ביטול בתהליך מהמשרד", decideAccess({ ...base, clerkBlocked: true, subUntil: "2026-11-16" }).allowed === true);
check("החלטה 3: ועל הקפאה", decideAccess({ ...base, freeze: { from: "2026-10-01" }, subUntil: "2026-11-16" }).allowed === true);
const long = { startSunday: sun(2026, 9, 6), today: "2026-10-12" };
check("המנוי לעולם אינו מקצר: 360 פתוח והמנוי נגמר אתמול", decideAccess({ ...long, subUntil: "2026-10-11" }).allowed === true && decideAccess({ ...long, subUntil: "2026-10-11" }).open360 === true);
const gift = { ...base, solo: 0, startSunday: sun(2025, 1, 5), glowFull: true };
check("החלטה 6: מתנת הוובינר אינה נפתחת שוב בזמן המנוי", decideAccess({ ...gift, subUntil: "2026-11-16" }).glowOpen === false);
check("החלטה 6: וגם לא הטבת סולו", decideAccess({ ...base, glowSolo: true, subUntil: "2026-11-16" }).glowOpen === false);
const paid = decideAccess({ ...gift, glowPaid: true, glowStart: "2026-06-01", subUntil: "2026-11-16" });
check("קורס בתשלום: נשאר פתוח, והמסך הוא התוכנית ולא הקורס לבדו", paid.glowOpen === true && paid.product === "360");
const paidNoSub = decideAccess({ ...gift, glowPaid: true, glowStart: "2026-06-01" });
check("ובלי המנוי: אותה אישה מקבלת את מסך הקורס, בדיוק כמו קודם", paidNoSub.product === "glow" && paidNoSub.glowOpen === true);
check("בלי תאריך התחלה: המנוי אינו פותח משהו שלא היה", decideAccess({ today: "2026-10-12", subUntil: "2026-11-16" }).subOn === false);

// ===== 8. הדוח של ההתראות =====
console.log("\nהדוח: מנויה נספרת כמי שהייתה אמורה לקבל תזכורת ערב\n");
const W = [{ email: "s@x.com", start: "2025-01-05", cancelled: true, sheetNewApp: true }];
const who = { sent: new Set(["s@x.com"]), failed: new Set(), pruned: new Set(), done: new Set() };
const wed = "2026-10-14";
check("בלי מנוי: לא נספרת", auditPush({ kind: "evening", date: wed, women: W, who }).should === 0);
check("עם מנוי: נספרת ונספרת כמי שקיבלה", auditPush({ kind: "evening", date: wed, women: W, who, subs: { "s@x.com": JSON.stringify({ paidUntil: "2026-11-16" }) } }).got === 1);
check("ובבוקר שום דבר לא משתנה", auditPush({ kind: "morning", date: wed, women: W, who, subs: { "s@x.com": JSON.stringify({ paidUntil: "2026-11-16" }) } }).should === 0);

// ===== 9. השער האמיתי =====
console.log("\nהשער, api/access.js האמיתי\n");
process.env.ACCESS_SHEET_CSV_URL = "https://sheet.test/csv";
process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";
let CSV = "ID,F_NAME,L_NAME,CF_EMAIL,360 - FINAL  PERSONAL START,ביטלה,SOLO10WEEK\n972541234567,דנה,כהן,dana@x.com,2025-01-05 12:00,,TRUE\n972541234568,רות,לוי,ruth@x.com,2025-01-05 12:00,TRUE,TRUE";
let gstore = { hash: {}, kv: {} };
let SUB_BROKEN = false;
let aiStore = {};
globalThis.fetch = async (url, opt) => {
  const u = String(url);
  if (u.startsWith("https://sheet.test")) return { ok: true, status: 200, text: async () => CSV };
  if (u.startsWith("https://redis.test")) {
    const parts = u.replace("https://redis.test/", "").split("/").map(decodeURIComponent);
    const [cmd, a, b, c] = parts;
    const H = (k) => (gstore.hash[k] = gstore.hash[k] || {});
    let result = null;
    if (cmd === "HGET" && a === SUB_HASH && SUB_BROKEN) return { ok: true, json: async () => ({ error: "WRONGPASS" }) };
    if (cmd === "HSET") { H(a)[b] = c; result = 1; }
    else if (cmd === "HSETNX") { if (H(a)[b] === undefined) { H(a)[b] = c; result = 1; } else result = 0; }
    else if (cmd === "HGET") result = H(a)[b] ?? null;
    else if (cmd === "SET") { const nx = parts.includes("NX"); if (nx && aiStore[a] !== undefined) result = null; else { gstore.kv[a] = b; aiStore[a] = b; result = "OK"; } }
    else if (cmd === "GET") result = aiStore[a] ?? gstore.kv[a] ?? null;
    else if (cmd === "INCR") { aiStore[a] = (Number(aiStore[a]) || 0) + 1; result = aiStore[a]; }
    else if (cmd === "DEL") { delete gstore.kv[a]; result = 1; }
    else result = 0;
    return { ok: true, json: async () => ({ result }) };
  }
  if (u.startsWith("https://api.anthropic.com")) return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "{}" }], usage: { input_tokens: 1, output_tokens: 1 } }) };
  throw new Error("unexpected fetch " + u);
};
const { default: accessHandler } = await import("../api/access.js");
const gate = async (email) => {
  const res = { code: 0, body: null };
  res.status = (c) => { res.code = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = () => {};
  await accessHandler({ query: { email, device: "dev-1" }, method: "GET", headers: {} }, res);
  return res.body || {};
};
let g = await gate("dana@x.com");
check("בלי מנוי: סמארט שנגמר מקבלת expired, כמו היום", g.allowed === false && g.reason === "expired", JSON.stringify(g));
const future = israelDay(30);
gstore.hash[SUB_HASH] = { "dana@x.com": JSON.stringify({ paidUntil: future, lastCharge: TODAY }) };
g = await gate("dana@x.com");
check("עם מנוי פעיל: נכנסת, והאפליקציה מקבלת עד מתי", g.allowed === true && g.sub && g.sub.until === future, JSON.stringify(g));
gstore.hash[SUB_HASH] = { "dana@x.com": JSON.stringify({ paidUntil: israelDay(-1) }) };
g = await gate("dana@x.com");
check("מנוי שהסתיים אתמול: חסומה שוב", g.allowed === false && !g.sub);
gstore.hash[SUB_HASH] = { "ruth@x.com": JSON.stringify({ paidUntil: future }) };
g = await gate("ruth@x.com");
check("החלטה 3 בשער: מי שביטלה ומשלמת נכנסת", g.allowed === true, JSON.stringify(g));
gstore.hash[SUB_HASH] = {};
g = await gate("ruth@x.com");
check("ובלי מנוי היא חסומה כמו היום", g.allowed === false && g.reason === "cancelled");
gstore.hash[SUB_HASH] = { "nobody@x.com": JSON.stringify({ paidUntil: future }) };
g = await gate("nobody@x.com");
check("החלטה 1 בשער: מנוי של מי שאינה רשומה אינו יוצר אותה", g.allowed === false && g.reason === "not_registered");
SUB_BROKEN = true;
g = await gate("dana@x.com");
check("קריאת המנוי נכשלה: התשובה מסומנת degraded, והאפליקציה לא תוציא אותה עליה", g.allowed === false && g.degraded === true, JSON.stringify(g));
SUB_BROKEN = false;

// ===== 10. api/ai.js האמיתי: 30 צילומים בחודש =====
console.log("\n30 צילומים בחודש, api/ai.js האמיתי\n");
process.env.ANTHROPIC_API_KEY = "k";
const { default: aiHandler } = await import("../api/ai.js");
const PHOTO = [{ role: "user", content: [{ type: "image", source: {} }, { type: "text", text: "ארוחה" }] }];
const shoot = async (email) => {
  let code = 0, out = null;
  await aiHandler({ method: "POST", headers: { "x-user-id": email }, body: { messages: PHOTO, model: "m", max_tokens: 5 } },
    { setHeader: () => {}, status: (c) => { code = c; return { json: (j) => { out = j; } }; } });
  return { code, out };
};
const rec = { paidUntil: future, lastCharge: TODAY };
gstore.hash[SUB_HASH] = { "dana@x.com": JSON.stringify(rec) };
aiStore = { "ai:photos:dana@x.com": "70" };
let s = await shoot("dana@x.com");
check("מנויה שגמרה את 70 של התוכנית מצלמת שוב", s.code === 200, JSON.stringify(s));
check("והצילום נספר במונה של החודש, לא של התוכנית", aiStore[subPhotoKey("dana@x.com", rec)] === 1 && aiStore["ai:photos:dana@x.com"] === "70");
aiStore[subPhotoKey("dana@x.com", rec)] = "29";
s = await shoot("dana@x.com");
check("הצילום ה-30 עובר", s.code === 200);
s = await shoot("dana@x.com");
check("וה-31 נחסם, בהודעה של המנוי", s.code === 429 && s.out.scope === "photos" && /החודש/.test(s.out.message));
const rec2 = { paidUntil: future, lastCharge: israelDay(1) };
gstore.hash[SUB_HASH] = { "dana@x.com": JSON.stringify(rec2) };
s = await shoot("dana@x.com");
check("חיוב חדש: המכסה מתחילה מחדש", s.code === 200);
gstore.hash[SUB_HASH] = {};
s = await shoot("dana@x.com");
check("בלי מנוי: 70 של התוכנית נשאר החסם, בדיוק כמו היום", s.code === 429 && /תקופת הליווי/.test(s.out.message));
aiStore = {};
s = await shoot("new@x.com");
check("ואישה רגילה באמצע התוכנית: הצילום נספר כמו תמיד", s.code === 200 && aiStore["ai:photos:new@x.com"] === 1);

// ===== 11. api/notify.js האמיתי: תזכורת ערב למנויה =====
// אחרון בקובץ, כי הוא מקפיא את השעון.
console.log("\nתזכורת ערב, api/notify.js האמיתי\n");
{
  const hebcal = await import("../api/_hebcal.js");
  const addDays = (iso, n) => { const x = new Date(iso + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  let D = "2026-10-06";
  while (new Date(D + "T12:00:00Z").getUTCDay() !== 2 || hebcal.isQuietDay(D) || hebcal.isErev(D)) D = addDays(D, 1);
  const RealDate = Date;
  const FIXED = new RealDate(D + "T19:30:00+03:00").getTime();
  globalThis.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(FIXED); } static now() { return FIXED; } };
  process.env.NOTIFY_SECRET = "t"; process.env.VAPID_PUBLIC = "p"; process.env.VAPID_PRIVATE = "q";
  const webpush = (await import("web-push")).default;
  webpush.setVapidDetails = () => {};
  const pushed = [];
  webpush.sendNotification = async (sub) => { pushed.push(sub.endpoint); return {}; };
  const OLD = addDays(D, -86);   // יום 87, אחרי סוף התוכנית
  const IN = addDays(D, -9);     // יום 10
  const db = { hash: {}, str: {}, sets: {} };
  globalThis.fetch = async (url, opt) => {
    const u = String(url);
    if (!u.startsWith("https://redis.test")) throw new Error("unexpected fetch " + u);
    const [op, key, ...a] = JSON.parse(opt.body);
    let result = null;
    if (op === "HGETALL") result = Object.entries(db.hash[key] || {}).flat();
    else if (op === "HSET") { (db.hash[key] = db.hash[key] || {})[a[0]] = a[1]; result = 1; }
    else if (op === "GET") result = db.str[key] ?? null;
    else if (op === "MGET") result = [key, ...a].map((k) => db.str[k] ?? null);
    else if (op === "SET") { if (a.includes("NX") && db.str[key] != null) result = null; else { db.str[key] = a[0]; result = "OK"; } }
    else if (op === "SADD") result = 1;
    else result = null;
    return { ok: true, json: async () => ({ result }) };
  };
  const reg = (email, ep, start) => [ep, JSON.stringify({ email, sub: { endpoint: ep }, startDate: start, hour: 19 })];
  db.hash["push:subs"] = Object.fromEntries([reg("sub@x.co", "ep-sub", OLD), reg("old@x.co", "ep-old", OLD), reg("frz@x.co", "ep-frz", IN), reg("frzsub@x.co", "ep-frzsub", IN), reg("mid@x.co", "ep-mid", IN)]);
  db.hash["admin:overrides"] = { "frz@x.co": JSON.stringify({ freeze: { from: IN } }), "frzsub@x.co": JSON.stringify({ freeze: { from: IN } }) };
  db.hash[SUB_HASH] = { "sub@x.co": JSON.stringify({ paidUntil: addDays(D, 20) }), "frzsub@x.co": JSON.stringify({ paidUntil: addDays(D, 20) }) };
  const notify = (await import("../api/notify.js")).default;
  const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; }, setHeader() {} };
  await notify({ headers: {}, query: { secret: "t", force: "1" } }, res);
  check("החלטה 4: מנויה אחרי יום 70 מקבלת תזכורת ערב", pushed.includes("ep-sub"), pushed.join(","));
  check("ואותה אישה בלי מנוי לא, כמו היום", !pushed.includes("ep-old"));
  check("החלטה 3: מנויה בהקפאה מקבלת", pushed.includes("ep-frzsub"));
  check("ובהקפאה בלי מנוי לא, כמו היום", !pushed.includes("ep-frz"));
  check("ואישה רגילה באמצע התוכנית מקבלת כמו תמיד", pushed.includes("ep-mid"));
  pushed.length = 0;
  db.str = {};
  const mres = { ...res, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; } };
  await notify({ headers: {}, query: { secret: "t", force: "1", kind: "morning" } }, mres);
  check("ובבוקר מנויה אחרי יום 70 אינה מקבלת תוכן חדש, כי אין", !pushed.includes("ep-sub"));
  globalThis.Date = RealDate;
}

console.log(`\n${pass} עברו, ${fail} נכשלו\n`);
process.exit(fail ? 1 : 0);
