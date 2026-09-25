// מה מוצג בחיפוש המזון לכל הנשים. v7.48, ומ-v7.50 ערכים מתווית בלבד
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
import { nameProblem, dairyProblem, cleanName, parseJudge, escapeGlob, indexField } from "../lib/catfilter.js";

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
    case "SCARD": return S(a).size;
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

const label = (name, per100, who = "w@test.co", unit = "g") => call({ method: "POST", query: { action: "label" }, headers: { "x-user-id": who }, body: { name, per100, unit } });
const bc = (code, name, per100, who = "w@test.co") => call({ method: "POST", query: { action: "bc" }, headers: { "x-user-id": who }, body: { code, name, per100, unit: "g" } });
const COT = { kcal: 95, p: 11, f: 5, c: 2 };

console.log("\nב. כלל היצרן או אחוז השומן במוצרי חלב, החלטת רון\n");
for (const [n, want] of [["קוטג", "generic"], ["קוטג' 5%", null], ["קוטג׳ 5% תנובה", null], ["יוגורט דנונה", null], ["יוגורט ללא סוכר", "generic"], ["לבנה", "generic"], ["חלב שקדים אלפרו", null], ["פשטידת גבינה", null], ["טחינה הר ברכה", null]]) {
  ck(`"${n}" -> ${want || "מוצג"}`, dairyProblem(n) === want, dairyProblem(n));
}

console.log("\nג. המאגר הגדול ממשיך להתמלא, ואינו מוצג בחיפוש\n");
reset();
let r = await log("נקטרינה", NECT);
ck("רישום ארוחה נשמר במאגר הגדול כמו קודם", r.ok === true && inStore("נקטרינה"), JSON.stringify(r));
ck("**ואינו מופיע בחיפוש**", (await search("נקט")).length === 0);
ck("**ואינו נשלח לבינה**", aiCalls === 0, aiCalls);
H("catidx").set("יוגורט ישן", JSON.stringify({ name: "יוגורט ישן", per100: COT, unit: "g", source: "estimated", seen: 5, ts: Date.now() }));
ck("**ומה שנכנס לאינדקס של v7.48 אינו נקרא**", (await search("יוגורט")).length === 0);

console.log("\nד. הזנה ידנית מתווית: נבדקת פעם אחת, ומופיעה לכל הנשים\n");
reset();
r = await label("קוטג' 5% תנובה", COT);
ck("נכנס לבדיקה", r.ok === true && r.queued === true, JSON.stringify(r));
ck("הבינה נשאלה פעם אחת", aiCalls === 1, aiCalls);
let items = await search("קוטג");
ck("**מופיע בחיפוש \"קוטג\"**", items.length === 1 && items[0].name === "קוטג' 5% תנובה", JSON.stringify(items.map((i) => i.name)));
ck("עם הערכים שהקלידה", items[0] && items[0].per100.kcal === 95 && items[0].per100.p === 11);
ck("ומסומן כמקור תווית", items[0] && items[0].source === "label", items[0] && items[0].source);
ck("**והחיפוש פקודה אחת, בלי KEYS**", !cmds.includes("KEYS") && cmds.length === 1, cmds.join(","));
ck("ואחרי שנבדק יצא מרשימת ההמתנה", !(sets.get("labidx:pending") || new Set()).size);
await label("קוטג׳ 5% תנובה", COT, "b@test.co");
ck("**אישה שנייה עם אותם ערכים מחזקת אותו, בלי בינה**", aiCalls === 1 && JSON.parse(H("labidx").get(indexField("קוטג' 5% תנובה"))).seen === 2, aiCalls);
await label("קוטג' 5% תנובה", { kcal: 150, p: 8, f: 11, c: 3 }, "c@test.co");
ck("**ואישה שלישית עם ערכים אחרים אינה דורסת**", (await search("קוטג"))[0].per100.kcal === 95 && aiCalls === 1);

console.log("\nה. מה שנפסל לפני הבינה: לא נכנס ולא עולה כסף\n");
reset();
for (const [n, p] of [["קוטג", COT], ["יוגורט ללא סוכר", { kcal: 60, p: 5, f: 2, c: 5 }], ["שתי ביצים", { kcal: 150, p: 12, f: 10, c: 1 }], ["פיתה + חומוס", { kcal: 250, p: 8, f: 9, c: 33 }], ["עוגת שוקולד", { kcal: 900, p: 1, f: 1, c: 1 }]]) {
  r = await label(n, p);
  ck(`"${n}": לא נכנס`, r.queued !== true, JSON.stringify(r));
}
ck("**אף אחד מהם לא הגיע לבינה**", aiCalls === 0, aiCalls);
ck("ואין תוצאות", (await search("קוטג")).length === 0 && (await search("יוגורט")).length === 0);

