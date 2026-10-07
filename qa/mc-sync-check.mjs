// עדכון ישיר ממניצ'ט, שלב ההרצה במקביל. v7.65
//
//   node qa/mc-sync-check.mjs
//
// **רון: "לוקח זמן לעדכון של המערכת מהקובץ. אי אפשר לקבל עדכון ישר ממניצ'ט?"** מניצ'ט
// שולח את השורה של אישה לכתובת ב-`api/admin.js?mcsync`, והשער משווה אותה לגיליון.
//
// **הדבר החשוב ביותר כאן הוא שהתשובה לאישה אינה משתנה**, בשום מצב: זהה, שונה, חסרה,
// ו-Redis שנופל. זה מה שמאפשר להעלות את השלב הזה לייצור בלי סיכון.
//
// **בלי רשת.** `fetch` מוחלף כולו: Redis בזיכרון, וגיליון מדומה.
process.env.ACCESS_SHEET_CSV_URL = "https://sheet.test/csv";
process.env.UPSTASH_REDIS_REST_URL = "redis://r";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";
process.env.ADMIN_KEY = "owner-key-123";
delete process.env.MC_SYNC_SECRET;

const sunday = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 14); while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); })();
const older = (() => { const d = new Date(sunday + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 7); return d.toISOString().slice(0, 10); })();
const START = "360 - FINAL  PERSONAL START";
let SHEET = `ID,F_NAME,CF_EMAIL,${START},ביטלה,חודשי גישה נוספים,GLOW-FULL
972501111111,רונית,ronit@test.com,${sunday} 12:00:00,,,
972502222222,דנה,dana@test.com,${sunday} 12:00:00,,,TRUE
972503333333,מיכל,michal@test.com,${older} 12:00:00,,,
972504444444,מיכל,michal@test.com,${sunday} 12:00:00,,,
`;

// ---------- Redis בזיכרון ----------
let H = {}, L = {}, S = {}, log = [], redisDown = false, sheetCalls = [], trips = [], mcCalls = [];
const MCAPI = { mode: "ok", tags: {} };
const OVERSIZE = new Set(); let SCANFAIL = false;
const hash = (k) => (H[k] = H[k] || {});
function run(cmd) {
  const [c, ...a] = cmd.map(String);
  log.push(c + " " + (a[0] || ""));
  switch (c) {
    case "GET": return S[a[0]] ?? null;
    case "SET": S[a[0]] = a[1]; return "OK";
    case "HGET": return (H[a[0]] || {})[a[1]] ?? null;
    case "HSET": { const h = hash(a[0]); for (let i = 1; i + 1 < a.length; i += 2) h[a[i]] = a[i + 1]; return 1; }
    case "HDEL": if (H[a[0]]) for (const f of a.slice(1)) delete H[a[0]][f]; return 1;
    case "HLEN": return Object.keys(H[a[0]] || {}).length;
    case "HSET_MULTI": return 1;
    case "DEL": delete H[a[0]]; delete S[a[0]]; delete L[a[0]]; return 1;
    case "RENAME": H[a[1]] = H[a[0]]; delete H[a[0]]; return "OK";
    case "HGETALL": if (OVERSIZE.has(a[0])) return { __error: "ERR max request size exceeded" }; return Object.entries(H[a[0]] || {}).flat();
    case "HSCAN": {
      if (SCANFAIL) return { __error: "ERR scan" };
      const keys = Object.keys(H[a[0]] || {}), at = Number(a[1]) || 0, page = keys.slice(at, at + 2);
      return [at + 2 >= keys.length ? "0" : String(at + 2), page.flatMap((k) => [k, H[a[0]][k]])];
    }
    case "HINCRBY": { const h = hash(a[0]); h[a[1]] = String((Number(h[a[1]]) || 0) + Number(a[2])); return Number(h[a[1]]); }
    case "LPUSH": (L[a[0]] = L[a[0]] || []).unshift(a[1]); return L[a[0]].length;
    case "LTRIM": L[a[0]] = (L[a[0]] || []).slice(Number(a[1]), Number(a[2]) + 1); return "OK";
    case "LRANGE": return (L[a[0]] || []).slice(Number(a[1]), Number(a[2]) + 1);
    case "ZCARD": return 1;
    case "ZSCORE": return Date.now();
    case "SISMEMBER": return 0;
    default: return 1;
  }
}
globalThis.fetch = async (url, opt) => {
  const u = String(url);
  if (u.indexOf("redis://") === 0) {
    if (redisDown) throw new Error("Redis נפל");
    trips.push(u.endsWith("/pipeline") ? "pipe:" + opt.body : (opt && opt.body ? opt.body : decodeURIComponent(u)));
    if (u.endsWith("/pipeline")) { const cmds = JSON.parse(opt.body); return { ok: true, json: async () => cmds.map((c) => ({ result: run(c) })) }; }
    const cmd = opt && opt.body ? JSON.parse(opt.body) : u.slice("redis://r/".length).split("/").map(decodeURIComponent);
    const res = run(cmd);
    return { ok: true, json: async () => (res && res.__error ? { error: res.__error } : { result: res }) };
  }
  if (u.indexOf("https://api.manychat.com/") === 0) {
    mcCalls.push({ url: u, method: (opt && opt.method) || "GET" });
    if (MCAPI.mode === "throw") throw new Error("מניצ'ט נפל");
    if (MCAPI.mode === "hang") return new Promise(() => {});
    if (MCAPI.mode === "500") return { ok: false, status: 500, json: async () => ({}) };
    if (MCAPI.mode === "error") return { ok: true, status: 200, json: async () => ({ status: "error", message: "x" }) };
    const id = new URL(u).searchParams.get("subscriber_id");
    return { ok: true, status: 200, json: async () => ({ status: "success", data: { id, tags: (MCAPI.tags[id] || []).map((name, i) => ({ id: i, name })) } }) };
  }
  sheetCalls.push((opt && opt.method) || "GET");
  return { ok: true, status: 200, text: async () => SHEET };
};

const { default: gate } = await import(new URL("../api/access.js", import.meta.url));
const { default: admin } = await import(new URL("../api/admin.js", import.meta.url));

const resOf = () => { const o = { code: 200, body: null }; return [o, { status: (c) => { o.code = c; return { json: (j) => { o.body = j; } }; }, setHeader: () => {} }]; };
async function login(email) { const [o, res] = resOf(); await gate({ query: { email, device: "d1" }, headers: {} }, res); return o.body; }
async function push(body, secret = "s3cret-mc", method = "POST") {
  const [o, res] = resOf();
  await admin({ method, query: { mcsync: "" }, headers: secret ? { "x-mc-secret": secret } : {}, body }, res);
  return o;
}
const strip = (j) => JSON.stringify(j);
const mcCmds = () => log.filter((x) => /\bmc:/.test(x)).length;
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const shadow = () => H["mc:shadow:" + today] || {};

let pass = 0, fail = 0;
const ck = (n, c, x) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x ? "  → " + x : "")); } };
const row = (o) => Object.assign({ ID: "972501111111", F_NAME: "רונית", CF_EMAIL: "ronit@test.com", [START]: sunday + " 12:00:00", "ביטלה": "", "חודשי גישה נוספים": "", "GLOW-FULL": "" }, o);

// ============================================================
console.log("\nלפני שהסיסמה מוגדרת: הכתובת סגורה, והשער לא נוגע בכלום\n");
const base = {};
for (const e of ["ronit@test.com", "dana@test.com", "michal@test.com", "nobody@test.com"]) { log = []; base[e] = await login(e); }
ck("השער עונה כרגיל", base["ronit@test.com"].allowed === true && base["nobody@test.com"].allowed === false, strip(base));
log = []; await login("ronit@test.com");
ck("**ואין אף פקודה על mc:**, כלומר בדיוק הקוד של היום", mcCmds() === 0, log.join(" | "));
ck("הכתובת סגורה בלי המשתנה, גם עם סיסמה", (await push(row({}))).code === 401);

