// המכסות של הבינה: הגבולות לא זזו, וניסיון שנכשל אינו נגרע. v7.36
//
//   node qa/ai-quota-check.mjs
//
// **למה זה קיים.** נילי קוניאק, 22 בספטמבר 2026: "אני רואה שהאפליקציה כבר מגבילה אותי
// במספר המנות שאני מצלמת, אבל בוודאות לא הגעתי ל-70 תמונות." היא צדקה: שלושת המונים
// עשו INCR **לפני** שהבינה נקראה, ולא היה בשום מקום DECR, ולכן כל ניסיון שנכשל גזל לה
// מכסה בלי שקיבלה דבר.
//
// **והשאלה של רון לפני שזה נגע בקוד הייתה "תבדוק שלא יעשה בלגן לנשים הקיימות".**
// זה בדיוק מה שנבדק כאן: הבדיקה מריצה את `api/ai.js` **האמיתי** מול Redis מדומה ומול
// אנתרופיק מדומה, ועוברת מספר-מספר על הגבולות, כדי להוכיח שהתשובה על כל מספר זהה
// לזו שבייצור. **אומת שיש לה שיניים: על v7.34 היא מחזירה 22 מתוך 26, וארבע הנפילות
// הן בדיוק ארבע אבחנות התיקון. כל 22 האבחנות שבודקות את הגבולות עצמם עוברות בשתי
// הגרסאות, וזו ההוכחה שלאישה שכבר בתוך התוכנית לא השתנה דבר.**

let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (extra ? "  → " + extra : "")); } };

process.env.ANTHROPIC_API_KEY = "test-key";
process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";

const { default: handler } = await import("../api/ai.js");

// ===== Redis מדומה, ואנתרופיק שאפשר לשבור =====
let store, aiOk, aiCalls;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opt) => {
  const u = String(url);
  if (u.indexOf("https://redis.test") === 0) {
    const parts = u.slice("https://redis.test/".length).split("/").map(decodeURIComponent);
    const [c, k, ...rest] = parts;
    if (c === "GET") return { ok: true, json: async () => ({ result: store[k] ?? null }) };
    if (c === "INCR") { store[k] = (Number(store[k]) || 0) + 1; return { ok: true, json: async () => ({ result: store[k] }) }; }
    if (c === "SET") {
      const nx = rest.indexOf("NX") !== -1;
      if (nx && store[k] !== undefined) return { ok: true, json: async () => ({ result: null }) };
      store[k] = rest[0]; return { ok: true, json: async () => ({ result: "OK" }) };
    }
    return { ok: true, json: async () => ({ result: 1 }) };   // EXPIRE וכל השאר
  }
  aiCalls++;
  if (!aiOk) return { ok: false, status: 529, json: async () => ({ error: { type: "overloaded" } }) };
  return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "{}" }], usage: { input_tokens: 5, output_tokens: 5 } }) };
};

const PHOTO = [{ role: "user", content: [{ type: "image", source: {} }, { type: "text", text: "ארוחה" }] }];
const TEXT  = [{ role: "user", content: "אכלתי תפוח" }];

async function call(messages, { email = "a@b.com", reqId = null } = {}) {
  const headers = { "x-user-id": email };
  if (reqId) headers["x-request-id"] = reqId;
  let out = null, code = 0, hdrs = {};
  await handler(
    { method: "POST", headers, body: { messages, model: "m", max_tokens: 10 } },
    { setHeader: (k, v) => { hdrs[k] = v; }, status: (c) => { code = c; return { json: (j) => { out = j; } }; } }
  );
  return { code, out, hdrs };
}
const fresh = () => { store = {}; aiOk = true; aiCalls = 0; };
const dayKey = "ai:day:a@b.com:" + new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

