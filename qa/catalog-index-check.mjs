// מה מתוך המאגר הגדול מוצג בחיפוש לכל הנשים. v7.48
//
//   node qa/catalog-index-check.mjs
//
// **רון: "תן לי להבין שנשים לא מקבלות זבל."** הקובץ הזה מריץ את `api/catalog.js` האמיתי
// מול Redis מדומה ומול בינה מדומה, בלי רשת, ובודק שלושה דברים:
//   1. המאגר ממשיך להתמלא בדיוק כמו קודם, מכל פריט שנרשם
//   2. בחיפוש מופיע רק מה שעבר את שלוש הבדיקות: שם, מספרים, ובינה
//   3. כל תקלה, בבינה או ב-Redis, לעולם אינה מכשילה את הרישום עצמו ואינה מציגה פריט שלא נבדק
process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";
process.env.ANTHROPIC_API_KEY = "k";

import { readFileSync } from "node:fs";
import { nameProblem, cleanName, parseJudge, escapeGlob, indexField } from "../lib/catfilter.js";

// ---------- Redis מדומה ----------
let str = new Map(), hash = new Map(), sets = new Map(), cmds = [];
const H = (k) => { if (!hash.has(k)) hash.set(k, new Map()); return hash.get(k); };
const S = (k) => { if (!sets.has(k)) sets.set(k, new Set()); return sets.get(k); };
const globRx = (g) => new RegExp("^" + String(g).replace(/\\(.)|([.+^${}()|[\]])|(\*)|(\?)/g, (m, esc, sp, star, q) => esc ? esc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : sp ? "\\" + sp : star ? "[\\s\\S]*" : "[\\s\\S]") + "$");
function redis(cmd) {
  const [op, a, ...r] = cmd;
  cmds.push(op);
  switch (op) {
    case "GET": return str.has(a) ? str.get(a) : null;
    case "SET": {
      if (r.includes("NX") && str.has(a)) return null;
      str.set(a, String(r[0])); return "OK";
    }
    case "DEL": return str.delete(a) ? 1 : 0;
    case "MGET": return [a, ...r].map((k) => (str.has(k) ? str.get(k) : null));
    case "INCR": { const n = (Number(str.get(a)) || 0) + 1; str.set(a, String(n)); return n; }
    case "INCRBY": { const n = (Number(str.get(a)) || 0) + Number(r[0]); str.set(a, String(n)); return n; }
    case "EXPIRE": return 1;
    case "KEYS": throw new Error("KEYS must not be used by search");
    case "SCAN": {
      const all = [...str.keys()].sort();
      const start = Number(a) || 0, count = Number(r[r.indexOf("COUNT") + 1]) || 10;
      const rx = globRx(r[r.indexOf("MATCH") + 1] || "*");
      const slice = all.slice(start, start + count);
      const next = start + count >= all.length ? "0" : String(start + count);
      return [next, slice.filter((k) => rx.test(k))];
    }
    case "HGET": return H(a).has(r[0]) ? H(a).get(r[0]) : null;
    case "HSET": H(a).set(r[0], r[1]); return 1;
    case "HDEL": return H(a).delete(r[0]) ? 1 : 0;
    case "HMGET": return r.map((f) => (H(a).has(f) ? H(a).get(f) : null));
    case "HSCAN": {
      const rx = globRx(r[r.indexOf("MATCH") + 1] || "*");
      const out = [];
      for (const [f, v] of H(a)) if (rx.test(f)) out.push(f, v);
      return ["0", out];
    }
    case "SADD": { r.forEach((x) => S(a).add(x)); return r.length; }
    case "SRANDMEMBER": return [...S(a)].slice(0, Number(r[0]) || 1);
    case "SREM": { let n = 0; r.forEach((x) => { if (S(a).delete(x)) n++; }); return n; }
    case "SPOP": { const n = Number(r[0]) || 1; const out = [...S(a)].slice(0, n); out.forEach((x) => S(a).delete(x)); return out; }
    default: throw new Error("fake redis: unknown " + op);
  }
}

