// תיקון השמות השבועי מהאקסל של הפקידה. v8.00.
//
// מריצה את `api/admin.js` האמיתי מול דרייב מדומה (עם קובץ xlsx אמיתי שנבנה כאן), Redis
// מדומה ומניצ'ט מדומה, ובודקת את הכללים שרון אישר ב-11.10.2026. בלי רשת.
//
//   node qa/namefix-check.mjs

import zlib from "node:zlib";
import crypto from "node:crypto";
import adminHandler from "../api/admin.js";
import { readXlsx } from "../api/_xlsx.js";
import { isBad, usable, sameName, decide, excelIndex, excelNames, targets, localPhone, run } from "../api/_namefix.js";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("✗ " + m); } };

// ===== קובץ xlsx אמיתי, נבנה ביד =====
function zip(files) {
  const locals = [], cds = [];
  let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, "utf8");
    const comp = zlib.deflateRawSync(data);
    const nb = Buffer.from(name, "utf8");
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nb.length, 26);
    locals.push(lh, nb, comp);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(nb.length, 28); cd.writeUInt32LE(off, 42);
    cds.push(cd, nb);
    off += 30 + nb.length + comp.length;
  }
  const cdBuf = Buffer.concat(cds);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(cds.length / 2, 8); end.writeUInt16LE(cds.length / 2, 10);
  end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cdBuf, end]);
}
const SHARED = ["שם פרטי", "שם משפחה", "מייל ", "טלפון ", "מיה", "ביטון", "רוית", "יוסף", "טלי", "נוטמן"];
const sst = `<sst>${SHARED.map((s) => `<si><t>${s}</t></si>`).join("")}<si><r><t>נטע-</t></r><r><t>לי</t></r></si><si><t>רעיני</t></si></sst>`;
const s = (i) => `t="s"><v>${i}</v>`;
const sheet1 = `<worksheet><sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>דוח מעקב</t></is></c></row>
<row r="2"><c r="B2" ${s(0)}</c><c r="C2" ${s(1)}</c><c r="D2" ${s(2)}</c><c r="E2" ${s(3)}</c></row>
<row r="3"><c r="B3" ${s(4)}</c><c r="C3" ${s(5)}</c><c r="D3" t="inlineStr"><is><t>Maya@Test.com</t></is></c><c r="E3"><v>544000001</v></c></row>
<row r="4"><c r="B4" ${s(6)}</c><c r="C4" ${s(7)}</c><c r="D4" t="str"><v>ravit@test.com</v></c><c r="E4"><v>5.44000002E8</v></c></row>
<row r="5"/>
</sheetData></worksheet>`;
const sheet2 = `<worksheet><sheetData>
<row r="1"><c r="A1" ${s(0)}</c><c r="B1" ${s(1)}</c><c r="C1" ${s(2)}</c><c r="D1" t="inlineStr"><is><t>טלפון ווטסאפ</t></is></c></row>
<row r="2"><c r="A2" ${s(8)}</c><c r="B2" ${s(9)}</c><c r="C2"/><c r="D2"><v>972544000003</v></c></row>
<row r="3"><c r="A3" ${s(10)}</c><c r="B3" ${s(11)}</c><c r="C3" t="inlineStr"><is><t>neta@test.com</t></is></c></row>
<row r="4"><c r="A4" t="inlineStr"><is><t>רוית</t></is></c><c r="B4" t="inlineStr"><is><t>יוסף-כהן</t></is></c><c r="C4" t="inlineStr"><is><t>ravit@test.com</t></is></c></row>
</sheetData></worksheet>`;
const XLSX = zip({
  "[Content_Types].xml": "<Types/>",
  "xl/workbook.xml": `<workbook xmlns:r="r"><sheets><sheet name="08-25" sheetId="1" r:id="rId1"/><sheet name="09-25" sheetId="2" r:id="rId2"/></sheets></workbook>`,
  "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>`,
  "xl/sharedStrings.xml": sst,
  "xl/worksheets/sheet1.xml": sheet1,
  "xl/worksheets/sheet2.xml": sheet2,
});