process.env.MC_SYNC_SECRET = "s3cret-mc";

console.log("\nהכתובת עצמה\n");
const nonMc = () => JSON.stringify([Object.entries(H).filter(([k]) => !/^mc:/.test(k)), S]);
const before = nonMc();
ck("סיסמה שגויה נדחית", (await push(row({}), "wrong-secre")).code === 401);
ck("בלי סיסמה נדחית", (await push(row({}), "")).code === 401);
ck("GET אינו מקבל", (await push(row({}), "s3cret-mc", "GET")).code === 405);
const noPhone = await push({ CF_EMAIL: "x@test.com" });
ck("שורה בלי טלפון נדחית ואינה נשמרת", noPhone.code === 400 && !(H["mc:rows"] || {})["", ""], strip(noPhone));
ck("גוף שאינו JSON נדחה", (await push("{not json")).code === 400);
const ok1 = await push(row({}));
ck("שורה תקינה נשמרת", ok1.code === 200 && ok1.body.phone === "972501111111", strip(ok1));
ck("ונכתבת תחת הטלפון", !!H["mc:rows"]["972501111111"]);
ck("ותחת המייל", !!H["mc:byemail"]["ronit@test.com"]);
const ok2 = await push(JSON.stringify(row({ ID: "+972-50-222-2222", CF_EMAIL: "Dana@Test.com", "GLOW-FULL": "TRUE" })));
ck("גוף שהגיע כמחרוזת, וטלפון וכתובת בכל צורה", ok2.code === 200 && ok2.body.phone === "972502222222" && ok2.body.email === "dana@test.com", strip(ok2));
ck("**שום דבר לא נכתב לגיליון, לסימוני המשרד או לגישה**",
   nonMc() === before, "השתנה משהו מחוץ ל-mc:");

console.log("\nעדכון חלקי: רק מה שנשלח משתנה\n");
await push({ ID: "972501111111", "חודשי גישה נוספים": "6" });
const r1 = JSON.parse(H["mc:rows"]["972501111111"]).cells;
ck("השדה שנשלח התעדכן", r1["חודשי גישה נוספים"] === "6", strip(r1));
ck("והמייל ותאריך ההתחלה נשארו", r1.CF_EMAIL === "ronit@test.com" && r1[START].startsWith(sunday), strip(r1));
ck("וגם ברשומה לפי המייל", JSON.parse(H["mc:byemail"]["ronit@test.com"])["972501111111"]["חודשי גישה נוספים"] === "6");
await push({ ID: "972501111111", "חודשי גישה נוספים": "" });

console.log("\nהמייל שלה השתנה במניצ'ט\n");
await push({ ID: "972509999999", CF_EMAIL: "old@test.com", [START]: sunday });
await push({ ID: "972509999999", CF_EMAIL: "new@test.com" });
ck("הכתובת הישנה כבר אינה מחזיקה אותה", !H["mc:byemail"]["old@test.com"], H["mc:byemail"]["old@test.com"]);
ck("והחדשה כן, עם תאריך ההתחלה", JSON.parse(H["mc:byemail"]["new@test.com"])["972509999999"][START] === sunday);
delete H["mc:rows"]["972509999999"]; delete H["mc:byemail"]["new@test.com"];

// ============================================================
console.log("\nהשער: ההשוואה, והתשובה שלא משתנה\n");
H["mc:shadow:" + today] = {};
const same = await login("ronit@test.com");
ck("**שורה זהה: התשובה זהה לזו שבלי מניצ'ט**", strip(same) === strip(base["ronit@test.com"]), strip(same));
ck("ונרשמה כזהה", shadow().same === "1", strip(shadow()));
const dana = await login("dana@test.com");
ck("גם כשיש לה את הקורס המלא", strip(dana) === strip(base["dana@test.com"]) && shadow().same === "2", strip(shadow()));

await push({ ID: "972501111111", [START]: older + " 12:00:00" });
const diffStart = await login("ronit@test.com");
ck("**תאריך אחר במניצ'ט: התאריך של השרת. שלב ב, v7.88**", diffStart.allowed === true && diffStart.startDate === older, strip(diffStart));
ck("ונרשם כפער", shadow().diff === "1", strip(shadow()));
const d0 = JSON.parse(L["mc:diffs"][0]);
ck("והפער נוקב בשדה ובשני הערכים", d0.email === "ronit@test.com" && d0.fields.start && d0.fields.start[0] === sunday && d0.fields.start[1] === older, strip(d0));

await push({ ID: "972501111111", [START]: sunday + " 12:00:00", "ביטלה": "TRUE" });
const cancelled = await login("ronit@test.com");
ck("**ביטול במניצ'ט בלבד אינו נועל אותה: אי הסכמה, היא נכנסת**", cancelled.allowed === true && strip(cancelled) === strip(base["ronit@test.com"]), strip(cancelled));
ck("אבל נרשם כפער בשדה הביטול", ((L["mc:diffs"] || []).map((x) => JSON.parse(x)).find((x) => x.cat === "diff") || { fields: {} }).fields.cancelled, L["mc:diffs"][0]);
ck("**וגם כאי הסכמה על הכניסה. v7.88**", (L["mc:diffs"] || []).some((x) => JSON.parse(x).cat === "gate"), L["mc:diffs"][0]);
await push({ ID: "972501111111", "ביטלה": "" });

console.log("\nכמה פניות ההשוואה מוסיפה. v7.67\n");
const keepShadow = JSON.stringify(H["mc:shadow:" + today] || {}), keepDiffs = JSON.stringify(L["mc:diffs"] || []);
await push({ ID: "972501111111", [START]: older + " 12:00:00" });
trips = [];
await login("ronit@test.com");
const mcTrips = trips.filter((t) => /mc:/.test(t));
ck("**פער: קריאה אחת ורישום אחד, ולא ארבע פניות**", mcTrips.length === 2 && mcTrips.filter((t) => t.startsWith("pipe:")).length === 1, strip(mcTrips));
ck("והרישום בפנייה האחת כולל את הספירה ואת הפער", /HINCRBY/.test(mcTrips.find((t) => t.startsWith("pipe:")) || "") && /LPUSH/.test(mcTrips.find((t) => t.startsWith("pipe:")) || ""));
await push({ ID: "972501111111", [START]: sunday + " 12:00:00" });
trips = [];
await login("ronit@test.com");
ck("זהה: גם כן שתיים בלבד", trips.filter((t) => /mc:/.test(t)).length === 2, strip(trips.filter((t) => /mc:/.test(t))));
{
  const i1 = trips.findIndex((t) => /mc:byemail/.test(t)), i2 = trips.findIndex((t) => /sheet:csv/.test(t));
  ck("**והקריאה יוצאת לפני הגיליון, כלומר במקביל לו**", i1 !== -1 && i2 !== -1 && i1 < i2, i1 + " " + i2);
}
H["mc:shadow:" + today] = JSON.parse(keepShadow); L["mc:diffs"] = JSON.parse(keepDiffs);

console.log("\nחסרה באחד מהם\n");
const onlySheet = await login("michal@test.com");
ck("בגיליון ולא במניצ'ט: תשובה זהה", strip(onlySheet) === strip(base["michal@test.com"]));
ck("ונרשמה כחסרה במניצ'ט", shadow().onlySheet === "1", strip(shadow()));
await push({ ID: "972508888888", CF_EMAIL: "nobody@test.com", [START]: sunday });
const onlyMc = await login("nobody@test.com");
// **משלב ב, v7.88, היא נכנסת, כי יש לה תאריך התחלה בשדה עצמו.** הלידים כבר אינם נשמרים בשרת (v7.85).
ck("**במניצ'ט עם תאריך ולא בגיליון: נכנסת. v7.88**", onlyMc.allowed === true && onlyMc.startDate === sunday, strip(onlyMc));
ck("ונרשמה כקיימת רק במניצ'ט", shadow().onlyMc === "1", strip(shadow()));