// ---------- בינה מדומה ----------
// פוסלת לפי רשימה, ואפשר להגיד לה ליפול או לא לענות על שורה.
let aiCalls = 0, aiSeen = [], aiMode = "ok", aiBad = new Set(["שיבולת שועל"]), aiSkip = new Set();
globalThis.fetch = async (url, opt = {}) => {
  const u = String(url);
  if (u.startsWith("https://redis.test")) {
    let result, error;
    try { result = redis(JSON.parse(opt.body)); } catch (e) { error = String(e.message); }
    return { ok: true, json: async () => (error ? { error } : { result }) };
  }
  if (u.startsWith("https://api.anthropic.com")) {
    aiCalls++;
    if (aiMode === "down") throw new Error("anthropic down");
    if (aiMode === "500") return { ok: false, status: 500, json: async () => ({}) };
    const body = JSON.parse(opt.body);
    const lines = body.messages[0].content.split("\n");
    aiSeen.push(...lines);
    const reply = lines.map((l) => {
      const m = l.match(/^(\d+)\. (.*?) \|/);
      if (aiSkip.has(m[2])) return "";
      return aiBad.has(m[2]) ? `${m[1]}:BAD values off` : `${m[1]}:OK`;
    }).filter(Boolean).join("\n");
    return { ok: true, json: async () => ({ content: [{ type: "text", text: reply }], usage: { input_tokens: 100, output_tokens: 10 } }) };
  }
  throw new Error("unexpected fetch " + u);
};

const { default: handler, fillIndex } = await import("../api/catalog.js");
const call = (req) => new Promise((resolve) => {
  const res = { status: () => res, json: (b) => resolve(b) };
  handler({ method: "GET", headers: {}, query: {}, ...req }, res);
});
const log = (name, per100, source = "estimated", unit = "g") => call({ method: "POST", headers: { "x-user-id": "w@test.co" }, body: { name, per100, unit, source } });
const search = async (q) => { cmds = []; const r = await call({ query: { q } }); return r.items || []; };
const reset = () => { str = new Map(); hash = new Map(); sets = new Map(); aiCalls = 0; aiSeen = []; aiMode = "ok"; aiSkip = new Set(); };
const inStore = (name) => str.has("cat:" + name);

let pass = 0, fail = 0;
const ck = (n, c, x) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x !== undefined ? "  → " + x : "")); } };

const NECT = { kcal: 44, p: 1.1, f: 0.3, c: 10.6 };
const OATS_BAD = { kcal: 253, p: 18, f: 20, c: 0 };

console.log("\nא. כללי השם, על שמות אמיתיים מהמאגר\n");
const names = [
  ["נקטרינה", null], ["גבינה צהובה 28%", null], ["יוגורט יופלה 1.5% ללא סוכר", null],
  ["תפוח פינק ליידי (חצי)", null], ["קפה הפוך על בסיס חלב חלקי - קטן", null],
  ["שתי ביצים", "qty"], ["חביתה 2 ביצים עם שפריץ שמן", "qty"], ["שניצל עוף מטוגן (x2)", null],
  ["חצי פיתה", "qty"], ["מנת קציצות טונה קטנה (3 קציצות)", "qty"], ["כוס קפה", "qty"],
  ["פיתה + חומוס + סלט", "combo"], ["תפוחי אדמה, חטיף, תפוצ'יפס/טבעי", "combo"],
  ["סלט טחינה ביתי או טחינה גולמית מדוללת עם מלח", "combo"],
  ["אייס קפה קטן ארומה עם חלב רגיל וסוכר", "long"], ["()", "empty"],
];
for (const [n, want] of names) ck(`"${n}" -> ${want || "תקין"}`, nameProblem(n) === want, nameProblem(n));
ck("הסוגריים יורדים מהשם שמוצג: \"תפוח פינק ליידי (חצי)\" -> \"תפוח פינק ליידי\"", cleanName("תפוח פינק ליידי (חצי)") === "תפוח פינק ליידי", cleanName("תפוח פינק ליידי (חצי)"));
ck("\"שניצל עוף מטוגן (x2)\" -> \"שניצל עוף מטוגן\"", cleanName("שניצל עוף מטוגן (x2)") === "שניצל עוף מטוגן");
ck("מילת גודל יורדת: \"נקטרינה בינונית-קטנה\" -> \"נקטרינה\"", cleanName("נקטרינה בינונית-קטנה") === "נקטרינה", cleanName("נקטרינה בינונית-קטנה"));
ck("וסימני קריאה: \"קוטג 2%!!!\" -> \"קוטג 2%\"", cleanName("קוטג 2%!!!") === "קוטג 2%");
ck("גרש עברי ורגיל הם אותו פריט", indexField("קוטג׳ 5%") === indexField("קוטג' 5%"), indexField("קוטג׳ 5%") + " / " + indexField("קוטג' 5%"));

