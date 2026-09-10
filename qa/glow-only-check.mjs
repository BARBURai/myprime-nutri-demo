// מוצר גלו העצמאי, ומתנת הוובינר, ואיך השער מבדיל ביניהם.
//
// **הסימן היחיד הוא תאריך ההתחלה של 360.** למי שקיבלה את הקורס במתנה בוובינר תמיד
// יש מחזור, ולמי שקנתה את הקורס לבדו אין, ולכן אין צורך בעמודה שאומרת "היא ב-360".
//
// הבדיקה מריצה את `api/access.js` האמיתי מול גיליון מדומה ומול Redis מדומה,
// **כולל המקרה שבו Redis נופל**, שבו אסור שאישה משלמת תינעל. בלי רשת ובלי עלות.
//
//   node qa/glow-only-check.mjs

import accessHandler from "../api/access.js";

process.env.ACCESS_SHEET_CSV_URL = "https://sheet.test/csv";
process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";

const HDR = 'ID,F_NAME,L_NAME,CF_EMAIL,360 - FINAL  PERSONAL START,ביטלה,קבוצה,חודשי גישה נוספים,בונוס איפור,GLOW-FULL,GLOW-FULL-M';
let CSV = HDR;
let REDIS_DOWN = false;
let store = { hash: {}, kv: {} };

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.startsWith("https://sheet.test")) return { ok: true, text: async () => CSV };
  if (REDIS_DOWN) throw new Error("redis down");
  const parts = u.replace("https://redis.test/", "").split("/").map(decodeURIComponent);
  const [cmd, a, b, c] = parts;
  const H = (k) => (store.hash[k] = store.hash[k] || {});
  let result = null;
  if (cmd === "HSET") { H(a)[b] = c; result = 1; }
  else if (cmd === "HSETNX") { if (H(a)[b] === undefined) { H(a)[b] = c; result = 1; } else result = 0; }
  else if (cmd === "HGET") result = H(a)[b] ?? null;
  else if (cmd === "HDEL") { delete H(a)[b]; result = 1; }
  else if (cmd === "SET") { store.kv[a] = b; result = "OK"; }
  else if (cmd === "GET") result = store.kv[a] ?? null;
  else if (cmd === "DEL") { delete store.kv[a]; result = 1; }
  else result = 0;
  return { ok: true, json: async () => ({ result }) };
};

function mkRes() {
  const r = { code: 0, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
const gate = async (email) => {
  const res = mkRes();
  await accessHandler({ query: { email, device: "dev-1" }, method: "GET" }, res);
  return res.body || {};
};
// תאריך בפורמט של הגיליון, N חודשים אחורה מהיום.
const monthsAgo = (n) => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
};
const sundayMonthsAgo = (n) => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().slice(0, 10);
};

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
};
const reset = () => { store = { hash: {}, kv: {} }; REDIS_DOWN = false; };

console.log("\nמתנת הוובינר: 360 וגם הקורס המלא");
{
  reset();
  CSV = [HDR, `972501111111,אורלי,לוי,gift@test.com,${sundayMonthsAgo(1)} 0:00:00,FALSE,ב,3,FALSE,TRUE,`].join("\n");
  const g = await gate("gift@test.com");
  check("היא נכנסת", g.allowed === true, g.reason);
  check("ויש לה את הקורס המלא", g.glowFull === true);
  check("והמוצר שלה הוא 360 ולא גלו", g.product === "360", g.product);
  check("ויש לה תאריך התחלה של מחזור", !!g.startDate, String(g.startDate));
}
{
  reset();
  // אותה אישה עם GLOW-FULL-M מלאה. לפי החלטת רון הקורס פתוח לה כל עוד 360 פתוח,
  // ולכן העמודה אינה מקצרת ואינה מאריכה לה כלום.
  CSV = [HDR, `972501111111,אורלי,לוי,gift@test.com,${sundayMonthsAgo(1)} 0:00:00,FALSE,ב,3,FALSE,TRUE,12`].join("\n");
  const g = await gate("gift@test.com");
  check("GLOW-FULL-M אינה הופכת אותה למוצר גלו", g.product === "360", g.product);
  check("והיא עדיין נכנסת", g.allowed === true, g.reason);
}
{
  reset();
  // 360 שנגמר לה. הקורס נסגר איתו, כי הוא היה מתנה בתוך התוכנית.
  CSV = [HDR, `972501111111,אורלי,לוי,gift@test.com,${sundayMonthsAgo(20)} 0:00:00,FALSE,ב,3,FALSE,TRUE,12`].join("\n");
  const g = await gate("gift@test.com");
  check("וכשחלון 360 נגמר היא יוצאת", g.allowed === false && g.reason === "expired", g.reason);
}

