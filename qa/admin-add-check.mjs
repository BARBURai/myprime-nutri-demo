// Offline check for the office batch of v6.68: the pending-notes count, rows in the sheet
// with no email address, adding a woman by hand, and the drafted answer.
//
// It runs the REAL api/admin.js, api/access.js and api/_sheet.js against a fake sheet, a
// fake Redis and a fake ManyChat. No network, no cost, no AI call.
//
//   node qa/admin-add-check.mjs

import adminHandler from "../api/admin.js";
import accessHandler from "../api/access.js";
import { loadSheet } from "../api/_sheet.js";
import { readFileSync } from "node:fs";

const KEY = "test-admin-key";
process.env.ADMIN_KEY = KEY;
process.env.ACCESS_SHEET_CSV_URL = "https://sheet.test/csv";
process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";
process.env.MANYCHAT_TOKEN = "mc-test";

const HEAD = 'ID,F_NAME,L_NAME,CF_EMAIL,360 - FINAL  PERSONAL START,הורידה אפליקציה,ביטלה,קבוצה,חודשי גישה נוספים';
// Three of the four rows below are the whole point: a woman with a phone and no address, a
// cancelled one, and one with neither. Only the first can be fixed from the screen.
let CSV = [HEAD,
  '972501111111,יפית,קורן,yafit@test.com,2026-06-14 0:00:00,TRUE,FALSE,ב,3',
  '972502222222,נילי,לביא,,2026-06-14 0:00:00,TRUE,FALSE,ב,3',
  '972503333333,רותי,כהן,,2026-06-14 0:00:00,TRUE,TRUE,א,3',
  ',שרה,אלמונית,,2026-06-14 0:00:00,TRUE,FALSE,ג,3',
].join("\n");

const MC = { calls: 0, email: null, refuseEmail: false, writes: [] };
const store = { hash: {}, kv: {}, list: {} };
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith("https://sheet.test")) return { ok: true, text: async () => CSV };
  if (u.startsWith("https://api.manychat.com")) {
    MC.calls++;
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    if (u.includes("findByCustomField")) {
      return { ok: true, json: async () => ({ status: "success", data: { id: 77, custom_fields: [
        { id: 11510555, name: "CF_EMAIL", value: MC.email || null },
      ], tags: [] } }) };
    }
    if (u.includes("setCustomField") && body && body.field_id === 11510555) {
      MC.writes.push(body.field_value);
      if (MC.refuseEmail) return { ok: true, json: async () => ({ status: "error", message: "no" }) };
      MC.email = body.field_value;
      return { ok: true, json: async () => ({ status: "success" }) };
    }
    return { ok: true, json: async () => ({ status: "success" }) };
  }
  if (u.startsWith("https://api.anthropic.com")) { MC.ai = (MC.ai || 0) + 1; throw new Error("no ai in this check"); }
  const parts = u.replace("https://redis.test/", "").split("/").map(decodeURIComponent);
  const [cmd, a, b, c] = parts;
  const H = (k) => (store.hash[k] = store.hash[k] || {});
  let result = null;
  if (cmd === "HSET") { H(a)[b] = c; result = 1; }
  else if (cmd === "HGET") result = H(a)[b] ?? null;
  else if (cmd === "HDEL") { delete H(a)[b]; result = 1; }
  else if (cmd === "HGETALL") { const o = H(a); result = Object.keys(o).flatMap((k) => [k, o[k]]); }
  else if (cmd === "KEYS") { const pre = String(a).replace(/\*$/, ""); result = Object.keys(store.kv).filter((k) => k.startsWith(pre)); }
  else if (cmd === "SET") { store.kv[a] = b; result = "OK"; }
  else if (cmd === "GET") result = store.kv[a] ?? null;
  else if (cmd === "HINCRBY") { const h = H(a); h[b] = String((parseInt(h[b], 10) || 0) + parseInt(c, 10)); result = Number(h[b]); }
  else if (cmd === "LRANGE") { const L = store.list[a] || []; result = L.slice(Number(b), Number(c) + 1); }
  else result = 0;
  if (cmd === "ZRANGE" || cmd === "ZREVRANGE") result = [];
  return { ok: true, json: async () => ({ result }) };
};

