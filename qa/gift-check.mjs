// דף המתנה, v8.52: תיעוד הצהרת הבריאות והפעלת האימון. בלי רשת: Redis מדומה ומניצ'ט מדומה.
import fs from "node:fs";
import { giftEvent, giftRetry, parseBody, originOk } from "../api/_gift.js";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("✗", m); } };

function store() {
  const h = {}, sets = {}, cnt = {};
  const calls = [];
  const redis = async (cmd) => {
    calls.push(cmd);
    const [op, key, ...a] = cmd;
    const t = (h[key] = h[key] || {});
    if (op === "INCR") return (cnt[key] = (cnt[key] || 0) + 1);
    if (op === "EXPIRE") return 1;
    if (op === "HSETNX") { if (a[0] in t) return 0; t[a[0]] = a[1]; return 1; }
    if (op === "HGET") return t[a[0]] ?? null;
    if (op === "HDEL") { const had = a[0] in t; delete t[a[0]]; return had ? 1 : 0; }
    if (op === "HINCRBY") { t[a[0]] = (+t[a[0]] || 0) + a[1]; return t[a[0]]; }
    const s = (sets[key] = sets[key] || new Set());
    if (op === "SADD") { s.add(a[0]); return 1; }
    if (op === "SREM") { const had = s.has(a[0]); s.delete(a[0]); return had ? 1 : 0; }
    if (op === "SMEMBERS") return [...s];
    throw new Error("unknown " + op);
  };
  return { h, sets, redis, calls };
}
const NOW = new Date("2026-11-15T10:00:00Z");
const ORIGIN = "https://myprime.co.il";
const deps = (s, tag, writeMc = true) => ({ redis: s.redis, tag, writeMc, now: NOW });
const tagOk = async () => true;