// ===== הקורא =====
const sheets = readXlsx(XLSX);
ok(sheets.length === 2 && sheets[0].name === "08-25" && sheets[1].name === "09-25", "שתי הלשוניות נקראו בסדר");
ok(sheets[0].rows[2][1] === "מיה" && sheets[0].rows[2][3] === "Maya@Test.com", "מחרוזת משותפת ומחרוזת בתוך התא");
ok(sheets[0].rows[3][4] === "544000002", "מספר בכתיב מדעי חוזר כספרות");
ok(sheets[0].rows[3][3] === "ravit@test.com", "תא נוסחה עם טקסט");
ok(sheets[1].rows[2][0] === "נטע-לי", "טקסט עשיר בכמה ריצות מתחבר");
ok(sheets[0].rows[4].length === 0, "שורה ריקה אינה מפילה");

const idx = excelIndex(sheets);
ok(idx.rows === 5, "חמש שורות של נשים, בלי שורות הכותרת: " + idx.rows);
ok(excelNames(idx, "maya@test.com", "")[0].first === "מיה", "חיפוש לפי מייל בלי הבדל באותיות");
ok(excelNames(idx, "", "972544000001")[0].last === "ביטון", "חיפוש לפי טלפון, 972 מול 9 ספרות");
ok(excelNames(idx, "nobody@x.com", "972544000003")[0].first === "טלי", "מייל שלא נמצא נופל לטלפון");
ok(excelNames(idx, "ravit@test.com", "").length === 2, "שני שמות שונים לאותו מייל בשתי לשוניות");
ok(localPhone("972-54-400-0001") === "0544000001" && localPhone("544000001") === "0544000001" && localPhone("123") === "", "טלפון מקומי");

// ===== הכללים =====
ok(isBad("ה-iPhone של מיה", "") && isBad("Samsung SM-S731B", "") && isBad("", "כהן") && isBad("רונית", "0541234567"), "שם מכשיר, ריק וטלפון הם שם משובש");
ok(isBad("אלה", ".") && !isBad("אלה", "") && !isBad("רונית", "כהן"), "שם משפחה שהוא נקודה משובש, שם תקין לא");
ok(!usable("ג", "שמולביץ") && usable("מיה", "ביטון") && !usable("Maya", ""), "שם שאפשר לכתוב: שתי אותיות בכל חלק");
ok(sameName({ first: "נטע-לי", last: "רעיני" }, { first: "נטע לי", last: "רעיני" }) && sameName({ first: "לחינו", last: "מיכל" }, { first: "מיכל", last: "לחינו" }), "מקף וסדר הפוך הם אותו שם");
ok(!sameName({ first: "טטיאנה", last: "לברוב" }, { first: "טניה", last: "לברוב" }), "שני שמות שונים אינם אותו שם");

const X = [{ first: "מיה", last: "ביטון" }];
ok(decide({ first: "ה-iPhone של מיה", last: "" }, X, null).cat === "excel", "באקסל, ובמניצ'ט אין: תיקון");
ok(decide({ first: "iPhone", last: "" }, X, { first: "מיה", last: "" }).cat === "excel", "במניצ'ט רק שם פרטי: תיקון");
ok(decide({ first: "iPhone", last: "" }, X, { first: "מיה", last: "ביטון" }).cat === "excel", "מניצ'ט מסכים: תיקון");
ok(decide({ first: "iPhone", last: "" }, X, { first: "מאיה", last: "כהן" }).cat === "conflict", "מניצ'ט חולק: לאישור");
ok(decide({ first: "iPhone", last: "" }, [...X, { first: "מיה", last: "לוי" }], null).cat === "conflict", "שני שמות באקסל: לאישור");
ok(decide({ first: "iPhone", last: "" }, [], { first: "מיה", last: "ביטון" }).cat === "mc", "אין באקסל, מניצ'ט תקין: לאישור");
ok(decide({ first: "iPhone", last: "" }, [], { first: "iPhone", last: "" }).cat === "manual", "אין שם תקין: לבירור");
ok(decide({ first: "iPhone", last: "" }, X, "multi").cat === "manual", "כמה אנשי קשר במניצ'ט: לבירור, גם כשיש באקסל");
const cl = decide({ first: "⁨רונית⁩", last: "כהן‏" }, [], null);
ok(cl.cat === "clean" && cl.to.first === "רונית" && cl.to.last === "כהן", "תווים נסתרים: ניקוי בלבד, השם נשאר");