console.log("\nב. פריט טוב: נכנס למאגר, נבדק פעם אחת, ומופיע בחיפוש\n");
reset();
let r = await log("נקטרינה", NECT);
ck("הרישום מצליח כמו תמיד", r.ok === true, JSON.stringify(r));
ck("ונכנס למאגר הגדול", inStore("נקטרינה"));
ck("והבינה נשאלה עליו פעם אחת", aiCalls === 1, aiCalls);
ck("ואחרי שנבדק הוא יוצא מרשימת ההמתנה", !(sets.get("catidx:pending") || new Set()).size);
let items = await search("נקט");
ck("**מופיע בחיפוש \"נקט\"**", items.length === 1 && items[0].name === "נקטרינה", JSON.stringify(items.map((i) => i.name)));
ck("עם הערכים שלו ל-100 גרם", items[0] && items[0].per100.kcal === 44 && items[0].per100.p === 1.1, JSON.stringify(items[0] && items[0].per100));
ck("**והחיפוש אינו משתמש ב-KEYS**, ולוקח פקודה אחת", !cmds.includes("KEYS") && cmds.length === 1, cmds.join(","));
await log("נקטרינה", NECT);
await log("נקטרינה", NECT);
ck("**רישום חוזר של אותו פריט אינו שואל את הבינה שוב**", aiCalls === 1, aiCalls);
ck("וסופר את השימוש", JSON.parse(hash.get("catidx").get("נקטרינה")).seen === 3);

console.log("\nג. שם של צלחת אישית: נכנס למאגר, לא לחיפוש, ובלי קריאה לבינה\n");
reset();
for (const n of ["שתי ביצים", "חצי פיתה", "פיתה + חומוס + סלט", "אייס קפה קטן ארומה עם חלב רגיל וסוכר"]) {
  r = await log(n, { kcal: 150, p: 10, f: 10, c: 5 });
  ck(`"${n}": הרישום מצליח ונשמר במאגר`, r.ok === true && inStore(n.toLowerCase()), JSON.stringify(r));
}
ck("**אף אחד מהם אינו מגיע לבינה**", aiCalls === 0, aiCalls);
ck("**ואינו מופיע בחיפוש \"ביצ\"**", (await search("ביצ")).length === 0);
ck("ולא \"פיתה\"", (await search("פיתה")).length === 0);

console.log("\nד. שם תקין עם מספרים שאינם מתיישבים: נדחה כמו קודם\n");
reset();
r = await log("עוגת שוקולד", { kcal: 900, p: 1, f: 1, c: 1 });
ck("נדחה כבר בשער הקיים", r.ok === false && r.reason === "rejected", JSON.stringify(r));
ck("ולא נשאל עליו אף אחד", aiCalls === 0);

console.log("\nה. שם תקין שהבינה פוסלת: במאגר, לא בחיפוש\n");
reset();
r = await log("שיבולת שועל", OATS_BAD, "usda");
ck("הרישום מצליח", r.ok === true);
ck("והפריט במאגר הגדול, לא נמחק", inStore("שיבולת שועל"));
ck("**אבל אינו מופיע בחיפוש**", (await search("שיבולת")).length === 0);
ck("והפסילה נשמרת עם הסיבה", /values off/.test(JSON.parse(hash.get("catjudge").get("שיבולת שועל")).why));
await log("שיבולת שועל", OATS_BAD, "usda");
ck("ואינו נשאל שוב על אותם ערכים", aiCalls === 1, aiCalls);
aiBad.delete("שיבולת שועל");
await log("שיבולת שועל", { kcal: 379, p: 13, f: 6.5, c: 67.7 }, "verified");
ck("**ערכים נכונים ממקור אמין יותר נבדקים מחדש**", aiCalls === 2, aiCalls);
ck("ועכשיו מופיע, עם הערכים הנכונים", (await search("שיבולת"))[0]?.per100.kcal === 379, JSON.stringify((await search("שיבולת"))[0]));
aiBad.add("שיבולת שועל");

console.log("\nו. הבינה נופלת או אינה עונה\n");
for (const mode of ["down", "500"]) {
  reset(); aiMode = mode;
  r = await log("נקטרינה", NECT);
  ck(`${mode}: הרישום עדיין מצליח`, r.ok === true && inStore("נקטרינה"), JSON.stringify(r));
  ck(`${mode}: **הפריט אינו מוצג**, כי לא נבדק`, (await search("נקט")).length === 0);
  ck(`${mode}: ונשאר ממתין לבדיקה`, sets.get("catidx:pending")?.has("cat:נקטרינה"));
  aiMode = "ok";
  await log("מלפפון", { kcal: 15, p: 0.7, f: 0.1, c: 3.6 });
  ck(`${mode}: ובפעם הבאה שהבינה עונה, הוא נבדק ומופיע`, (await search("נקט")).length === 1);
}
reset(); aiSkip = new Set(["נקטרינה"]);
await log("נקטרינה", NECT);
ck("שורה שהבינה דילגה עליה אינה נחשבת תשובה, ואינה מוצגת", (await search("נקט")).length === 0 && !hash.get("catjudge")?.has("נקטרינה"));
ck("ונשארת לבדיקה חוזרת", sets.get("catidx:pending")?.has("cat:נקטרינה"));

