#!/usr/bin/env node
/* ============================================================================
   כמה מדויקים המספרים שהאישה רואה ביומן?

   השאלה של רון: בכמה אחוז ה-AI מפספס. עד היום התשובה הייתה הערכה. הבדיקה הזאת
   מודדת אותה.

   **השיטה:** בונים ארוחות מתוך מאגר משרד הבריאות ("צמרת"), עם כמויות מדויקות
   בגרמים, ולכן הערך האמיתי של כל ארוחה **ידוע ולא משוער**. אחר כך מתארים את
   אותה ארוחה ל-AI של האפליקציה, עם ההנחיות האמיתיות שלה, וסופרים בכמה הוא פספס.

   **כל ארוחה נשלחת פעמיים, וזה הלב של הבדיקה:**

   1. `מדויק` - התיאור כולל את הכמויות בגרמים. מה שנמדד כאן הוא **רק** הידע
      התזונתי של המנוע, כי אין לו מה לנחש.
   2. `רגיל` - אותה ארוחה בדיוק, מתוארת כמו שאישה כותבת באמת ("חביתה משתי ביצים
      עם פרוסת לחם"). כאן נוספת **הערכת הכמות**, וזה המספר שהאישה חיה איתו.

   ההפרש בין השניים הוא בדיוק כמה עולה לנו הניחוש של גודל המנה.

   **מה שהבדיקה הזאת לא מודדת, וצריך לזכור:** מה שהאישה לא רשמה בכלל. יום שבו
   שכחה חטיף שגוי ביותר מכל טעות שנמדדת כאן.

   **הערה על פחמימות:** צמרת מדווח פחמימות בניכוי סיבים והאפליקציה כוללת אותם,
   ולכן הערך האמיתי כאן הוא הסכום. אותה הנחה בדיוק כמו ב-qa/tzameret-check.mjs.

   דורש רשת אל data.gov.il ואל האפליקציה:
     QA_BASE_URL="https://myprime-nutri-demo.vercel.app" node qa/macro-accuracy.mjs
   ========================================================================== */

import { readFileSync } from "node:fs";

const BASE_URL = (process.env.QA_BASE_URL || "").replace(/\/$/, "");
const MODEL = process.env.QA_MODEL || "claude-sonnet-4-20250514"; // the model aiNutritionChat actually sends
const USER_PREFIX = process.env.QA_USER || "macro";
const CONCURRENCY = parseInt(process.env.QA_CONCURRENCY || "3", 10);
const ONLY_MODE = process.env.QA_MODE || ""; // "exact" | "casual" | ""

if (!BASE_URL) {
  console.error('\n  ✖ חסר QA_BASE_URL. למשל:\n    QA_BASE_URL="https://myprime-nutri-demo.vercel.app" node qa/macro-accuracy.mjs\n');
  process.exit(1);
}

/* ---------- the app's own logging instructions, read from src/App.jsx ----------
   Not a copy. Taking the literal straight out of the app is what stops this
   measurement from grading a prompt that no longer exists. */
function appNutritionSystem() {
  const src = readFileSync("src/App.jsx", "utf8");
  const anchor = 'const system = "את עוזרת תזונה';
  const i = src.indexOf(anchor);
  if (i === -1) throw new Error("לא מצאתי את ההנחיות של aiNutritionChat ב-src/App.jsx");
  const start = src.indexOf('"', i);
  let j = start + 1;
  while (j < src.length) {
    if (src[j] === "\\") { j += 2; continue; }
    if (src[j] === '"') break;
    j++;
  }
  return new Function("return " + src.slice(start, j + 1))();
}
const NUTRITION_SYSTEM = appNutritionSystem();

/* ---------- truth: צמרת ---------- */
const RESOURCE = "c3cb0630-0650-46c1-a068-82d575c094b2";
const DATA_URL = `https://data.gov.il/api/3/action/datastore_search?resource_id=${RESOURCE}&limit=5000` +
  "&fields=smlmitzrach,shmmitzrach,protein,total_fat,carbohydrates,food_energy,total_dietary_fiber";

