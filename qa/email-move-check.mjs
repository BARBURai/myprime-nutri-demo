// v8.62: החלפת מייל במסך הניהול מעבירה גם את ההטבות, את חברה מביאה חברה, את ההערות ואת
// המונים. נמצא על משתתפת שהמייל שלה תוקן מ-gmail.con: הטבת נובמבר נשארה תחת הישנה, והשער
// נתן לה 70 יום בלבד. מריצה את api/admin.js האמיתי מול Redis ומניצ'ט מדומים, בלי רשת.
//
//   node qa/email-move-check.mjs

import adminHandler from "../api/admin.js";

const KEY = "test-admin-key";
process.env.ADMIN_KEY = KEY;
process.env.ACCESS_SHEET_CSV_URL = "https://sheet.test/csv";
process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";
process.env.MANYCHAT_TOKEN = "test-token";

const CSV = [
  "ID,F_NAME,L_NAME,CF_EMAIL,360 - FINAL  PERSONAL START,ביטלה,קבוצה",
  "972504444444,מיכל,לוי,michal@gmail.con,2026-11-15 0:00:00,FALSE,",
  "972505555555,דנה,כהן,dana@test.com,2026-11-15 0:00:00,FALSE,",
].join("\n");

let store;
const MC = { email: "" };
const reset = () => { store = { hash: {}, kv: {}, list: {} }; };
reset();
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith("https://sheet.test")) return { ok: true, text: async () => CSV };
  if (u.startsWith("https://api.manychat.com")) {
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    if (u.includes("findByCustomField")) return { ok: true, json: async () => ({ status: "success", data: { id: 77, custom_fields: [{ id: 11510555, name: "CF_EMAIL", value: MC.email || null }], tags: [] } }) };
    if (u.includes("setCustomField") && body && body.field_id === 11510555) MC.email = body.field_value;
    return { ok: true, json: async () => ({ status: "success" }) };
  }
  const [cmd, a, b, c] = u.replace("https://redis.test/", "").split("/").map(decodeURIComponent);
  const H = (k) => (store.hash[k] = store.hash[k] || {});
  const has = (k) => store.kv[k] !== undefined || store.list[k] !== undefined;
  let result = null;
  if (cmd === "HSET") { H(a)[b] = c; result = 1; }
  else if (cmd === "HSETNX") { if (H(a)[b] === undefined) { H(a)[b] = c; result = 1; } else result = 0; }
  else if (cmd === "HGET") result = H(a)[b] ?? null;
  else if (cmd === "HDEL") { delete H(a)[b]; result = 1; }
  else if (cmd === "HGETALL") { const o = H(a); result = Object.keys(o).flatMap((k) => [k, o[k]]); }
  else if (cmd === "SET") { store.kv[a] = b; result = "OK"; }
  else if (cmd === "GET") result = store.kv[a] ?? null;
  else if (cmd === "DEL") { const had = store.kv[a] !== undefined; delete store.kv[a]; result = had ? 1 : 0; }
  else if (cmd === "RENAMENX") {
    if (!has(a)) return { ok: false, status: 400, json: async () => ({ error: "ERR no such key" }) };
    if (has(b)) result = 0;
    else {
      if (store.kv[a] !== undefined) { store.kv[b] = store.kv[a]; delete store.kv[a]; }
      if (store.list[a] !== undefined) { store.list[b] = store.list[a]; delete store.list[a]; }
      result = 1;
    }
  }
  else if (cmd === "SISMEMBER") result = 0;
  else result = 0;
  return { ok: true, json: async () => ({ result }) };
};

const mkRes = () => { const r = { code: 0, body: null }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.setHeader = () => {}; r.send = (b) => { r.body = b; return r; }; return r; };
const move = async (from, to) => { const res = mkRes(); await adminHandler({ query: { key: KEY }, method: "POST", body: { email: from, newEmail: to, phone: "972504444444", by: "רון" } }, res); return res; };

let pass = 0, fail = 0;
const check = (name, cond, extra) => { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); } };

