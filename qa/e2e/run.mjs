#!/usr/bin/env node
/* ============================================================================
   שכבה 3: תרחישים פונקציונליים ומטריצת מכשירים

   מריץ את האפליקציה **הבנויה** בדפדפן אמיתי, בשלושה גדלי מסך, ובודק מה שאישה
   רואה בפועל: שהמסך נטען, שהכרטיסים נמצאים, שהוספת מזון מגיעה ליומן, ושחלון
   פתוח לא משאיר את הסרגל התחתון מעליו.

   **מה זה כן בודק:** את הקוד של האפליקציה, את הלוגיקה שתלויה ביום בתוכנית,
   ואת הפריסה בשלושה רוחבי מסך.

   **מה זה לא בודק, וחשוב לא להתבלבל:** אייפון אמיתי. הדפדפן כאן הוא כרום בכל
   שלושת הפרופילים, כי ספארי לא קיים על לינוקס. לכן הבאגים של iOS שרשומים
   בסעיף 5.1 של CLAUDE.md (גובה המסך `--vvh`, תפריט השיתוף, המקלדת) **לא
   ייתפסו כאן לעולם**, והדרך היחידה לבדוק אותם היא מכשיר אמיתי.

   שום קריאה לא יוצאת החוצה: כל `/api/*` נענה מכאן, ולכן ההרצה בחינם, מהירה,
   ולא נוגעת בייצור ולא בנתונים של אף אישה.

   הרצה:  npm --prefix qa/e2e install   (פעם אחת)
          node qa/e2e/run.mjs
   ========================================================================== */

import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { chromium } from "playwright-core";

const ROOT = resolve(new URL("../..", import.meta.url).pathname);
const DIST = join(ROOT, "dist");
const BROWSER = process.env.QA_CHROMIUM || "/opt/pw-browsers/chromium";

if (!existsSync(join(DIST, "index.html"))) {
  console.log("נכשל | לא נמצא dist/index.html. הריצו קודם: npm run build");
  process.exit(1);
}

/* ---------- a static server for dist/ ---------- */
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

/* ---------- dates ---------- */
// The app's "today" is the date in Israel, not in UTC. Between 21:00 and midnight UTC the
// two are different days, and a harness that works in UTC then puts her on the wrong
// programme day and reports a bug that does not exist. This was found the hard way.
const israelToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const TODAY = israelToday();
// To put her on day N we walk back N-1 days from today, which is what the app does with
// the date that comes from the registration sheet.
const startForDay = (n) => new Date(Date.parse(TODAY + "T00:00:00Z") - (n - 1) * 86400000).toISOString().slice(0, 10);

/* ---------- the three profiles ---------- */
const UA_ANDROID = "Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const UA_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const UA_DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const DEVICES = [
  { name: "סמסונג, כרום", viewport: { width: 360, height: 800 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA_ANDROID },
  { name: "אייפון (מנוע כרום)", viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA_IPHONE },
  { name: "מחשב", viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false, userAgent: UA_DESKTOP },
];

/* ---------- canned API answers: nothing leaves this machine ---------- */
async function stubApi(context, { startDate }) {
  await context.route("**/api/**", async (route) => {
    const url = route.request().url();
    const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (url.includes("/api/access")) return json({ allowed: true, name: "בדיקה", startDate });
    if (url.includes("/api/ai")) return json({ content: [{ type: "text", text: JSON.stringify({ reply: "רשמתי לך", done: false, items: [] }) }] });
    if (url.includes("/api/catalog") || url.includes("/api/il-food")) return json({ items: [] });
    return json({ ok: true });
  });
}

async function openApp(browser, device, { day = 10, seed = {}, neverAskedNotify = false } = {}) {
  const startDate = startForDay(day);
  const context = await browser.newContext({ ...device, locale: "he-IL", timezoneId: "Asia/Jerusalem" });
  await stubApi(context, { startDate });
  await context.addInitScript(([sd, extra, neverAsked]) => {
    localStorage.setItem("myprime_access_email", "qa@myprime.co.il");
    localStorage.setItem("myprime_access_name", "בדיקה");
    localStorage.setItem("myprime_start_date", sd);
    localStorage.setItem("myprime_install_ack", "1"); // she already installed it
    const state = {
      onboarded: true,
      profile: { age: 50, heightCm: 165, weightKg: 72, activity: "יושבני", weeklyRateG: 250, goalWeightKg: 66, returnPct: 50, startDate: sd, calorieOverride: null, stepGoal: null, stepBaseline: null, tipsSeen: ["cal", "steps", "tracker", "cabinet", "trackerfill", "stepbaseline", "water", "protein", "weeklysummary", "notifyAsked"], keepShabbat: false, fasting: false, cupMl: 250, diet: [], allergies: [], dislikes: "", name: "בדיקה", catchup: "done" },
      log: [], weights: [], activityLog: [], waterByDate: {}, stepsByDate: {}, favorites: [], recents: [], checkins: {}, goalAckWeek: 99,
      ...extra,
    };
    // addInitScript runs on every navigation, so a reload would put this mark back and the
    // prompt would never appear. It has to be decided here, not patched afterwards.
    if (neverAsked) state.profile.tipsSeen = state.profile.tipsSeen.filter((k) => k !== "notifyAsked");
    localStorage.setItem("myprime_demo_state_v1", JSON.stringify(state));
  }, [startDate, seed, neverAskedNotify]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2600); // the splash holds for 2s
  // The central plus button carries two endless CSS animations, so it never stops moving
  // and a normal click waits for it for ever. Motion is not what this layer tests.
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important}" }).catch(() => {});
  return { context, page, errors, startDate };
}