console.log("\nז. אין מפתח לבינה: שום דבר אינו מוצג, ושום דבר אינו נשבר\n");
reset(); delete process.env.ANTHROPIC_API_KEY;
r = await log("נקטרינה", NECT);
ck("הרישום מצליח והמאגר גדל", r.ok === true && inStore("נקטרינה"));
ck("ואין תוצאות לא בדוקות בחיפוש", (await search("נקט")).length === 0);
process.env.ANTHROPIC_API_KEY = "k";

console.log("\nח. מה שכבר היה במאגר לפני הגרסה הזאת עובר את אותה בדיקה, פעם אחת\n");
reset();
const now = Date.now();
const old = [];
for (let i = 0; i < 120; i++) {
  const bad = i % 4 === 0, junk = i % 4 === 1;
  const name = junk ? `שתי פרוסות לחם ${String.fromCharCode(1488 + (i % 22))}${String.fromCharCode(1488 + Math.floor(i / 22))}` : bad ? "שיבולת שועל" + (i ? " דקה " + String.fromCharCode(1488 + (i % 22)) + String.fromCharCode(1488 + Math.floor(i / 22)) : "") : `מזון בדיקה ${String.fromCharCode(1489 + (i % 21))}${String.fromCharCode(1489 + Math.floor(i / 21))}`;
  old.push(name);
  str.set("cat:" + name.toLowerCase(), JSON.stringify({ name, per100: bad ? OATS_BAD : { kcal: 100, p: 5, f: 3, c: 13 }, unit: "g", source: "estimated", seen: 1, ts: now }));
}
aiBad = new Set(old.filter((n) => n.startsWith("שיבולת שועל")));
for (let i = 0; i < 20 && str.get("catidx:cursor") !== "done"; i++) await fillIndex("https://redis.test", "t");
ck("**המעבר מסתיים**", str.get("catidx:cursor") === "done", str.get("catidx:cursor"));
const idx = hash.get("catidx") || new Map();
const goodOld = old.filter((n) => n.startsWith("מזון בדיקה"));
ck(`**כל ${goodOld.length} הטובים באינדקס**`, goodOld.every((n) => idx.has(n)), goodOld.filter((n) => !idx.has(n)).join(","));
ck("**אף אחד מאלה שהבינה פסלה**", ![...idx.keys()].some((f) => f.startsWith("שיבולת")));
ck("**ואף שם של צלחת**", ![...idx.keys()].some((f) => f.includes("פרוסות")));
ck("וכל פריט נשאל פעם אחת בלבד", new Set(aiSeen.map((l) => l.replace(/^\d+\. /, ""))).size === aiSeen.length, aiSeen.length);
ck("ובקבוצות של עד 40", aiCalls <= Math.ceil(90 / 40) + 2, aiCalls);
ck("**ושום דבר לא נמחק מהמאגר**", old.every((n) => str.has("cat:" + n.toLowerCase())));
aiBad = new Set(["שיבולת שועל"]);

console.log("\nט. שתי הרצות במקביל אינן בודקות את אותו פריט פעמיים\n");
reset();
for (let i = 0; i < 30; i++) str.set(`cat:פרי ${i}`, JSON.stringify({ name: `פרי ${i}`, per100: { kcal: 50, p: 1, f: 0, c: 12 }, unit: "g", source: "estimated", seen: 1, ts: Date.now() }));
const [a1, a2] = await Promise.all([fillIndex("https://redis.test", "t"), fillIndex("https://redis.test", "t")]);
ck("אחת רצה והשנייה מוותרת", [a1.reason, a2.reason].includes("locked"), JSON.stringify([a1, a2]));
ck("והנעילה משתחררת בסוף", !str.has("catidx:lock"));