console.log("\nו. הבינה פוסלת\n");
reset();
r = await label("שיבולת שועל", OATS_BAD);
ck("לא מופיע בחיפוש", (await search("שיבולת")).length === 0);
ck("והפסילה נשמרת עם הסיבה", /values off/.test(JSON.parse(H("labjudge").get("שיבולת שועל")).why));
await label("שיבולת שועל", OATS_BAD, "b@test.co");
ck("ואינה נשאלת שוב על אותם ערכים", aiCalls === 1, aiCalls);

console.log("\nז. תיקון ברקוד מהתווית\n");
reset();
r = await bc("7290000000001", "טחינה הר ברכה", { kcal: 640, p: 24, f: 55, c: 12 });
ck("נשמר לה כמו קודם", r.ok === true && str.has("bcv:7290000000001:w@test.co"), JSON.stringify(r));
ck("**ומופיע בחיפוש לכל הנשים**", (await search("טחינה"))[0]?.name === "טחינה הר ברכה", JSON.stringify(await search("טחינה")));

console.log("\nח. הבינה נופלת, מחזירה 500, מדלגת על שורה, או שאין מפתח\n");
for (const mode of ["down", "500"]) {
  reset(); aiMode = mode;
  r = await label("קוטג' 5% תנובה", COT);
  ck(`${mode}: הבקשה עונה`, r.ok === true, JSON.stringify(r));
  ck(`${mode}: **לא מוצג, כי לא נבדק**`, (await search("קוטג")).length === 0);
  ck(`${mode}: ונשאר ממתין`, (sets.get("labidx:pending") || new Set()).size === 1);
  aiMode = "ok";
  await label("טחינה הר ברכה", { kcal: 640, p: 24, f: 55, c: 12 });
  ck(`${mode}: ובפעם הבאה נבדק ומופיע`, (await search("קוטג")).length === 1);
}
reset(); aiSkip = new Set(["קוטג' 5% תנובה"]);
await label("קוטג' 5% תנובה", COT);
ck("שורה שהבינה דילגה עליה אינה מוצגת ונשארת ממתינה", (await search("קוטג")).length === 0 && (sets.get("labidx:pending") || new Set()).size === 1);
reset(); delete process.env.ANTHROPIC_API_KEY;
r = await label("קוטג' 5% תנובה", COT);
ck("אין מפתח: הבקשה עונה, ושום דבר אינו מוצג", r.ok === true && (await search("קוטג")).length === 0);
process.env.ANTHROPIC_API_KEY = "k";

console.log("\nט. תיקוני הברקוד שכבר היו לפני הגרסה הזאת נבדקים פעם אחת\n");
reset();
const L = (i) => String.fromCharCode(1489 + (i % 21)) + String.fromCharCode(1489 + Math.floor(i / 21));
const oldGood = [];
for (let i = 0; i < 60; i++) {
  const junk = i % 3 === 0;
  const name = junk ? `קוטג ${L(i)}` : `חטיף בדיקה ${L(i)}`;
  if (!junk) oldGood.push(name);
  str.set(`bcv:72900${i}:u${i}@t`, JSON.stringify({ name, per100: { kcal: 400, p: 8, f: 18, c: 50 }, unit: "g", ts: 1 }));
}
for (let i = 0; i < 20 && str.get("labidx:cursor") !== "done"; i++) await fillIndex("https://redis.test", "t");
ck("**המעבר מסתיים**", str.get("labidx:cursor") === "done", str.get("labidx:cursor"));
const idx = H("labidx");
ck(`כל ${oldGood.length} הטובים מוצגים`, oldGood.every((n) => idx.has(indexField(n))), oldGood.filter((n) => !idx.has(indexField(n))).join(","));
ck("**ואף קוטג בלי יצרן ובלי אחוז**", ![...idx.keys()].some((f) => f.startsWith("קוטג")));
ck("וכל פריט נשאל פעם אחת", new Set(aiSeen.map((l) => l.replace(/^\d+\. /, ""))).size === aiSeen.length, aiSeen.length);

console.log("\nי. שתי הרצות במקביל\n");
reset();
for (let i = 0; i < 10; i++) sets.set("labidx:pending", (sets.get("labidx:pending") || new Set()).add(JSON.stringify({ name: `חטיף ${L(i)}`, per100: { kcal: 400, p: 8, f: 18, c: 50 }, unit: "g" })));
str.set("labidx:cursor", "done");
const [a1, a2] = await Promise.all([fillIndex("https://redis.test", "t"), fillIndex("https://redis.test", "t")]);
ck("אחת רצה והשנייה מוותרת", [a1.reason, a2.reason].includes("locked"), JSON.stringify([a1, a2]));
ck("והנעילה משתחררת", !str.has("labidx:lock"));