console.log("\nשתי שורות לאותה אישה\n");
await push({ ID: "972503333333", CF_EMAIL: "michal@test.com", [START]: older + " 12:00:00" });
await push({ ID: "972504444444", CF_EMAIL: "michal@test.com", [START]: sunday + " 12:00:00" });
const two = await login("michal@test.com");
ck("המאוחרת מנצחת בשני המקורות, ולכן זהות", shadow().same === "3" && strip(two) === strip(base["michal@test.com"]), strip(shadow()));

console.log("\nRedis נופל באמצע\n");
const keep = globalThis.fetch;
let n = 0;
globalThis.fetch = async (url, opt) => {
  if (String(url).indexOf("redis://") === 0) {
    const cmd = opt && opt.body ? JSON.parse(opt.body) : String(url).slice("redis://r/".length).split("/").map(decodeURIComponent);
    if (String(cmd[1] || "").startsWith("mc:")) { n++; throw new Error("נפל"); }
  }
  return keep(url, opt);
};
const down = await login("ronit@test.com");
ck("**תקלה בקריאה ממניצ'ט אינה משנה את התשובה**", n > 0 && strip(down) === strip(base["ronit@test.com"]), n + " " + strip(down));
globalThis.fetch = keep;

console.log("\nמסך הניהול\n");
const [so, sres] = resOf();
await admin({ method: "GET", query: { key: "owner-key-123", mcstatus: "" }, headers: {} }, sres);
const st = so.body || {};
ck("מחזיר כמה שורות הגיעו", st.ok && st.rows >= 5 && st.received >= 5, strip(st).slice(0, 200));
ck("ואת ספירת היום", st.days && st.days[0].day === today && st.days[0].same === 3 && st.days[0].diff === 2, strip(st.days && st.days[0]));
ck("ואת הפערים האחרונים", Array.isArray(st.diffs) && st.diffs.length >= 2);
const [uo, ures] = resOf();
await admin({ method: "GET", query: { key: "wrong", mcstatus: "" }, headers: {} }, ures);
ck("ובלי מפתח המשרד אינו נפתח", uo.code === 401);

// ============================================================
console.log("\n\"Add Full Contact Data\": אותה בקשה בכל אוטומציה\n");
const fullBody = {
  id: "123456789", first_name: "אורית", last_name: "לוי", whatsapp_phone: "+972507777777",
  custom_fields: { CF_EMAIL: "orit@test.com", [START]: sunday + " 12:00:00", "360-WEEK": "3" },
  tags: [{ id: 1, name: "ביטלה 360 ❌❌❌" }, { id: 2, name: "360 התקינה" }],
};
const f1 = await push(fullBody);
ck("נקלטת, והטלפון מהוואטסאפ ולא ממספר המנוי", f1.code === 200 && f1.body.phone === "972507777777" && !H["mc:rows"]["123456789"], strip(f1));
const fc = JSON.parse(H["mc:rows"]["972507777777"]).cells;
ck("שדות לפי השם, והשם הפרטי", fc.CF_EMAIL === "orit@test.com" && fc.F_NAME === "אורית" && fc[START].startsWith(sunday), strip(fc));
ck("**תגית עם שם אחר בגיליון נכנסת לעמודה של הגיליון**", fc["ביטלה"] === "TRUE" && fc["הורידה אפליקציה"] === "TRUE" && fc["שבוע בתוכנית"] === "3", strip(fc));
ck("עמודת כן או לא בלי תגית נרשמת ריקה", fc["GLOW-FULL"] === "" && fc["צמיד"] === "", strip(fc));
await push(Object.assign({}, fullBody, { tags: [{ name: "360 התקינה" }] }));
ck("**תגית שהוסרה במניצ'ט מתרוקנת**", JSON.parse(H["mc:rows"]["972507777777"]).cells["ביטלה"] === "", H["mc:rows"]["972507777777"]);
await push({ full_contact: JSON.stringify(Object.assign({}, fullBody, { whatsapp_phone: "972506666666" })) });
ck("גם כשהנתונים עטופים בתוך full_contact", !!H["mc:rows"]["972506666666"]);
ck("והבקשות נשמרות כדוגמה, עד חמש", Array.isArray(L["mc:samples"]) && L["mc:samples"].length === 5 && JSON.parse(L["mc:samples"][0]).full === true);

console.log("\nייבוא הגיליון לשרת\n");
delete S["sheet:csv:v1"];
SHEET = SHEET + "972505555555,נועה,noa@test.com," + sunday + " 12:00:00,,,\n";
const mcBefore = H["mc:rows"]["972501111111"];
const nonMcImp = () => JSON.stringify(Object.entries(H).filter(([k]) => !/^mc:/.test(k)));
const nonMcImpBefore = nonMcImp();
sheetCalls = [];
const [io, ires] = resOf();
await admin({ method: "POST", query: { key: "owner-key-123" }, headers: {}, body: { mcImport: true } }, ires);
ck("הייבוא עובד למנהל", io.code === 200 && io.body.ok && io.body.imported === 1 && io.body.keptMc === 4, strip(io.body));
ck("**שורה שהגיעה ממניצ'ט לא השתנתה**", H["mc:rows"]["972501111111"] === mcBefore);
ck("השורה החדשה נכנסה, מסומנת כייבוא", JSON.parse(H["mc:rows"]["972505555555"]).src === "import");
ck("ונמצאת לפי המייל, וגם מי שהגיעה ממניצ'ט", !!H["mc:byemail"]["noa@test.com"] && !!H["mc:byemail"]["ronit@test.com"] && !!H["mc:byemail"]["orit@test.com"]);
ck("**הגיליון רק נקרא, ושום דבר לא נכתב אליו**", sheetCalls.length >= 1 && sheetCalls.every((m) => m === "GET"), strip(sheetCalls));
ck("**ושום דבר מחוץ ל-mc: לא השתנה**", nonMcImp() === nonMcImpBefore, "השתנה משהו מחוץ ל-mc:");
hash("admin:codes")["CLERK1"] = JSON.stringify({ name: "טלי" });
const [co, cres] = resOf();
await admin({ method: "POST", query: { key: "CLERK1" }, headers: {}, body: { mcImport: true } }, cres);
ck("**ופקידה שאינה מנהל אינה יכולה להריץ אותו**", co.code === 403, co.code);
const [s2, s2res] = resOf();
await admin({ method: "GET", query: { key: "owner-key-123", mcstatus: "" }, headers: {}, body: null }, s2res);
ck("מסך הניהול: כמה נשים הגיעו ממניצ'ט, וכמה יובאו", s2.body.fromMc >= 6 && s2.body.imported === 1, strip({ f: s2.body.fromMc, i: s2.body.imported }));
const noa = await login("noa@test.com");
ck("והשער עדיין עונה לפי הגיליון", noa.allowed === true, strip(noa));