/* ---------- the checks ---------- */
const results = [];
const record = (device, name, ok, detail, skip) => {
  results.push({ device, name, ok, detail, skip });
  const tag = skip ? "מדולג" : ok ? "עובר " : "נכשל ";
  console.log(`${tag} | ${device} | ${name}${detail ? `\n        ${detail}` : ""}`);
};

const CHECKS = [
  {
    name: "המסך הראשי נטען ואין שגיאת JavaScript",
    async run(browser, device) {
      const { context, page, errors } = await openApp(browser, device);
      const bar = await page.locator("text=יומן").first().isVisible().catch(() => false);
      const fab = await page.locator('[aria-label="הוספה"]').isVisible().catch(() => false);
      await context.close();
      return { ok: bar && fab && !errors.length, detail: `סרגל תחתון ${bar}, כפתור הוספה ${fab}, שגיאות ${errors.length ? errors[0].slice(0, 90) : "אין"}` };
    },
  },
  {
    name: "יומן המעקב לא מופיע ביום 2 ומופיע ביום 3",
    async run(browser, device) {
      const a = await openApp(browser, device, { day: 2 });
      const onDay2 = await a.page.locator("text=יומן המעקב שלי").count();
      await a.context.close();
      const b = await openApp(browser, device, { day: 3 });
      const onDay3 = await b.page.locator("text=יומן המעקב שלי").count();
      await b.context.close();
      return { ok: onDay2 === 0 && onDay3 > 0, detail: `יום 2: ${onDay2} כרטיסים, יום 3: ${onDay3}` };
    },
  },
  {
    name: "כרטיס התוכן קיים גם אחרי יום 70",
    async run(browser, device) {
      const { context, page } = await openApp(browser, device, { day: 80 });
      const n = await page.locator("text=התכנים שלך").count();
      await context.close();
      return { ok: n > 0, detail: `${n} כרטיסים ביום 80` };
    },
  },
  {
    name: "הוספת מזון מהחיפוש מגיעה ליומן",
    async run(browser, device) {
      const { context, page } = await openApp(browser, device);
      await page.locator('[aria-label="הוספה"]').click();
      await page.waitForTimeout(400);
      await page.locator("text=הוספת מזון").first().click();
      await page.waitForTimeout(500);
      await page.locator("text=חיפוש מזון").first().click();
      await page.waitForTimeout(500);
      const box = page.locator('input[type="text"], input:not([type])').first();
      await box.fill("בננה");
      await page.waitForTimeout(700);
      await page.locator("text=בננה בינונית").first().click();
      await page.waitForTimeout(400);
      const add = page.locator("text=/הוסיפי ל/").first();
      const had = await add.count();
      if (had) await add.click();
      await page.waitForTimeout(700);
      const inDiary = await page.locator("text=בננה בינונית").count();
      await context.close();
      return { ok: had > 0 && inDiary > 0, detail: `כפתור הוספה ${had}, מופיע ביומן ${inDiary}` };
    },
  },
  {
    name: "הסרגל התחתון מוסתר כשחלון פתוח",
    async run(browser, device) {
      const { context, page } = await openApp(browser, device);
      const fab = page.locator('[aria-label="הוספה"]');
      await fab.click();
      await page.waitForTimeout(500);
      const stillThere = await fab.isVisible().catch(() => false);
      await context.close();
      return { ok: !stillThere, detail: stillThere ? "הפלוס המרכזי נשאר גלוי מעל החלון" : "מוסתר כמצופה" };
    },
  },
  {
    name: "מסך ההמלצות נפתח ומגיע לשאלה",
    async run(browser, device) {
      const { context, page } = await openApp(browser, device);
      await page.locator('[aria-label="הוספה"]').click();
      await page.waitForTimeout(400);
      const entry = page.locator("text=/מה כדאי/").first();
      if (!(await entry.count())) { await context.close(); return { ok: false, detail: "לא נמצא הכניסה למסך ההמלצות בתפריט ההוספה" }; }
      await entry.click();
      await page.waitForTimeout(600);
      const cont = page.locator("text=/הבנתי|המשך|קבלי המלצות/").first();
      if (await cont.count()) { await cont.click(); await page.waitForTimeout(500); }
      const q = await page.locator("text=/ספרי לי מה את רוצה לאכול/").count();
      const btn = await page.locator("text=קבלי המלצות").count();
      await context.close();
      return { ok: q > 0 && btn > 0, detail: `שאלה ${q}, כפתור ${btn}` };
    },
  },
  {
    name: "כפתור \"קבלי המלצות\" נמצא בתוך המסך ולא מתחתיו",
    async run(browser, device) {
      const { context, page } = await openApp(browser, device);
      await page.locator('[aria-label="הוספה"]').click();
      await page.waitForTimeout(400);
      const entry = page.locator("text=/מה כדאי/").first();
      if (!(await entry.count())) { await context.close(); return { ok: false, detail: "לא נמצא הכניסה למסך ההמלצות" }; }
      await entry.click();
      await page.waitForTimeout(600);
      const cont = page.locator("text=/הבנתי|המשך|קבלי המלצות/").first();
      if (await cont.count()) { await cont.click(); await page.waitForTimeout(500); }
      const btn = page.locator("text=קבלי המלצות").first();
      if (!(await btn.count())) { await context.close(); return { ok: false, detail: "הכפתור לא נמצא" }; }
      const box = await btn.boundingBox();
      const h = device.viewport.height;
      await context.close();
      const ok = !!box && box.y >= 0 && box.y + box.height <= h + 1;
      return { ok, detail: box ? `הכפתור ב-y=${Math.round(box.y)} וגובה המסך ${h}` : "אין מיקום" };
    },
  },
  {
    name: "שאלת התזכורת היומית מוצגת פעם אחת ואפשר לסגור אותה",
    async run(browser, device) {
      const { context, page } = await openApp(browser, device, { neverAskedNotify: true });
      await page.waitForTimeout(1800); // the prompt waits 1.4s after the day screen settles
      // The app only asks when push exists AND permission was never answered. A headless
      // browser usually starts at "denied", and then staying quiet is the correct behaviour.
      const env = await page.evaluate(() => ({
        push: "serviceWorker" in navigator && "PushManager" in window && "Notification" in window,
        perm: "Notification" in window ? Notification.permission : "none",
      }));
      if (!env.push || env.perm !== "default") {
        await context.close();
        return { ok: true, skip: true, detail: `בדפדפן כאן ההרשאה היא "${env.perm}" ולא "default", ולכן האפליקציה צודקת בכך שהיא שותקת` };
      }
      const shown = await page.locator("text=שנזכיר לך כל ערב?").count();
      if (shown) await page.locator("text=לא עכשיו").first().click();
      await page.waitForTimeout(400);
      const gone = await page.locator("text=שנזכיר לך כל ערב?").count();
      const fabClickable = await page.locator('[aria-label="הוספה"]').click({ timeout: 4000 }).then(() => true).catch(() => false);
      await context.close();
      return { ok: shown > 0 && gone === 0 && fabClickable, detail: `הוצגה ${shown}, נסגרה ${gone === 0}, המסך משוחרר ${fabClickable}` };
    },
  },
  {
    name: "מסך ההתקנה מוצג בטלפון שעוד לא התקינה",
    async run(browser, device) {
      const context = await browser.newContext({ ...device, locale: "he-IL", timezoneId: "Asia/Jerusalem" });
      await stubApi(context, { startDate: startForDay(10) });
      await context.addInitScript(() => {
        localStorage.setItem("myprime_access_email", "qa@myprime.co.il");
        localStorage.removeItem("myprime_install_ack");
      });
      const page = await context.newPage();
      await page.goto(BASE, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2600);
      const shown = await page.locator("text=/מסך הבית|התקנה/").count();
      await context.close();
      const isPhone = device.isMobile;
      // On a desktop there is no home screen, so the app must NOT show it there.
      return { ok: isPhone ? shown > 0 : shown === 0, detail: isPhone ? `בטלפון, נמצאו ${shown}` : `במחשב, נמצאו ${shown} (מצופה 0)` };
    },
  },
];

/* ---------- run ---------- */
const browser = await chromium.launch({ executablePath: BROWSER });
console.log(`\n  MyPrime QA שכבה 3 — ${CHECKS.length} בדיקות × ${DEVICES.length} מכשירים\n`);
for (const device of DEVICES) {
  for (const c of CHECKS) {
    try {
      const { ok, detail, skip } = await c.run(browser, device);
      record(device.name, c.name, ok, detail, skip);
    } catch (e) {
      record(device.name, c.name, false, `שגיאה: ${String(e.message || e).split("\n")[0].slice(0, 120)}`);
    }
  }
}
await browser.close();
server.close();

const failed = results.filter((r) => !r.ok && !r.skip);
const skipped = results.filter((r) => r.skip);
console.log(`\n  ── סיכום ──`);
console.log(`  עברו: ${results.length - failed.length - skipped.length}/${results.length - skipped.length}${skipped.length ? `   מדולגים: ${skipped.length}` : ""}`);
if (failed.length) {
  console.log(`  נכשלו:`);
  for (const f of failed) console.log(`   · ${f.device} | ${f.name}`);
}
console.log("");
process.exit(failed.length ? 1 : 0);
