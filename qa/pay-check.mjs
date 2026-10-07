// דף התשלום (pay/), בלי רשת: מריצה את קבצי השרת האמיתיים מול קארדקום מדומה,
// רב מסר מדומה ו-Redis מדומה.
//
// מה שנבדק כאן הוא מה שאסור שיישבר בשקט:
//   - הסכום נלקח מהשרת ולא מהדפדפן
//   - דיווח לכתובת הדיווח אינו מספיק: רק מה שקארדקום עונה ב-GetLpResult קובע
//   - דיווח כפול לא מכניס אותה פעמיים, ותקלה ברב מסר מבקשת מקארדקום לנסות שוב
//   - מי שלא שילמה נכנסת לרשימת "רכישה נכשלה", ומי ששילמה בניסיון אחר לא
//
// node qa/pay-check.mjs

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.log("✗", name); } };

process.env.CARDCOM_TERMINAL = "1000";
process.env.CARDCOM_API_NAME = "test";
process.env.UPSTASH_REDIS_REST_URL = "https://redis.mock";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";
process.env.RESPONDER_CLIENT_ID = "238";
process.env.RESPONDER_CLIENT_SECRET = "s";
process.env.RESPONDER_USER_TOKEN = "u";
process.env.PAY_SWEEP_SECRET = "sweep";
process.env.PAY_ORIGIN = "https://pay.example";

// ---- Redis מדומה ----
const kv = new Map(); const zs = new Map();
function redisCmd([cmd, ...a]) {
  switch (cmd) {
    case "SET": if (a.includes("NX") && kv.has(a[0])) return null; kv.set(a[0], String(a[1])); return "OK";
    case "GET": return kv.has(a[0]) ? kv.get(a[0]) : null;
    case "ZADD": { const z = zs.get(a[0]) || new Map(); z.set(a[2], Number(a[1])); zs.set(a[0], z); return 1; }
    case "ZREM": { const z = zs.get(a[0]); return z && z.delete(a[1]) ? 1 : 0; }
    case "ZRANGEBYSCORE": { const z = zs.get(a[0]) || new Map(); return [...z].filter(([, s]) => s >= Number(a[1]) && s <= Number(a[2])).sort((x, y) => x[1] - y[1]).map(([m]) => m); }
    default: throw new Error("redis mock: " + cmd);
  }
}

// ---- קארדקום ורב מסר מדומים ----
let cardcomCreate = [], lpResult = {}, responderAdds = [], responderDown = false, cardcomDown = false;
globalThis.fetch = async (url, init = {}) => {
  const body = init.body ? JSON.parse(init.body) : null;
  const json = (o, status = 200) => ({ ok: status < 400, status, json: async () => o, text: async () => JSON.stringify(o) });
  if (url === "https://redis.mock") return json({ result: redisCmd(body) });
  if (url.endsWith("/LowProfile/Create")) {
    if (cardcomDown) throw new Error("down");
    cardcomCreate.push(body);
    return json({ ResponseCode: 0, LowProfileId: "lp-" + cardcomCreate.length, Url: "https://secure.cardcom.solutions/EA/x" });
  }
  if (url.endsWith("/LowProfile/GetLpResult")) return json(lpResult[body.LowProfileId] || { ResponseCode: 5 });
  if (url.endsWith("/oauth/token")) return json({ access_token: "tok" });
  if (/\/lists\/[^/]+\/subscribers$/.test(url)) {
    if (responderDown) return json({ error: "x" }, 500);
    responderAdds.push({ list: url.match(/lists\/([^/]+)/)[1], sub: body.subscribers[0], auth: init.headers.Authorization });
    return json({ ok: true });
  }
  throw new Error("unexpected fetch " + url);
};

const { PRODUCTS } = await import("../pay/lib/products.js");
PRODUCTS.smart.rmList = "111";
PRODUCTS.smart.rmFailedList = "1884";
const create = (await import("../pay/api/create.js")).default;
const webhook = (await import("../pay/api/webhook.js")).default;
const sweep = (await import("../pay/api/sweep.js")).default;
const product = (await import("../pay/api/product.js")).default;
const { idOk, parseBuyer } = await import("../pay/lib/buyer.js");

