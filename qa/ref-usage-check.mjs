// חברה מביאה חברה, v8.48: שלושה מונים בנתוני השימוש. כמה פעמים כרטיס ההזמנה הוצג
// ומתי, כמה לחיצות על "שליחה בוואטסאפ" מהמדליה ומהפרופיל, וכמה על "העתקת הקישור".
// מספרים ותאריך בלבד. רץ בלי רשת.
import { readFileSync } from "node:fs";
const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (extra ? "  ← " + extra : "")); } };

const written = {};
process.env.UPSTASH_REDIS_REST_URL = "http://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";
globalThis.fetch = async (url) => {
  const parts = String(url).replace("http://redis.test/", "").split("/").map(decodeURIComponent);
  if (parts[0] === "HSET") { written[parts[1]] = written[parts[1]] || {}; written[parts[1]][parts[2]] = parts[3]; return { ok: true, json: async () => ({ result: 1 }) }; }
  return { ok: true, json: async () => ({ result: null }) };
};
const { default: handler } = await import("../api/usage.js");
const res = () => { const r = {}; r.status = () => r; r.json = () => r; r.setHeader = () => {}; r.end = () => r; return r; };
const post = (body) => handler({ method: "POST", body }, res());
const BASE = { email: "r@test.com", days: {}, videosDone: 0, videosTotal: 1, views: 0, trackerDays: 0 };
const stored = () => JSON.parse(written["admin:usage"]["r@test.com"]);

console.log("\nהשרת");
await post({ ...BASE, feat: { ref_shown: 1, ref_wa_cheer: 2, ref_wa_profile: 3, ref_copy: 4 }, refShown: "2026-11-12" });
let r = stored();
check("ארבעת המונים נשמרים", r.feat.ref_shown === 1 && r.feat.ref_wa_cheer === 2 && r.feat.ref_wa_profile === 3 && r.feat.ref_copy === 4, JSON.stringify(r.feat));
check("והיום שבו הוצג נשמר", r.refShown === "2026-11-12");
await post({ ...BASE, refShown: "<script>" });
check("ערך שאינו תאריך נזרק", stored().refShown === "");
await post({ ...BASE });
check("בלי מונים, השדה ריק ולא נשבר", stored().refShown === "" && !("ref_shown" in stored().feat));

console.log("\nהאפליקציה");
check("הכרטיס במדליה נספר ברגע שהוא מסומן כמוצג",
  /localStorage\.setItem\(REF_OFFER_SEEN_KEY, "1"\);\s*usageBump\("ref_shown"\); usageRefShown\(today\);/.test(app));
check("לחיצה על וואטסאפ במדליה נספרת וסוגרת", app.includes(`onClick={() => { usageBump("ref_wa_cheer"); onClose(); }}`));
check("לחיצה על וואטסאפ בפרופיל נספרת", app.includes(`onClick={() => usageBump("ref_wa_profile")}`));
check("העתקת הקישור נספרת", /const copy = \(\) => \{\s*usageBump\("ref_copy"\);/.test(app));
check("היום נשלח עם נתוני השימוש", app.includes(`refShown: usg.refShown || ""`));
check("היום נכתב פעם אחת ואינו נדרס", /function usageRefShown\(day\) \{[^}]*if \(!u\.refShown\) u\.refShown = day;/.test(app));
check("הקישור עצמו לא נשלח לשרת", !/usageBump\([^)]*refLink/.test(app));

console.log(`\n${pass} עברו, ${fail} נכשלו`);
process.exit(fail ? 1 : 0);
