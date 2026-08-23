#!/usr/bin/env node
/* ============================================================================
   מחולל צילומי מסך לדף המכירה

   מריץ את האפליקציה הבנויה בדפדפן אמיתי בגודל אייפון, עם פרופיל מומצא ומלא,
   ומצלם את המסכים שנבחרו. **שום נתון של משתתפת אמיתית לא נכנס לכאן**, וכל
   קריאת רשת נענית מקומית.

   זה כלי שיווקי ולא בדיקה: הוא לא נכשל ולא מדווח על באגים.

   הרצה:  npm run build && node qa/e2e/shots.mjs
   פלט:   qa/shots/*.png
   ========================================================================== */

import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { chromium } from "playwright-core";

const ROOT = resolve(new URL("../..", import.meta.url).pathname);
const DIST = join(ROOT, "dist");
const OUT = join(ROOT, "qa", "shots");
const BROWSER = process.env.QA_CHROMIUM || "/opt/pw-browsers/chromium";
mkdirSync(OUT, { recursive: true });
mkdirSync(join(OUT, "web"), { recursive: true });
// שני פלטים: PNG לעיון, ו-JPEG קל לדף המכירה. הפלט לדף נשמר בצפיפות 2 ולא 3,
// כי ברוחב תצוגה של כ-300 פיקסלים זה עדיין כפול ממה שצריך, והמשקל יורד בחצי.
const WEB_DPR = 2;
const WEB = { "02b-content-all": 1, "03-tracker": 2, "07-addfood": 3, "05-recommend": 4, "04c-report-cal": 5 };