const START = "360 - FINAL PERSONAL START";
const slim = {
  "972544000001": JSON.stringify({ F_NAME: "ה-iPhone של מיה", L_NAME: "", CF_EMAIL: "maya@test.com", [START]: "2026-10-04 12:00" }),
  "972544000009": JSON.stringify({ F_NAME: "רונית", L_NAME: "כהן", CF_EMAIL: "ok@test.com", [START]: "2026-10-04" }),
  "972544000010": JSON.stringify({ F_NAME: "iPhone", L_NAME: "", CF_EMAIL: "lead@test.com" }),
  "972544000011": JSON.stringify({ F_NAME: "Ron2", L_NAME: ".", CF_EMAIL: "rhsegal@gmail.com", [START]: "2026-10-04" }),
  "972544000012": JSON.stringify({ F_NAME: "iPhone", L_NAME: "", CF_EMAIL: "fixed@test.com", [START]: "2026-10-04" }),
};
const tg = targets(slim, { "fixed@test.com": { first: "שם", last: "שהמשרד תיקן" } });
ok(tg.length === 1 && tg[0].email === "maya@test.com", "נבדקת רק מי שהשם שלה משובש, עם תאריך, לא בדיקות ולא מי שהמשרד תיקן: " + tg.map((t) => t.email));

// ===== הריצה, בלי שרת =====
const calls = [];
const deps = (over = {}) => ({
  async mcMain(p) { calls.push("find:" + p); if (over.err && over.err === p) throw new Error("429"); return null; },
  async log(e) { calls.push("log:" + e.phone); },
  async write(t) { calls.push("write:" + t.phone); return over.fail === t.phone ? "namefail:x" : "ok"; },
});
const L = [{ phone: "1", email: "maya@test.com", first: "iPhone", last: "" }, { phone: "2", email: "x@x.com", first: "iPhone", last: "" }];
calls.length = 0;
let rp = await run({ list: L, idx, live: false, deps: deps() });
ok(!calls.some((c) => c.startsWith("write") || c.startsWith("log")), "תצוגה מקדימה אינה כותבת דבר");
calls.length = 0;
rp = await run({ list: L, idx, live: true, cap: 0, deps: deps() });
ok(rp.stopped && !calls.some((c) => c.startsWith("write")), "מעל התקרה: עוצרת ולא מתקנת אף אחת");
calls.length = 0;
rp = await run({ list: L, idx, live: true, deps: deps({ err: "1" }) });
ok(rp.items[0].cat === "manual" && rp.items[0].why === "mc_error" && !calls.includes("write:1"), "תקלה במניצ'ט: לבירור, לעולם לא תיקון");
calls.length = 0;
rp = await run({ list: L, idx, live: true, deps: deps({ fail: "1" }) });
ok(calls.indexOf("log:1") !== -1 && calls.indexOf("log:1") < calls.indexOf("write:1"), "השם הישן נשמר לפני הכתיבה");
ok(rp.failed.length === 1 && rp.fixed.length === 0, "כתיבה שנכשלה מדווחת ולא נספרת כתיקון");

