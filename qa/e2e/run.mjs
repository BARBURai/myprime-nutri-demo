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

// A real cohort ALWAYS begins on a Sunday, so a woman's program day and her day of the week
// are the same thing. Counting back N days from today ignores that and, depending on which
// day the suite happens to run, invents a cohort that started on a Friday. Nothing in the
// app is built for that: the tracker card unlocks on elapsed days while its tasks unlock by
// weekday, and on such a cohort the two disagree and the card renders empty. That is not a
// bug a participant can ever hit, and chasing it cost a session. Anything that depends on
// which day of the week it is must be built from these two instead.
const sundayWeeksAgo = (weeksAgo) => {
  const d = new Date(TODAY + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - d.getUTCDay() - weeksAgo * 7);
  return d.toISOString().slice(0, 10);
};
const programDayOn = (startDate) =>
  Math.round((Date.parse(TODAY + "T00:00:00Z") - Date.parse(startDate + "T00:00:00Z")) / 86400000) + 1;

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
async function stubApi(context, { startDate, glow = false }) {
  await context.route("**/api/**", async (route) => {
    const url = route.request().url();
    const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (url.includes("/api/access")) return json({ allowed: true, name: "בדיקה", startDate, glow });
    if (url.includes("/api/ai")) return json({ content: [{ type: "text", text: JSON.stringify({ reply: "רשמתי לך", done: false, items: [] }) }] });
    if (url.includes("/api/catalog") || url.includes("/api/il-food")) return json({ items: [] });
    return json({ ok: true });
  });
}