if (!existsSync(join(DIST, "index.html"))) { console.log("לא נמצא dist/index.html. הריצו קודם: npm run build"); process.exit(1); }

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".pdf": "application/pdf", ".ico": "image/x-icon" };
const server = createServer((req, res) => {
  const path = decodeURIComponent((req.url || "/").split("?")[0]);
  let file = join(DIST, path);
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");
  res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const israelToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const TODAY = israelToday();
const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
// מחזור מתחיל תמיד ביום ראשון. שלושה שבועות אחורה מציב אותה בשבוע 4, שבו כבר
// נפתחו החלבון, המים והשינה, ולכן היומן נראה מלא ולא חצי ריק.
const sundayWeeksAgo = (w) => { const d = new Date(TODAY + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - d.getUTCDay() - w * 7); return d.toISOString().slice(0, 10); };
const START = sundayWeeksAgo(3);
const DAYS_IN = Math.round((Date.parse(TODAY + "T00:00:00Z") - Date.parse(START + "T00:00:00Z")) / 86400000);

/* ---------- הפרופיל המומצא ---------- */
const NAME = "רונית";
const profile = {
  age: 52, heightCm: 165, weightKg: 78, activity: "יושבני", weeklyRateG: 250, goalWeightKg: 72,
  returnPct: 50, startDate: START, calorieOverride: null, stepGoal: 8000, stepBaseline: 6400,
  tipsSeen: ["cal", "steps", "tracker", "cabinet", "trackerfill", "stepbaseline", "water", "protein", "weeklysummary", "notifyAsked", "appTour"],
  keepShabbat: false, fasting: false, cupMl: 250, diet: [], allergies: [], dislikes: "", name: NAME, catchup: "done", lossStopAt: null,
};

const MEAL = (meal, name, g, kcal, p, f, c) => ({ meal, name, g, unit: "g", source: "verified", kcal, p, f, c });
const dayMenu = (i, workout) => {
  // יום מלא ומאוזן, קרוב ל-1,500 קק״ל וכ-140 גרם חלבון, כדי שהיעדים ייראו מושגים
  // ולא כדי לייפות: זה בדיוק סוג היום שהתוכנית מלמדת להרכיב.
  const br = [
    [MEAL("בוקר", "יוגורט יווני 5%", 200, 194, 18, 10, 8), MEAL("בוקר", "אגוזי מלך", 15, 98, 2, 10, 2)],
    [MEAL("בוקר", "חביתה משתי ביצים", 110, 168, 13, 12, 1), MEAL("בוקר", "קוטג׳ 5%", 100, 98, 11, 5, 3)],
    [MEAL("בוקר", "קוטג׳ 5%", 200, 196, 22, 10, 6), MEAL("בוקר", "עגבניות שרי", 100, 18, 1, 0, 4)],
  ][i % 3];
  const snack = [
    MEAL("ביניים בוקר", "מעדן חלבון", 200, 150, 30, 2, 6),
    MEAL("ביניים בוקר", "לחם מלא פרוס", 50, 124, 5, 1, 23),
    MEAL("ביניים אחה״צ", "תפוח", 180, 94, 0, 0, 25),
    MEAL("ביניים אחה״צ", "שקדים", 30, 174, 6, 15, 6),
    MEAL("ערב", "שמן זית", 12, 106, 0, 12, 0),
  ];
  const lunch = [
    [MEAL("צהריים", "חזה עוף בגריל", 150, 248, 46, 6, 0), MEAL("צהריים", "אורז מלא מבושל", 150, 165, 4, 1, 34), MEAL("צהריים", "סלט ירקות", 200, 84, 2, 5, 8)],
    [MEAL("צהריים", "סלמון אפוי", 150, 309, 34, 19, 0), MEAL("צהריים", "בטטה בתנור", 150, 135, 2, 0, 31), MEAL("צהריים", "ברוקולי מאודה", 150, 51, 4, 1, 8)],
    [MEAL("צהריים", "הודו בתנור", 150, 225, 45, 5, 0), MEAL("צהריים", "קינואה מבושלת", 150, 180, 6, 3, 30), MEAL("צהריים", "סלט ירקות", 200, 84, 2, 5, 8)],
  ][i % 3];
  const dinner = [
    [MEAL("ערב", "טונה במים", 100, 116, 26, 1, 0), MEAL("ערב", "קוטג׳ 5%", 100, 98, 11, 5, 3), MEAL("ערב", "סלט ירקות", 200, 84, 2, 5, 8)],
    [MEAL("ערב", "גבינה בולגרית 5%", 100, 137, 15, 5, 3), MEAL("ערב", "ביצה קשה", 100, 155, 13, 11, 1)],
    [MEAL("ערב", "סלט טונה וביצה", 220, 245, 28, 12, 4), MEAL("ערב", "אבוקדו", 70, 112, 1, 10, 6)],
  ][i % 3];
  // ביום אימון התקציב הקלורי גדל, ולכן גם מה שהיא אוכלת. זה בדיוק מה שהאפליקציה
  // מלמדת, ולולא זה כל יום אימון היה נצבע כאילו אכלה מעט מדי.
  const extra = workout ? [MEAL("ביניים אחה״צ", "יוגורט עם פירות", 200, 190, 12, 5, 24)] : [];
  return [...br, ...snack, ...lunch, ...extra, ...dinner];
};

const log = [], stepsByDate = {}, waterByDate = {}, checkins = {}, activityLog = [], weights = [];
for (let k = 0; k <= DAYS_IN; k++) {
  const d = addDays(START, k);
  const isToday = d === TODAY;
  // היום עצמו נשאר חלקי בכוונה: מסך שכולו וי נראה כמו מסך גמור ולא כמו יום חי.
  const workout = k % 3 === 0;
  const menu = isToday ? dayMenu(k, workout).slice(0, 4) : dayMenu(k, workout);
  menu.forEach((m, i) => log.push({ id: `s${k}_${i}`, date: d, ...m }));
  stepsByDate[d] = isToday ? 6120 : 7200 + ((k * 617) % 2600);
  waterByDate[d] = isToday ? 1500 : 2000 + ((k * 250) % 500);
  checkins[d] = {
    strength: true, veg: 4 + (k % 3), mealorder: 3, drinkbefore: true,
    sleephours: isToday ? null : 7, noscreens: !isToday, stopeating: !isToday, breathing: !isToday,
  };
  if (workout) activityLog.push({ id: `a${k}`, date: d, name: "אימון כוח", min: 40, kcal: 210 });
}
[[0, 78], [7, 77.1], [14, 76.2], [21, 75.4]].forEach(([k, kg]) => { if (k <= DAYS_IN) weights.push({ date: addDays(START, k), kg }); });

const STATE = { onboarded: true, profile, log, weights, activityLog, waterByDate, stepsByDate, favorites: [], recents: [], checkins, goalAckWeek: 99 };

/* ---------- תשובות מוכנות לכל קריאת רשת ---------- */
const REC = {
  intro: "לפי מה שנשאר לך היום, הנה שלוש אפשרויות:",
  options: [
    { name: "אומלט ירקות עם פיתה מלאה", desc: "שתי ביצים, פלפל ובצל, לצד חצי פיתה מקמח מלא.", unit: "g", grams: 210, kcal: 320, p: 21, f: 15, c: 26 },
    { name: "סלט טונה על מצע עלים", desc: "טונה במים, עלי בייבי, עגבניות שרי וכף טחינה.", unit: "g", grams: 280, kcal: 295, p: 28, f: 16, c: 9 },
    { name: "יוגורט יווני עם פירות ואגוזים", desc: "יוגורט 5%, חצי בננה וכף אגוזי מלך קצוצים.", unit: "g", grams: 250, kcal: 310, p: 19, f: 14, c: 27 },
  ],
  note: "כל השלוש בתוך התקציב שנשאר לך היום.",
};
async function stubApi(context) {
  await context.route("**/api/**", async (route) => {
    const url = route.request().url();
    const json = (b) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
    if (url.includes("/api/access")) return json({ allowed: true, name: NAME, startDate: START, glow: false });
    if (url.includes("/api/ai")) return json({ content: [{ type: "text", text: JSON.stringify(REC) }] });
    if (url.includes("/api/catalog") || url.includes("/api/il-food")) return json({ items: [] });
    return json({ ok: true });
  });
}

/* ---------- ההרצה ---------- */
const browser = await chromium.launch({ executablePath: BROWSER, args: ["--no-sandbox"] });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: WEB_DPR, isMobile: true, hasTouch: true,
  locale: "he-IL", timezoneId: "Asia/Jerusalem",
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
});
await stubApi(context);
await context.addInitScript(([sd, st, nm]) => {
  localStorage.setItem("myprime_access_email", "demo@myprime.co.il");
  localStorage.setItem("myprime_access_name", nm);
  localStorage.setItem("myprime_start_date", sd);
  localStorage.setItem("myprime_install_ack", "1");
  localStorage.setItem("myprime_demo_state_v1", JSON.stringify(st));
  localStorage.setItem("mp_cheer_seen_v1", "1");
  // שלושת השבועות שמאחוריה מסומנים כהושלמו, ובשבוע הנוכחי חלק. מסך שכולו 0
  // נקרא כאילו היא לא נגעה בתוכן, וזה לא מה שהדף מתאר.
  const doneMap = {};
  for (let w = 1; w <= 3; w++) for (let d = 1; d <= 7; d++) for (let i = 0; i < 6; i++) doneMap["W" + w + "D" + d + "-" + i] = 1;
  doneMap["W4D1-0"] = 1;
  localStorage.setItem("mp_content_done_v1", JSON.stringify(doneMap));
}, [START, STATE, NAME]);