// ============================================================
console.log("\nהתגיות ממניצ'ט עצמו, כי \"Add Full Contact Data\" אינו כולל אותן. v7.72\n");
// **הצורה האמיתית, מבקשה שנשמרה בייצור 30.09.2026:** יש id ו-custom_fields, ואין tags בכלל.
process.env.MANYCHAT_TOKEN = "mc-token";
process.env.MC_TAGS_TIMEOUT_MS = "300";
const realBody = (o) => Object.assign({
  key: "user:555", id: "555", first_name: "שירה", last_name: "כהן", whatsapp_phone: "+972508888888", email: null,
  custom_fields: { WA_PHONE: "972508888888", CF_EMAIL: "shira@test.com", [START]: sunday + " 12:00:00" },
}, o);
const cellsOf = (p) => JSON.parse(H["mc:rows"][p]).cells;
MCAPI.mode = "ok"; MCAPI.tags["555"] = ["360 ביטלה ❌❌❌", "GLOW- DEMO 💄", "אפליקציה תזונה", "GLOW-FULL", "RTEMP8"];
mcCalls = [];
const t1 = await push(realBody({}));
const c1 = cellsOf("972508888888");
ck("נקלטת, והשרת שואל את מניצ'ט על התגיות", t1.code === 200 && mcCalls.length === 1, strip(t1) + " " + mcCalls.length);
ck("**לפי מספר המנוי, ובקריאה בלבד**", mcCalls.length === 1 && mcCalls[0].method === "GET" && /getInfo\?subscriber_id=555$/.test(mcCalls[0].url), strip(mcCalls));
ck("ביטול מהתגית נכנס לעמודה ביטלה", c1["ביטלה"] === "TRUE", strip(c1));
ck("**\"GLOW- DEMO 💄\" נכנס ל\"בונוס איפור\"**", c1["בונוס איפור"] === "TRUE", strip(c1));
ck("**\"אפליקציה תזונה\" נכנס ל\"אפליקציית תזונה\"**", c1["אפליקציית תזונה"] === "TRUE", strip(c1));
ck("ועמודת כן או לא בלי תגית נרשמת ריקה", c1["צמיד"] === "" && c1["SOLO6"] === "", strip(c1));
MCAPI.tags["555"] = ["GLOW- DEMO 💄", "אפליקציה תזונה", "GLOW-FULL"];
await push(realBody({}));
ck("**תגית שהוסרה במניצ'ט מתרוקנת**", cellsOf("972508888888")["ביטלה"] === "", strip(cellsOf("972508888888")));
// v7.79: התגית האמיתית במניצ'ט היא "GLOW-FULL💄💄💄", ונמצאה בהשוואה של 04.10.2026
MCAPI.tags["555"] = ["GLOW-FULL💄💄💄"];
await push(realBody({}));
const gf = cellsOf("972508888888");
ck("**\"GLOW-FULL💄💄💄\" נכנסת לעמודה GLOW-FULL**", gf["GLOW-FULL"] === "TRUE", strip(gf));
ck("ואינה יוצרת עמודה משלה", !Object.keys(gf).some((k) => k !== "GLOW-FULL" && k.startsWith("GLOW-FULL")), strip(gf));
MCAPI.tags["555"] = ["GLOW-FULL-M"];
await push(realBody({}));
ck("**\"GLOW-FULL-M\" נשארת נפרדת ואינה נקראת כ-GLOW-FULL**", cellsOf("972508888888")["GLOW-FULL"] === "", strip(cellsOf("972508888888")));
MCAPI.tags["555"] = ["SOLO10WEEK ⭐", "glow-solo"];
await push(realBody({}));
ck("קישוט ואותיות קטנות בתגית של עמודת כן או לא", cellsOf("972508888888")["SOLO10WEEK"] === "TRUE" && cellsOf("972508888888")["GLOW-SOLO"] === "TRUE", strip(cellsOf("972508888888")));
MCAPI.tags["555"] = ["360 ביטלה ❌❌❌", "GLOW-FULL"];
await push(realBody({}));
const beforeFail = cellsOf("972508888888");
for (const mode of ["throw", "500", "error", "hang"]) {
  MCAPI.mode = mode;
  const t0 = Date.now();
  const r = await push(realBody({ custom_fields: { WA_PHONE: "972508888888", CF_EMAIL: "shira@test.com", [START]: older + " 12:00:00" } }));
  const c = cellsOf("972508888888");
  ck(`מניצ'ט ${mode}: הבקשה נקלטת, השדות מתעדכנים, **והתגיות נשארות כמו שהיו**`,
     r.code === 200 && c[START].startsWith(older) && c["ביטלה"] === "TRUE" && c["GLOW-FULL"] === "TRUE" && c["בונוס איפור"] === beforeFail["בונוס איפור"] && (Date.now() - t0) < 3000,
     mode + " " + strip(c));
}
MCAPI.mode = "ok";
delete process.env.MANYCHAT_TOKEN;
mcCalls = [];
await push(realBody({}));
ck("בלי מפתח למניצ'ט: אין פנייה, והתגיות נשארות", mcCalls.length === 0 && cellsOf("972508888888")["ביטלה"] === "TRUE", strip(cellsOf("972508888888")));
process.env.MANYCHAT_TOKEN = "mc-token";
mcCalls = [];
await push(Object.assign({}, fullBody, { id: "777", tags: [{ name: "360 התקינה" }] }));
ck("**כשהתגיות כבר בבקשה, אין פנייה נוספת**", mcCalls.length === 0, mcCalls.length);
// שורה שיובאה מהגיליון עם ביטול, ואחריה בקשה ממניצ'ט כשהוא אינו עונה
hash("mc:rows")["972509999999"] = JSON.stringify({ cells: { ID: "972509999999", CF_EMAIL: "yael@test.com", [START]: sunday + " 12:00:00", "ביטלה": "TRUE", "GLOW-FULL": "TRUE" }, t: 1, src: "import" });
MCAPI.mode = "500";
await push(realBody({ id: "999", whatsapp_phone: "+972509999999", custom_fields: { WA_PHONE: "972509999999", CF_EMAIL: "yael@test.com", [START]: sunday + " 12:00:00" } }));
const yc = cellsOf("972509999999");
ck("**שורה מהייבוא עם ביטול אינה מאבדת אותו כשמניצ'ט לא עונה**", yc["ביטלה"] === "TRUE" && yc["GLOW-FULL"] === "TRUE", strip(yc));
MCAPI.mode = "ok";
const shira = await login("shira@test.com");
ck("והשער עדיין עונה לפי הגיליון בלבד", shira.allowed === false, strip(shira));

// ============================================================
console.log("\nאותו טלפון פעמיים בגיליון: הייבוא בוחר כמו השער. v7.80\n");
// **מהשוואה אמיתית, 04.10.2026:** שש נשים על שתי שורות עם אותו טלפון ואותו מייל. הייבוא
// שמר את התחתונה, והשער בוחר את תאריך ההתחלה המאוחר, ובתיקו את הראשונה.
const newer = sunday, old2 = older;
SHEET = `ID,F_NAME,CF_EMAIL,${START},ביטלה,חודשי גישה נוספים,GLOW-FULL,בונוס איפור,GLOW-PAID
972507000001,א,dupa@test.com,${newer} 12:00:00,FALSE,,TRUE,,
972507000001,א,dupa@test.com,${old2} 12:00:00,FALSE,,,,
972507000002,ב,dupb@test.com,${newer} 12:00:00,FALSE,,,TRUE,
972507000002,ב,dupb@test.com,${newer} 12:00:00,FALSE,,,,
972507000003,ג,dupc@test.com,${newer} 12:00:00,FALSE,,,,
972507000003,ג,dupc@test.com,${old2} 12:00:00,TRUE,,,,
972507000004,ד,dupd@test.com,${newer} 12:00:00,FALSE,,,,
972507000004,ד,dupd@test.com,,FALSE,,TRUE,,
972507000005,ה,dupe@test.com,${old2} 12:00:00,FALSE,,,,
972507000005,ה,dupe@test.com,${newer} 12:00:00,FALSE,,TRUE,,
972507000006,ו,dupf@test.com,${newer} 12:00:00,FALSE,,TRUE,,
972507000006,ו,dupf@test.com,${old2} 12:00:00,FALSE,,TRUE,,TRUE
`;
delete S["sheet:csv:v1"];
const [dio, dires] = resOf();
await admin({ method: "POST", query: { key: "owner-key-123" }, headers: {}, body: { mcImport: true } }, dires);
ck("הייבוא רץ", dio.code === 200 && dio.body.ok, strip(dio.body));
const dc = (n) => JSON.parse(H["mc:rows"]["97250700000" + n]).cells;
ck("**התאריך המאוחר מנצח, עם GLOW-FULL שלו**, גם כשהוא השורה העליונה", dc(1)[START].startsWith(newer) && dc(1)["GLOW-FULL"] === "TRUE", strip(dc(1)));
ck("**בתיקו הראשונה מנצחת**, ואיתה הבונוס", dc(2)["בונוס איפור"] === "TRUE", strip(dc(2)));
ck("**ביטול נספר מכל השורות**, גם מהשורה שהפסידה", dc(3)[START].startsWith(newer) && dc(3)["ביטלה"] === "TRUE", strip(dc(3)));
ck("שורה בלי תאריך לעולם אינה מנצחת", dc(4)[START].startsWith(newer) && dc(4)["GLOW-FULL"] === "", strip(dc(4)));
ck("כשהמאוחרת היא התחתונה, היא מנצחת", dc(5)[START].startsWith(newer) && dc(5)["GLOW-FULL"] === "TRUE", strip(dc(5)));
ck("GLOW-PAID נספר מכל השורות, כמו בשער", dc(6)["GLOW-PAID"] === "TRUE" && dc(6)[START].startsWith(newer), strip(dc(6)));
for (const n of [1, 2, 3, 4, 5, 6]) {
  const e = "dup" + "abcdef"[n - 1] + "@test.com";
  const sh0 = Object.assign({}, shadow()), d0 = (L["mc:diffs"] || []).length;
  const r = await login(e);
  const sh1 = shadow();
  ck(`**${e}: השער רושם זהות מול השרת, ובלי פער**`, Number(sh1.same || 0) === Number(sh0.same || 0) + 1 && (L["mc:diffs"] || []).length === d0, strip({ r: r && r.allowed, sh0, sh1, last: (L["mc:diffs"] || [])[0] }));
}