async function openApp(browser, device, { day = 10, startDate: fixedStart = null, seed = {}, neverAskedNotify = false, glow = false } = {}) {
  // `day` is the convenient form and is fine wherever the day of the week does not matter.
  // Pass `startDate` instead when it does, and build it with sundayWeeksAgo.
  const startDate = fixedStart || startForDay(day);
  const context = await browser.newContext({ ...device, locale: "he-IL", timezoneId: "Asia/Jerusalem" });
  await stubApi(context, { startDate, glow });
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
    // The lower bound for weight loss is BMI 20, and it is read off her height. A fixed
    // number in kilograms cannot do this job: 50kg blocked a real participant at 152cm who
    // is perfectly healthy, and waved through 51kg at 175cm, which is severe underweight.
    // Both halves are asserted from the same screen, because a rule that only ever fires
    // would be indistinguishable from a rule that never fires.
    name: "מי שאין לה לאן לרדת מקבלת שמירה בלבד, ומי שכן מקבלת את הקצבים",
    async run(browser, device) {
      const context = await browser.newContext({ ...device, locale: "he-IL", timezoneId: "Asia/Jerusalem" });
      await stubApi(context, { startDate: startForDay(1) });
      await context.addInitScript(([sd]) => {
        localStorage.setItem("myprime_access_email", "qa@myprime.co.il");
        localStorage.setItem("myprime_access_name", "בדיקה");
        localStorage.setItem("myprime_start_date", sd);
        localStorage.setItem("myprime_install_ack", "1");
      }, [startForDay(1)]);
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e.message || e)));
      const goalStep = async (heightCm, weightKg) => {
        await page.goto(BASE, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(2600);
        await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important}" }).catch(() => {});
        const nums = page.locator("input[type=number]");
        await nums.nth(0).fill("50");
        await nums.nth(1).fill(String(heightCm));
        await nums.nth(2).fill(String(weightKg));
        await page.locator("text=כן, כל השבוע").first().click();
        await page.locator("text=המשך").first().click();
        await page.waitForTimeout(600);
        return page.locator("body").innerText();
      };
      // 152cm and 44kg is BMI 19.0 - inside the normal range, and blocked outright before this.
      const low = await goalStep(152, 44);
      const lowOk = low.includes("לפי הנתונים שלך אנו לא ממליצים על ירידה במשקל") && !low.includes("ירידה 250 ג׳ בשבוע") && low.includes("שמירה על המשקל");
      // The same height at 60kg is BMI 26.0, and nothing about her screen may change.
      const norm = await goalStep(152, 60);
      const normOk = norm.includes("ירידה 250 ג׳ בשבוע") && norm.includes("משקל רצוי") && !norm.includes("אנו לא ממליצים על ירידה במשקל");
      await context.close();
      return { ok: lowOk && normOk && !errors.length, detail: `BMI 19 שמירה בלבד ${lowOk} · BMI 26 קצבים ${normOk} · שגיאות ${errors.length ? errors[0].slice(0, 80) : "אין"}` };
    },
  },
  {
    // The whole journey in one scenario, because the halves are meaningless apart: a rule
    // that only ever fires looks exactly like a rule that never fires. She crosses the line
    // on a weight she reports, gets the screen, lands in maintenance with the rate list
    // gone, then gains back past the second line and is offered the way back.
    name: "חצייה של הקו מעבירה לשמירה, ועלייה חזרה פותחת את הדרך בחזרה",
    async run(browser, device) {
      const start = sundayWeeksAgo(1);
      const prof = { age: 50, heightCm: 152, weightKg: 55, activity: "יושבני", weeklyRateG: 250, goalWeightKg: 50, returnPct: 50, startDate: start, calorieOverride: null, stepGoal: null, stepBaseline: null, tipsSeen: ["cal", "steps", "tracker", "cabinet", "trackerfill", "stepbaseline", "water", "protein", "weeklysummary", "notifyAsked", "appTour"], keepShabbat: false, fasting: false, cupMl: 250, diet: [], allergies: [], dislikes: "", name: "בדיקה", catchup: "done", lossStopAt: null };
      const { context, page, errors } = await openApp(browser, device, { startDate: start, seed: { profile: prof, weights: [{ date: start, kg: 55 }] } });
      // בלי טעינה מחדש לאורך כל התרחיש: addInitScript רץ בכל ניווט ומחזיר את
      // האחסון לזרע, כלומר טעינה מחדש הייתה מוחקת בדיוק את מה שאנחנו בודקים.
      const logWeight = async (kg) => {
        await page.locator("text=דוח").last().click();
        await page.waitForTimeout(400);
        await page.locator("text=הזיני משקל").first().click();
        await page.waitForTimeout(400);
        await page.locator('input[inputmode="decimal"]').last().fill(String(kg));
        await page.locator("text=שמור").first().click();
        await page.waitForTimeout(700);
      };
      // "נתוני בסיס" מגיע מקופל, וכל שורות המשקל והקצב יושבות בתוכו
      const openBase = async () => {
        await page.locator("text=פרופיל").last().click();
        await page.waitForTimeout(500);
        if (!(await page.locator("text=קצב ירידה").count())) {
          await page.locator("text=נתוני בסיס").first().click();
          await page.waitForTimeout(400);
        }
      };
      const state = () => page.evaluate(() => JSON.parse(localStorage.getItem("myprime_demo_state_v1") || "{}").profile || {});

      // 45 ק״ג בגובה 152 הוא BMI 19.5, מתחת לקו של BMI 20 שהוא 46.5 ק״ג
      await logWeight(45);
      let body = await page.locator("body").innerText();
      const shown = body.includes("לא ממליצים על ירידה נוספת במשקל ללא התייעצות עם דיאטנית קלינית")
        && body.includes("אנחנו ממליצים לך ליצור קשר עם הדיאטנית לקבלת הנחיות")
        && body.includes('בלחיצה על "הבנתי" את מאשרת שקראת את ההודעה הזאת')
        && !body.includes("הודעה לצוות בוואטסאפ");
      const st1 = await state();
      const moved = st1.weeklyRateG === 0 && !!st1.lossStopAt;
      // הכפתור ולא הטקסט: שורת האישור שמעליו מכילה את המילה "הבנתי" בתוכה
      await page.getByRole("button", { name: "הבנתי" }).first().click();
      await page.waitForTimeout(500);
      const acked = !!(await state()).lossAckAt;

      // ברשימת הקצבים נשארה שמירה בלבד
      await openBase();
      await page.locator("text=קצב ירידה").first().click();
      await page.waitForTimeout(400);
      body = await page.locator("body").innerText();
      const locked = !body.includes("ירידה 250 ג׳ בשבוע") && !body.includes("ירידה 500 ג׳ בשבוע") && body.includes("שמירה על המשקל");
      // שורת משקל היעד נעלמת בשמירה: אין לה יעד, והמינימום של השדה היה גבוה מהערך שבתוכו
      const noGoalRow = !body.includes("משקל יעד");
      await page.mouse.click(8, 8);   // הרקע של החלון סוגר אותו
      await page.waitForTimeout(400);

      // 48 ק״ג עדיין מתחת לקו השני, שהוא 49 ק״ג בגובה הזה
      await logWeight(48);
      await openBase();
      const tooEarly = !(await page.locator("body").innerText()).includes("אפשר לחזור לירידה במשקל");

      await logWeight(49.5);
      await openBase();
      body = await page.locator("body").innerText();
      const offered = body.includes("אפשר לחזור לירידה במשקל") && body.includes("כדאי להתייעץ עם דיאטנית קלינית לפני שחוזרים.");
      await page.locator("text=חזרה לירידה במשקל").first().click();
      await page.waitForTimeout(500);
      const st2 = await state();
      const back = st2.weeklyRateG === 250 && !st2.lossStopAt;

      await context.close();
      const ok = shown && moved && acked && locked && noGoalRow && tooEarly && offered && back && !errors.length;
      return { ok, detail: `מסך ${shown} · לשמירה ${moved} · אישרה ${acked} · הקצבים נעלמו ${locked} · אין משקל יעד ${noGoalRow} · ב-48 לא מוצע ${tooEarly} · ב-49.5 מוצע ${offered} · חזרה ${back} · שגיאות ${errors.length ? errors[0].slice(0, 60) : "אין"}` };
    },
  },
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
    // The tracker opens on program day 3. Checked against the two most recent real cohorts
    // rather than against a made-up "three days ago", so what the card is expected to do is
    // derived from the same rule the app uses instead of being hard-coded to a day number
    // that only lines up on a Tuesday.
    name: "יומן המעקב נפתח ביום 3 בתוכנית, לפי מחזור אמיתי",
    async run(browser, device) {
      const parts = [];
      let ok = true;
      for (const weeksAgo of [0, 1]) {
        const start = sundayWeeksAgo(weeksAgo);
        const day = programDayOn(start);
        const { context, page } = await openApp(browser, device, { startDate: start });
        const cards = await page.locator("text=יומן המעקב שלי").count();
        await context.close();
        const want = day >= 3;
        if ((cards > 0) !== want) ok = false;
        parts.push(`יום ${day}: ${cards} ${want ? "(מצופה שיופיע)" : "(מצופה שלא)"}`);
      }
      return { ok, detail: parts.join(" · ") };
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
    // She can watch the Glow bonus while she waits for day 1. The point of this scenario is
    // the safety half: before her start date NOTHING of the programme is unlocked, and the
    // button must not become a side door into content she has not reached. Asserted by
    // counting programme lessons on the screen the button lands her on, which must be zero.
    name: "לפני תחילת התוכנית: כרטיס הבונוס נפתח, ואין אף שיעור של התוכנית",
    async run(browser, device) {
      // Two days from now, so she is genuinely before day 1.
      const future = new Date(Date.parse(TODAY + "T00:00:00Z") + 2 * 86400000).toISOString().slice(0, 10);
      const { context, page, errors } = await openApp(browser, device, { startDate: future, glow: true });
      const card = await page.locator("text=בונוס שמחכה לך כבר עכשיו").count();
      await page.locator("text=לצפייה בשיעורים").first().click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(900);
      // The four bonus rows must be there...
      const bonus = await page.locator("text=/שיעור \\d+ - /").count();
      // ...and nothing from the programme: no week, no day, no lesson of a day.
      const weeks = await page.locator("text=/^שבוע \\d+$/").count();
      const dayRows = await page.locator('div[role="button"]').filter({ hasText: /יום \d/ }).count();
      const bad = errors.filter((e) => !/favicon|manifest/i.test(e));
      await context.close();
      return {
        ok: card > 0 && bonus >= 3 && weeks === 0 && dayRows === 0 && bad.length === 0,
        detail: `כרטיס ${card} · שיעורי בונוס ${bonus} · שבועות ${weeks} · ימים ${dayRows}`,
      };
    },
  },
  {
    // She is NOT marked for the bonus, so the waiting screen must stay exactly as it was.
    name: "לפני תחילת התוכנית: בלי הסימון אין כרטיס בונוס",
    async run(browser, device) {
      const future = new Date(Date.parse(TODAY + "T00:00:00Z") + 2 * 86400000).toISOString().slice(0, 10);
      const { context, page } = await openApp(browser, device, { startDate: future, glow: false });
      const card = await page.locator("text=בונוס שמחכה לך כבר עכשיו").count();
      const waiting = await page.locator("text=התוכנית שלך מתחילה ביום").count();
      await context.close();
      return { ok: card === 0 && waiting > 0, detail: `כרטיס ${card} (מצופה 0) · מסך המתנה ${waiting}` };
    },
  },
  {
    // A participant reported that back from inside a recipe landed her on the diary instead
    // of the recipe list. The open recipe was not a layer the back handler could see. This
    // is the one part of the Android back button a desktop browser can actually reproduce,
    // because both arrive as the same popstate.
    name: "חזרה מתוך מתכון מחזירה לרשימת המתכונים ולא ליומן",
    async run(browser, device) {
      const { context, page, errors } = await openApp(browser, device, { day: 15 });
      await page.locator('text="מתכונים"').last().click();
      await page.waitForTimeout(500);
      const searchBox = page.locator('input[placeholder*="חיפוש מתכון"]');
      const listBefore = await searchBox.count();
      await page.locator("img[alt]").first().click();
      await page.waitForTimeout(400);
      const inDetail = (await searchBox.count()) === 0;
      await page.goBack();
      await page.waitForTimeout(500);
      const backOnList = (await searchBox.count()) > 0;
      const bad = errors.filter((e) => !/favicon|manifest/i.test(e));
      await context.close();
      return {
        ok: listBefore > 0 && inDetail && backOnList && bad.length === 0,
        detail: `רשימה ${listBefore > 0} · נכנסה למתכון ${inDetail} · חזרה לרשימה ${backOnList}`,
      };
    },
  },
  {
    // Same fault one screen over: back from inside a lesson used to shut the whole content
    // screen. The tab strip only exists in the list views, so its absence is what says a
    // lesson is open, and the close button says we are still inside the content screen.
    name: "חזרה מתוך שיעור נשארת במסך התוכן ולא סוגרת אותו",
    async run(browser, device) {
      const { context, page, errors } = await openApp(browser, device, { day: 15 });
      // Straight into today's lessons. Going through "כל התוכנית" would work too, but the
      // shortest path to an open lesson is the one least likely to break for an unrelated
      // reason and hide what this scenario is actually about.
      await page.locator('[data-tut="contentcard"], [aria-label="כל התוכנית"]').first().click();
      await page.waitForTimeout(700);
      const tabs = page.locator('[data-tut^="content-tab-"]');
      const rows = page.locator('div[role="button"]');
      // Not every role=button on the screen is a lesson, and some are off screen, so try a
      // few and give each a short leash rather than letting one hidden row eat 30 seconds.
      const n = Math.min(await rows.count(), 10);
      for (let i = 0; i < n; i++) {
        const row = rows.nth(i);
        if (!(await row.isVisible().catch(() => false))) continue;
        await row.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(350);
        if ((await tabs.count()) === 0) break;   // a lesson opened
      }
      const inLesson = (await tabs.count()) === 0;
      await page.goBack();
      await page.waitForTimeout(500);
      const backInList = (await tabs.count()) > 0;
      const stillOpen = (await page.locator('[aria-label="סגירה"]').count()) > 0;
      const bad = errors.filter((e) => !/favicon|manifest/i.test(e));
      await context.close();
      return {
        ok: inLesson && backInList && stillOpen && bad.length === 0,
        detail: `נכנסה לשיעור ${inLesson} · חזרה לרשימה ${backInList} · מסך התוכן עדיין פתוח ${stillOpen}`,
      };
    },
  },
  {
    // Nothing here opened "כל התוכנית" until now, and that is how a plain ReferenceError
    // shipped: a variable was removed while a line below still used it. The build passes on
    // that, and every offline check passes on it, because it only throws while rendering.
    name: "מסך כל התוכנית נפתח, מציג שבועות, ובלי שגיאת JavaScript",
    async run(browser, device) {
      const { context, page, errors } = await openApp(browser, device, { day: 15 });
      // The card carries data-tut; matching on its text hits the heading inside it, which is
      // not the clickable element.
      await page.locator('[data-tut="contentcard"], [aria-label="כל התוכנית"]').first().click();
      await page.waitForTimeout(500);
      await page.locator('[data-tut="content-tab-all"]').first().click();
      await page.waitForTimeout(600);
      const weeks = await page.locator("text=/^שבוע \\d+$/").count();
      // The day heading is not a line of its own: it carries the "היום" badge and the lesson
      // summary beside it, so an anchored "^יום N$" never matched and the screen was reported
      // empty while it was in fact fine. Matched on the row itself rather than on loose text,
      // which would also hit every wrapper around it and then click something unclickable.
      const dayRows = page.locator('div[role="button"]').filter({ hasText: /יום \d/ });
      const days = await dayRows.count();
      // She must be able to open a day and see its lessons.
      if (days > 0) { await dayRows.first().click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(400); }
      const bad = errors.filter((e) => !/favicon|manifest/i.test(e));
      await context.close();
      return { ok: weeks > 0 && days > 0 && bad.length === 0, detail: `${weeks} שבועות · ${days} ימים · ${bad.length} שגיאות ${bad[0] || ""}` };
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
    name: "הודעה שאינה על אוכל מקבלת את המשפט הקבוע ובלי רעיונות",
    async run(browser, device) {
      const context = await browser.newContext({ ...device, locale: "he-IL", timezoneId: "Asia/Jerusalem" });
      const FIXED = "אני מצטערת, אני יכולה לעזור רק ברעיונות לאוכל באפליקציה הזו 🙂 רק רוצה להגיד לך, שתמיד את יכולה לשתף בקבוצת הוואטסאפ שלך, או את ענת בפרטי. אם בא לך רעיון לארוחה, כתבי לי ואשמח לעזור.";
      // The model is not in the loop here: this asserts that the screen RENDERS a refusal
      // with no options, instead of falling onto the v4.47 error path.
      await context.route("**/api/**", (route) => {
        const url = route.request().url();
        const json = (b) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
        if (url.includes("/api/access")) return json({ allowed: true, name: "בדיקה", startDate: startForDay(10) });
        if (url.includes("/api/ai")) return json({ content: [{ type: "text", text: JSON.stringify({ intro: FIXED, options: [], note: "" }) }] });
        return json({ ok: true, items: [] });
      });
      await context.addInitScript((sd) => {
        localStorage.setItem("myprime_access_email", "qa@myprime.co.il");
        localStorage.setItem("myprime_start_date", sd);
        localStorage.setItem("myprime_install_ack", "1");
        localStorage.setItem("myprime_demo_state_v1", JSON.stringify({ onboarded: true, profile: { age: 50, heightCm: 165, weightKg: 72, activity: "יושבני", weeklyRateG: 250, goalWeightKg: 66, returnPct: 50, startDate: sd, calorieOverride: null, stepGoal: null, stepBaseline: null, tipsSeen: ["cal", "steps", "tracker", "cabinet", "trackerfill", "stepbaseline", "water", "protein", "weeklysummary", "notifyAsked"], keepShabbat: false, fasting: false, cupMl: 250, diet: [], allergies: [], dislikes: "", name: "בדיקה", catchup: "done" }, log: [], weights: [], activityLog: [], waterByDate: {}, stepsByDate: {}, favorites: [], recents: [], checkins: {}, goalAckWeek: 99 }));
      }, startForDay(10));
      const page = await context.newPage();
      await page.goto(BASE, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2600);
      await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important}" }).catch(() => {});
      await page.locator('[aria-label="הוספה"]').click();
      await page.waitForTimeout(400);
      await page.locator("text=/מה כדאי/").first().click();
      await page.waitForTimeout(600);
      const cont = page.locator("text=/הבנתי|המשך|קבלי המלצות/").first();
      if (await cont.count()) { await cont.click(); await page.waitForTimeout(500); }
      await page.locator("textarea, input[type='text']").first().fill("אין לי כוח, בא לי לוותר על כל התוכנית");
      await page.locator("text=קבלי המלצות").first().click();
      await page.waitForTimeout(2500);
      const sentence = await page.locator("text=רק ברעיונות לאוכל").count();
      const cards = await page.locator("text=/^אופציה /").count();
      const error = await page.locator("text=/לא הצלחתי|אופס/").count();
      await context.close();
      return { ok: sentence > 0 && cards === 0 && error === 0, detail: `משפט קבוע ${sentence}, כרטיסי אופציה ${cards}, הודעת שגיאה ${error}` };
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
  {
    // The install video is an addition and never a route: if Bunny does not answer, the
    // written steps must still be there. Both halves are asserted here, because the screen
    // she lands on from the link is the one place where a blank is a lost participant.
    name: "מסך ההתקנה מציג את הסרטון מעל ההנחיות הכתובות",
    async run(browser, device) {
      if (!device.isMobile) return { skip: true, detail: "מסך ההתקנה מוצג בטלפון בלבד" };
      const context = await browser.newContext({ ...device, locale: "he-IL", timezoneId: "Asia/Jerusalem" });
      await context.route("**/api/**", (route) => {
        const url = route.request().url();
        const json = (b) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
        if (url.includes("/api/bunny-token")) return json({ url: "about:blank", expires: 0 });
        if (url.includes("/api/access")) return json({ allowed: true, name: "בדיקה", startDate: startForDay(10) });
        return json({ ok: true });
      });
      await context.addInitScript(() => {
        localStorage.setItem("myprime_access_email", "qa@myprime.co.il");
        localStorage.removeItem("myprime_install_ack");
      });
      const page = await context.newPage();
      await page.goto(BASE, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3000);
      const intro = await page.locator("text=/סרטון קצר שמראה בדיוק איך/").count();
      const frame = await page.locator('iframe[title="סרטון התקנה"]').count();
      const withVideo = await page.locator("text=/ואותם שלבים בכתב/").count();
      const plain = await page.locator("text=/^אייפון \\(Safari\\)$|^אנדרואיד \\(Chrome\\)$/").count();
      const list = await page.locator("ol li").count();
      await context.close();
      // מערכת הפעלה שאין לה עדיין מזהה סרטון חייבת להיראות בדיוק כמו לפני התוספת.
      // הכלל שנבדק כאן הוא שאין חצי מסך: או פתיח ונגן וכותרת "ואותם שלבים", או
      // אף אחד מהם והכותרת הרגילה. ובשני המקרים ההנחיות הכתובות קיימות.
      const full = intro === 1 && frame === 1 && withVideo === 1 && plain === 0;
      const none = intro === 0 && frame === 0 && withVideo === 0 && plain === 1;
      return { ok: (full || none) && list >= 4, detail: full ? `עם סרטון, ${list} שלבים` : none ? `בלי סרטון (אין עדיין מזהה), ${list} שלבים` : `לא עקבי: פתיח ${intro}, נגן ${frame}, כותרת עם ${withVideo}, כותרת רגילה ${plain}` };
    },
  },
  {
    // The invariant behind the iPhone jump (v4.80). While the keyboard is open the page
    // used to stay at full height inside a shrunken viewport, leaving spare page for iOS
    // to scroll into, and the app was dragged out of view. On a phone the page must have
    // NO scroll range at all. Chromium on Linux cannot reproduce the iPhone itself, but it
    // can prove the condition that made it possible is gone: try to scroll the document by
    // force, and fail if it moves even one pixel.
    name: "בטלפון אי אפשר לגלול את העמוד עצמו, גם עם שדה כתיבה פתוח",
    async run(browser, device) {
      if (!device.isMobile) return { skip: true, detail: "רלוונטי לטלפון בלבד" };
      const { page, context } = await openApp(browser, device, { day: 10 });
      await page.locator('[aria-label="הוספה"]').click();
      await page.locator("text=תיאור ב-AI").first().click().catch(() => {});
      await page.waitForTimeout(700);
      const box = page.locator("textarea").first();
      if (await box.count()) { await box.click().catch(() => {}); await page.waitForTimeout(300); }
      const r = await page.evaluate(() => {
        const before = window.scrollY;
        window.scrollTo(0, 900);
        const after = window.scrollY;
        const doc = document.documentElement;
        return { before, after, scrollH: doc.scrollHeight, clientH: doc.clientHeight };
      });
      await context.close();
      const noRange = r.scrollH <= r.clientH + 1;
      const cannotScroll = r.after === 0 && r.before === 0;
      return {
        ok: noRange && cannotScroll,
        detail: `גובה העמוד ${r.scrollH} מול חלון ${r.clientH}, אחרי ניסיון גלילה בכוח sY=${r.after}`,
      };
    },
  },
];

/* ---------- run ---------- */
const browser = await chromium.launch({ executablePath: BROWSER });
console.log(`\n  MyPrime QA שכבה 3 - ${CHECKS.length} בדיקות × ${DEVICES.length} מכשירים\n`);
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