const page = await context.newPage();
const fresh = async () => {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2800);
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important}" }).catch(() => {});
};
const shot = async (file) => {
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, file + ".png") });
  if (WEB[file]) await page.screenshot({ path: join(OUT, "web", "demo-" + WEB[file] + ".jpg"), type: "jpeg", quality: 78 });
  console.log("צולם | " + file + (WEB[file] ? "  ->  web/demo-" + WEB[file] + ".jpg" : ""));
};
const tap = async (text, nth = 0) => { await page.locator(`text=${text}`).nth(nth).click({ timeout: 6000 }); await page.waitForTimeout(700); };

console.log(`פרופיל: ${NAME} · התחלה ${START} · יום ${DAYS_IN + 1} בתוכנית`);

async function step(name, fn) {
  try { await fresh(); await fn(); await shot(name); }
  catch (e) { console.log("נכשל  | " + name + " | " + String(e.message || e).split("\n")[0].slice(0, 110)); try { await page.screenshot({ path: join(OUT, "_fail_" + name + ".png") }); } catch (e2) {} }
}

const plus = async () => { await page.locator('[data-tut="nav-fab"]').first().click({ timeout: 6000 }); await page.waitForTimeout(700); };

await step("01-day", async () => {});
await step("02-content-today", async () => { await page.locator('[data-tut="contentcard"]').first().click({ timeout: 6000 }); await page.waitForTimeout(900); });
await step("02b-content-all", async () => { await page.locator('[data-tut="contentcard"]').first().click({ timeout: 6000 }); await page.waitForTimeout(900); await tap("כל התוכנית"); await page.waitForTimeout(700);
  const wk = page.getByText("שבוע 2", { exact: true });
  console.log("   שבוע 2: " + (await wk.count()) + " התאמות");
  await wk.first().click({ timeout: 5000 }); await page.waitForTimeout(900); });
await step("03-tracker", async () => {
  await tap("הקישי למילוי המעקב");
  await page.locator("text=הבנתי").first().click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(400);
  await page.waitForTimeout(400);
});
await step("04-report-steps", async () => { await tap("דוח"); });
await step("04b-report-weight", async () => { await tap("דוח"); await tap("משקל"); });
await step("04c-report-cal", async () => { await tap("דוח"); await tap("יעד קלורי"); });
await step("05-recommend", async () => { await plus(); await tap("מה כדאי לאכול?"); await tap("הבנתי, בואי נתחיל"); await page.locator("textarea, input[type=text]").first().fill("בא לי משהו קל לארוחת ערב, יש לי ביצים טונה ועגבניות"); await page.waitForTimeout(200); await tap("קבלי המלצות"); await page.waitForTimeout(2500); });
await step("06-collection", async () => { await tap("ארון"); });
await step("07-addfood", async () => { await plus(); await tap("הוספת מזון"); });

await context.close();
await browser.close();
server.close();
console.log("\nהתמונות ב-qa/shots/");