// 1. אישור ראשון נשמר ומתויג
{
  const s = store(); const tagged = [];
  const r = await giftEvent(JSON.stringify({ u: "12345678", ev: "hd", ver: "briut-v1" }), "1.1.1.1", ORIGIN, deps(s, async (u, at) => { tagged.push([u, at]); return true; }));
  ok(r.status === 200 && r.json.first === true && r.json.mc === "ok", "אישור ראשון: 200, first, mc ok");
  const rec = JSON.parse(s.h["gift:hd"]["12345678"]);
  ok(rec.at === NOW.toISOString() && rec.ver === "briut-v1", "נשמרו השעה וגרסת הנוסח");
  ok(tagged.length === 1 && tagged[0][0] === "12345678" && tagged[0][1] === NOW.toISOString(), "מניצ'ט קיבל את המזהה ואת השעה");
}
// 2. אישור כפול אינו דורס ואינו מתייג שוב
{
  const s = store(); let n = 0;
  const t = async () => { n++; return true; };
  await giftEvent({ u: "123", ev: "hd", ver: "1" }, "ip", ORIGIN, deps(s, t));
  const first = s.h["gift:hd"]["123"];
  const later = { ...deps(s, t), now: new Date("2026-11-16T10:00:00Z") };
  const r = await giftEvent({ u: "123", ev: "hd", ver: "2" }, "ip", ORIGIN, later);
  ok(r.json.first === false && s.h["gift:hd"]["123"] === first, "האישור הראשון לעולם אינו נדרס");
  ok(n === 1, "מניצ'ט נקרא פעם אחת בלבד");
}
// 3. מניצ'ט דוחה או זורק: האישור שמור, והמזהה בתור
for (const [name, t] of [["דוחה", async () => false], ["זורק", async () => { throw new Error("x"); }]]) {
  const s = store();
  const r = await giftEvent({ u: "555", ev: "hd" }, "ip", ORIGIN, deps(s, t));
  ok(r.status === 200 && r.json.mc === "queued", `מניצ'ט ${name}: עדיין 200`);
  ok(!!s.h["gift:hd"]["555"] && s.sets["gift:mcq"].has("555"), `מניצ'ט ${name}: נשמר ונכנס לתור`);
}
// 4. בדב (writeMc=false) אין שום פנייה למניצ'ט
{
  const s = store(); let n = 0;
  const r = await giftEvent({ u: "777", ev: "hd" }, "ip", ORIGIN, deps(s, async () => { n++; return true; }, false));
  ok(r.json.mc === "skip" && n === 0 && !!s.h["gift:hd"]["777"], "בלי writeMc: נשמר ובלי מניצ'ט");
}
// 5. הפעלת האימון נשמרת בנפרד ואינה מתייגת
{
  const s = store(); let n = 0;
  const r = await giftEvent({ u: "888", ev: "play" }, "ip", ORIGIN, deps(s, async () => { n++; return true; }));
  ok(r.status === 200 && !!s.h["gift:play"]["888"] && !(s.h["gift:hd"] || {})["888"] && n === 0, "play: נשמר ב-gift:play בלבד ובלי תגית");
}
// 6. קלט לא תקין
{
  const s = store();
  for (const [b, why] of [[{ u: "abc", ev: "hd" }, "מזהה לא מספרי"], [{ u: "12", ev: "hd" }, "מזהה קצר"], [{ u: "1".repeat(21), ev: "hd" }, "מזהה ארוך"], [{ u: "123", ev: "x" }, "אירוע לא מוכר"], ["{not json", "גוף שבור"], [null, "בלי גוף"]]) {
    const r = await giftEvent(b, "ip", ORIGIN, deps(s, tagOk));
    ok(r.status === 400, `400: ${why}`);
  }
  ok(!s.calls.some((c) => c[0] === "HSETNX"), "קלט לא תקין לא נכתב");
}
// 7. מקור
{
  ok(originOk("https://myprime.co.il") && originOk("https://www.myprime.co.il") && originOk(""), "מקורות מותרים, ובלי Origin מותר");
  const s = store();
  const r = await giftEvent({ u: "123", ev: "hd" }, "ip", "https://evil.example", deps(s, tagOk));
  ok(r.status === 403 && s.calls.length === 0, "מקור זר: 403 ובלי שום פנייה");
}
// 8. תקרה: 30 לדקה לכתובת רשת
{
  const s = store(); let last;
  for (let i = 0; i < 31; i++) last = await giftEvent({ u: String(100 + i), ev: "play" }, "9.9.9.9", ORIGIN, deps(s, tagOk));
  ok(last.status === 429, "הפנייה ה-31 בדקה: 429");
  const other = await giftEvent({ u: "200", ev: "play" }, "8.8.8.8", ORIGIN, deps(s, tagOk));
  ok(other.status === 200, "כתובת אחרת אינה מושפעת");
}
// 9. הניסיון החוזר
{
  const s = store();
  await giftEvent({ u: "111", ev: "hd" }, "ip", ORIGIN, deps(s, async () => false));
  await giftEvent({ u: "222", ev: "hd" }, "ip", ORIGIN, deps(s, async () => false));
  const seen = [];
  const out = await giftRetry({ redis: s.redis, tag: async (u, at) => { seen.push([u, at]); return u === "111"; } });
  ok(out.done === 1 && out.failed === 1, "ניסיון חוזר: אחד עבר ואחד לא");
  ok(!s.sets["gift:mcq"].has("111") && s.sets["gift:mcq"].has("222"), "מי שעבר יצא מהתור, מי שלא נשאר");
  ok(seen.find((x) => x[0] === "111")[1] === NOW.toISOString(), "הניסיון החוזר שולח את שעת האישור המקורית");
  for (let i = 0; i < 40; i++) await giftRetry({ redis: s.redis, tag: async () => false });
  ok(!s.sets["gift:mcq"].has("222") && !!s.h["gift:hd"]["222"], "אחרי 30 ניסיונות יוצא מהתור, והתיעוד נשאר");
}
// 10. parseBody
ok(parseBody('{"u":" 123 ","ev":"hd","ver":"v<1>"}').u === "123" && parseBody('{"ver":"v<1>"}').ver === "v1", "parseBody מנקה");

// 11. החיבור ב-api/admin.js
{
  const a = fs.readFileSync(new URL("../api/admin.js", import.meta.url), "utf8");
  ok(/req\.query\.gift !== undefined/.test(a), "המסלול ?gift קיים");
  ok(/process\.env\.VERCEL_ENV !== "preview"/.test(a.slice(a.indexOf("req.query.gift !== undefined"), a.indexOf("req.query.gift !== undefined") + 900)), "בדב אין כתיבה למניצ'ט");
  ok(/giftRetry\(/.test(a.slice(a.indexOf("req.query.paywatch !== undefined"))), "הניסיון החוזר רץ בתוך paywatch");
  const h = a.indexOf("export default async function handler");
  ok(a.indexOf("req.query.gift !== undefined") > h && a.indexOf("req.query.gift !== undefined") < a.indexOf("await whoIs(key", h), "המסלול לפני בדיקת מפתח המשרד");
}

console.log(`gift-check: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