console.log("\nי. סדר התוצאות, ופריטים ישנים\n");
reset();
for (const [n, seen] of [["מיץ תפוח", 9], ["תפוח עץ ירוק", 2], ["תפוח", 1], ["עוגת תפוחים", 20]]) {
  str.set("cat:" + n, JSON.stringify({ name: n, per100: { kcal: 52, p: 0.3, f: 0.2, c: 14 }, unit: "g", source: "estimated", seen, ts: Date.now() }));
}
str.set("cat:אגס ישן", JSON.stringify({ name: "אגס ישן", per100: { kcal: 57, p: 0.4, f: 0.1, c: 15 }, unit: "g", source: "estimated", seen: 1, ts: Date.now() - 200 * 24 * 3600 * 1000 }));
for (let i = 0; i < 5; i++) await fillIndex("https://redis.test", "t");
items = await search("תפוח");
ck("שם זהה ראשון, ואחריו מה שמתחיל במילה", items[0]?.name === "תפוח" && items[1]?.name === "תפוח עץ ירוק", items.map((i) => i.name).join(" | "));
ck("ורק אחריהם התאמה באמצע השם", items.slice(2).map((i) => i.name).join("|") === "עוגת תפוחים|מיץ תפוח", items.map((i) => i.name).join(" | "));
ck("פריט שלא נרשם 180 יום אינו מוצג", (await search("אגס")).length === 0);
ck("כוכבית בשאילתה אינה מחזירה את כל המאגר", (await search("**")).length === 0);
ck("escapeGlob", escapeGlob("a*b[c]") === "a\\*b\\[c\\]");
reset();
for (const n of ["נקטרינה קטנה", "נקטרינה בינונית", "נקטרינה גדולה"]) await log(n, NECT);
items = await search("נקטרינה");
ck("**שלושה גדלים של אותו פרי הם שורה אחת בחיפוש**", items.length === 1 && items[0].name === "נקטרינה", items.map((i) => i.name).join(" | "));
ck("ונבדקו בבינה פעם אחת", aiCalls === 1, aiCalls);
await log("קוטג׳ 5%", { kcal: 95, p: 11, f: 5, c: 2 });
ck("**חיפוש עם גרש רגיל מוצא את מה שנרשם עם גרש עברי**", (await search("קוטג' 5")).length === 1 && (await search("קוטג")).length === 1);

console.log("\nיא. מחיקה מהמשרד\n");
process.env.NOTIFY_SECRET = "s";
reset();
await log("נקטרינה", NECT);
await call({ query: { action: "del", key: "נקטרינה", secret: "s" } });
ck("הפריט יוצא מהחיפוש", (await search("נקט")).length === 0);
await log("נקטרינה", NECT);
ck("**ורישום חדש של אותו שם אינו מחזיר אותו**", (await search("נקט")).length === 0);

console.log("\nיב. הפענוח של תשובת הבינה\n");
let pj = parseJudge("1:OK\n2:BAD typo\n3: ok\nsomething else\n2:OK", 4);
ck("OK, BAD, רווחים ואותיות קטנות", pj.ok[0] === true && pj.ok[1] === false && pj.ok[2] === true, JSON.stringify(pj.ok));
ck("שורה שלא נענתה נשארת null ולא נחשבת פסולה", pj.ok[3] === null);
ck("תשובה ראשונה לשורה קובעת", pj.ok[1] === false && pj.why[1] === "typo");
ck("מספר מחוץ לטווח מתעלמים ממנו", parseJudge("9:OK", 2).ok.every((x) => x === null));

console.log("\nיג. באפליקציה\n");
const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
ck("**התרגום לבינה אינו נקרא כשהמאגר כבר מצא**", /if \(!items\.length && alive\(\) && !catFound\) \{ const en = await translateFoodToEnglish\(q\)/.test(app));
ck("והמאגר מסמן שמצא", /catFound = \(cat \|\| \[\]\)\.length > 0/.test(app));
ck("**המאגר אינו דורס מספרים בשיחה עם הבינה**, כמו עד היום", /const CATALOG_IN_RECONCILE = false;/.test(app) && /if \(!result && CATALOG_IN_RECONCILE\) \{ try \{ const cat = await catalogSearch\(name\)/.test(app));
ck("הכותרת בחיפוש קיימת ולא השתנתה", app.includes(">מהקטלוג שלנו</div>"));
const srv = readFileSync(new URL("../api/catalog.js", import.meta.url), "utf8");
const searchBlock = srv.slice(srv.indexOf("// --- search ---"), srv.indexOf("// --- her correction"));
ck("**חיפוש השם בשרת אינו סורק את המאגר (KEYS)**", searchBlock.length > 100 && !searchBlock.includes('"KEYS"'));

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.");
process.exit(fail ? 1 : 0);