function mkRes() {
  const r = { code: 0, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
const callAdmin = async (query, method = "GET", body = null) => {
  const res = mkRes();
  await adminHandler({ query, method, body }, res);
  return res;
};
const callAccess = async (email) => {
  const res = mkRes();
  await accessHandler({ query: { email, device: "dev-1", login: "1" }, method: "GET" }, res);
  return res;
};

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
};

const ADMIN_JS = readFileSync(new URL("../api/admin.js", import.meta.url), "utf8");
const HTML = readFileSync(new URL("../public/admin.html", import.meta.url), "utf8");

console.log("\nשורות בלי מייל, בקריאת הגיליון");
{
  const r = await loadSheet(process.env.ACCESS_SHEET_CSV_URL);
  check("מי שיש לה מייל אינה ברשימה הזאת", !(r.noEmail || []).some((x) => x.phone === "972501111111"));
  const nili = (r.noEmail || []).find((x) => x.phone === "972502222222");
  check("מי שאין לה מייל נאספת לפי הטלפון", !!nili);
  check("ועם השם, הקבוצה ותאריך ההתחלה שלה",
    nili && nili.first === "נילי" && nili.group === "ב" && nili.start === "2026-06-14",
    nili && JSON.stringify(nili));
  check("שורה בלי טלפון אינה נאספת, כי אין במה לזהות אותה",
    !(r.noEmail || []).some((x) => x.first === "שרה"));
  check("והיא עדיין נספרת ב-skipped, כדי שהפער לא ייעלם", r.skipped.noEmail === 3, String(r.skipped.noEmail));
}

console.log("\nמה שהמסך מקבל");
{
  const r = await callAdmin({ key: KEY });
  const rows = r.body.noEmail || [];
  check("הרשימה מגיעה למסך", rows.length === 1, JSON.stringify(rows.map((x) => x.phone)));
  check("מי שביטלה אינה בה, כי אין שם מה לתקן", !rows.some((x) => x.phone === "972503333333"));
  check("ולכל שורה מחושב תאריך סיום הגישה", rows[0] && rows[0].end === "2026-11-23", rows[0] && rows[0].end);
}

console.log("\nספירת ההערות באריח מול התור");
{
  // אישה שכתבה הערה ואינה ברשימה, כי בשורה שלה אין מייל. זה בדיוק המקרה שבו האריח
  // אמר 9 והתור אמר 12.
  store.hash["notes:pending"] = { "yafit@test.com": "2", "ghost@test.com": "3" };
  const r = await callAdmin({ key: KEY });
  check("הספירה כוללת גם את מי שאינה ברשימה", r.body.notesTotal === 5, String(r.body.notesTotal));
  check("והמסך יודע כמה מהן כאלה", r.body.notesOff === 3, String(r.body.notesOff));
  const onList = r.body.women.reduce((n, w) => n + (parseInt(w.notes, 10) || 0), 0);
  check("הספירה הישנה, זו שמהרשימה בלבד, באמת נמוכה יותר", onList === 2, String(onList));
  check("והאריח במסך קורא את המספר מהשרת", HTML.includes("DATA.notesTotal"));
  store.hash["notes:pending"] = {};
}

console.log("\nהשלמת מייל לשורה שאין בה");
{
  const bad = await callAdmin({ key: KEY }, "POST", { fixEmail: "yafit@test.com", phone: "972502222222", by: "טלי" });
  check("כתובת שכבר תפוסה נדחית", bad.body.ok === false && bad.body.error === "email_taken");
  const noRow = await callAdmin({ key: KEY }, "POST", { fixEmail: "x@test.com", phone: "972509999999", by: "טלי" });
  check("טלפון שאינו באף שורה בלי מייל נדחה", noRow.body.ok === false && noRow.body.error === "row_gone");

  MC.refuseEmail = true;
  const refused = await callAdmin({ key: KEY }, "POST", { fixEmail: "nili@test.com", phone: "972502222222", by: "טלי" });
  check("כשמניצ'ט מסרב, הפעולה נכשלת", refused.body.ok === false);
  check("ושום דבר לא נשמר אצלנו", !store.hash["admin:manual"] || !store.hash["admin:manual"]["nili@test.com"]);
  MC.refuseEmail = false;

  const ok = await callAdmin({ key: KEY }, "POST", { fixEmail: "nili@test.com", phone: "972502222222", by: "טלי" });
  check("השלמה תקינה מצליחה", ok.body.ok === true, JSON.stringify(ok.body));
  check("הכתובת נכתבה למניצ'ט", MC.email === "nili@test.com");
  const rec = JSON.parse((store.hash["admin:manual"] || {})["nili@test.com"] || "null");
  check("ונשמרה גם אצלנו", !!rec && rec.src === "noemail" && rec.start === "2026-06-14", JSON.stringify(rec));
  check("עם השם והקבוצה מהשורה שלה", rec && rec.first === "נילי" && rec.group === "ב");
}

console.log("\nוהשער נותן לה להיכנס מיד, לפני שהגיליון התעדכן");
{
  const a = await callAccess("nili@test.com");
  check("היא נכנסת", a.body.allowed === true, JSON.stringify(a.body));
  check("עם תאריך ההתחלה שלה", a.body.startDate === "2026-06-14", a.body.startDate);
  const gone = await callAccess("mystery@test.com");
  check("ומי שאינה בשום מקום עדיין לא נכנסת", gone.body.allowed === false && gone.body.reason === "not_registered");
}

console.log("\nוהיא מופיעה במסך כמו כל אישה");
{
  const r = await callAdmin({ key: KEY });
  const w = r.body.women.find((x) => x.email === "nili@test.com");
  check("היא ברשימה", !!w);
  check("מסומנת כאפליקציה החדשה", w && w.newApp === true);
  check("עם חלון הגישה שנגזר מהשורה שלה", w && w.until === "2026-11-23", w && w.until);
  check("ומסומנת כרשומה שהמשרד הזין", w && w.manual && w.manual.src === "noemail");
  check("והיא כבר לא ברשימת חסרי המייל", !(r.body.noEmail || []).some((x) => x.phone === "972502222222"));
}

console.log("\nהגיליון תמיד מנצח");
{
  const before = CSV;
  CSV = [HEAD,
    '972501111111,יפית,קורן,yafit@test.com,2026-06-14 0:00:00,TRUE,FALSE,ב,3',
    '972502222222,נילי,לביא,nili@test.com,2026-05-03 0:00:00,TRUE,FALSE,ד,3',
  ].join("\n");
  const r = await callAdmin({ key: KEY });
  const w = r.body.women.filter((x) => x.email === "nili@test.com");
  check("היא מופיעה פעם אחת בלבד", w.length === 1, String(w.length));
  check("והנתונים הם של הגיליון ולא של הרשומה שלנו", w[0].start === "2026-05-03" && w[0].group === "ד", JSON.stringify(w[0].start));
  check("והיא כבר לא מסומנת כרשומה ידנית", !w[0].manual);
  CSV = before;
}

console.log("\nהוספת משתתפת שאינה בגיליון");
{
  const mcBefore = MC.calls;
  const notSunday = await callAdmin({ key: KEY }, "POST", { addWoman: { first: "דנה", email: "dana@test.com", start: "2026-06-15" }, by: "טלי" });
  check("תאריך שאינו יום ראשון נדחה", notSunday.body.ok === false && notSunday.body.error === "not_sunday");
  const taken = await callAdmin({ key: KEY }, "POST", { addWoman: { first: "דנה", email: "yafit@test.com", start: "2026-06-14" }, by: "טלי" });
  check("כתובת שכבר בגיליון נדחית", taken.body.ok === false && taken.body.error === "email_taken");
  const noName = await callAdmin({ key: KEY }, "POST", { addWoman: { email: "dana@test.com", start: "2026-06-14" }, by: "טלי" });
  check("בלי שם נדחה", noName.body.ok === false && noName.body.error === "no_name");
  const badGroup = await callAdmin({ key: KEY }, "POST", { addWoman: { first: "דנה", email: "dana@test.com", start: "2026-06-14", group: "זz" }, by: "טלי" });
  check("קבוצה שאינה אות אחת נדחית", badGroup.body.ok === false && badGroup.body.error === "bad_group");

  const ok = await callAdmin({ key: KEY }, "POST", { addWoman: { first: "דנה", last: "אבידן", phone: "972507777777", email: "dana@test.com", start: "2026-06-14", group: "ג" }, by: "טלי" });
  check("הוספה תקינה מצליחה", ok.body.ok === true, JSON.stringify(ok.body));
  // ההחלטה של רון: "לא לא מכניסים ממני צ'אט". שום רשומה לא נוצרת שם, ולכן שום
  // אוטומציה לא יכולה לרוץ ושום הודעה לא נשלחת אליה.
  check("ואף קריאה אחת לא יצאה למניצ'ט", MC.calls === mcBefore, String(MC.calls - mcBefore));
  const rec = JSON.parse((store.hash["admin:manual"] || {})["dana@test.com"] || "null");
  check("היא נשמרה אצלנו בלבד", !!rec && rec.src === "add" && rec.by === "טלי");
}

console.log("\nוהיא מקבלת את חלון הגישה הרגיל");
{
  const a = await callAccess("dana@test.com");
  check("היא נכנסת", a.body.allowed === true, JSON.stringify(a.body));
  const r = await callAdmin({ key: KEY });
  const w = r.body.women.find((x) => x.email === "dana@test.com");
  // 70 יום ועוד שלושה חודשים מתאריך ההתחלה, בדיוק כמו כל אישה אחרת.
  check("גישה עד 70 יום ועוד שלושה חודשים", w && w.until === "2026-11-23", w && w.until);
  check("עם השם והקבוצה שהוזנו", w && w.first === "דנה" && w.group === "ג");
}

console.log("\nטיוטת התשובה");
{
  check("היא נשענת על הבריף ב-api/_kb.js", ADMIN_JS.includes('from "./_kb.js"') && ADMIN_JS.includes("${KB}"));
  // עד תחילת המסלול הבא ולא עד מסלול מסוים בשם, אחרת כל מסלול שיוכנס ביניהם
  // ייכנס לחיתוך ויפיל את הבדיקה בלי שהטיוטה השתנתה. קרה ב-v6.80.
  const dFrom = ADMIN_JS.indexOf("body.draftFor");
  const draft = ADMIN_JS.slice(dFrom, ADMIN_JS.indexOf('\n  if (req.method === "POST"', dFrom + 200));
  // הדבר היחיד שמגיע למשתתפת הוא notes:replies, ואליו כותבים רק כשאדם לוחץ "שלחי לה".
  check("ושום דבר ממנה אינו נשלח למשתתפת", !draft.includes("notes:replies") && !draft.includes("HSET"));
  check("ואינה כותבת שום דבר לשום מקום", !draft.includes('"SET"') && !draft.includes("mcPush"));
  check("שאלות של המשרד אינן נענות בה", ADMIN_JS.includes("ענייני משרד"));
  check("ואסור לה להבטיח תיקון שלא קרה", ADMIN_JS.includes("בלי להבטיח תיקון שלא קרה"));
  check("ואינה נחתמת בשמה של ענת", ADMIN_JS.includes("ולעולם לא בשמה של ענת"));
  check("הכפתור קיים במסך", HTML.includes("נסחי לי תשובה") && HTML.includes("data-drafta"));
  check("והוא ממלא את התיבה שהפקידה עורכת ולא שולח", HTML.includes('box.value = d.answer'));
  check("וניחוש מסומן ככזה", HTML.includes("guess:") && HTML.includes("⚠ ניחוש"));
}

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.");
process.exit(fail ? 1 : 0);
