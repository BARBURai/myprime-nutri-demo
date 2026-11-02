// חברה מביאה חברה. v8.39.
//
// **רון, 2 בנובמבר 2026:** אישת סמארט משתפת קישור אישי לדף המכירה. חברה שקונה דרכו מקבלת
// חודש גישה נוסף, וגם מי שהזמינה, עד 3 חודשים. **אין הנחה ואין שינוי מחיר.** חברה שביטלה
// אינה לוקחת את החודש של המזמינה, והחברה מקבלת 70 יום ועוד חודש.
//
// דף התשלום (myprime-pay) שולח לכאן את התשלום עם הקוד, כמו המנוי החודשי. המפתח `APP_REF_KEY`,
// בכותרת `x-ref-key`. בלי המשתנה בוורסל הכתובת סגורה.
//
//   ref:mine   מייל -> קוד           הקוד האישי שלה, נוצר פעם אחת
//   ref:code   קוד -> מייל
//   ref:bonus  מייל -> {m, f, via}   מה שהשער קורא: חודשים, כמה חברות, והאם הגיעה דרך חברה
//   ref:credit מייל -> {friends:[{email, order, at}]}   הפירוט, למסך הניהול
//   ref:by     מייל של חברה -> {from, order, at}
//   ref:orders מספר הזמנה -> 1      אותה הזמנה משפיעה פעם אחת
//
// קובץ שמתחיל בקו תחתון אינו נספר כפונקציה בוורסל. ראה v5.21.

export const REF_MAX_MONTHS = 3;
export const REF_MINE = "ref:mine", REF_CODE = "ref:code", REF_BONUS = "ref:bonus";
export const REF_CREDIT = "ref:credit", REF_BY = "ref:by", REF_ORDERS = "ref:orders";

// אותיות גדולות וספרות, בלי מה שקל לבלבל בטלפון (I, O, 0, 1).
const ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function makeCode(rand = Math.random) {
  let s = "";
  for (let i = 0; i < 6; i++) s += ABC[Math.floor(rand() * ABC.length)];
  return s;
}
export function cleanCode(c) {
  const s = String(c || "").trim().toUpperCase();
  return /^[A-Z0-9]{4,12}$/.test(s) ? s : "";
}
const parse = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; } };
const cleanEmail = (e) => String(e || "").trim().toLowerCase();
const digits = (p) => String(p || "").replace(/[^\d]/g, "").replace(/^0/, "972");

// מה שהשער צריך: כמה חודשים להוסיף, והקוד שלה. **תקלה מחזירה אפס חודשים ובלי קוד**, ולעולם
// אינה סוגרת אישה, כי בלי הבונוס היא מקבלת בדיוק את מה שהייתה מקבלת בלי המנגנון.
export async function readBonus(redis, RU, RT, email) {
  try {
    const b = parse(await redis(RU, RT, "HGET", REF_BONUS, email)) || {};
    return { months: Math.max(0, Number(b.m) || 0), days: Math.max(0, Number(b.pd) || 0), friends: Number(b.f) || 0, via: !!b.via };
  } catch (e) { return { months: 0, days: 0, friends: 0, via: false }; }
}

export async function ensureCode(redis, RU, RT, email, rand) {
  try {
    const have = await redis(RU, RT, "HGET", REF_MINE, email);
    if (have) return String(have);
    for (let i = 0; i < 5; i++) {
      const c = makeCode(rand);
      if (Number(await redis(RU, RT, "HSETNX", REF_CODE, c, email)) === 1) {
        // אם שתי כניסות במקביל יצרו קוד, הראשון שנכתב ל-ref:mine הוא הקוד שלה.
        await redis(RU, RT, "HSETNX", REF_MINE, email, c);
        return String((await redis(RU, RT, "HGET", REF_MINE, email)) || c);
      }
    }
  } catch (e) {}
  return "";
}

// התשלום מדף התשלום. **200 רק אחרי שהכל נשמר**, אחרת דף התשלום ינסה שוב בסבב הבא.
// `rpost(cmd)` מריץ פקודה אחת ומחזיר את התוצאה, וזורק על תקלה.
export async function refCharge(body, rpost, phonesOf, now = Date.now()) {
  const b = body && typeof body === "object" ? body : {};
  const code = cleanCode(b.ref);
  const friend = cleanEmail(b.email);
  const order = String(b.orderId || b.order || "").trim();
  if (!code || !friend || !order) return { status: 400, json: { ok: false, error: "bad_body" } };
  const from = String((await rpost(["HGET", REF_CODE, code])) || "");
  if (!from) return { status: 200, json: { ok: true, skipped: "unknown_ref" } };
  // **הזמנה עצמית אינה נספרת**, לפי מייל או לפי טלפון.
  if (from === friend) return { status: 200, json: { ok: true, skipped: "self" } };
  const fp = digits(b.phone);
  if (fp) {
    let mine = [];
    try { mine = (await phonesOf(from)).map(digits); } catch (e) { mine = []; }
    if (mine.includes(fp)) return { status: 200, json: { ok: true, skipped: "self" } };
  }
  if (Number(await rpost(["HSETNX", REF_ORDERS, order, String(now)])) !== 1) return { status: 200, json: { ok: true, already: true } };
  try {
    const at = new Date(now).toISOString();
    // **חברה נספרת פעם אחת**, גם אם קנתה שוב.
    const was = parse(await rpost(["HGET", REF_BY, friend]));
    // ואותה הזמנה שנקטעה באמצע ממשיכה מאיפה שנעצרה: כל צעד כאן אינו מכפיל את עצמו.
    if (was && was.order !== order) return { status: 200, json: { ok: true, skipped: "friend_counted" } };
    if (!was) await rpost(["HSET", REF_BY, friend, JSON.stringify({ from, order, at })]);
    const fb = parse(await rpost(["HGET", REF_BONUS, friend])) || {};
    await rpost(["HSET", REF_BONUS, friend, JSON.stringify({ ...fb, m: (Number(fb.m) || 0) + (fb.via ? 0 : 1), f: Number(fb.f) || 0, via: true })]);
    const cr = parse(await rpost(["HGET", REF_CREDIT, from])) || { friends: [] };
    if (!Array.isArray(cr.friends)) cr.friends = [];
    if (!cr.friends.some((x) => x && x.email === friend)) cr.friends.push({ email: friend, order, at });
    await rpost(["HSET", REF_CREDIT, from, JSON.stringify(cr)]);
    const mb = parse(await rpost(["HGET", REF_BONUS, from])) || {};
    const own = Math.min(REF_MAX_MONTHS, cr.friends.length);
    await rpost(["HSET", REF_BONUS, from, JSON.stringify({ ...mb, m: own + (mb.via ? 1 : 0), f: cr.friends.length, via: !!mb.via })]);
    return { status: 200, json: { ok: true, from, friend, months: own } };
  } catch (e) {
    // לא נשמר עד הסוף: משחררים את ההזמנה כדי שהניסיון הבא ייספר.
    try { await rpost(["HDEL", REF_ORDERS, order]); } catch (e2) {}
    return { status: 502, json: { ok: false, error: "save_failed" } };
  }
}