// Hand-picked codes, the same ones qa/tzameret-check.mjs already vouches for.
const F = {
  egg: 31101010, bread: 51101009, cot: 14201019, oil: 82101000, oat: 57602100,
  milk: 11111009, ban: 63107010, chk: 24120120, rice: 56204930, cuke: 75111030,
  tomato: 74101000, pita: 51140559, hummus: 41205078, tahini: 43103119,
  salmon: 26137108, potato: 71103010, tuna: 26155190, avocado: 63105010,
  wcheese: 14210109, honey: 91302010, almond: 42101000, lentil: 41305000,
  pasta: 56130010, ycheese: 14108409, apple: 63101000, blackcoffee: 92101610,
  sugar: 91101010, butter: 81101100,
};

/* ---------- the meals ----------
   `exact` spells the quantity out, `casual` is how a woman actually writes it.
   The grams in `items` are the truth for BOTH lines: the casual sentence
   describes exactly this plate, it just does not say the numbers out loud. */
const MEALS = [
  { id: "omelet", items: [[F.egg, 100], [F.oil, 5], [F.bread, 50], [F.cot, 60]],
    exact: "אכלתי חביתה מ-100 גרם ביצה, מטוגנת ב-5 גרם שמן, עם 50 גרם לחם לבן ו-60 גרם קוטג' 5%",
    casual: "אכלתי חביתה משתי ביצים עם פרוסת לחם וקצת קוטג'" },
  { id: "oatmeal", items: [[F.oat, 40], [F.milk, 200], [F.ban, 120]],
    exact: "אכלתי 40 גרם שיבולת שועל יבשה עם 200 מ\"ל חלב 3% ו-120 גרם בננה",
    casual: "אכלתי דייסת שיבולת שועל עם חלב ובננה" },
  { id: "chicken", items: [[F.chk, 150], [F.rice, 150], [F.cuke, 60], [F.tomato, 80], [F.oil, 5]],
    exact: "אכלתי 150 גרם חזה עוף על הגריל, 150 גרם אורז לבן מבושל, וסלט מ-60 גרם מלפפון ו-80 גרם עגבנייה עם 5 גרם שמן זית",
    casual: "אכלתי חזה עוף על הגריל עם אורז וסלט ירקות" },
  { id: "pita", items: [[F.pita, 70], [F.hummus, 80], [F.tahini, 15]],
    exact: "אכלתי פיתה של 70 גרם עם 80 גרם חומוס ו-15 גרם טחינה גולמית",
    casual: "אכלתי פיתה עם חומוס וטחינה" },
  { id: "salmon", items: [[F.salmon, 150], [F.potato, 200], [F.oil, 5]],
    exact: "אכלתי 150 גרם סלמון אפוי עם 200 גרם תפוחי אדמה מבושלים ו-5 גרם שמן",
    casual: "אכלתי פילה סלמון אפוי עם תפוחי אדמה" },
  { id: "tunasand", items: [[F.tuna, 100], [F.avocado, 70], [F.bread, 50]],
    exact: "אכלתי כריך מ-50 גרם לחם לבן עם 100 גרם טונה במים מסוננת ו-70 גרם אבוקדו",
    casual: "אכלתי כריך טונה עם אבוקדו" },
  { id: "yogbowl", items: [[F.wcheese, 150], [F.honey, 15], [F.almond, 20]],
    exact: "אכלתי 150 גרם גבינה לבנה 5% עם 15 גרם דבש ו-20 גרם שקדים",
    casual: "אכלתי קערית גבינה לבנה עם כפית דבש וקצת שקדים" },
  { id: "lentil", items: [[F.lentil, 200], [F.oil, 5]],
    exact: "אכלתי 200 גרם עדשים מבושלות עם 5 גרם שמן",
    casual: "אכלתי צלחת מרק עדשים" },
  { id: "pasta", items: [[F.pasta, 200], [F.tomato, 100], [F.ycheese, 30], [F.oil, 10]],
    exact: "אכלתי 200 גרם פסטה מבושלת עם 100 גרם עגבניות, 30 גרם גבינה צהובה 28% ו-10 גרם שמן זית",
    casual: "אכלתי צלחת פסטה ברוטב עגבניות עם גבינה צהובה מגוררת" },
  { id: "snack", items: [[F.apple, 150], [F.almond, 25]],
    exact: "אכלתי תפוח של 150 גרם ו-25 גרם שקדים",
    casual: "אכלתי תפוח וחופן שקדים" },
  { id: "cheesesand", items: [[F.bread, 60], [F.ycheese, 40], [F.cuke, 50]],
    exact: "אכלתי כריך מ-60 גרם לחם לבן עם 40 גרם גבינה צהובה 28% ו-50 גרם מלפפון",
    casual: "אכלתי כריך גבינה צהובה עם מלפפון" },
  { id: "coffee", items: [[F.blackcoffee, 200], [F.milk, 40], [F.sugar, 8]],
    exact: "שתיתי 200 מ\"ל קפה שחור עם 40 מ\"ל חלב 3% ו-8 גרם סוכר",
    casual: "שתיתי קפה עם חלב וכפית סוכר" },
  { id: "eggsalad", items: [[F.egg, 50], [F.cuke, 100], [F.tomato, 100], [F.oil, 8]],
    exact: "אכלתי ביצה קשה של 50 גרם עם סלט מ-100 גרם מלפפון ו-100 גרם עגבנייה, עם 8 גרם שמן זית",
    casual: "אכלתי ביצה קשה עם סלט ירקות" },
  { id: "toast", items: [[F.bread, 60], [F.butter, 10], [F.honey, 20]],
    exact: "אכלתי 60 גרם לחם לבן עם 10 גרם חמאה ו-20 גרם דבש",
    casual: "אכלתי פרוסת לחם עם חמאה ודבש" },
  { id: "oatnight", items: [[F.oat, 50], [F.milk, 150], [F.honey, 20], [F.almond, 15]],
    exact: "אכלתי 50 גרם שיבולת שועל יבשה עם 150 מ\"ל חלב 3%, 20 גרם דבש ו-15 גרם שקדים",
    casual: "אכלתי שיבולת שועל עם חלב, דבש ושקדים" },
];