// ===== 1. הגבולות, מספר-מספר =====
//
// זה הלב. הייצור עושה INCR ואז `> LIMIT`, והקוד החדש עושה GET ואז `>= LIMIT`.
// שתי הצורות חייבות להחזיר בדיוק את אותה תשובה על כל מספר, אחרת אישה שנמצאת
// היום על הגבול תרגיש שינוי.
console.log("\nהגבול היומי, 30, לא זז\n");
for (const [had, allowed] of [[0, true], [28, true], [29, true], [30, false], [31, false], [45, false]]) {
  fresh(); store[dayKey] = String(had);
  const r = await call(TEXT);
  check(`כבר ביצעה ${had} היום → ${allowed ? "עוברת" : "נחסמת"}`, allowed ? r.code === 200 : (r.code === 429 && r.out.scope === "day"), `code=${r.code}`);
}
fresh(); store[dayKey] = "29";
const soft = await call(TEXT);
check("והקריאה ה-30 מסומנת כאחרונה להיום", soft.hdrs["x-ai-limit"] === "soft", JSON.stringify(soft.hdrs));

console.log("\nגבול התמונות, 70, לא זז\n");
for (const [had, allowed] of [[0, true], [68, true], [69, true], [70, false], [71, false]]) {
  fresh(); store["ai:photos:a@b.com"] = String(had);
  const r = await call(PHOTO);
  check(`כבר צילמה ${had} → ${allowed ? "עוברת" : "נחסמת"}`, allowed ? r.code === 200 : (r.code === 429 && r.out.scope === "photos"), `code=${r.code}`);
}
fresh(); store["ai:photos:a@b.com"] = "70";
const blocked = await call(PHOTO);
check("ומי שנחסמה מקבלת את הודעת התמונות ולא הודעה גנרית", /צילומי הארוחה/.test(blocked.out.message || ""), blocked.out.message);
check("ובחסימה לא נשלחת בכלל קריאה לבינה", aiCalls === 0, String(aiCalls));

// ===== 2. התיקון עצמו =====
console.log("\nניסיון שנכשל אינו נגרע ממנה\n");
fresh(); aiOk = false;
const failed = await call(PHOTO);
check("הבינה נכשלה, והאישה מקבלת את השגיאה", failed.code === 529, String(failed.code));
check("**והתמונה לא נספרה**", store["ai:photos:a@b.com"] === undefined, String(store["ai:photos:a@b.com"]));
check("וגם לא נגרע לה מהמכסה היומית", store[dayKey] === undefined, String(store[dayKey]));

console.log("\nניסיון שהצליח כן נספר\n");
fresh();
const good = await call(PHOTO);
check("עוברת", good.code === 200);
check("והתמונה נספרה", Number(store["ai:photos:a@b.com"]) === 1, String(store["ai:photos:a@b.com"]));
check("והיומי נספר", Number(store[dayKey]) === 1, String(store[dayKey]));
check("והמונה חוזר אליה בכותרת, לשם ההתראה בתמונה ה-35", good.hdrs["x-photo-count"] === "1", JSON.stringify(good.hdrs));

console.log("\nניסיון חוזר על אותה תמונה נספר פעם אחת בלבד\n");
fresh();
await call(PHOTO, { reqId: "abc-123" });
const again = await call(PHOTO, { reqId: "abc-123" });
check("שתי השליחות מחזירות תשובה", again.code === 200);
check("**ונגרעה תמונה אחת ולא שתיים**", Number(store["ai:photos:a@b.com"]) === 1, String(store["ai:photos:a@b.com"]));
check("והמונה שחוזר אליה נכון גם בשנייה", again.hdrs["x-photo-count"] === "1", JSON.stringify(again.hdrs));
fresh();
await call(PHOTO, { reqId: "id-1" });
await call(PHOTO, { reqId: "id-2" });
check("ושתי תמונות שונות כן נספרות שתיהן", Number(store["ai:photos:a@b.com"]) === 2, String(store["ai:photos:a@b.com"]));

console.log("\nושום דבר אינו נועל אישה כשהתשתית נופלת\n");
fresh();
const noRedis = await (async () => {
  const u = process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_URL;
  const r = await call(TEXT); process.env.UPSTASH_REDIS_REST_URL = u; return r;
})();
check("בלי Redis היא עוברת כרגיל", noRedis.code === 200, String(noRedis.code));

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.");
globalThis.fetch = realFetch;
process.exit(fail ? 1 : 0);