// ============================================================
console.log("\nSMART ו-SOLO10WEEK בהשוואה מול מניצ'ט. v7.82\n");
// **תגית ששמה SMART חייבת להיחשב זהה לעמודה SOLO10WEEK בגיליון, ולהפך**, אחרת כל אחת
// מ-40 הנשים תירשם כפער ביום שרון משנה את שם התגית. **וביקורת: SMART במניצ'ט בלי סימון
// בגיליון עדיין פער**, כדי שההשוואה לא תיבלע.
for (const [label, col, mcCol, sheetVal, want] of [
  ["תגית SMART מול כותרת SOLO10WEEK", "SOLO10WEEK", "SMART", "TRUE", "same"],
  ["תגית SOLO10WEEK מול כותרת SMART", "SMART", "SOLO10WEEK", "TRUE", "same"],
  ["SMART במניצ'ט ובגיליון ריק: פער", "SOLO10WEEK", "SMART", "", "diff"],
]) {
  SHEET = `ID,F_NAME,CF_EMAIL,${START},ביטלה,חודשי גישה נוספים,${col}
972506600001,ס,smart@test.com,${sunday} 12:00:00,FALSE,,${sheetVal}
`;
  delete S["sheet:csv:v1"];
  const cells = { ID: "972506600001", F_NAME: "ס", CF_EMAIL: "smart@test.com", [START]: sunday + " 12:00:00", "ביטלה": "", [mcCol]: "TRUE" };
  H["mc:rows"] = H["mc:rows"] || {}; H["mc:byemail"] = H["mc:byemail"] || {};
  H["mc:rows"]["972506600001"] = JSON.stringify({ cells, t: Date.now(), src: "mc" });
  H["mc:byemail"]["smart@test.com"] = JSON.stringify({ "972506600001": cells });
  const sh0 = Object.assign({}, shadow());
  await login("smart@test.com");
  const sh1 = shadow();
  ck(label, Number(sh1[want] || 0) === Number(sh0[want] || 0) + 1, strip({ sh0, sh1, last: (L["mc:diffs"] || [])[0] }));
}
const { fromFullContact } = await import(new URL("../api/_mcsync.js", import.meta.url));
ck("תגית SMART נכנסת לעמודה SMART ולא לשם אחר", (() => { const c = fromFullContact({ id: "1", whatsapp_phone: "972506600002", custom_fields: [], tags: [{ name: "SMART" }] }); return c && JSON.stringify(c).indexOf('"SMART":"TRUE"') !== -1; })());