// **הטבת נובמבר 2026. v8.41.** רון, 2.11.2026: "28 יום נוספים לכל מי שקנתה סמארט מ-2.11 עד
// 30.11 בחצות, לפי שעת התשלום." דף התשלום שולח כל קנייה של סמארט, עם שעת התשלום, ל-`?promocharge`.
// הימים נשמרים כ-`pd` באותה רשומה של חברה מביאה חברה, ולכן השער קורא אותם באותה פנייה.
// **פעם אחת לכל אישה**, גם אם קנתה פעמיים בחלון.
export const PROMO_NOV26 = "promo:nov26";
export const PROMO_DAYS = 28;
// 02.11.2026 00:00 עד 30.11.2026 בחצות, שעון ישראל (חורף, UTC+2).
export const PROMO_FROM = Date.UTC(2026, 10, 1, 22, 0, 0);
export const PROMO_TO = Date.UTC(2026, 10, 30, 22, 0, 0);
export async function promoCharge(body, rpost) {
  const b = body && typeof body === "object" ? body : {};
  const email = cleanEmail(b.email);
  const order = String(b.orderId || b.order || "").trim();
  const paid = Date.parse(String(b.paidAt || ""));
  if (!email || !order || !Number.isFinite(paid)) return { status: 400, json: { ok: false, error: "bad_body" } };
  if (paid < PROMO_FROM || paid >= PROMO_TO) return { status: 200, json: { ok: true, skipped: "outside_window" } };
  if (Number(await rpost(["HSETNX", PROMO_NOV26, email, JSON.stringify({ order, paidAt: new Date(paid).toISOString() })])) !== 1) return { status: 200, json: { ok: true, already: true } };
  try {
    const fb = parse(await rpost(["HGET", REF_BONUS, email])) || {};
    await rpost(["HSET", REF_BONUS, email, JSON.stringify({ ...fb, pd: (Number(fb.pd) || 0) + PROMO_DAYS })]);
    return { status: 200, json: { ok: true, email, days: PROMO_DAYS } };
  } catch (e) {
    try { await rpost(["HDEL", PROMO_NOV26, email]); } catch (e2) {}
    return { status: 502, json: { ok: false, error: "save_failed" } };
  }
}

// **שיוך ידני של חברה למזמינה, מהמשרד. v8.41.** כשהקוד לא עבר בקנייה. `from` הוא הקוד של
// המזמינה או המייל שלה. עובר באותו `refCharge` בדיוק, עם מספר הזמנה ידני, ולכן כל הכללים חלים:
// הזמנה עצמית אינה נספרת, חברה נספרת פעם אחת, והתקרה של 3 חודשים.
export async function refLink(fromRaw, friendRaw, rpost, phonesOf, now = Date.now()) {
  const friend = cleanEmail(friendRaw);
  const raw = String(fromRaw || "").trim();
  if (!friend || !raw) return { status: 400, json: { ok: false, error: "bad_body" } };
  let code = "";
  if (raw.includes("@")) {
    const from = cleanEmail(raw);
    code = String((await rpost(["HGET", REF_MINE, from])) || "");
    if (!code) {
      for (let i = 0; i < 5 && !code; i++) {
        const c = makeCode();
        if (Number(await rpost(["HSETNX", REF_CODE, c, from])) === 1) {
          await rpost(["HSETNX", REF_MINE, from, c]);
          code = String((await rpost(["HGET", REF_MINE, from])) || c);
        }
      }
    }
  } else code = cleanCode(raw);
  if (!code) return { status: 400, json: { ok: false, error: "bad_ref" } };
  return refCharge({ ref: code, email: friend, orderId: "manual:" + friend }, rpost, phonesOf, now);
}

export function refKeyOk(req) {
  const want = process.env.APP_REF_KEY || "";
  if (!want) return false;
  const h = req.headers || {};
  const got = String(h["x-ref-key"] || h["X-Ref-Key"] || "");
  return got.length === want.length && got === want;
}