console.log("\nיא. סדר התוצאות, תווים מיוחדים, ותקרת ההמתנה\n");
reset();
for (const n of ["יוגורט דנונה 3%", "משקה יוגורט יטבתה", "יוגורט"]) await label(n, { kcal: 60, p: 5, f: 3, c: 5 });
items = await search("יוגורט");
ck("שם שמתחיל במילה קודם להתאמה באמצע", items[0]?.name === "יוגורט דנונה 3%" && items[1]?.name === "משקה יוגורט יטבתה", items.map((i) => i.name).join(" | "));
ck("\"יוגורט\" לבדו לא נכנס בכלל", !items.some((i) => i.name === "יוגורט"));
ck("כוכבית אינה מחזירה הכל", (await search("**")).length === 0);
ck("escapeGlob", escapeGlob("a*b[c]") === "a\\*b\\[c\\]");
reset(); delete process.env.ANTHROPIC_API_KEY;
for (let i = 0; i < 2000; i++) sets.set("labidx:pending", (sets.get("labidx:pending") || new Set()).add("x" + i));
r = await label("טחינה הר ברכה", { kcal: 640, p: 24, f: 55, c: 12 });
ck("מעל 2,000 ממתינים לא מוסיפים עוד", r.queued === false && sets.get("labidx:pending").size === 2000, JSON.stringify(r));
process.env.ANTHROPIC_API_KEY = "k";

console.log("\nיב. מחיקה מהמשרד\n");
process.env.NOTIFY_SECRET = "s";
reset();
await label("קוטג' 5% תנובה", COT);
await call({ query: { action: "del", key: "קוטג' 5% תנובה", secret: "s" } });
ck("יוצא מהחיפוש", (await search("קוטג")).length === 0);
await label("קוטג' 5% תנובה", COT, "b@test.co");
ck("**והקלדה חוזרת אינה מחזירה אותו**", (await search("קוטג")).length === 0);

console.log("\nיג. הפענוח של תשובת הבינה\n");
let pj = parseJudge("1:OK\n2:BAD typo\n3: ok\nsomething else\n2:OK", 4);
ck("OK, BAD, רווחים ואותיות קטנות", pj.ok[0] === true && pj.ok[1] === false && pj.ok[2] === true, JSON.stringify(pj.ok));
ck("שורה שלא נענתה נשארת null", pj.ok[3] === null);
ck("תשובה ראשונה לשורה קובעת", pj.ok[1] === false && pj.why[1] === "typo");

console.log("\nיד. באפליקציה\n");
const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const save = app.slice(app.indexOf("const saveManual = () => {"), app.indexOf("// Two-stage search."));
ck("**הזנה ידנית ל-100 גרם בלי ברקוד נשלחת כמועמד**", /if \(!mWhole\) catalogLabelPut\(name, \{/.test(save));
ck("**וערכים של מנה שלמה לא נשלחים**: הקריאה היחידה נמצאת בתוך if (!mWhole)", (save.match(/catalogLabelPut\(/g) || []).length === 1 && save.includes("if (!mWhole) catalogLabelPut("));
ck("ועם ברקוד היא הולכת בדרך של הברקוד ויוצאת לפני", save.indexOf("catalogBarcodePut(") < save.indexOf("catalogLabelPut(") && /setTimeout\(\(\) => commit\(entry\), 1200\);\s*return;/.test(save));
ck("השמירה ביומן עדיין מסומנת manual, ולכן המאגר הגדול מדלג עליה", /source: "manual"/.test(save));
ck("התרגום לבינה אינו נקרא כשהקטלוג מצא", /if \(!items\.length && alive\(\) && !catFound\) \{ const en = await translateFoodToEnglish\(q\)/.test(app));
ck("המאגר אינו דורס מספרים בשיחה עם הבינה", /const CATALOG_IN_RECONCILE = false;/.test(app));
const srv = readFileSync(new URL("../api/catalog.js", import.meta.url), "utf8");
const searchBlock = srv.slice(srv.indexOf("// --- search ---"), srv.indexOf("// --- her correction"));
ck("**החיפוש בשרת קורא רק את labidx, בלי KEYS**", searchBlock.includes('"HSCAN", IDX') && !searchBlock.includes('"KEYS"') && /const IDX = "labidx"/.test(srv));
const upsert = srv.slice(srv.indexOf("// --- add / upsert ---"));
ck("**רישום ארוחה לא מזין את החיפוש**", !upsert.includes("addCandidate") && !upsert.includes("fillIndex") && !upsert.includes("PENDING"));

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.");
process.exit(fail ? 1 : 0);
