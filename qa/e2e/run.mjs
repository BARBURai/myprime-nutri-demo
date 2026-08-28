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
let lastPage = null;
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

async function openApp(browser, device, { day = 10, startDate: fixedStart = null, seed = {}, neverAskedNotify = false, glow = false, clock = null } = {}) {
  // `day` is the convenient form and is fine wherever the day of the week does not matter.
  // Pass `startDate` instead when it does, and build it with sundayWeeksAgo.
  const startDate = fixedStart || startForDay(day);
  const context = await browser.newContext({ ...device, locale: "he-IL", timezoneId: "Asia/Jerusalem" });
  await stubApi(context, { startDate, glow });
  // שעון נעוץ, לתרחיש שתלוי ביום בשבוע. בלעדיו הוא היה עובר בימים מסוימים
  // ונופל באחרים, וזו בדיוק המלכודת מסעיף 20.
  if (clock) {
    await context.addInitScript((iso) => {
      const Real = Date;
      const shift = Real.parse(iso) - Real.now();
      window.Date = new Proxy(Real, {
        construct: (t, a) => (a.length === 0 ? new Real(Real.now() + shift) : new Real(...a)),
        get: (t, k) => (k === "now" ? () => Real.now() + shift : Reflect.get(t, k)),
      });
    }, clock);
  }
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
  lastPage = page;
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
    // **החלבון היה המשימה האוטומטית היחידה שדרשה הצלחה ולא דיווח**, ולכן מי שלא
    // תיעדה את כל מה שאכלה לא סגרה את היום, לא קיבלה מדליה, והרצף שלה נשבר.
    // עכשיו היא מסומנת לבד למי שהגיעה ליעד, ומי שלא יכולה לסמן בעצמה. הבדיקה
    // רצה על אישה שהחלבון שלה נמוך מהיעד, ולכן היא בדיוק המקרה שהיה חסום.
    name: "משימת החלבון ניתנת לסימון ידני כשהיא לא הגיעה ליעד",
    async run(browser, device) {
      const start = sundayWeeksAgo(3);   // שבוע 4, ולכן משימת החלבון כבר פתוחה
      const today = TODAY;
      const seed = {
        log: [{ id: "p1", date: today, meal: "בוקר", name: "תפוח", g: 180, unit: "g", source: "verified", kcal: 94, p: 0, f: 0, c: 25 }],
      };
      const { context, page, errors } = await openApp(browser, device, { startDate: start, seed });
      await page.locator("text=הקישי למילוי המעקב").first().click({ timeout: 8000 });
      await page.waitForTimeout(900);
      await page.locator("text=הבנתי").first().click({ timeout: 2500 }).catch(() => {});
      await page.waitForTimeout(400);
      const label = await page.locator("text=הקפדתי על חלבון בכל ארוחה").count();
      const oldLabel = await page.locator("text=הגעתי ליעד החלבון").count();
      // התיבה שלה: הכפתור שיושב באותה שורה של הכיתוב. כשהיא לא הגיעה ליעד זו
      // חייבת להיות תיבת סימון ולא תג "אוטומטי", אחרת אין לה מה לעשות.
      const box = page.locator('div:has(> div > span:text-is("הקפדתי על חלבון בכל ארוחה")) > button').last();
      const hasBox = await box.count();
      let ticked = 0;
      if (hasBox) { await box.click({ timeout: 5000 }); await page.waitForTimeout(600); ticked = await box.locator("svg").count(); }
      await context.close();
      return {
        ok: label === 1 && oldLabel === 0 && hasBox === 1 && ticked === 1 && !errors.length,
        detail: `כיתוב חדש ${label}, ישן ${oldLabel}, תיבה ${hasBox}, נסמנה ${ticked}, שגיאות ${errors.length ? errors[0].slice(0, 70) : "אין"}`,
      };
    },
  },
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
    // v6.01 הפסיקה להציע 500 למי שקרובה לקו, ומי שכבר בחרה 500 המשיכה לקבל את
    // הגירעון המלא. רון: "אין לי בעיה שתהיה ב-250 בלבד." המספר על המסך שלה עולה
    // בכ-275 קלוריות, ולכן זה חייב להיאמר לה.
    name: "מי שבחרה 500 ומתקרבת לקו מועברת ל-250, ורואה על זה מסך",
    async run(browser, device) {
      const start = sundayWeeksAgo(1);
      const prof = { age: 50, heightCm: 165, weightKg: 70, activity: "יושבני", weeklyRateG: 500, goalWeightKg: 60, returnPct: 50, startDate: start, calorieOverride: null, stepGoal: null, stepBaseline: null, tipsSeen: ["cal", "steps", "tracker", "cabinet", "trackerfill", "stepbaseline", "water", "protein", "weeklysummary", "notifyAsked", "appTour"], keepShabbat: false, fasting: false, cupMl: 250, diet: [], allergies: [], dislikes: "", name: "בדיקה", catchup: "done", lossStopAt: null };
      const { context, page, errors } = await openApp(browser, device, { startDate: start, seed: { profile: prof, weights: [{ date: start, kg: 70 }] } });
      const state = () => page.evaluate(() => JSON.parse(localStorage.getItem("myprime_demo_state_v1") || "{}").profile || {});
      const logWeight = async (kg) => {
        await page.locator("text=דוח").last().click();
        await page.waitForTimeout(400);
        await page.locator("text=הזיני משקל").first().click();
        await page.waitForTimeout(400);
        await page.locator('input[inputmode="decimal"]').last().fill(String(kg));
        await page.locator("text=שמור").first().click();
        await page.waitForTimeout(800);
      };
      const bad = [];
      // בגובה 165 הקו הוא 54.5 ק״ג, ו-5 ק״ג מעליו הם 59.5. 62 עדיין רחוק.
      await logWeight(62);
      if ((await state()).weeklyRateG !== 500) bad.push("הקצב זז כשעוד היה מקום");
      if (await page.locator("text=הקצב שלך עודכן").count()) bad.push("המסך הוצג כשעוד היה מקום");

      // 57 כבר בתוך 5 הקילו, ושם התקרה תופסת
      await logWeight(57);
      let body = await page.locator("body").innerText();
      if (!body.includes("הקצב שלך עודכן")) bad.push("המסך לא הוצג");
      if (!body.includes("הקצב שלך עודכן ל-250 גרם בשבוע, והיעד הקלורי היומי עלה בהתאם")) bad.push("הקופי אינו כלשונו");
      const st = await state();
      if (st.weeklyRateG !== 250) bad.push("הקצב נשאר " + st.weeklyRateG);
      if (st.lossStopAt) bad.push("היא הועברה לשמירה במקום ל-250");
      const btn = page.getByRole("button", { name: "הבנתי" }).first();
      if (await btn.count()) await btn.click();
      await page.waitForTimeout(500);
      if (await page.locator("text=הקצב שלך עודכן").count()) bad.push("המסך לא נסגר");

      await context.close();
      return { ok: bad.length === 0 && errors.length === 0, detail: bad.length ? bad.join(" · ") : `שגיאות ${errors.length ? errors[0].slice(0, 40) : "אין"}` };
    },
  },
  {
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
      // 48 בגובה 152 יושב בין שני הקווים: מעל 46.5 ומתחת ל-49. שם נשבר הכל פעם
      // אחת, כי הנעילה נשענה על המשקל של הרגע ולא על המצב.
      await logWeight(48);
      await openBase();
      body = await page.locator("body").innerText();
      const tooEarly = !body.includes("אפשר לחזור לירידה במשקל") && !body.includes("משקל יעד");
      await page.locator("text=קצב ירידה").first().click();
      await page.waitForTimeout(400);
      body = await page.locator("body").innerText();
      const stillLocked = !body.includes("ירידה 250 ג׳ בשבוע") && !body.includes("ירידה 500 ג׳ בשבוע");
      await page.mouse.click(8, 8);
      await page.waitForTimeout(400);

      // 49.5 בגובה 152 חוצה את הקו השני (49), ולכן ההצעה לחזור קופצת בדוח עצמו.
      // בלי זה היא עולה חזרה מעל הקו ולא יודעת שנפתחה לה הדרך, כי הכרטיס יושב
      // בפרופיל והיא מזינה משקל בדוח.
      await logWeight(49.5);
      body = await page.locator("body").innerText();
      const offered = body.includes("אפשר לחזור לירידה במשקל")
        && body.includes("לפי המשקל שהזנת, אפשר לחזור לירידה מתונה. הקצב המרבי מכאן הוא 250 גרם בשבוע.")
        && body.includes("לא עכשיו");
      await page.getByRole("button", { name: "חזרה לירידה במשקל" }).first().click();
      await page.waitForTimeout(600);
      const st2 = await state();
      const back = st2.weeklyRateG === 250 && !st2.lossStopAt;
      // מי שכבר ירדה מתחת לקו פעם אחת לא רואה 500 שוב, בשום משקל
      await openBase();
      await page.locator("text=קצב ירידה").first().click();
      await page.waitForTimeout(400);
      body = await page.locator("body").innerText();
      const noFast = body.includes("ירידה 250 ג׳ בשבוע") && !body.includes("ירידה 500 ג׳ בשבוע");
      await page.mouse.click(8, 8);
      await page.waitForTimeout(300);

      await context.close();
      const ok = shown && moved && acked && locked && noGoalRow && tooEarly && stillLocked && offered && back && noFast && !errors.length;
      return { ok, detail: `מסך ${shown} · לשמירה ${moved} · אישרה ${acked} · הקצבים נעלמו ${locked} · אין משקל יעד ${noGoalRow} · ב-48 לא מוצע ${tooEarly} · ונשאר נעול ${stillLocked} · ההצעה קפצה ${offered} · חזרה ${back} · בלי 500 ${noFast} · שגיאות ${errors.length ? errors[0].slice(0, 60) : "אין"}` };
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
      // **התרחיש הזה נכשל בשבת, וזו מגבלה שלו ולא באג באפליקציה.** הוא נכנס דרך
      // "התכנים שלך היום", ובשבת אין תוכן חדש ולכן `data-tut="contentcard"`
      // אינו קיים כלל והכרטיס מציג "כל התוכנית פתוחה לך". אומת ב-22 באוגוסט
      // 2026: אין שגיאת ריצה, מסך התוכן תקין, והכניסה בלבד היא שלא נמצאת.
      // התיקון הנכון הוא להיכנס דרך "כל התוכנית" ולפתוח שבוע, כי מ-v5.16 שום
      // יום אינו נפתח מעצמו. ראה סעיף 28.
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
    // רון: "ההסתברות שבדיוק מה שרשום במאגר זה בדיוק מה שהיא אכלה היא אפסית."
    // לכן אין יותר הוספה מהירה בתוצאות החיפוש, והקשה בכל מקום בשורה פותחת את
    // מסך הכמות. ובאותו תרחיש גם: "לחצתי על המוצר עשיתי איקס, לא חזרתי למסך החיפוש."
    name: "שורת חיפוש נפתחת לכמות, וה-✕ שם מחזיר לתוצאות ולא סוגר הכל",
    async run(browser, device) {
      const { context, page, errors } = await openApp(browser, device);
      const sheetTitle = () => page.evaluate(() => {
        const ov = Array.from(document.querySelectorAll("div")).find((d) => getComputedStyle(d).backgroundColor === "rgba(58, 43, 48, 0.4)" && d.style.position === "absolute");
        if (!ov || !ov.firstElementChild) return "אין חלון פתוח";
        const h = ov.firstElementChild.querySelector("span");
        return h ? h.innerText.trim() : "?";
      });
      await page.locator('[aria-label="הוספה"]').click();
      await page.waitForTimeout(400);
      await page.locator("text=הוספת מזון").first().click();
      await page.waitForTimeout(500);
      await page.locator("text=חיפוש מזון").first().click();
      await page.waitForTimeout(500);
      const box = page.locator('input[placeholder="חיפוש מזון…"]');
      await box.fill("בננה");
      await page.waitForTimeout(800);

      const bad = [];
      // בשורת התוצאה אין יותר שום כפתור, ולכן אין דרך להוסיף כמות של המאגר בטעות.
      const btns = await page.evaluate(() => {
        const row = Array.from(document.querySelectorAll("div")).find((d) => d.children.length === 2 && d.innerText.startsWith("בננה בינונית"));
        return row ? row.querySelectorAll("button").length : -1;
      });
      if (btns !== 0) bad.push("בשורת התוצאה יש " + btns + " כפתורים");
      // הקשה על הקצה של השורה, שם ישב הפלוס, פותחת את מסך הכמות
      const row = page.locator("text=בננה בינונית").first();
      const box2 = await row.boundingBox();
      if (box2) await page.mouse.click(box2.x + 10, box2.y + box2.height / 2);
      await page.waitForTimeout(600);
      if (!(await page.locator("text=שיוך לארוחה").count())) bad.push("מסך הכמות לא נפתח");

      // ✕ בשורת הכותרת: הכפתור האחרון
      await page.evaluate(() => {
        const ov = Array.from(document.querySelectorAll("div")).find((d) => getComputedStyle(d).backgroundColor === "rgba(58, 43, 48, 0.4)" && d.style.position === "absolute");
        const bs = ov.firstElementChild.children[0].querySelectorAll("button");
        bs[bs.length - 1].click();
      });
      await page.waitForTimeout(600);
      const title = await sheetTitle();
      if (title === "אין חלון פתוח") bad.push("✕ סגר את הכל במקום לחזור");
      const left = await page.evaluate(() => { const i = document.querySelector('input[placeholder="חיפוש מזון…"]'); return i ? i.value : ""; });
      if (left !== "בננה") bad.push("החיפוש לא נשמר, נשאר " + JSON.stringify(left));

      await context.close();
      return { ok: bad.length === 0 && errors.length === 0, detail: bad.length ? bad.join(" · ") : `חזרה אל "${title}" · שגיאות ${errors.length ? errors[0].slice(0, 40) : "אין"}` };
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
      // כפתור ולא טקסט חופשי, וזו הייתה נפילה אמיתית של הבדיקה ב-23 באוגוסט 2026:
      // הביטוי הקודם תפס גם "המשך משימת הצעדים" בכרטיס שמאחורי החלונית, שמופיע
      // רק בימים מסוימים. הבדיקה לחצה על אלמנט מוסתר וחיכתה לו 30 שניות.
      const cont = page.getByRole("button", { name: /הבנתי|קבלי המלצות/ }).first();
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
      const cont = page.getByRole("button", { name: /הבנתי|קבלי המלצות/ }).first();
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
      const cont = page.getByRole("button", { name: /הבנתי|קבלי המלצות/ }).first();
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
    name: "מסך ההתקנה מציג את ההנחיות הכתובות מעל הסרטון",
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
      const intro = await page.locator("text=/ואותם שלבים בסרטון קצר/").count();
      const frame = await page.locator('iframe[title="סרטון התקנה"]').count();
      const plain = await page.locator("text=/^אייפון \\(Safari\\)$|^אנדרואיד \\(Chrome\\)$/").count();
      const list = await page.locator("ol li").count();
      const shots = await page.locator('img[src*="/guides/install-ios-"]').count();
      // הכלל החדש: ההנחיות הכתובות קודם והסרטון אחריהן. הסרטון מצלם מסך טלפון
      // שלם, ולכן כשהוא ראשון הוא דוחף את השלבים אל מחוץ לתמונה, וזה בדיוק מה
      // שרון תפס בבדיקה. השוואת המיקום היא על סדר האלמנטים בדף ולא על העין.
      const stepsFirst = await page.evaluate(() => {
        const ol = document.querySelector("ol");
        const f = document.querySelector('iframe[title="סרטון התקנה"]');
        if (!ol || !f) return null;
        return !!(ol.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING);
      });
      const isIOS = /iphone|ipad|ipod/i.test(device.userAgent || "");
      await context.close();
      // מערכת הפעלה שאין לה עדיין מזהה סרטון חייבת להיראות בדיוק כמו לפני התוספת:
      // או פתיח ונגן, או אף אחד מהם. אין חצי מסך. הכותרת היא תמיד הרגילה.
      const full = intro === 1 && frame === 1 && stepsFirst === true;
      const none = intro === 0 && frame === 0;
      // באייפון שתי התמונות של הסרגל חייבות להיות שם, כי בלעדיהן ההנחיה חוזרת
      // לתאר צורה במקום מקום, וזה מה ששלח משתתפת לכפתור ה-AirPlay שעל הסרטון.
      const shotsOk = isIOS ? shots === 2 : true;
      return { ok: (full || none) && plain === 1 && list >= 4 && shotsOk, detail: `${full ? "סרטון אחרי השלבים" : none ? "בלי סרטון (אין עדיין מזהה)" : `לא עקבי: פתיח ${intro}, נגן ${frame}, השלבים ראשונים ${stepsFirst}`} · ${list} שלבים · תמונות ${shots}` };
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
  {
    // משתתפת ביקשה לראות את היומן לפי הארוחות, כדי לדעת מה אכלה מתי. הכפתור
    // אומר מה יקרה אם לוחצים עליו, ובררת המחדל נשארת סדר ההזנה.
    name: "היומן מתהפך לסדר הארוחות ובחזרה",
    async run(browser, device) {
      const log = [
        { id: "e1", date: TODAY, meal: "ערב", name: "סלמון בדיקה", g: 100, unit: "g", source: "verified", kcal: 200, p: 20, f: 12, c: 0 },
        { id: "e2", date: TODAY, meal: "בוקר", name: "לחם בדיקה", g: 30, unit: "g", source: "verified", kcal: 80, p: 3, f: 1, c: 15 },
        { id: "e3", date: TODAY, meal: "צהריים", name: "אורז בדיקה", g: 150, unit: "g", source: "verified", kcal: 190, p: 4, f: 1, c: 42 },
      ];
      const { page, context, errors } = await openApp(browser, device, { day: 10, seed: { log } });
      // סדר השמות ברשימה, לפי סדר האלמנטים בדף ולא לפי העין.
      const order = async () => page.evaluate(() => {
        const wrap = document.querySelector('[data-tut="diarylist"]');
        if (!wrap) return [];
        const out = [];
        let el = wrap.nextElementSibling;
        while (el) { const t = (el.textContent || ""); const m = t.match(/(סלמון|לחם|אורז) בדיקה/); if (m) out.push(m[1]); el = el.nextElementSibling; }
        return out;
      });
      const before = await order();
      const btn = page.getByRole("button", { name: /לפי הארוחה/ }).first();
      const hadBtn = await btn.count();
      if (hadBtn) { await btn.click(); await page.waitForTimeout(400); }
      const after = await order();
      const backBtn = await page.getByRole("button", { name: /לפי סדר ההזנה/ }).count();
      await context.close();
      const ok = hadBtn > 0 &&
        before.join(",") === "סלמון,לחם,אורז" &&
        after.join(",") === "לחם,אורז,סלמון" &&
        backBtn > 0 && errors.length === 0;
      return { ok, detail: `לפני ${before.join(",") || "אין"} · אחרי ${after.join(",") || "אין"} · כפתור חזרה ${backBtn} · שגיאות ${errors.length ? errors[0].slice(0, 60) : "אין"}` };
    },
  },
  {
    // דיווח של רינת לאון: "המספר 1 נשאר, לא יכולתי לרשום 70 אלא רק 71". השדה
    // מגיע עם ערך בפנים, וההקלדה נדבקה אליו במקום להחליף אותו.
    name: "הקלדה בשדה כמות מחליפה את המספר שכבר בו",
    async run(browser, device) {
      const { context, page, errors } = await openApp(browser, device);
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
      await page.waitForTimeout(500);
      // מונה הכמות: שדה מספרי צר וממורכז, זה שיושב בין המינוס לפלוס.
      const qty = page.locator('input[inputmode="numeric"]').first();
      const before = await qty.inputValue();
      await qty.click();
      await page.waitForTimeout(200);
      await page.keyboard.type("70");
      await page.waitForTimeout(300);
      const after = await qty.inputValue();
      await context.close();
      return {
        ok: before !== "" && after === "70" && errors.length === 0,
        detail: `היה ${before || "ריק"} · הוקלד 70 · יצא ${after} · שגיאות ${errors.length ? errors[0].slice(0, 50) : "אין"}`,
      };
    },
  },
  {
    // רעיון של רון: כפתור בארון הגביעים שאומר מה חסר לגביע של השבוע, בשישי ובשבת
    // בלבד. השעון נעוץ ליום שישי, אחרת התרחיש היה עובר בימים מסוימים ונופל באחרים.
    name: "בארון הגביעים, מה נשאר לגביע מונה את היום ואת המשימה",
    async run(browser, device) {
      // 2026-08-16 הוא יום ראשון. יום 13 בתוכנית הוא שישי של שבוע 2.
      const start = "2026-08-16";
      const day = (n) => { const t = new Date(Date.UTC(2026, 7, 16)); t.setUTCDate(t.getUTCDate() + n - 1); return t.toISOString().slice(0, 10); };
      const THU = day(12);
      const prof = { age: 50, heightCm: 165, weightKg: 72, activity: "יושבני", weeklyRateG: 250, goalWeightKg: 66, returnPct: 50, startDate: start, calorieOverride: null, stepGoal: 8000, stepBaseline: 8000, tipsSeen: ["cal", "steps", "tracker", "cabinet", "trackerfill", "stepbaseline", "water", "protein", "weeklysummary", "notifyAsked", "appTour"], keepShabbat: false, fasting: false, cupMl: 250, diet: [], allergies: [], dislikes: "", name: "בדיקה", catchup: "done" };
      // שבוע 2 מלא, חוץ מאימון הכוח של חמישי. בדיוק המקרה של הילה.
      const checkins = {}, stepsByDate = {}, waterByDate = {}, log = [];
      const IDS = "steps journal strength veg mealorder".split(" ");
      const NUM = new Set(["steps", "veg", "mealorder"]);
      for (let n = 8; n <= 13; n++) {
        const d = day(n);
        stepsByDate[d] = 9000; waterByDate[d] = 2200;
        log.push({ id: "x" + n, date: d, meal: "בוקר", name: "בדיקה", g: 200, unit: "g", source: "verified", kcal: 400, p: 130, f: 10, c: 20 });
        const ans = {};
        for (const id of IDS) ans[id] = NUM.has(id) ? 5 : true;
        if (d === THU) delete ans.strength;
        checkins[d] = ans;
      }
      const { context, page, errors } = await openApp(browser, device, {
        startDate: start, clock: "2026-08-28T14:00:00.000Z",
        seed: { profile: prof, checkins, stepsByDate, waterByDate, log, weights: [{ date: start, kg: 72 }] },
      });
      const bad = [];
      await page.locator('[data-tut="cabinet"]').first().click().catch(async () => { await page.locator("text=ארון").first().click(); });
      await page.waitForTimeout(700);
      if (!(await page.locator("text=ארון המדליות והגביעים").count())) bad.push("הארון לא נפתח");
      const btn = page.locator("text=/מה נשאר לגביע של שבוע/").first();
      if (!(await btn.count())) bad.push("הכפתור אינו מוצג בשישי");
      else {
        await btn.click();
        await page.waitForTimeout(500);
        const body = await page.evaluate(() => document.body.innerText);
        if (!body.includes("מה נשאר לגביע של שבוע 2?")) bad.push("הכותרת אינה נוקבת בשבוע");
        // כפתור הסגירה חייב להיות נראה בלי לגלול, אחרת החלונית נראית כאילו נחתכה
        const seen = await page.evaluate(() => { const b = Array.from(document.querySelectorAll("button")).find((x) => x.innerText.trim() === "סגירה"); if (!b) return false; const r = b.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
        if (!seen) bad.push("כפתור הסגירה אינו נראה");
        if (!body.includes("יום חמישי · 27.08")) bad.push("היום החסר או התאריך שלו אינם מופיעים");
        if (!body.includes("אימון כוח")) bad.push("המשימה החסרה אינה מופיעה");
        if (body.includes("יום רביעי")) bad.push("יום שהושלם מופיע ברשימה");
        // סוגרים את המסך וחוזרים לארון, לבדוק את גביע הכסף עצמו
        await page.getByRole("button", { name: "סגירה" }).first().click().catch(() => {});
        await page.waitForTimeout(400);
      }
      // שבוע 2 חסר בו יום אחד, ולכן הוא כסף. שבוע 1 לא מולא כלל ואינו גביע.
      const silver = await page.evaluate(() => Array.from(document.querySelectorAll("img")).filter((i) => i.src.includes("-silver.webp")).length);
      if (silver !== 1) bad.push("גביעי כסף על המסך: " + silver);
      const cab = await page.evaluate(() => document.body.innerText);
      if (!cab.includes("כסף")) bad.push("לא כתוב שהגביע כסף");
      if (!cab.includes("אם פספסת יום אחד, נכנס גביע כסף")) bad.push("שורת ההסבר אינה מופיעה בארון");
      await context.close();
      return { ok: bad.length === 0 && errors.length === 0, detail: bad.length ? bad.join(" · ") : `שגיאות ${errors.length ? errors[0].slice(0, 40) : "אין"}` };
    },
  },
  {
    // רון: "לחיצה על שאלות ותשובות ועזרה צריכה להוביל ישר לשאלות והתשובות, ואז
    // בסוף השאלות והתשובות שיהיה קו מפריד ומתחתיו מחיקת כל הנתונים והתנתקות."
    // ובאותה שיחה: "כל הטקסטים האפורים... אני רוצה אותם שחורים."
    name: "השורה בפרופיל פותחת ישר את השאלות והתשובות, ובתחתיתן פעולות החשבון",
    async run(browser, device) {
      const { context, page, errors } = await openApp(browser, device);
      const bad = [];
      await page.locator("text=פרופיל").last().click();
      await page.waitForTimeout(700);
      // הטקסט המשני בפרופיל צריך להיות שחור כמו הראשי, בלי שום אפור.
      const grey = await page.evaluate(() => {
        const bads = [];
        document.querySelectorAll("div,span").forEach((el) => {
          if (el.children.length) return;
          const c = getComputedStyle(el).color;
          if (c === "rgb(139, 115, 122)" || c === "rgb(187, 167, 172)") bads.push((el.innerText || "").slice(0, 20));
        });
        return bads.slice(0, 3);
      });
      if (grey.length) bad.push("נשאר טקסט אפור: " + grey.join(" | "));

      await page.locator("text=שאלות, תשובות ועזרה").first().click();
      await page.waitForTimeout(700);
      if (!(await page.locator("text=כל מה שכדאי לדעת על השימוש").count())) bad.push("המסך לא נפתח בהקשה אחת");
      if (await page.locator("text=שאלות ותשובות נפוצות").count()) bad.push("שורת הביניים עדיין קיימת");

      const reset = page.locator("text=מחיקת כל הנתונים והתחלה מחדש").first();
      const out = page.locator("text=התנתקות מהמכשיר הזה").first();
      if (!(await reset.count())) bad.push("מחיקת הנתונים אינה בתוך המסך");
      if (!(await out.count())) bad.push("ההתנתקות אינה בתוך המסך");
      if (await out.count()) {
        await out.scrollIntoViewIfNeeded();
        await out.click();
        await page.waitForTimeout(500);
        if (!(await page.locator("text=להתנתק מהמכשיר?").count())) bad.push("חלונית האישור לא נפתחה");
        const cancel = page.getByRole("button", { name: "ביטול" }).first();
        if (await cancel.count()) await cancel.click();
        await page.waitForTimeout(400);
      }
      await context.close();
      return { ok: bad.length === 0 && errors.length === 0, detail: bad.length ? bad.join(" · ") : `שגיאות ${errors.length ? errors[0].slice(0, 40) : "אין"}` };
    },
  },
  {
    // בקשה של הילה: "כדאי להוסיף חיפוש במאכלים האחרונים שאכלתי." ההחלטה של רון:
    // החיפוש חוצה את שתי הלשוניות, כי מי שמחפשת במועדפים ולא מוצאת לא תחשוב
    // להחליף לשונית ולחפש שוב. שני הצדדים באותו תרחיש בכוונה: שהחיפוש מוצא בשתי
    // הרשימות, ושפריט שנמצא בשתיהן מוצג פעם אחת בלבד.
    name: "החיפוש באחרונים ובמועדפים מוצא בשתי הרשימות, וכפול מוצג פעם אחת",
    async run(browser, device) {
      const item = (name, kcal) => ({ id: "fav_" + name, name, per100: { kcal, p: 5, f: 2, c: 10 }, exact: { g: 100, kcal, p: 5, f: 2, c: 10 }, measures: [{ label: "100 ג׳", g: 100 }, { label: "כף", g: 15 }], def: 0, unit: "g", lastG: 100 });
      const { context, page, errors } = await openApp(browser, device, {
        seed: {
          favorites: [item("יוגורט ביו בדיקה", 90), item("יוגורט עם גרנולה בדיקה", 140), item("סלט ירקות בדיקה", 40), item("לחם מלא בדיקה", 240), item("אגוזי מלך בדיקה", 650)],
          recents: [item("יוגורט יווני בדיקה", 100), item("יוגורט ביו בדיקה", 90), item("ביצה קשה בדיקה", 155), item("אורז בדיקה", 130), item("טונה בדיקה", 116)],
        },
      });
      await page.locator('[aria-label="הוספה"]').click();
      await page.waitForTimeout(400);
      await page.locator("text=הוספת מזון").first().click();
      await page.waitForTimeout(500);
      await page.locator("text=האחרונים והמועדפים שלי").first().click();
      await page.waitForTimeout(500);

      const bad = [];
      const box = page.locator('input[placeholder="חיפוש בפריטים שלי…"]');
      if (!(await box.count())) bad.push("שדה החיפוש לא מוצג אף שיש עשרה פריטים");
      // כותרת המסך היא "האחרונים והמועדפים שלי", ולכן חיפוש טקסט חופשי תופס גם אותה.
      const tab = () => page.getByRole("button", { name: "המועדפים שלי", exact: true });
      const tabsBefore = await tab().count();
      if (!tabsBefore) bad.push("שתי הלשוניות לא מוצגות לפני החיפוש");

      if (await box.count()) {
        await box.fill("יוגורט");
        await page.waitForTimeout(500);
      }
      const txt = () => page.evaluate(() => document.body.innerText);
      let body = await txt();
      const count = (needle) => body.split(needle).length - 1;
      if (count("יוגורט ביו בדיקה") !== 1) bad.push("פריט שנמצא בשתי הרשימות מוצג " + count("יוגורט ביו בדיקה") + " פעמים");
      if (count("יוגורט יווני בדיקה") !== 1) bad.push("הפריט שקיים רק באחרונים אינו מוצג");
      if (count("סלט ירקות בדיקה") !== 0) bad.push("פריט שאינו תואם נשאר על המסך");
      if (!body.includes("מועדפים (2)")) bad.push("כותרת המועדפים חסרה");
      if (!body.includes("אחרונים (1)")) bad.push("כותרת האחרונים חסרה");
      if (body.indexOf("מועדפים (2)") > body.indexOf("אחרונים (1)")) bad.push("האחרונים מוצגים לפני המועדפים");
      if (await tab().count()) bad.push("הלשוניות נשארו בזמן חיפוש");

      if (await box.count()) { await box.fill("פסטה"); await page.waitForTimeout(400); }
      body = await txt();
      if (!body.includes("לא נמצא פריט בשם הזה")) bad.push("חיפוש בלי תוצאות אינו אומר את זה");

      if (await box.count()) { await box.fill(""); await page.waitForTimeout(400); }
      if (!(await tab().count())) bad.push("הלשוניות לא חזרו כשמחקו את החיפוש");
      body = await txt();
      if (!body.includes("סלט ירקות בדיקה")) bad.push("הרשימה המלאה לא חזרה");

      await context.close();
      return { ok: bad.length === 0 && errors.length === 0, detail: bad.length ? bad.join(" · ") : `שגיאות ${errors.length ? errors[0].slice(0, 50) : "אין"}` };
    },
  },
  {
    // בטלפוני סמסונג קישור מוואטסאפ נוחת בדפדפן של סמסונג, ושם ההתקנה נחסמת על
    // ידי אנדרואיד. משתתפת שלחה צילום של Google Play Protect. שני הצדדים באותו
    // תרחיש בכוונה, כי הודעה שמופיעה תמיד נראית בדיוק כמו הודעה שלא מופיעה אף פעם.
    name: "בדפדפן שאי אפשר להתקין ממנו מוצגת ההפניה, ובנכון לא",
    async run(browser, device) {
      if (!device.isMobile) return { ok: true, skip: true, detail: "רלוונטי לטלפון בלבד" };
      // באייפון ההנחיות הן של ספארי ולא של כרום, ולכן הצד השני של ההשוואה אינו קיים שם.
      if (/iphone|ipad/i.test(device.userAgent || "")) return { ok: true, skip: true, detail: "באייפון ההנחיות הן של ספארי" };
      const SAMSUNG = "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36";
      const look = async (ua, standalone) => {
        const context = await browser.newContext({ ...device, ...(ua ? { userAgent: ua } : {}), locale: "he-IL", timezoneId: "Asia/Jerusalem" });
        await stubApi(context, { startDate: startForDay(10) });
        await context.addInitScript((sa) => {
          localStorage.setItem("myprime_access_email", "qa@myprime.co.il");
          localStorage.removeItem("myprime_install_ack");
          // אפליקציה מותקנת: matchMedia מדווח standalone. אין דרך אחרת לדמות את זה.
          if (sa) { const real = window.matchMedia.bind(window); window.matchMedia = (q) => (q === "(display-mode: standalone)" ? { matches: true, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} } : real(q)); }
        }, !!standalone);
        const page = await context.newPage();
        await page.goto(BASE, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(2600);
        const note = await page.locator("text=מתקינים רק דרך Chrome").count();
        const chromeSteps = await page.locator("text=ודאי שאת בדפדפן Chrome").count();
        const copyBtn = await page.getByRole("button", { name: /העתקת הקישור/ }).count();
        const iosNote = await page.locator("text=מתקינים רק דרך Safari").count();
        const iosSteps = await page.locator("text=ודאי שאת בדפדפן Safari").count();
        await context.close();
        return { note, chromeSteps, copyBtn, iosNote, iosSteps };
      };
      const sam = await look(SAMSUNG);
      const chr = await look(null);
      // ובאייפון: כרום שם הוא ספארי מבפנים בלי אפשרות התקנה, ולכן גם הוא מקבל הפניה.
      const CRIOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1";
      const SAF = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
      const cr = await look(CRIOS);
      const sf = await look(SAF);
      // מי שכבר בתוך האפליקציה המותקנת לא תראה את ההודעה לעולם. באייפון הזהות של
      // אפליקציה מותקנת אינה נושאת Version/, בדיוק כמו דפדפן פנימי, ולכן בלי הסייג
      // היא הייתה מקבלת הפניה להתקין למרות שהיא כבר התקינה.
      const PWA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
      const inst = await look(PWA, true);
      // ובאפליקציה המותקנת יש עוד דרך להגיע להנחיות: הפרופיל. שם ההודעה הייתה
      // מופיעה למי שכבר התקינה, כי מסך ההתקנה עצמו אינו מרונדר שם בכלל.
      const instProfile = await (async () => {
        const context = await browser.newContext({ ...device, userAgent: PWA, locale: "he-IL", timezoneId: "Asia/Jerusalem" });
        await stubApi(context, { startDate: startForDay(10) });
        await context.addInitScript(() => {
          const real = window.matchMedia.bind(window);
          window.matchMedia = (q) => (q === "(display-mode: standalone)" ? { matches: true, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} } : real(q));
        });
        const page = await context.newPage();
        await page.goto(BASE, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(2600);
        await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important}" }).catch(() => {});
        await page.locator("text=פרופיל").last().click().catch(() => {});
        await page.waitForTimeout(700);
        const row = page.locator("text=התקנת האפליקציה על הטלפון").first();
        const had = await row.count();
        if (had) { await row.click(); await page.waitForTimeout(700); }
        const n = await page.locator("text=/מתקינים רק דרך/").count();
        await context.close();
        return { had, n };
      })();
      const ok = sam.note === 1 && sam.chromeSteps === 0 && sam.copyBtn === 1 &&
                 chr.note === 0 && chr.chromeSteps === 1 &&
                 cr.iosNote === 1 && cr.iosSteps === 0 && sf.iosNote === 0 && sf.iosSteps === 1 &&
                 inst.iosNote === 0 && inst.note === 0 && instProfile.n === 0;
      return { ok, detail: `סמסונג ${sam.note}/${sam.chromeSteps} · כרום ${chr.note}/${chr.chromeSteps} · אייפון-כרום ${cr.iosNote}/${cr.iosSteps} · ספארי ${sf.iosNote}/${sf.iosSteps} · מותקנת ${inst.iosNote} · פרופיל במותקנת ${instProfile.n} (שורה ${instProfile.had})` };
    },
  },
];

/* ---------- run ---------- */
const browser = await chromium.launch({ executablePath: BROWSER });
// E2E_ONLY="חלק מהשם" מריץ תרחישים שהשם שלהם מכיל את המחרוזת, ו-E2E_DEVICE
// מצמצם למכשיר אחד. נועד לחזור על תרחיש שנפל בלי לשלם על כל החבילה, וזה מה
// שהיה חסר כשצריך היה לחקור נפילה אחת. שתיהן ריקות בהרצה רגילה.
const ONLY = process.env.E2E_ONLY || "";
const ONE_DEV = process.env.E2E_DEVICE || "";
const RUN_DEV = DEVICES.filter((d) => !ONE_DEV || d.name.includes(ONE_DEV));
const RUN_CHK = CHECKS.filter((c) => !ONLY || c.name.includes(ONLY));
console.log(`\n  MyPrime QA שכבה 3 - ${RUN_CHK.length} בדיקות × ${RUN_DEV.length} מכשירים\n`);
for (const device of RUN_DEV) {
  for (const c of RUN_CHK) {
    try {
      const { ok, detail, skip } = await c.run(browser, device);
      record(device.name, c.name, ok, detail, skip);
    } catch (e) {
      record(device.name, c.name, false, `שגיאה: ${String(e.message || e).split("\n")[0].slice(0, 120)}`);
      // E2E_SHOT=/path שומר צילום מסך של הכשל. בלי זה חוקרים לפי שם התרחיש,
      // וזה בדיוק מה שכבר שלח אותנו פעם למסקנה שגויה.
      if (process.env.E2E_SHOT && lastPage) { try { await lastPage.screenshot({ path: process.env.E2E_SHOT, fullPage: true }); } catch (e2) {} }
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