// ============================================================
console.log("\nשלב ב: השרת קובע, והגיליון בדיקה כפולה. v7.88\n");
// כל מצב נבנה משורה בגיליון ושורה בשרת לאותה אישה, ונבדק מול השער האמיתי.
async function stageA(sheetCells, serverCells, opts = {}) {
  const cols = ["ID", "F_NAME", "CF_EMAIL", START, "ביטלה", "חודשי גישה נוספים", "GLOW-FULL", "SOLO10WEEK"];
  const em = "stagea@test.com", ph = "972506700001";
  const row = (c) => cols.map((k) => (c[k] == null ? "" : c[k])).join(",");
  SHEET = cols.join(",") + "\n" + (sheetCells ? row({ ID: ph, F_NAME: "א", CF_EMAIL: em, [START]: sunday + " 12:00:00", ...sheetCells }) + "\n" : "");
  delete S["sheet:csv:v1"];
  H["mc:rows"] = H["mc:rows"] || {}; H["mc:byemail"] = H["mc:byemail"] || {};
  if (serverCells) {
    const cells = { ID: ph, F_NAME: "א", CF_EMAIL: em, [START]: sunday + " 12:00:00", ...serverCells };
    H["mc:rows"][ph] = JSON.stringify({ cells, t: Date.now(), src: "mc" });
    H["mc:byemail"][em] = JSON.stringify({ [ph]: cells });
  } else { delete H["mc:rows"][ph]; delete H["mc:byemail"][em]; }
  redisDown = !!opts.down;
  const out = await login(em);
  redisDown = false;
  return out;
}
{
  const ker = await stageA({ "GLOW-FULL": "TRUE" }, { "GLOW-FULL💄💄💄": "TRUE" });
  ck("**שורה ישנה בשרת (המקרה של ker) אינה לוקחת את הקורס**", ker.allowed === true && ker.glowFull === true, strip(ker));
  const add = await stageA({}, { "GLOW-FULL": "TRUE" });
  ck("**קורס שקיים רק בשרת נפתח מיד**", add.allowed === true && add.glowFull === true, strip(add));
  const mcCancel = await stageA({}, { "ביטלה": "TRUE" });
  ck("**ביטול בשרת בלבד אינו נועל אותה**", mcCancel.allowed === true, strip(mcCancel));
  const shCancel = await stageA({ "ביטלה": "TRUE" }, {});
  ck("**ביטול בגיליון בלבד: אי הסכמה, היא נכנסת**", shCancel.allowed === true, strip(shCancel));
  const shCancelNo = await stageA({ "ביטלה": "TRUE" }, null);
  ck("**ובלי שורה בשרת, ביטול בגיליון נועל כמו היום**", shCancelNo.allowed === false && shCancelNo.reason === "cancelled", strip(shCancelNo));
  const both = await stageA({ "ביטלה": "TRUE" }, { "ביטלה": "TRUE" });
  ck("ביטול בשניהם נועל", both.allowed === false && both.reason === "cancelled", strip(both));
  const months = await stageA({ "חודשי גישה נוספים": "3" }, { "חודשי גישה נוספים": "6" });
  const months0 = await stageA({ "חודשי גישה נוספים": "3" }, null);
  ck("חודשים נוספים: הגבוה מבין השניים", months.allowed === true && strip(months) === strip(months0), strip(months));
  const smartSheet = await stageA({ SOLO10WEEK: "TRUE" }, {});
  ck("SMART בגיליון בלבד, בשבוע 3: נכנסת", smartSheet.allowed === true, strip(smartSheet));
  const noServer = await stageA({ "GLOW-FULL": "TRUE" }, null);
  const withSame = await stageA({ "GLOW-FULL": "TRUE" }, { "GLOW-FULL": "TRUE" });
  ck("**שורה זהה בשרת: תשובה זהה לתשובה בלי שרת**", strip(noServer) === strip(withSame), strip(withSame));
  const lead = await stageA(null, { [START]: "" });
  ck("**ליד שקיים רק בשרת, בלי תאריך, אינו נכנס**", lead.allowed === false && lead.reason === "not_registered", strip(lead));
  const datedOnly = await stageA(null, { "GLOW-FULL": "TRUE" });
  ck("**אישה עם תאריך שקיימת רק בשרת נכנסת. v7.88**", datedOnly.allowed === true && datedOnly.glowFull === true && datedOnly.startDate === sunday, strip(datedOnly));
  {
    // **מייל שהשתנה במניצ'ט: הטלפון בגיליון עם הכתובת החדשה, והשרת עדיין תחת הישנה.**
    const cols = ["ID", "F_NAME", "CF_EMAIL", START, "ביטלה"];
    SHEET = cols.join(",") + "\n" + ["972506700001", "א", "newaddr@test.com", sunday + " 12:00:00", ""].join(",") + "\n";
    delete S["sheet:csv:v1"];
    const cells = { ID: "972506700001", CF_EMAIL: "oldaddr@test.com", [START]: sunday + " 12:00:00" };
    H["mc:rows"]["972506700001"] = JSON.stringify({ cells, t: Date.now(), src: "mc" });
    H["mc:byemail"]["oldaddr@test.com"] = JSON.stringify({ "972506700001": cells });
    const oldA = await login("oldaddr@test.com");
    ck("**הכתובת הישנה אינה נכנסת כשהטלפון שלה בגיליון תחת כתובת אחרת**", oldA.allowed === false && oldA.reason === "not_registered", strip(oldA));
    const newA = await login("newaddr@test.com");
    ck("והחדשה נכנסת", newA.allowed === true, strip(newA));
    delete H["mc:byemail"]["oldaddr@test.com"];
  }
  const strictOnly = await stageA(null, { [START]: "", "PERSONAL WEBINAR DATE AND TIME": sunday + " 20:00:00", "GLOW-FULL": "TRUE" });
  ck("**ושורה בשרת בלי תאריך התחלה אינה שולפת תאריך משדה אחר**", strictOnly.allowed === false && strictOnly.reason === "not_registered", strip(strictOnly));
  const startDiff = await stageA({}, { [START]: older + " 12:00:00" });
  ck("**תאריך ההתחלה הוא של השרת**", startDiff.startDate === older, strip(startDiff));
  const noStart = await stageA({}, { [START]: "", "PERSONAL WEBINAR DATE AND TIME": older + " 20:00:00" });
  ck("**שורה בשרת בלי תאריך (המקרה של ora): התאריך של הגיליון**, ולא תאריך משדה אחר", noStart.allowed === true && noStart.startDate === sunday, strip(noStart));
  delete process.env.MC_SYNC_SECRET;
  const off = await stageA({}, { "GLOW-FULL": "TRUE" });
  ck("**בלי MC_SYNC_SECRET השרת אינו נקרא בכלל**, כלומר בדיוק כמו קודם", off.allowed === true && off.glowFull === false, strip(off));
  const offOnly = await stageA(null, { "GLOW-FULL": "TRUE" });
  ck("ובלי MC_SYNC_SECRET מי שרק בשרת עדיין אינה רשומה", offOnly.allowed === false && offOnly.reason === "not_registered", strip(offOnly));
  process.env.MC_SYNC_SECRET = "s3cret-mc";
  {
    // **חלון שנגמר לפי השרת ופתוח לפי הגיליון: היא נכנסת, ונרשם.** סמארט בשרת, התחלה לפני 12 שבועות.
    const d = new Date(sunday + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 70); const old12 = d.toISOString().slice(0, 10);
    L["mc:diffs"] = [];
    const late = await stageA({ [START]: old12 + " 12:00:00" }, { [START]: old12 + " 12:00:00", SMART: "TRUE" });
    ck("**אחרי יום 70: השרת אומר סמארט שנגמר, הגיליון פתוח. היא נכנסת**", late.allowed === true, strip(late));
    const g = (L["mc:diffs"] || []).map((x) => JSON.parse(x)).find((x) => x.cat === "gate");
    ck("**והמקרה נרשם ב-mc:diffs כאי הסכמה**", !!g && g.email === "stagea@test.com", strip(L["mc:diffs"]));
    const lateBoth = await stageA({ [START]: old12 + " 12:00:00", SOLO10WEEK: "TRUE" }, { [START]: old12 + " 12:00:00", SMART: "TRUE" });
    ck("**ושניהם אומרים סמארט שנגמר: הגישה הסתיימה**", lateBoth.allowed === false && lateBoth.reason === "expired", strip(lateBoth));
    L["mc:diffs"] = [];
    await stageA({}, { "GLOW-FULL": "TRUE" });
    ck("הסכמה על הכניסה אינה נרשמת כאי הסכמה", !(L["mc:diffs"] || []).some((x) => JSON.parse(x).cat === "gate"), strip(L["mc:diffs"]));
  }
  const down = await stageA({ "GLOW-FULL": "TRUE" }, { "ביטלה": "TRUE" }, { down: true });
  ck("**Upstash נופל: הגיליון לבד**, והיא נכנסת", down.allowed === true && down.glowFull === true, strip(down));
}
{
  const { mergeServer } = await import(new URL("../api/access.js", import.meta.url));
  const endOf = (st, mo, so) => so === 10 ? 1 : so === 12 ? 3 : 2;
  const base0 = { start: sunday, cancelled: false, months: null, solo: 0, glow: false, glowFull: false, glowPaid: false, glowSolo: false, glowM: null };
  ck("mergeServer: בלי שרת מחזיר את הגיליון כמו שהוא", mergeServer(base0, null, endOf) === base0);
  ck("mergeServer: המסלול של השרת", mergeServer({ ...base0, solo: 0 }, { ...base0, solo: 10 }, endOf, 0).solo === 10);
  ck("mergeServer: תאריך ההתחלה של השרת", mergeServer(base0, { ...base0, start: older }, endOf, 0).start === older);
  ck("mergeServer: שרת בלי תאריך משאיר את של הגיליון", mergeServer(base0, { ...base0, start: null }, endOf, 0).start === sunday);
  ck("mergeServer: ביטול רק בשניהם", mergeServer({ ...base0, cancelled: true }, base0, endOf, 0).cancelled === false && mergeServer({ ...base0, cancelled: true }, { ...base0, cancelled: true }, endOf, 0).cancelled === true);
  ck("mergeServer: חלון שנגמר רק לפי השרת חוזר לגיליון", (() => { const m = mergeServer({ ...base0, solo: 0 }, { ...base0, solo: 10 }, endOf, 1.5); return m.solo === 0 && m.disagree === true; })());
  ck("mergeServer: בלי גיליון אין כלום, גם כשבשרת יש", mergeServer(null, base0, endOf) === null);
}
{
  const { normalizeFlagKeys } = await import(new URL("../api/_mcsync.js", import.meta.url));
  const n1 = normalizeFlagKeys({ ID: "1", "GLOW-FULL💄💄💄": "TRUE" });
  ck("ייבוא: תגית בשם הישן עוברת ל-GLOW-FULL", n1 && n1["GLOW-FULL"] === "TRUE" && !("GLOW-FULL💄💄💄" in n1), strip(n1));
  ck("ייבוא: שורה בלי שם ישן אינה נכתבת", normalizeFlagKeys({ ID: "1", "GLOW-FULL": "TRUE" }) === null);
  const n3 = normalizeFlagKeys({ ID: "1", "GLOW-FULL": "TRUE", "GLOW-FULL💄💄💄": "" });
  ck("ייבוא: שם ישן ריק אינו מוחק TRUE קיים", n3 && n3["GLOW-FULL"] === "TRUE", strip(n3));
  ck("ייבוא: GLOW-FULL-M אינה נוגעת", normalizeFlagKeys({ ID: "1", "GLOW-FULL-M": "6" }) === null);
  // ייבוא אמיתי על שורה ישנה ממניצ'ט
  SHEET = `ID,F_NAME,CF_EMAIL,${START},ביטלה,חודשי גישה נוספים,GLOW-FULL\n972506700002,ב,old@test.com,${sunday} 12:00:00,,,TRUE\n`;
  delete S["sheet:csv:v1"];
  H["mc:rows"]["972506700002"] = JSON.stringify({ cells: { ID: "972506700002", CF_EMAIL: "old@test.com", [START]: sunday, "GLOW-FULL💄💄💄": "TRUE" }, t: 1, src: "mc" });
  const [io, ires] = resOf();
  await admin({ method: "POST", query: { key: "owner-key-123" }, headers: {}, body: { mcImport: true } }, ires);
  const fixed = JSON.parse(H["mc:rows"]["972506700002"]);
  ck("**ייבוא אמיתי מסדר את השורה הישנה, והיא נשארת ממניצ'ט**", fixed.src === "mc" && fixed.cells["GLOW-FULL"] === "TRUE" && !("GLOW-FULL💄💄💄" in fixed.cells) && io.body.renamed >= 1, strip({ fixed, body: io.body }));
  const after = JSON.parse(H["mc:byemail"]["old@test.com"] || "{}");
  ck("ואינדקס המיילים נבנה מהשורה המסודרת", after["972506700002"] && after["972506700002"]["GLOW-FULL"] === "TRUE", strip(after));
}