/* ---------- helpers ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v) => { const x = parseFloat(v); return isFinite(x) ? x : 0; };

async function callAI(body, userId, attempt = 0) {
  try {
    const res = await fetch(`${BASE_URL}/api/ai`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": userId },
      body: JSON.stringify(body),
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await sleep(1000 * Math.pow(2, attempt) + Math.random() * 500);
      return callAI(body, userId, attempt + 1);
    }
    const data = await res.json();
    if (!res.ok || data.error || !Array.isArray(data.content)) {
      return { error: data.error ? JSON.stringify(data.error) : `status ${res.status}` };
    }
    return { text: data.content.map((i) => i.text || "").join("").trim() };
  } catch (e) {
    if (attempt < 4) { await sleep(1000 * Math.pow(2, attempt)); return callAI(body, userId, attempt + 1); }
    return { error: String(e) };
  }
}

function parseReply(text) {
  if (!text) return null;
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a === -1 || b <= a) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch (e) { return null; }
}

// Sum an answer the way the app adds it to the diary. A dish that splits into
// pieces carries the values of the WHOLE tray plus how many pieces she ate.
function sumItems(items) {
  const t = { kcal: 0, p: 0, f: 0, c: 0 };
  for (const it of items || []) {
    let share = 1;
    const pieces = num(it.pieces), ate = num(it.ate);
    if (pieces > 0 && ate > 0) share = ate / pieces;
    t.kcal += num(it.kcal) * share;
    t.p += num(it.protein) * share;
    t.f += num(it.fat) * share;
    t.c += num(it.carbs) * share;
  }
  return t;
}

/* ---------- run one meal in one mode ---------- */
async function runOne(meal, mode, truth) {
  const uid = `${USER_PREFIX}-${meal.id}-${mode}`;
  const messages = [{ role: "user", content: mode === "exact" ? meal.exact : meal.casual }];
  const body = () => ({
    model: MODEL, max_tokens: 2200,
    system: [{ type: "text", text: NUTRITION_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages,
  });

  // Up to three turns: the app asks follow-up questions, and a real woman answers
  // them. Answering "that is all" is the shortest honest stand-in for that.
  for (let turn = 0; turn < 3; turn++) {
    const r = await callAI(body(), uid);
    if (r.error) return { error: r.error };
    const parsed = parseReply(r.text);
    if (!parsed) return { error: "תשובה שאינה JSON" };
    if (parsed.done && Array.isArray(parsed.items) && parsed.items.length) {
      return { est: sumItems(parsed.items), turns: turn + 1, items: parsed.items, ask: null };
    }
    messages.push({ role: "assistant", content: r.text });
    messages.push({ role: "user", content: "זה הכל, אפשר לסכם בבקשה." });
  }
  return { error: "לא הגיע לסיכום בשלושה תורות" };
}

/* ---------- go ---------- */
const r = await fetch(DATA_URL);
if (!r.ok) { console.log(`נכשל | data.gov.il החזיר ${r.status}`); process.exit(1); }
const rows = ((await r.json()).result || {}).records || [];
const byCode = new Map(rows.map((x) => [Number(x.smlmitzrach), x]));
console.log(`נטענו ${rows.length} שורות מצמרת.\n`);

function truthOf(meal) {
  const t = { kcal: 0, p: 0, f: 0, c: 0 };
  for (const [code, g] of meal.items) {
    const row = byCode.get(code);
    if (!row) throw new Error(`הקוד ${code} לא נמצא בצמרת`);
    const k = g / 100;
    t.kcal += num(row.food_energy) * k;
    t.p += num(row.protein) * k;
    t.f += num(row.total_fat) * k;
    t.c += (num(row.carbohydrates) + num(row.total_dietary_fiber)) * k; // צמרת מנכה סיבים
  }
  return t;
}

const MODES = ONLY_MODE ? [ONLY_MODE] : ["exact", "casual"];
const jobs = [];
for (const meal of MEALS) for (const mode of MODES) jobs.push({ meal, mode, truth: truthOf(meal) });

const results = [];
let next = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (next < jobs.length) {
    const job = jobs[next++];
    const out = await runOne(job.meal, job.mode, job.truth);
    results.push({ ...job, ...out });
    const tag = job.mode === "exact" ? "מדויק" : "רגיל ";
    if (out.error) console.log(`שגיאה | ${tag} | ${job.meal.id}: ${out.error}`);
    else {
      const e = out.est, t = job.truth;
      const pct = (a, b) => (b <= 0 ? "  -  " : `${((a - b) / b * 100).toFixed(0).padStart(4)}%`);
      console.log(`      | ${tag} | ${job.meal.id.padEnd(11)} קלוריות ${pct(e.kcal, t.kcal)} · חלבון ${pct(e.p, t.p)} · שומן ${pct(e.f, t.f)} · פחמימה ${pct(e.c, t.c)}   (${Math.round(t.kcal)} אמיתי, ${Math.round(e.kcal)} נמדד)`);
    }
    await sleep(400);
  }
}));