function mkRes() {
  const r = { code: 200, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (o) => { r.body = o; return r; };
  r.send = (o) => { r.body = o; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  return r;
}
const call = async (h, req) => { const res = mkRes(); await h({ headers: { host: "x" }, query: {}, ...req }, res); return res; };

const good = { p: "smart", firstName: "רונית", lastName: "כהן", phone: "050-1234567", email: "Ronit@Gmail.com", tz: "000000018", mkt: true, terms: true };

// ---- בדיקת הפרטים ----
ok(idOk("000000018"), "ת\"ז תקינה עוברת");
ok(!idOk("123456789"), "ת\"ז עם ספרת ביקורת שגויה נפסלת");
ok(!idOk(""), "ת\"ז ריקה נפסלת");
ok(parseBuyer(good).buyer && parseBuyer(good).buyer.email === "ronit@gmail.com", "מייל נשמר באותיות קטנות");
ok(JSON.stringify(parseBuyer({ ...good, mkt: false }).missing) === JSON.stringify(["אישור הדיוור"]), "בלי אישור דיוור: חסר אישור הדיוור");
ok(JSON.stringify(parseBuyer({ ...good, terms: false }).missing) === JSON.stringify(["אישור התקנון"]), "בלי תקנון: חסר אישור התקנון");
ok((parseBuyer({ ...good, biz: { name: "", id: "" } }).missing || []).includes("שם העסק ומספר ח.פ"), "חשבונית עסקית בלי פרטים נפסלת");
ok(parseBuyer({ ...good, mkt: "true" }).missing, "אישור שאינו true ממש אינו נחשב אישור");

// ---- המוצר ----
let r = await call(product, { query: { p: "smart" } });
ok(r.code === 200 && r.body.price === 590, "המוצר מוחזר עם המחיר");
ok(r.body.rmList === undefined && r.body.rmFailedList === undefined, "מספרי הרשימות אינם נשלחים לדפדפן");
r = await call(product, { query: { p: "nope" } });
ok(r.code === 404, "מוצר שלא קיים: 404");
r = await call(product, { query: { p: "__proto__" } });
ok(r.code === 404, "__proto__ אינו מוצר");

// ---- יצירת דף תשלום ----
r = await call(create, { method: "POST", body: { ...good, Amount: 1, price: 1 } });
ok(r.code === 200 && r.body.url, "נוצר דף תשלום");
const sent = cardcomCreate[0];
ok(sent.Amount === 590, "הסכום שנשלח לקארדקום הוא של השרת ולא של הבקשה");
ok(sent.Document.Products[0].UnitCost === 590, "סכום הפריטים בחשבונית שווה לסכום החיוב");
ok(sent.Document.IsSendByEmail === true, "החשבונית נשלחת במייל");
ok(sent.Document.TaxId === "000000018" && sent.Document.Name === "רונית כהן", "החשבונית על שמה ועל הת\"ז שלה");
ok(sent.UIDefinition.CardOwnerIdValue === "000000018", "הת\"ז ממולאת מראש בטופס התשלום");
ok(sent.SuccessRedirectUrl === "https://pay.example/done?p=smart", "דף ההצלחה הוא שלנו, שמעביר לדף התודה");
ok(sent.WebHookUrl === "https://pay.example/api/webhook", "כתובת הדיווח");
ok(sent.AdvancedDefinition.MaxNumOfPayments === 12, "עד 12 תשלומים");
ok(!sent.UIDefinition.CustomFields, "בלי מספר שדה הדיוור לא נשלח שדה מותאם");
const order1 = sent.ReturnValue;
ok(/^smart-[a-z0-9]+-[a-z0-9]+$/.test(order1), "מספר ההזמנה בנוי מהמוצר");
ok(kv.has(`pay:ord:${order1}`) && zs.get("pay:pending").has(order1), "ההזמנה נשמרת וממתינה");

r = await call(create, { method: "POST", body: { ...good, biz: { name: "סטודיו רונית", id: "000000018" } } });
ok(cardcomCreate[1].Document.Name === "סטודיו רונית", "חשבונית עסקית על שם העסק");

r = await call(create, { method: "POST", body: { ...good, tz: "123" } });
ok(r.code === 400 && r.body.missing.includes("תעודת זהות"), "ת\"ז שגויה נעצרת בשרת");
r = await call(create, { method: "GET" });
ok(r.code === 405, "רק POST");
cardcomDown = true;
r = await call(create, { method: "POST", body: good });
ok(r.code === 502, "קארדקום לא עונה: 502 ולא קריסה");
cardcomDown = false;

// ---- הדיווח ----
const paidResult = (order, amount = 590, term = 1000) => ({
  ResponseCode: 0, TerminalNumber: term, ReturnValue: order,
  TranzactionInfo: { ResponseCode: 0, Amount: amount, TranzactionId: 77 },
  UIValues: { CardOwnerName: "רונית כהן", CardOwnerEmail: "ronit@gmail.com", CardOwnerPhone: "0501234567" },
});

r = await call(webhook, { body: { LowProfileId: "fake" } });
ok(r.code === 200 && responderAdds.length === 0, "דיווח מזויף שקארדקום לא מכירה: לא נכנסת לשום רשימה");

lpResult["lp-a"] = paidResult(order1, 1);
r = await call(webhook, { body: { LowProfileId: "lp-a" } });
ok(responderAdds.length === 0, "סכום שאינו 590: לא נחשב תשלום");

lpResult["lp-b"] = paidResult(order1, 590, 999);
r = await call(webhook, { body: { LowProfileId: "lp-b" } });
ok(responderAdds.length === 0, "מסוף אחר: לא נחשב תשלום");

responderDown = true;
lpResult["lp-1"] = paidResult(order1);
r = await call(webhook, { body: { lowprofilecode: "lp-1" } });
ok(r.code === 500, "רב מסר נפל: 500 כדי שקארדקום תנסה שוב");
ok(!kv.has(`pay:done:${order1}`), "ולא מסומן כטופל");
responderDown = false;
r = await call(webhook, { body: "LowProfileId=lp-1" });
ok(r.code === 200 && responderAdds.length === 1, "בניסיון החוזר היא נכנסת לרשימה (גם בדיווח בפורמט טופס)");
ok(responderAdds[0].list === "111" && responderAdds[0].sub.email === "ronit@gmail.com", "לרשימה של המוצר, עם המייל שלה");
ok(responderAdds[0].auth === "Bearer tok", "עם אסימון הגישה של רב מסר");
r = await call(webhook, { body: { LowProfileId: "lp-1" } });
ok(r.body === "already" && responderAdds.length === 1, "דיווח כפול: לא נכנסת פעמיים");
ok(!zs.get("pay:pending").has(order1), "שולמה: יוצאת מרשימת הממתינות");

// ---- מי שלא השלימה ----
const order2 = cardcomCreate[1].ReturnValue; // הזמנה עסקית של אותה אישה, לא שולמה
zs.get("pay:pending").set(order2, Date.now() - 31 * 60 * 1000);
r = await call(sweep, { query: { secret: "sweep" } });
ok(r.body.paid >= 1 && !responderAdds.some((a) => a.list === "1884"), "שילמה בניסיון אחר: לא נכנסת ל\"רכישה נכשלה\"");

await call(create, { method: "POST", body: { ...good, email: "dana@gmail.com", firstName: "דנה" } });
const order3 = cardcomCreate.at(-1).ReturnValue;
r = await call(sweep, { query: { secret: "sweep" } });
ok(!responderAdds.some((a) => a.list === "1884"), "פחות מ-30 דקות: עוד לא");
zs.get("pay:pending").set(order3, Date.now() - 31 * 60 * 1000);
r = await call(sweep, { query: { secret: "sweep" } });
ok(responderAdds.filter((a) => a.list === "1884").length === 1 && responderAdds.at(-1).sub.email === "dana@gmail.com", "אחרי 30 דקות בלי תשלום: נכנסת ל\"רכישה נכשלה\"");
r = await call(sweep, { query: { secret: "sweep" } });
ok(responderAdds.filter((a) => a.list === "1884").length === 1, "פעם אחת בלבד");
r = await call(sweep, { query: { secret: "wrong" } });
ok(r.code === 401, "בלי הסיסמה: 401");

console.log(`${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