// ===== מקצה לקצה, דרך api/admin.js =====
const KEY = "test-admin-key";
const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.ADMIN_KEY = KEY;
process.env.CRON_SECRET = "cron-test";
process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";
process.env.MANYCHAT_TOKEN = "mc-test";
process.env.GOOGLE_SA_KEY = JSON.stringify({ client_email: "names-reader@x.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }), token_uri: "https://oauth2.test/token" });
delete process.env.RESEND_API_KEY;

let H, LISTS, MCDB, mcLog, driveCalls, driveFail, rps429;
function reset() {
  H = { "mc:slim": { ...slim }, "mc:rows": {}, "admin:overrides": { "fixed@test.com": JSON.stringify({ first: "שם", last: "שהמשרד תיקן" }) } };
  H["mc:rows"]["972544000001"] = JSON.stringify({ cells: JSON.parse(slim["972544000001"]), src: "mc" });
  LISTS = {};
  MCDB = { "972544000001": { id: 11, first_name: "Maya", last_name: "", F_NAME: "ה-iPhone של מיה", L_NAME: "" } };
  mcLog = []; driveCalls = []; driveFail = false; rps429 = 0;
}
const redisCmd = (cmd, a, b, c) => {
  const h = (k) => (H[k] = H[k] || {});
  if (cmd === "HGET") return h(a)[b] ?? null;
  if (cmd === "HSET") { h(a)[b] = c; return 1; }
  if (cmd === "HSCAN") { const o = h(a); return ["0", Object.keys(o).flatMap((k) => [k, o[k]])]; }
  if (cmd === "LPUSH") { (LISTS[a] = LISTS[a] || []).unshift(b); return 1; }
  if (cmd === "LTRIM") return "OK";
  if (cmd === "INCR") return 1;
  return null;
};
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const J = (o, st = 200) => ({ ok: st < 300, status: st, json: async () => o, text: async () => JSON.stringify(o) });
  if (u.startsWith("https://oauth2.test")) { driveCalls.push("token:" + /assertion=/.test(opts.body)); return J({ access_token: "tok" }); }
  if (u.startsWith("https://www.googleapis.com/drive/v3/files/")) {
    driveCalls.push("get:" + (opts.method || "GET") + ":" + (opts.headers && opts.headers.Authorization));
    if (driveFail) return { ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, arrayBuffer: async () => XLSX.buffer.slice(XLSX.byteOffset, XLSX.byteOffset + XLSX.length) };
  }
  if (u.startsWith("https://api.manychat.com")) {
    if (rps429 > 0) { rps429--; return J({ status: "error", message: "Api max rps reached" }, 429); }
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (u.includes("findByCustomField")) {
      const p = decodeURIComponent(u.split("field_value=")[1]);
      const s = MCDB[p];
      if (!s) return J({ status: "success", data: [] });
      return J({ status: "success", data: [{ id: s.id, first_name: s.first_name, last_name: s.last_name, custom_fields: [{ name: "F_NAME", value: s.F_NAME }, { name: "L_NAME", value: s.L_NAME }] }] });
    }
    if (u.includes("setCustomFieldByName")) {
      mcLog.push(body.field_name + "=" + body.field_value);
      const s = Object.values(MCDB).find((x) => x.id === body.subscriber_id);
      if (s) s[body.field_name] = body.field_value;
      return J({ status: "success" });
    }
    mcLog.push("other:" + u);
    return J({ status: "success" });
  }
  if (u.startsWith("https://redis.test")) {
    if (opts.method === "POST") { const c = JSON.parse(opts.body); return J({ result: redisCmd(...c) }); }
    const parts = u.replace("https://redis.test/", "").split("/").map(decodeURIComponent);
    return J({ result: redisCmd(...parts) });
  }
  throw new Error("unexpected fetch " + u);
};
function mkRes() {
  const r = { code: 0, body: null, html: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.send = (b) => { r.html = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  return r;
}
const call = async (query, headers = {}) => { const res = mkRes(); await adminHandler({ query: { namefix: "", ...query }, method: "GET", headers, body: null }, res); return res; };
const cron = { authorization: "Bearer cron-test" };

reset();
let r = await call({});
ok(r.code === 401, "בלי מפתח ובלי סיסמת cron: 401");
r = await call({ key: "wrong" });
ok(r.code === 401, "מפתח שגוי: 401");

reset(); delete process.env.NAMEFIX_LIVE;
r = await call({}, cron);
ok(r.code === 200 && r.body.ok && r.body.live === false, "בלי NAMEFIX_LIVE גם יום חמישי הוא תצוגה מקדימה");
ok(mcLog.length === 0 && !(LISTS["namefix:log"] || []).length, "תצוגה מקדימה: שום דבר לא נכתב למניצ'ט ולשרת");
ok(r.body.excelRows === 5 && r.body.counts.excel === 1 && r.body.total === 1, "התצוגה המקדימה מוצאת את מיה לתיקון מהאקסל: " + JSON.stringify(r.body.counts));
ok(driveCalls.includes("token:true") && driveCalls.some((c) => c === "get:GET:Bearer tok"), "הקובץ נקרא בקריאה בלבד, עם אסימון של חשבון השירות");

reset();
r = await call({ key: KEY });
ok(r.code === 200 && /תצוגה מקדימה בלבד/.test(r.html || "") && /maya@test\.com/.test(r.html) && /מיה ביטון/.test(r.html), "המנהל רואה את הדוח כדף");
ok(!/544000001/.test(r.html), "מספרי טלפון אינם מוצגים בדוח");

reset(); process.env.NAMEFIX_LIVE = "1";
r = await call({ key: KEY });
ok(r.body === null && mcLog.length === 0, "גם עם NAMEFIX_LIVE, המנהל בלי run=1 אינו כותב");
reset();
r = await call({}, cron);
ok(r.body.live === true && r.body.fixed === 1, "יום חמישי עם NAMEFIX_LIVE: מתקן");
ok(mcLog.join("|") === "F_NAME=מיה|L_NAME=ביטון", "נכתב למניצ'ט F_NAME ו-L_NAME בלבד: " + mcLog.join("|"));
const logged = JSON.parse((LISTS["namefix:log"] || [])[0] || "{}");
ok(logged.from && logged.from.first === "ה-iPhone של מיה" && logged.to.first === "מיה", "השם הישן נשמר");
ok(JSON.parse(H["mc:slim"]["972544000001"]).F_NAME === "מיה" && JSON.parse(H["mc:rows"]["972544000001"]).cells.L_NAME === "ביטון", "השם עודכן גם בשרת שלנו, כדי שמסך הניהול יראה אותו");
ok(JSON.parse(H["mc:slim"]["972544000012"]).F_NAME === "iPhone", "מי שהמשרד תיקן לה שם לא נגעה");

reset(); rps429 = 2;
r = await call({}, cron);
ok(r.body.fixed === 1, "429 ממניצ'ט מנוסה שוב ואינו מפיל את הריצה");

reset(); driveFail = true;
r = await call({}, cron);
ok(r.code === 500 && r.body.error === "excel_failed" && mcLog.length === 0, "האקסל לא נקרא: לא משתנה כלום");

reset(); MCDB["972544000001"].first_name = "מאיה"; MCDB["972544000001"].last_name = "כהן";
r = await call({}, cron);
ok(r.body.fixed === 0 && r.body.counts.conflict === 1 && mcLog.length === 0, "מניצ'ט חולק על האקסל: לא נוגעים, עוברת לאישור");

reset(); MCDB["972544000001"].F_NAME = "x"; // הקריאה החוזרת לא תתאים
{
  const orig = globalThis.fetch;
  globalThis.fetch = async (u, o) => { if (String(u).includes("setCustomFieldByName") && JSON.parse(o.body).field_name === "L_NAME") return { ok: true, status: 200, json: async () => ({ status: "error", message: "nope" }) }; return orig(u, o); };
  r = await call({}, cron);
  globalThis.fetch = orig;
  ok(r.body.fixed === 0 && r.body.failed.length === 1 && JSON.parse(H["mc:slim"]["972544000001"]).F_NAME === "ה-iPhone של מיה", "כתיבה שנדחתה במניצ'ט: השרת שלנו לא משתנה, ומדווח");
}

reset(); H["admin:codes"] = { "ABCD-EFGH": JSON.stringify({ name: "טלי" }) };
r = await call({ key: "ABCD-EFGH" });
ok(r.code === 200 && /תצוגה מקדימה בלבד/.test(r.html || ""), "קוד של המשרד רואה את התצוגה המקדימה");
reset(); H["admin:codes"] = { "ABCD-EFGH": JSON.stringify({ name: "טלי" }) };
r = await call({ key: "ABCD-EFGH", run: "1", format: "json" });
ok(r.body.live === false && mcLog.length === 0, "קוד של המשרד עם run=1 אינו כותב, רק המנהל");

reset(); process.env.GOOGLE_SA_KEY = "not json";
r = await call({}, cron);
ok(r.body.error === "no_key" && mcLog.length === 0, "מפתח חסר: לא משתנה כלום");

{
  const { readFileSync } = await import("node:fs");
  const adm = readFileSync(new URL("../public/admin.html", import.meta.url), "utf8");
  ok(/namefix\\b\/\.test\(location\.search\) && KEY/.test(adm) && /"\/api\/admin\?namefix&key="\+encodeURIComponent\(KEY\)/.test(adm), "admin.html?namefix פותח את התצוגה עם המפתח השמור");
}
console.log(`${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