const FROM = "michal@gmail.con", TO = "michal@gmail.com";
const seed = () => {
  reset();
  store.hash["ref:bonus"] = { [FROM]: JSON.stringify({ pd: 28, m: 1, f: 1, via: false }) };
  store.hash["ref:mine"] = { [FROM]: "AB12CD" };
  store.hash["ref:code"] = { AB12CD: FROM };
  store.hash["ref:credit"] = { [FROM]: JSON.stringify({ friends: ["dana@test.com"] }) };
  store.hash["ref:by"] = { [FROM]: JSON.stringify({ from: "x@test.com", order: "o1" }) };
  store.hash["promo:nov26"] = { [FROM]: JSON.stringify({ order: "o2" }) };
  store.hash["promo:bf26"] = { [FROM]: JSON.stringify({ order: "o3" }) };
  store.hash["promo:bf26start"] = { [FROM]: "2026-11-08" };
  store.hash["notes:replies"] = { [FROM]: JSON.stringify([{ text: "תשובה" }]) };
  store.hash["notes:pending"] = { [FROM]: "1" };
  store.list["notes:" + FROM] = ['{"text":"הערה"}'];
  store.list["bk:hist:" + FROM] = ["v1", "v2"];
  store.kv["ai:photos:" + FROM] = "23";
  store.kv["bkmail:" + FROM] = "1";
};

console.log("\nהחלפת מייל מעבירה הכל");
{
  seed();
  const r = await move(FROM, TO);
  check("ההחלפה הצליחה", r.body && r.body.ok === true, JSON.stringify(r.body));
  for (const h of ["ref:bonus", "ref:mine", "ref:credit", "ref:by", "promo:nov26", "promo:bf26", "promo:bf26start", "notes:replies", "notes:pending"]) {
    check(`${h} עבר לכתובת החדשה`, store.hash[h][TO] !== undefined && store.hash[h][FROM] === undefined, JSON.stringify(store.hash[h]));
  }
  check("**הטבת נובמבר נשמרה כמו שהייתה**", JSON.parse(store.hash["ref:bonus"][TO]).pd === 28);
  check("**הקוד שלה מצביע על הכתובת החדשה**", store.hash["ref:code"].AB12CD === TO);
  check("ההערות עברו", store.list["notes:" + TO]?.length === 1 && store.list["notes:" + FROM] === undefined);
  check("שלושת העותקים של הגיבוי עברו", store.list["bk:hist:" + TO]?.length === 2 && store.list["bk:hist:" + FROM] === undefined);
  check("**מונה הצילומים עבר ולא התאפס**", store.kv["ai:photos:" + TO] === "23" && store.kv["ai:photos:" + FROM] === undefined);
  check("סימון מייל הגיבוי עבר", store.kv["bkmail:" + TO] === "1");
  check("אין שום דבר שנשאר מאחור", Array.isArray(r.body.kept) && r.body.kept.length === 0, JSON.stringify(r.body.kept));
  check("ברשימת מה שעבר", r.body.moved.includes("ref:bonus") && r.body.moved.includes("ai:photos:"), JSON.stringify(r.body.moved));
}

console.log("\nרשומה שכבר קיימת תחת הכתובת החדשה אינה נדרסת");
{
  seed();
  store.hash["ref:bonus"][TO] = JSON.stringify({ pd: 0, m: 0 });
  store.kv["ai:photos:" + TO] = "5";
  const r = await move(FROM, TO);
  check("ההחלפה הצליחה", r.body && r.body.ok === true);
  check("הרשומה של הכתובת החדשה לא נדרסה", JSON.parse(store.hash["ref:bonus"][TO]).pd === 0);
  check("והישנה נשארה במקומה", JSON.parse(store.hash["ref:bonus"][FROM]).pd === 28);
  check("המונה של החדשה לא נדרס, והישן נשאר", store.kv["ai:photos:" + TO] === "5" && store.kv["ai:photos:" + FROM] === "23");
  check("מה שלא עבר נאמר בתשובה", r.body.kept.includes("ref:bonus") && r.body.kept.includes("ai:photos:"), JSON.stringify(r.body.kept));
  const log = JSON.parse(store.hash["admin:overrides"][TO]).log || [];
  check("ונרשם ביומן", log.some((L) => L.field === "email" && (L.kept || []).includes("ref:bonus")), JSON.stringify(log));
  check("כל השאר עבר", store.hash["promo:nov26"][TO] !== undefined && store.hash["ref:code"].AB12CD === TO);
}

console.log("\nאישה בלי שום הטבה");
{
  reset();
  const r = await move(FROM, TO);
  check("ההחלפה הצליחה בלי כלום להעביר", r.body && r.body.ok === true && r.body.kept.length === 0, JSON.stringify(r.body));
  check("ולא נוצרה שום רשומה ריקה", !store.hash["ref:bonus"] || store.hash["ref:bonus"][TO] === undefined);
  check("ואין קוד שמצביע עליה", !store.hash["ref:code"] || !Object.values(store.hash["ref:code"]).includes(TO));
}

console.log(`\n${pass} עברו, ${fail} נכשלו`);
process.exit(fail ? 1 : 0);