/* ---------- the numbers ---------- */
const median = (a) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const KEYS = [["kcal", "קלוריות"], ["p", "חלבון"], ["f", "שומן"], ["c", "פחמימות"]];

console.log("\n══════════ התוצאה ══════════");
for (const mode of MODES) {
  const ok = results.filter((x) => x.mode === mode && !x.error);
  if (!ok.length) { console.log(`\n${mode}: אין תוצאות`); continue; }
  console.log(`\n${mode === "exact" ? "כשהכמות נמסרה בגרמים (טעות הידע התזונתי בלבד)" : "כשהארוחה מתוארת כמו שאישה כותבת (מה שקורה בפועל)"}, ${ok.length} ארוחות:`);
  for (const [k, label] of KEYS) {
    const errs = ok.filter((x) => x.truth[k] > 0.5).map((x) => (x.est[k] - x.truth[k]) / x.truth[k] * 100);
    const abs = errs.map(Math.abs);
    const worst = Math.max(...abs);
    console.log(`  ${label.padEnd(9)} טעות טיפוסית ${median(abs).toFixed(0).padStart(3)}%   ·   הטיה ${median(errs) >= 0 ? "+" : ""}${median(errs).toFixed(0)}%   ·   הגרוע ${worst.toFixed(0)}%`);
  }
}
const failed = results.filter((x) => x.error).length;
console.log(`\n${results.length - failed} מתוך ${results.length} הרצות הסתיימו. ${failed} נכשלו.`);
console.log('"טעות טיפוסית" היא החציון של הסטייה המוחלטת. "הטיה" מראה אם המנוע נוטה לתת יותר מדי או פחות מדי.');
