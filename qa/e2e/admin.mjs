// שכבה 3 למסך הניהול. דפדפן אמיתי, בלי רשת חיצונית.
//
//   npm --prefix qa/e2e install && node qa/e2e/admin.mjs
//
// למה היא קיימת: 271 הבדיקות של qa/admin-check.mjs קוראות את הקוד ומריצות את
// השרת, ואף אחת מהן לא פותחת דפדפן. לכן שגיאת ריצה במסך הזה אינה נתפסת בשום
// מקום. תפריט "פעולות מהירות" זרק "jumpTo is not defined" בכל בחירה מ-v5.70 ועד
// v6.32, בשקט מוחלט, ורון גילה את זה בטלפון שלו. זו בדיוק הצורה של v5.20.
//
// הכלל: כל בדיקה כאן נופלת על כל שגיאת JavaScript, גם אם מה שהיא בדקה עבד.

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const BROWSER = process.env.QA_CHROMIUM || "/opt/pw-browsers/chromium";
const HTML = readFileSync(new URL("../../public/admin.html", import.meta.url), "utf8");
const TODAY = "2026-08-27";

const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(HTML);
});
await new Promise((r) => server.listen(0, r));
const BASE = "http://127.0.0.1:" + server.address().port + "/admin.html";

// שתי נשים, כדי שיהיה מה לסנן ומה לחפש. אחת מהן נושאת כתובת מייל שיש בה ספרות,
// והשנייה מספר טלפון בקידומת 050-66, וזה בדיוק הצירוף שהחזיר 11 תוצאות ב-v6.28.
const WOMEN = [
  {
    email: "lior5066@gmail.com", first: "אורלי", last: "לוי", phone: "972501111111",
    group: "א", start: "2026-08-16", until: "2026-11-24", sheetEnd: "2026-11-24",
    newApp: true, cancelled: false, glow: false, sheetGlow: false, solo: 0,
    months: 3, expired: false, notes: 0, log: [], needsGroup: false,
  },
  {
    email: "ronit@test.com", first: "רונית", last: "כהן", phone: "972506612345",
    group: "ב", start: "2026-08-09", until: "2026-11-17", sheetEnd: "2026-11-17",
    newApp: true, cancelled: false, glow: false, sheetGlow: false, solo: 6,
    months: 3, expired: false, notes: 0, log: [], needsGroup: false,
  },
];
const DATA = { ok: true, today: TODAY, me: "רון", owner: true, version: "test", women: WOMEN, headers: {}, skipped: {}, rawHeaders: [] };