// ============================================================
console.log("\nייבוא כשהשרת גדול מ-10MB. v7.84\n");
// **06.10.2026: HGETALL על mc:rows החזיר מ-Upstash 200 עם שגיאה, והייבוא היה קורא את זה כ"אין
// שורות" ודורס את כל השורות שהגיעו ממניצ'ט.** כאן HGETALL "גדול מדי", והסריקה בעמודים של שתיים.
{
  OVERSIZE.add("mc:rows"); OVERSIZE.add("mc:byemail");
  SHEET = `ID,F_NAME,CF_EMAIL,${START},ביטלה,חודשי גישה נוספים,GLOW-FULL\n972506900001,א,big1@test.com,${sunday} 12:00:00,,,\n972506900002,ב,big2@test.com,${sunday} 12:00:00,,,\n`;
  delete S["sheet:csv:v1"];
  H["mc:rows"]["972506900002"] = JSON.stringify({ cells: { ID: "972506900002", CF_EMAIL: "big2@test.com", [START]: sunday, "GLOW-FULL": "TRUE" }, t: 5, src: "mc" });
  const before = Object.keys(H["mc:rows"]).length;
  const [o1, r1] = resOf();
  await admin({ method: "POST", query: { key: "owner-key-123" }, headers: {}, body: { mcImport: true } }, r1);
  const kept = JSON.parse(H["mc:rows"]["972506900002"]);
  ck("**הייבוא עובד גם כש-HGETALL גדול מדי**", o1.code === 200 && o1.body.ok === true, strip(o1.body));
  ck("**ושורה ממניצ'ט לא נדרסה**", kept.src === "mc" && kept.cells["GLOW-FULL"] === "TRUE", strip(kept));
  ck("והחדשה מהגיליון נכנסה", !!H["mc:rows"]["972506900001"]);
  ck("ושום שורה לא נעלמה", Object.keys(H["mc:rows"]).length >= before);
  SCANFAIL = true;
  const snap = JSON.stringify(H["mc:rows"]);
  const [o2, r2] = resOf();
  await admin({ method: "POST", query: { key: "owner-key-123" }, headers: {}, body: { mcImport: true } }, r2);
  ck("**סריקה שנכשלה: הייבוא נכשל**", !(o2.body && o2.body.ok === true), strip(o2.body));
  ck("**ושום שורה לא נכתבה**", JSON.stringify(H["mc:rows"]) === snap);
  SCANFAIL = false; OVERSIZE.clear();
}

// ============================================================
console.log("\nליד אינו נשמר בשרת. v7.85\n");
// **06.10.2026: כ-930 לידים נכנסו דרך טריגר שינוי המייל.** נשמרת רק מי שיש לה תאריך התחלה
// של 360, או סימן קנייה בלי 360.
{
  const n0 = Object.keys(H["mc:rows"]).length;
  const lead = await push({ ID: "972506100001", F_NAME: "ליד", CF_EMAIL: "lead@test.com" });
  ck("**ליד בלי תאריך התחלה: 200, ואינו נשמר**", lead.code === 200 && lead.body.skipped === "not_member" && !H["mc:rows"]["972506100001"], strip(lead.body));
  ck("ואינו נכנס לאינדקס המיילים", !(H["mc:byemail"] || {})["lead@test.com"]);
  const lead2 = await push({ ID: "972506100002", CF_EMAIL: "lead2@test.com", "EAT - Personal Start": sunday, "360 - Next Start +1": sunday, "אתגר פיט - FINAL  PERSONAL START": sunday });
  ck("**ליד עם שדות תאריך אחרים אינו נשמר**", !H["mc:rows"]["972506100002"], strip(lead2.body));
  const emptyStart = await push({ ID: "972506100003", CF_EMAIL: "lead3@test.com", [START]: "" });
  ck("תאריך התחלה ריק אינו נחשב", !H["mc:rows"]["972506100003"], strip(emptyStart.body));
  ck("ושום שורה לא נוספה", Object.keys(H["mc:rows"]).length === n0);
  const glow = await push({ ID: "972506100004", CF_EMAIL: "glowonly@test.com", "GLOW-FULL": "TRUE" });
  ck("**קונת Glow בלי תאריך נשמרת**", glow.body.ok === true && !glow.body.skipped && !!H["mc:rows"]["972506100004"], strip(glow.body));
  for (const col of ["GLOW-SOLO", "SMART", "SOLO10WEEK", "SOLO6", "SOLO12", "GLOW-PAID"]) {
    const ph = "97250620" + String(col.length).padStart(2, "0") + col.charCodeAt(5);
    const r = await push({ ID: ph, CF_EMAIL: col.toLowerCase() + "@test.com", [col]: "TRUE" });
    ck(col + " בלי תאריך נשמרת", !r.body.skipped && !!H["mc:rows"][r.body.phone], strip(r.body));
  }
  const member = await push({ ID: "972506100005", CF_EMAIL: "member@test.com", [START]: sunday + " 12:00:00" });
  ck("**מי שיש לה תאריך התחלה נשמרת**", !member.body.skipped && !!H["mc:rows"]["972506100005"], strip(member.body));
  const kept = H["mc:rows"]["972506100005"];
  const wipe = await push({ ID: "972506100005", [START]: "" });
  ck("**בקשה שמרוקנת את התאריך אינה נוגעת בשורה הקיימת**", wipe.body.skipped === "not_member" && H["mc:rows"]["972506100005"] === kept, strip(wipe.body));
  const upd = await push({ ID: "972506100005", "קבוצה": "ב" });
  ck("ועדכון קבוצה של מי שכבר שמורה עובר, כי התאריך שלה שמור", !upd.body.skipped && JSON.parse(H["mc:rows"]["972506100005"]).cells["קבוצה"] === "ב", strip(upd.body));
  const lg = await login("lead@test.com");
  ck("והשער עונה על הליד כמו קודם", lg && lg.allowed === false, strip(lg));
}

