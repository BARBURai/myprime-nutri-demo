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
const hash = (k) => (H[k] = H[k] || {});
function run(cmd) {
  const [c, ...a] = cmd.map(String);
  log.push(c + " " + (a[0] || ""));
  switch (c) {
    case "GET": return S[a[0]] ?? null;
    case "SET": S[a[0]] = a[1]; return "OK";
    case "HGET": return (H[a[0]] || {})[a[1]] ?? null;
    case "HSET": { const h = hash(a[0]); for (let i = 1; i + 1 < a.length; i += 2) h[a[i]] = a[i + 1]; return 1; }
    case "HDEL": if (H[a[0]]) delete H[a[0]][a[1]]; return 1;
    case "HLEN": return Object.keys(H[a[0]] || {}).length;
    case "HSET_MULTI": return 1;
    case "DEL": delete H[a[0]]; delete S[a[0]]; delete L[a[0]]; return 1;
    case "RENAME": H[a[1]] = H[a[0]]; delete H[a[0]]; return "OK";
    case "HGETALL": return Object.entries(H[a[0]] || {}).flat();
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
    return { ok: true, json: async () => ({ result: run(cmd) }) };
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
ck("**תאריך אחר במניצ'ט: התשובה עדיין לפי הגיליון**", strip(diffStart) === strip(base["ronit@test.com"]), strip(diffStart));
ck("ונרשם כפער", shadow().diff === "1", strip(shadow()));
const d0 = JSON.parse(L["mc:diffs"][0]);
ck("והפער נוקב בשדה ובשני הערכים", d0.email === "ronit@test.com" && d0.fields.start && d0.fields.start[0] === sunday && d0.fields.start[1] === older, strip(d0));

await push({ ID: "972501111111", [START]: sunday + " 12:00:00", "ביטלה": "TRUE" });
const cancelled = await login("ronit@test.com");
ck("**ביטול במניצ'ט בלבד אינו נועל אותה בשלב הזה**", cancelled.allowed === true && strip(cancelled) === strip(base["ronit@test.com"]), strip(cancelled));
ck("אבל נרשם כפער בשדה הביטול", JSON.parse(L["mc:diffs"][0]).fields.cancelled, L["mc:diffs"][0]);
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
ck("**במניצ'ט ולא בגיליון: עדיין לא נכנסת**", onlyMc.allowed === false && strip(onlyMc) === strip(base["nobody@test.com"]), strip(onlyMc));
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

console.log(`\n${pass} מתוך ${pass + fail} עברו.`);
process.exit(fail ? 1 : 0);