const DEVICES = [
  { name: "טלפון", viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" },
  { name: "מחשב", viewport: { width: 1280, height: 900 } },
];

const results = [];
const record = (device, name, ok, detail, skip) => {
  results.push({ device, name, ok, detail, skip });
  console.log(`${skip ? "מדולג" : ok ? "עובר " : "נכשל "} | ${device} | ${name}${detail ? `\n        ${detail}` : ""}`);
};

async function open(browser, device) {
  const ctx = await browser.newContext({ ...device, locale: "he-IL", timezoneId: "Asia/Jerusalem" });
  await ctx.route("**/api/**", (route) => {
    const url = route.request().url();
    const json = (b) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
    if (url.includes("notes=")) return json({ ok: true, notes: [], replies: [] });
    if (url.includes("bank=1")) return json({ ok: true, bank: [] });
    if (url.includes("mc=")) return json({ ok: true, found: false });
    if (url.includes("codes=1")) return json({ ok: true, codes: [] });
    return json(DATA);
  });
  await ctx.addInitScript(() => {
    localStorage.setItem("mp_admin_key", "k");
    localStorage.setItem("mp_admin_who", "רון");
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important}" }).catch(() => {});
  return { ctx, page, errors };
}

// שבע האפשרויות בתפריט, ולאיזה שדה כל אחת אמורה לקפוץ.
const ACTIONS = [
  ["fld-coh", "העברת מחזור"],
  ["fld-grp", "שיוך קבוצה"],
  ["fld-frz", "הכנסה להקפאה"],
  ["fld-until", "הארכת גישה"],
  ["fld-name", "שינוי השם"],
  ["fld-mail", "שינוי כתובת מייל"],
  ["fld-cancel", "ביטול בתהליך"],
];

const CHECKS = [
  {
    name: "המסך נטען וכרטיס נפתח, בלי שגיאת JavaScript",
    async run(browser, device) {
      const { ctx, page, errors } = await open(browser, device);
      const rows = await page.locator("[data-open]").count();
      await page.locator("[data-open]").first().click();
      await page.waitForTimeout(400);
      const card = await page.locator(".card.open").count();
      await ctx.close();
      return { ok: rows === 2 && card === 1 && errors.length === 0, detail: `שורות ${rows} · כרטיס ${card} · שגיאות ${errors[0] || "אין"}` };
    },
  },
  {
    // זה מה שהיה שבור: כל בחירה בתפריט זרקה שגיאה ושום דבר לא קרה.
    name: "כל שבע הפעולות המהירות קופצות לשדה שלהן",
    async run(browser, device) {
      const { ctx, page, errors } = await open(browser, device);
      await page.locator("[data-open]").first().click();
      await page.waitForTimeout(400);
      const bad = [];
      for (const [id, label] of ACTIONS) {
        const sel = page.locator("select[data-qa]").first();
        if (!(await sel.count())) { bad.push(label + ": אין תפריט"); break; }
        await sel.selectOption(id);
        await page.waitForTimeout(350);
        const target = page.locator("#" + id);
        if (!(await target.count())) { bad.push(label + ": השדה לא נמצא"); continue; }
        if (!(await target.isVisible())) { bad.push(label + ": השדה מוסתר"); continue; }
        if (!(await page.locator("#" + id + ".lit").count())) bad.push(label + ": לא הודגש");
      }
      await ctx.close();
      return { ok: bad.length === 0 && errors.length === 0, detail: bad.length ? bad.join(" · ") : `שבע עברו · שגיאות ${errors[0] || "אין"}` };
    },
  },
  {
    name: "כל שש הלשוניות נפתחות בלי שגיאה",
    async run(browser, device) {
      const { ctx, page, errors } = await open(browser, device);
      await page.locator("[data-open]").first().click();
      await page.waitForTimeout(400);
      const tabs = await page.locator("[data-tab]").count();
      for (let i = 0; i < tabs; i++) {
        await page.locator("[data-tab]").nth(i).click();
        await page.waitForTimeout(250);
      }
      const body = await page.locator(".tabwrap").count();
      await ctx.close();
      return { ok: tabs === 6 && body === 1 && errors.length === 0, detail: `לשוניות ${tabs} · שגיאות ${errors[0] || "אין"}` };
    },
  },
  {
    // v6.29: הדבקת מייל שיש בו ספרות נקראה כמספר טלפון, וכל אישה בקידומת
    // 050-66 נכנסה לתוצאות. כאן זה נבדק על המסך עצמו ולא על הקוד.
    name: "חיפוש לפי מייל מחזיר אותה בלבד",
    async run(browser, device) {
      const { ctx, page, errors } = await open(browser, device);
      await page.locator("#q").fill("lior5066@gmail.com");
      await page.waitForTimeout(500);
      const rows = await page.locator("[data-open]").count();
      const byPhone = async () => { await page.locator("#q").fill("050-661-2345"); await page.waitForTimeout(500); return page.locator("[data-open]").count(); };
      const phoneRows = await byPhone();
      await ctx.close();
      return { ok: rows === 1 && phoneRows === 1 && errors.length === 0, detail: `לפי מייל ${rows} · לפי טלפון ${phoneRows} · שגיאות ${errors[0] || "אין"}` };
    },
  },
  {
    // v6.31: כרטיס פתוח של מישהי אחרת נשאר על המסך בזמן חיפוש חדש.
    name: "כרטיס פתוח נסגר כשמחפשים מישהי אחרת",
    async run(browser, device) {
      // בטלפון שורת החיפוש מוסתרת כל עוד כרטיס פתוח, לפי v5.72, ולכן אי אפשר
      // בכלל להקליד חיפוש חדש בלי לחזור לרשימה. זו התנהגות נכונה ולא כשל.
      if (device.isMobile) return { ok: true, skip: true, detail: "בטלפון שורת החיפוש מוסתרת כשכרטיס פתוח" };
      const { ctx, page, errors } = await open(browser, device);
      await page.locator("[data-open]").first().click();
      await page.waitForTimeout(400);
      const openBefore = await page.locator(".card.open").count();
      await page.locator("#q").fill("רונית");
      await page.waitForTimeout(500);
      const openAfter = await page.locator(".card.open").count();
      const rows = await page.locator("[data-open]").count();
      await ctx.close();
      return { ok: openBefore === 1 && openAfter === 0 && rows === 1 && errors.length === 0, detail: `לפני ${openBefore} · אחרי ${openAfter} · תוצאות ${rows} · שגיאות ${errors[0] || "אין"}` };
    },
  },
  {
    // v6.30: תגי הצבע היו מתים, כי .grp נכתב אחריהם ודרס להם את הרקע.
    // כאן נמדד הצבע בפועל שהדפדפן מצייר, ולא מה שכתוב בקובץ.
    name: "תג 360 סגול ותג סולו סגול, בפועל על המסך",
    async run(browser, device) {
      const { ctx, page, errors } = await open(browser, device);
      const bg = (sel) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).backgroundColor);
      const p360 = await bg(".p360pill");
      const solo = await bg(".solopill");
      await ctx.close();
      const purple = "rgb(237, 231, 246)";
      return { ok: p360 === purple && solo === purple && errors.length === 0, detail: `360 ${p360} · סולו ${solo}` };
    },
  },
];

const browser = await chromium.launch({ executablePath: BROWSER });
const ONLY = process.env.E2E_ONLY || "";
const RUN = CHECKS.filter((c) => !ONLY || c.name.includes(ONLY));
console.log(`\n  MyPrime QA שכבה 3 · מסך הניהול - ${RUN.length} בדיקות × ${DEVICES.length} מכשירים\n`);
for (const device of DEVICES) {
  for (const c of RUN) {
    try {
      const { ok, detail, skip } = await c.run(browser, device);
      record(device.name, c.name, ok, detail, skip);
    } catch (e) {
      record(device.name, c.name, false, "שגיאה: " + String(e.message || e).split("\n")[0].slice(0, 120));
    }
  }
}
await browser.close();
server.close();

const skipN = results.filter((r) => r.skip).length;
const okN = results.filter((r) => r.ok && !r.skip).length;
const total = results.length - skipN;
console.log("\n  ── סיכום ──");
console.log(`  עברו: ${okN}/${total}` + (skipN ? `   מדולגים: ${skipN}` : ""));
if (okN < total) {
  console.log("  נכשלו:");
  results.filter((r) => !r.ok && !r.skip).forEach((r) => console.log(`   · ${r.device} | ${r.name}`));
}
process.exit(okN === total ? 0 : 1);