// ============================================================
console.log("\nהייבוא מוציא מהשרת לידים שאינם בגיליון. v7.85\n");
{
  SHEET = `ID,F_NAME,CF_EMAIL,${START},ביטלה,חודשי גישה נוספים,GLOW-FULL\n972506300001,א,keep@test.com,${sunday} 12:00:00,,,\n972506300009,ב,nodate@test.com,,,,\n`;
  delete S["sheet:csv:v1"];
  const put = (p, cells, src = "mc") => { H["mc:rows"][p] = JSON.stringify({ cells: Object.assign({ ID: p }, cells), t: 1, src }); };
  put("972506300002", { CF_EMAIL: "lead1@test.com", "השתתפה בוובינר": "TRUE" });
  put("972506300003", { CF_EMAIL: "lead2@test.com", "EAT - Personal Start": sunday }, "import");
  put("972506300004", { CF_EMAIL: "member@test.com", [START]: sunday });
  put("972506300005", { CF_EMAIL: "glow@test.com", "GLOW-FULL": "TRUE" });
  put("972506300006", { CF_EMAIL: "keep@test.com" });
  put("972506300009", { CF_EMAIL: "nodate@test.com" });
  const raw2 = H["mc:rows"]["972506300002"];
  delete H["mc:pruned"];
  const [io, ires] = resOf();
  await admin({ method: "POST", query: { key: "owner-key-123" }, headers: {}, body: { mcImport: true } }, ires);
  ck("הייבוא הצליח", io.body && io.body.ok === true, strip(io.body));
  ck("**ליד שאינו בגיליון יצא מהשרת**", !H["mc:rows"]["972506300002"] && !H["mc:rows"]["972506300003"]);
  ck("**ועותק שלו נשמר ב-mc:pruned, בית-בית**", (H["mc:pruned"] || {})["972506300002"] === raw2 && !!(H["mc:pruned"] || {})["972506300003"]);
  ck("והתשובה סופרת אותם", io.body.pruned === 2, strip(io.body));
  ck("**מי שיש לה תאריך התחלה נשארת**, גם כשאינה בגיליון", !!H["mc:rows"]["972506300004"]);
  ck("**קונת Glow בלי תאריך נשארת**", !!H["mc:rows"]["972506300005"]);
  ck("**מי שהמייל שלה בגיליון נשארת**, גם בטלפון אחר", !!H["mc:rows"]["972506300006"]);
  ck("**שורה מהגיליון בלי תאריך נשארת**", !!H["mc:rows"]["972506300009"]);
  ck("ואינדקס המיילים אינו מחזיק את מי שיצאה", !(H["mc:byemail"] || {})["lead1@test.com"]);
  const mcLeft = Object.values(H["mc:rows"]).filter((r) => JSON.parse(r).src === "mc").length;
  ck("ומונה \"התקבלו ממניצ'ט\" נספר מחדש", Number(H["mc:stats"].fromMc) === mcLeft, H["mc:stats"].fromMc + " / " + mcLeft);
  put("972506300007", { CF_EMAIL: "lead3@test.com" });
  SHEET = `ID,F_NAME,CF_EMAIL,${START}\n`;
  delete S["sheet:csv:v1"];
  const [eo, eres] = resOf();
  await admin({ method: "POST", query: { key: "owner-key-123" }, headers: {}, body: { mcImport: true } }, eres);
  ck("**גיליון בלי שורות אינו מוציא אף אחת**", !!H["mc:rows"]["972506300007"] && !(eo.body && eo.body.pruned), strip(eo.body));
}

// ============================================================
console.log("\nv7.89: מסך הניהול רואה את קורס האיפור ואת אפליקציית תזונה מהשרת\n");
{
  H = {}; L = {}; S = {}; log = []; redisDown = false; OVERSIZE.clear(); SCANFAIL = false; MCAPI.mode = "ok";
  process.env.MC_SYNC_SECRET = "s3cret-mc";
  SHEET = `ID,F_NAME,CF_EMAIL,${START},ביטלה,חודשי גישה נוספים,GLOW-FULL,אפליקציית תזונה
972507700001,עמליה,amal@test.com,${sunday} 12:00:00,,,,
972507700002,שירה,shira@test.com,${sunday} 12:00:00,,,,
972507700003,כרמלה,carm@test.com,${sunday} 12:00:00,,,TRUE,
`;
  const list = async () => { const [o, r] = resOf(); await admin({ method: "GET", query: { key: "owner-key-123" }, headers: {} }, r); const ws = (o.body && o.body.women) || []; return Object.fromEntries(ws.map((w) => [w.email, w])); };
  const before = await list();
  ck("לפני: המסך קורא את הגיליון לבדו", before["amal@test.com"] && before["amal@test.com"].glowFull === false && before["amal@test.com"].newApp === false, strip(before["amal@test.com"]));
  const r1 = await push({ ID: "972507700001", F_NAME: "עמליה", CF_EMAIL: "amal@test.com", [START]: sunday + " 12:00:00", "GLOW-FULL": "TRUE", "אפליקציית תזונה": "TRUE" });
  ck("מניצ'ט שולח, והשורה נשמרת", r1.code === 200, strip(r1.body));
  ck("**הסימונים נשמרים לפי הטלפון**", (H["mc:flags"] || {})["972507700001"] === "ga", strip(H["mc:flags"]));
  const after = await list();
  ck("**קורס האיפור המלא מוצג לפי השרת**, כשהגיליון ריק", after["amal@test.com"].glowFull === true, strip(after["amal@test.com"]));
  ck("**והיא מוצגת כאפליקציה חדשה**", after["amal@test.com"].newApp === true);
  ck("ומה שהגיליון אומר נשאר גלוי בנפרד", after["amal@test.com"].sheetGlowFull === false);
  ck("אישה אחרת לא נגעה", after["shira@test.com"].glowFull === false && after["shira@test.com"].newApp === false);
  ck("**סימון בגיליון בלי שרת נשאר כמו שהוא**", after["carm@test.com"].glowFull === true);
  await push({ ID: "972507700001", F_NAME: "עמליה", CF_EMAIL: "amal@test.com", [START]: sunday + " 12:00:00", "GLOW-FULL": "", "אפליקציית תזונה": "TRUE" });
  ck("תגית שהוסרה במניצ'ט יורדת מהסימונים", (H["mc:flags"] || {})["972507700001"] === "a", strip(H["mc:flags"]));
  await push({ ID: "972507700001", F_NAME: "עמליה", CF_EMAIL: "amal@test.com", [START]: sunday + " 12:00:00", "GLOW-FULL": "", "אפליקציית תזונה": "" });
  ck("ובלי אף סימון השורה יוצאת מהרשימה", !(H["mc:flags"] || {})["972507700001"], strip(H["mc:flags"]));
  await push({ ID: "972507700001", F_NAME: "עמליה", CF_EMAIL: "amal@test.com", [START]: sunday + " 12:00:00", "GLOW-FULL": "TRUE", "אפליקציית תזונה": "TRUE" });
  hash("admin:overrides")["amal@test.com"] = JSON.stringify({ glowFull: "0", by: "טלי" });
  ck("**הכרעת המשרד גוברת על השרת**", (await list())["amal@test.com"].glowFull === false);
  delete H["admin:overrides"];
  delete process.env.MC_SYNC_SECRET;
  const off = await list();
  ck("**בלי MC_SYNC_SECRET המסך מתעלם מהשרת**, כמו השער", off["amal@test.com"].glowFull === false && off["amal@test.com"].newApp === false, strip(off["amal@test.com"]));
  process.env.MC_SYNC_SECRET = "s3cret-mc";
  OVERSIZE.add("mc:flags");
  const bad = await list();
  ck("**תקלה בקריאת הסימונים משאירה את הגיליון לבדו**, והמסך נטען", bad["amal@test.com"] && bad["amal@test.com"].glowFull === false, strip(bad["amal@test.com"]));
  OVERSIZE.delete("mc:flags");
  delete H["mc:flags"]; delete S["sheet:csv:v1"];
  hash("mc:rows")["972507700002"] = JSON.stringify({ cells: { ID: "972507700002", CF_EMAIL: "shira@test.com", [START]: sunday, "GLOW-FULL": "TRUE" }, t: 1, src: "mc" });
  const [io, ires] = resOf();
  await admin({ method: "POST", query: { key: "owner-key-123" }, headers: {}, body: { mcImport: true } }, ires);
  ck("הייבוא הצליח", io.body && io.body.ok === true, strip(io.body));
  ck("**הייבוא בונה את הסימונים מחדש מכל השורות**", (H["mc:flags"] || {})["972507700001"] === "ga" && (H["mc:flags"] || {})["972507700002"] === "g", strip(H["mc:flags"]));
  ck("ושורה מהגיליון עם GLOW-FULL נכנסת גם היא", (H["mc:flags"] || {})["972507700003"] === "g", strip(H["mc:flags"]));
  ck("ולא נשארה רשימת עבודה", !H["mc:flags:build"]);
}

console.log(`\n${pass} מתוך ${pass + fail} עברו.`);
process.exit(fail ? 1 : 0);
