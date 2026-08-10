// QA: the barcode correction round trip, run against the real handler with a fake Redis.
//
// This exists because of a real bug: the read route was placed after the generic search
// route, which answers EVERY GET, so a lookup by barcode never reached its own code and
// always came back empty. Her correction saved fine and then vanished on the next scan.
//
// Run: node qa/catalog-barcode-check.mjs
process.env.UPSTASH_REDIS_REST_URL = "http://fake";
process.env.UPSTASH_REDIS_REST_TOKEN = "fake";

const store = new Map();
globalThis.fetch = async (_url, opts) => {
  const cmd = JSON.parse(opts.body);
  const [op, key, val] = cmd;
  let result = null;
  if (op === "GET") result = store.has(key) ? store.get(key) : null;
  else if (op === "SET") { store.set(key, val); result = "OK"; }
  else if (op === "KEYS") {
    const rx = new RegExp("^" + String(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*") + "$");
    result = [...store.keys()].filter((k) => rx.test(k));
  }
  return { json: async () => ({ result }) };
};

const { default: handler } = await import("../api/catalog.js");

function call(req) {
  return new Promise((resolve) => {
    const res = { status: () => res, json: (b) => resolve(b) };
    handler({ method: "GET", headers: {}, query: {}, ...req }, res);
  });
}

const CODE = "7290114314015";
const LABEL = { kcal: 374, p: 11, f: 8, c: 69 };
let failed = 0;
const check = (name, ok, detail) => { if (!ok) failed++; console.log(`${ok ? "עובר " : "נכשל "} | ${name}${detail ? "\n        " + detail : ""}`); };

// 1. Nothing stored yet.
let r = await call({ query: { code: CODE }, headers: { "x-user-id": "a@x.com" } });
check("ברקוד שלא תוקן מחזיר ריק", r.ok && r.item === null, `scope=${r.scope}`);

// 2. She corrects it. Private to her.
r = await call({ method: "POST", query: { action: "bc" }, headers: { "x-user-id": "a@x.com" }, body: { code: CODE, name: "שיבולת שועל", per100: LABEL, unit: "g" } });
check("התיקון נשמר ואינו משותף עדיין", r.ok && r.shared === false, `shared=${r.shared}`);

// 3. She scans again: her own values come back. THIS is what the route ordering broke.
r = await call({ query: { code: CODE }, headers: { "x-user-id": "a@x.com" } });
check("סריקה חוזרת מחזירה את התיקון שלה", r.item && r.item.per100.kcal === 374 && r.scope === "mine", `scope=${r.scope}, kcal=${r.item && r.item.per100.kcal}`);

// 4. Another woman still sees nothing.
r = await call({ query: { code: CODE }, headers: { "x-user-id": "b@x.com" } });
check("אישה אחרת עדיין לא רואה את זה", r.item === null, `scope=${r.scope}`);

// 5. A typo from someone else must not become shared.
r = await call({ method: "POST", query: { action: "bc" }, headers: { "x-user-id": "b@x.com" }, body: { code: CODE, name: "שיבולת שועל", per100: { kcal: 250, p: 11, f: 8, c: 69 }, unit: "g" } });
check("ערכים שונים לא הופכים למשותפים", r.ok && r.shared === false, `shared=${r.shared}`);

// 6. Agreement from a third makes it shared.
r = await call({ method: "POST", query: { action: "bc" }, headers: { "x-user-id": "c@x.com" }, body: { code: CODE, name: "שיבולת שועל", per100: LABEL, unit: "g" } });
check("אישה שנייה שמסכימה הופכת את זה למשותף", r.ok && r.shared === true, `shared=${r.shared}`);

// 7. Now everyone gets it, including someone who never corrected anything.
r = await call({ query: { code: CODE }, headers: { "x-user-id": "z@x.com" } });
check("כל אישה מקבלת את הערך המשותף", r.item && r.item.per100.kcal === 374 && r.scope === "shared", `scope=${r.scope}, kcal=${r.item && r.item.per100.kcal}`);

// 8. An impossible row never reaches storage at all.
r = await call({ method: "POST", query: { action: "bc" }, headers: { "x-user-id": "d@x.com" }, body: { code: "111", name: "בדיקה", per100: { kcal: 50, p: 0, f: 30, c: 0 }, unit: "g" } });
check("ערכים בלתי אפשריים נדחים", r.ok === false, `reason=${r.reason}`);

// 9. The plain text search still works - the barcode route must not have shadowed it.
r = await call({ query: { q: "שיבולת" } });
check("חיפוש טקסט רגיל ממשיך לעבוד", r.ok && Array.isArray(r.items), `items=${r.items && r.items.length}`);

console.log(`\n${9 - failed} מתוך 9 עברו.`);
process.exit(0);
