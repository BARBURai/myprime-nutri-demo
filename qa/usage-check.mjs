#!/usr/bin/env node
// נתוני השימוש שנאספים לניתוח מקרו. בלי רשת.
//
//   node qa/usage-check.mjs
//
// רון, 28 באוגוסט 2026: "אני רוצה לדעת איפה הן נופלות, איזה משימות קשה להן
// איתן, ולראות גרף התקדמות." מסך ההסכמה אומר שהחברה **אינה אוספת מידע אישי**
// ו**אוספת נתוני שימוש באפליקציה בלבד**, וזה הגבול שהבדיקה הזאת שומרת:
// נספר מה היא עשתה, ולעולם לא הערכים עצמם.
//
// הבדיקה מריצה את api/usage.js האמיתי מול Redis מדומה, ובודקת מה באמת נשמר.

import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../api/usage.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (extra ? "  ← " + extra : "")); } };

// ── Redis מדומה, ותופס את מה שנכתב ──────────────────────────────────────────
const written = {};
process.env.UPSTASH_REDIS_REST_URL = "http://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";
globalThis.fetch = async (url) => {
  const parts = String(url).replace("http://redis.test/", "").split("/").map(decodeURIComponent);
  if (parts[0] === "HSET") { written[parts[1]] = written[parts[1]] || {}; written[parts[1]][parts[2]] = parts[3]; return { ok: true, json: async () => ({ result: 1 }) }; }
  return { ok: true, json: async () => ({ result: null }) };
};

const { default: handler } = await import("../api/usage.js");
const res = () => { const r = { code: 0, body: null }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.setHeader = () => {}; r.end = () => r; return r; };
const post = async (body) => { const r = res(); await handler({ method: "POST", body }, r); return r; };

const BASE = { email: "a@test.com", days: {}, videosDone: 1, videosTotal: 2, views: 0, trackerDays: 3 };
const stored = () => JSON.parse(written["admin:usage"]["a@test.com"]);

console.log("\nמה נשמר");
await post({
  ...BASE,
  opens: { "2026-08-25": 2, "2026-08-26": 1, "לא-תאריך": 9 },
  mins: { "2026-08-25": 41 },
  hours: Array.from({ length: 24 }, (_, i) => i),
  feat: { ai: 4, barcode: 2, search: 7, weighIn: 1, לאקיים: 5 },
  dayClosed: "110100",
  tasksAgg: { steps: [5, 6], strength: [1, 3] },
  standalone: 1,
  notif: "granted",
});
const rec = stored();
check("הימים שנכנסה נשמרים", rec.opens["2026-08-25"] === 2 && rec.opens["2026-08-26"] === 1);
check("ומפתח שאינו תאריך נזרק", rec.opens["לא-תאריך"] === undefined);
check("הדקות באפליקציה נשמרות", rec.mins["2026-08-25"] === 41);
check("שעות הפעילות נשמרות כ-24 מספרים", Array.isArray(rec.hours) && rec.hours.length === 24 && rec.hours[5] === 5);
check("מוני הכלים נשמרים", rec.feat.ai === 4 && rec.feat.barcode === 2 && rec.feat.search === 7 && rec.feat.weighIn === 1);
check("ושם שאינו ברשימה הסגורה נזרק", rec.feat["לאקיים"] === undefined);
check("הימים שנסגרו נשמרים כמחרוזת אפסים ואחדות", rec.dayClosed === "110100");
check("וספירת המשימות נשמרת כזוג", rec.tasksAgg.steps[0] === 5 && rec.tasksAgg.steps[1] === 6);
check("האם התקינה למסך הבית", rec.standalone === 1);
check("ומצב ההתראות", rec.notif === "granted");

console.log("\nגבולות, כי הקריאה אינה מאומתת במפתח");
await post({ ...BASE, dayClosed: "1a1<script>0".repeat(40), tasksAgg: { steps: [999, 5], "לא חוקי": [1, 2] }, hours: "לא מערך", notif: "משהו", mins: { "2026-08-25": 99999 } });
const r2 = stored();
check("מחרוזת הימים מנוקה ונחתכת", /^[01]*$/.test(r2.dayClosed) && r2.dayClosed.length <= 70, r2.dayClosed.slice(0, 20));
check("מסומן לעולם אינו גדול מזמין", r2.tasksAgg.steps[0] <= r2.tasksAgg.steps[1]);
check("מזהה משימה לא חוקי נזרק", r2.tasksAgg["לא חוקי"] === undefined);
check("שעות שאינן מערך מוחזרות ריקות", Array.isArray(r2.hours) && r2.hours.length === 0);
check("מצב התראות לא מוכר נזרק", r2.notif === "");
check("הדקות מוגבלות ליממה", r2.mins["2026-08-25"] <= 1440);

console.log("\nמה לעולם אינו נשלח, וזה הגבול");
const payload = app.slice(app.indexOf("payload = {"), app.indexOf("fetch(\"/api/usage\"", app.indexOf("payload = {")));
check("לא נשלח משקל", !/weight|weights|kg/i.test(payload));
check("לא נשלח מזון", !/\blog\b\s*[,:]/.test(payload));
check("לא נשלחים ערכי צעדים או מים", !/stepsByDate|waterByDate/.test(payload));
check("ולא שיחות AI", !/aiMsgs|messages/.test(payload));
// ספירת המשימות היא "סומן או לא", ולא הערך שהיא הזינה
check("ספירת המשימות היא סימון בלבד", /if \(taskDone\(t, ans, au\)\) cur\[0\]\+\+;/.test(app));
check("והשרת אינו מקבל שום שדה של ערכים", !/sleephours|cups|steps:/.test(api));

console.log("\nהאיסוף במכשיר");
check("יום כניסה ושעה נרשמים פעם אחת בטעינה", /usageOpened\(TODAY\);/.test(app));
check("הזמן נספר רק כשהמסך גלוי", /document\.visibilityState === "visible"/.test(app));
check("ונצבר על המכשיר לשליחה בטעינה הבאה", /function usageAddSeconds\(today, sec\)/.test(app));
check("החלון נשמר מוגבל", /USAGE_KEEP_DAYS = 120/.test(app) && /usageTrim\(u\.opens, keepFrom\)/.test(app));
for (const k of ["ai", "photo", "barcode", "history", "search", "manual", "recommend", "summary", "cabinet", "weighIn"]) {
  check('מונה קיים: usageBump("' + k + '")', app.includes('usageBump("' + k + '")'));
}
check("ומעבר בין הלשוניות נספר", /usageBump\("tab_" \+ t\.id\)/.test(app));

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.");
process.exit(fail ? 1 : 0);
