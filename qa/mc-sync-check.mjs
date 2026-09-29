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
const SHEET = `ID,F_NAME,CF_EMAIL,${START},ביטלה,חודשי גישה נוספים,GLOW-FULL
972501111111,רונית,ronit@test.com,${sunday} 12:00:00,,,
972502222222,דנה,dana@test.com,${sunday} 12:00:00,,,TRUE
972503333333,מיכל,michal@test.com,${older} 12:00:00,,,
972504444444,מיכל,michal@test.com,${sunday} 12:00:00,,,
`;

// ---------- Redis בזיכרון ----------
let H = {}, L = {}, S = {}, log = [], redisDown = false;
const hash = (k) => (H[k] = H[k] || {});
function run(cmd) {
  const [c, ...a] = cmd.map(String);
  log.push(c + " " + (a[0] || ""));
  switch (c) {
    case "GET": return S[a[0]] ?? null;
    case "SET": S[a[0]] = a[1]; return "OK";
    case "HGET": return (H[a[0]] || {})[a[1]] ?? null;
    case "HSET": hash(a[0])[a[1]] = a[2]; return 1;
    case "HDEL": if (H[a[0]]) delete H[a[0]][a[1]]; return 1;
    case "HLEN": return Object.keys(H[a[0]] || {}).length;
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
    const cmd = opt && opt.body ? JSON.parse(opt.body) : u.slice("redis://r/".length).split("/").map(decodeURIComponent);
    return { ok: true, json: async () => ({ result: run(cmd) }) };
  }
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

console.log(`\n${pass} מתוך ${pass + fail} עברו.`);
process.exit(fail ? 1 : 0);