console.log("\nמוצר גלו העצמאי: הקורס בלי 360");
{
  reset();
  CSV = [HDR, '972502222222,דנה,כהן,solo@test.com,,FALSE,,,FALSE,TRUE,'].join("\n");
  const g = await gate("solo@test.com");
  check("היא נכנסת בלי תאריך התחלה", g.allowed === true, g.reason);
  check("והמוצר שלה הוא גלו", g.product === "glow", g.product);
  const seen = () => (store.hash["glow:start"] || {})["solo@test.com"];
  check("היום הראשון שלה נתפס אצלנו", !!seen());
  const first = seen();
  await gate("solo@test.com");
  check("והוא אינו נדרס בכניסה הבאה", !!first && seen() === first, String(first));
}
{
  reset();
  CSV = [HDR, '972502222222,דנה,כהן,solo@test.com,,FALSE,,,FALSE,TRUE,'].join("\n");
  store.hash["glow:start"] = { "solo@test.com": monthsAgo(11) };
  const g = await gate("solo@test.com");
  check("אחרי 11 חודשים היא עדיין בפנים", g.allowed === true, g.reason);
}
{
  reset();
  CSV = [HDR, '972502222222,דנה,כהן,solo@test.com,,FALSE,,,FALSE,TRUE,'].join("\n");
  store.hash["glow:start"] = { "solo@test.com": monthsAgo(13) };
  const g = await gate("solo@test.com");
  check("ואחרי 13 חודשים היא יוצאת. ברירת המחדל היא 12", g.allowed === false && g.reason === "expired", g.reason);
}
{
  reset();
  CSV = [HDR, '972502222222,דנה,כהן,solo@test.com,,FALSE,,,FALSE,TRUE,6'].join("\n");
  store.hash["glow:start"] = { "solo@test.com": monthsAgo(7) };
  const g = await gate("solo@test.com");
  check("GLOW-FULL-M של 6 מקצרת לה את החלון", g.allowed === false && g.reason === "expired", g.reason);
}
{
  reset();
  CSV = [HDR, '972502222222,דנה,כהן,solo@test.com,,FALSE,,,FALSE,TRUE,24'].join("\n");
  store.hash["glow:start"] = { "solo@test.com": monthsAgo(13) };
  const g = await gate("solo@test.com");
  check("ו-24 מאריכה לה אותו", g.allowed === true, g.reason);
}

console.log("\nשתי העמודות אינן מתבלבלות זו בזו");
{
  reset();
  // GLOW-FULL ריקה ו-GLOW-FULL-M מלאה: אין לה קורס בכלל, והמספר אינו נותן אותו.
  CSV = [HDR, '972503333333,מיכל,רז,none@test.com,,FALSE,,,FALSE,,12'].join("\n");
  const g = await gate("none@test.com");
  check("מספר בלי סימון אינו נותן את הקורס", g.glowFull === false);
  check("והמוצר שלה אינו גלו", g.product === "360", g.product);
}

console.log("\nמה שאסור שיקרה");
{
  reset();
  CSV = [HDR, '972502222222,דנה,כהן,solo@test.com,,FALSE,,,FALSE,TRUE,'].join("\n");
  REDIS_DOWN = true;
  const g = await gate("solo@test.com");
  check("Redis נופל ואישה משלמת אינה נעולה", g.allowed === true, g.reason);
  check("והמוצר שלה עדיין מזוהה נכון", g.product === "glow", g.product);
}
{
  reset();
  CSV = [HDR, '972502222222,דנה,כהן,solo@test.com,,TRUE,,,FALSE,TRUE,'].join("\n");
  store.hash["glow:start"] = { "solo@test.com": monthsAgo(1) };
  const g = await gate("solo@test.com");
  check("מי שביטלה אינה נכנסת גם עם הקורס", g.allowed === false && g.reason === "cancelled", g.reason);
}
{
  reset();
  // 360 רגילה בלי הקורס: שום דבר אצלה לא זז.
  CSV = [HDR, `972504444444,רונית,שני,plain@test.com,${sundayMonthsAgo(1)} 0:00:00,FALSE,א,3,FALSE,,`].join("\n");
  const g = await gate("plain@test.com");
  check("מי שאין לה קורס אינה מושפעת בכלל", g.allowed === true && g.product === "360" && g.glowFull === false);
  check("ולא נכתב לה שום שעון של גלו", !store.hash["glow:start"]);
}

console.log(`\n${pass} מתוך ${pass + fail} עברו.\n`);
process.exit(fail ? 1 : 0);
