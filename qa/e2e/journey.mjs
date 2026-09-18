/* ============================================================================
   המסלול המלא של רון, מקצה לקצה, בדיוק בסדר שהוא עושה אותו.

   **למה הקובץ הזה קיים:** ב-17 בספטמבר 2026 מסרתי לרון רשימת בדיקות, והוא
   נתקל בשלוש תקלות ברצף שאף אחת מהבדיקות שלי לא תפסה. **הסיבה זהה בכולן:
   כל תרחיש נבדק בבידוד ועל הקשר טרי, והוא עובד ברצף אחד על אותו מכשיר.**

   כאן אין שום `goto` באמצע. נכנסים פעם אחת ומריצים את כל מה שהוא מריץ:
   כניסה, הרשמה, קוד גיבוי, הזנת אוכל, מחיקה, כניסה מחדש, שחזור, דילוג, וסיום.
   **ובשני מצבי שרת: מהיר, וכזה שרדום ולוקח לו עשר שניות** (נמדד בפועל).

   הרצה:  node qa/e2e/journey.mjs
   ========================================================================== */
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { chromium } from "playwright-core";

const DIST = "/home/user/myprime-nutri-demo/dist";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon", ".jpg": "image/jpeg" };
const server = createServer((q, s) => { let f = join(DIST, decodeURIComponent((q.url || "/").split("?")[0])); if (!existsSync(f) || statSync(f).isDirectory()) f = join(DIST, "index.html"); s.writeHead(200, { "content-type": MIME[extname(f)] || "application/octet-stream" }); s.end(readFileSync(f)); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const start = new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 10);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (extra ? "  → " + extra : "")); } };
const seeRestore = (p) => p.locator("text=מצאנו גיבוי מוצפן").count();
const seeReg = (p) => p.locator("text=נעים להכיר").count();
const seeGate = (p) => p.locator('input[placeholder="שם פרטי"]').count();
const seeLine = (p) => p.locator("text=כבר היו לך נתונים באפליקציה?").count();

/* השרת המדומה. cloud מחזיק את הגיבוי, בדיוק כמו אצלנו: מקום אחד לכל מייל. */
function makeCtx(browser, { slowMs = 0 } = {}) {
  const cloud = { blob: null };
  return browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "he-IL", timezoneId: "Asia/Jerusalem" }).then(async (c) => {
    await c.route("**/api/**", async (route) => {
      const url = route.request().url(), m = route.request().method();
      const json = (b) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
      if (url.includes("/api/backup")) {
        if (slowMs) await new Promise((r) => setTimeout(r, slowMs));
        if (m === "POST") { try { cloud.blob = JSON.parse(route.request().postData() || "{}").blob || null; } catch (e) {} return json({ ok: true }); }
        return cloud.blob ? json({ ok: true, exists: true, blob: cloud.blob }) : json({ ok: true, exists: false });
      }
      if (url.includes("/api/access")) return json({ allowed: true, name: "רון", startDate: start });
      return json({ ok: true });
    });
    await c.addInitScript(() => { localStorage.setItem("myprime_install_ack", "1"); });
    return { c, cloud };
  });
}
const quiet = (p) => p.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important}" }).catch(() => {});

/* הכניסה במסך השער. **ומה שהפיל אותה בכניסה השנייה:** סימון "קראתי ואני מאשרת"
   נשאר מסומן אחרי "מחיקת כל הנתונים", כי המסך עצמו אינו נטען מחדש. הקשה עליו
   באותו רגע **מבטלת** אותו. לכן מנסים להיכנס, ורק אם נשארנו על הטופס מקישים
   על הסימון ומנסים שוב. עובד בשתי הדרכים. */
async function signIn(p) {
  await p.locator('input[placeholder="שם פרטי"]').fill("רון");
  await p.locator('input[placeholder*="המייל"]').fill("ron@test.com");
  for (let i = 0; i < 2; i++) {
    await p.locator("text=כניסה").last().click().catch(() => {});
    await p.waitForTimeout(1500);
    if ((await p.locator('input[placeholder="שם פרטי"]').count()) === 0) { await p.waitForTimeout(2000); return true; }
    await p.locator("text=קראתי ואני מאשרת").click().catch(() => {});
    await p.waitForTimeout(400);
  }
  await p.waitForTimeout(2000);
  return (await p.locator('input[placeholder="שם פרטי"]').count()) === 0;
}
/* ההרשמה, שישה מסכים, ומזוהים לפי הטקסט שעליהם ולא לפי מספר הצעד.
   **מה שהפיל את הגרסה הראשונה של הפונקציה הזאת:** כפתור "המשך" אינו מושבת
   כששאלה לא נענתה, הוא פשוט מציג "יש לבחור תשובה". בדיקה שממתינה ל-disabled
   לא רואה את זה לעולם, ולכן היא לחצה תשע פעמים על אותו מסך. */
const BK_CODE = "myprime1";
async function fillOnboarding(p) {
  for (let step = 0; step < 12; step++) {
    await p.waitForTimeout(400);
    const t = (await p.locator("body").innerText()).replace(/\s+/g, " ");
    const nums = p.locator('input[type="number"]');
    for (let i = 0; i < (await nums.count()); i++) { const v = await nums.nth(i).inputValue(); if (!v) await nums.nth(i).fill(["52", "168", "74"][i] || "60").catch(() => {}); }
    if (t.includes("כולל שבת")) await p.locator("button").filter({ hasText: /^כן, כל השבוע$/ }).first().click().catch(() => {});
    if (t.includes("גיבוי מאובטח")) {
      await p.locator("button").filter({ hasText: /^כן, רוצה גיבוי מוצפן$/ }).first().click().catch(() => {});
      await p.waitForTimeout(300);
      const pw = p.locator('input[name^="mp-bk-"]');
      for (let i = 0; i < (await pw.count()); i++) if (!(await pw.nth(i).inputValue())) await pw.nth(i).fill(BK_CODE).catch(() => {});
      await p.locator("text=קראתי והבנתי את מדיניות").first().click().catch(() => {});
      await p.waitForTimeout(200);
    }
    const done = p.locator("button").filter({ hasText: /^בואי נתחיל$/ });
    if (await done.count()) { await done.first().click(); await p.waitForTimeout(1500); return true; }
    const next = p.locator("button").filter({ hasText: /^המשך$/ });
    if (!(await next.count())) return false;
    await next.first().click().catch(() => {});
    await p.waitForTimeout(500);
    // חלונית האישור למי שלא סימנה רגישויות
    const sure = p.locator("button").filter({ hasText: /^כן, אפשר להמשיך$/ });
    if (await sure.count()) { await sure.first().click().catch(() => {}); await p.waitForTimeout(500); }
  }
  return false;
}
/* חלוניות שקופצות מעצמן וחוסמות את כל המסך. **וזו בדיוק הסיבה שהסימולציה
   הזאת נבנתה:** אחרי השחזור האפליקציה נטענת מחדש, וחלונית ההתראות עולה עליה
   ו**מכילה בעצמה את המילה "פרופיל"**, ולכן הקשה על "פרופיל" נחתה בתוך החלונית
   ולא על הלשונית. בדיקה שנכנסת ישירות למסך לא הייתה נתקלת בזה לעולם. */
async function dismissPopups(p) {
  for (const t of [/^לא עכשיו$/, /^הבנתי$/, /^הבנתי, בואי נתחיל$/, /^סגירה$/]) {
    const b = p.locator("button").filter({ hasText: t });
    if (await b.count()) { await b.first().click().catch(() => {}); await p.waitForTimeout(500); }
  }
}
/* "מחיקת כל הנתונים והתחלה מחדש", מהפרופיל. **ומדפיסה מה על המסך כשהיא לא
   מוצאת**, כי "הכפתור לא נמצא" בלי לדעת מה כן היה שם הוא בדיוק הניחוש שגרר
   את כל העבודה הזאת. */
async function deleteAll(p) {
  const dump = async (w) => console.log("     [" + w + "] " + (await p.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 160));
  await dismissPopups(p);
  // הלשונית היא כפתור בסרגל התחתון, **ומזוהה ככזה ולא לפי טקסט חופשי**.
  const tab = p.locator("button").filter({ hasText: /^פרופיל$/ });
  if (!(await tab.count())) { await dump("אין לשונית פרופיל"); return false; }
  const qa = p.locator("text=/שאלות, תשובות/");
  for (let i = 0; i < 3 && !(await qa.count()); i++) { await tab.last().click().catch(() => {}); await p.waitForTimeout(1200); }
  if (!(await qa.count())) { await dump("אין שורת שאלות ותשובות"); return false; }
  await qa.first().click(); await p.waitForTimeout(1000);
  const del = p.locator("text=מחיקת כל הנתונים והתחלה מחדש");
  if (!(await del.count())) { await dump("אין שורת מחיקה"); return false; }
  await del.click(); await p.waitForTimeout(600);
  await p.locator("text=כן, מחקי והתחילי מחדש").click(); await p.waitForTimeout(1800);
  return true;
}
for (const mode of [{ name: "שרת מהיר", slowMs: 0 }, { name: "שרת רדום, עשר שניות", slowMs: 10000 }]) {
  console.log(`\n=== המסלול המלא: ${mode.name} ===`);
  try {
    const { c, cloud } = await makeCtx(browser, mode);
    const p = await c.newPage();
    await p.goto(BASE, { waitUntil: "domcontentloaded" });
    await p.waitForTimeout(mode.slowMs ? 13000 : 3500);
    await quiet(p);

    ok("1. מסך הכניסה מוצג, ולא נתקעים על טוען", (await seeGate(p)) > 0, (await p.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 80));
    await signIn(p);
    ok("2. אחרי הכניסה מגיעים להרשמה", (await seeReg(p)) > 0);
    ok("3. ואין שורה על נתונים קודמים, כי אין לו גיבוי", (await seeLine(p)) === 0);

    ok("4. ההרשמה הושלמה", await fillOnboarding(p));
    await p.waitForTimeout(mode.slowMs ? 12000 : 2000);
    ok("5. ונכנסים לאפליקציה, בלי להיעצר", (await seeReg(p)) === 0 && (await seeRestore(p)) === 0);

    // הגיבוי נכתב בהשהיה של 12 שניות, או מיד כשסוגרים. מדמים סגירה.
    await p.evaluate(() => { document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("pagehide")); });
    await p.waitForTimeout(mode.slowMs ? 12000 : 2500);
    ok("6. הגיבוי נשמר בענן", !!cloud.blob);
    const code = await p.evaluate(() => localStorage.getItem("myprime_bk_code"));
    ok("7. ויש קוד גיבוי על המכשיר", !!code, String(code));

    ok("8א. המחיקה עצמה רצה עד הסוף", await deleteAll(p));
    ok("8. אחרי מחיקה חוזרים למסך הכניסה", (await seeGate(p)) > 0);
    await signIn(p);
    await p.waitForTimeout(mode.slowMs ? 13000 : 1500);
    ok("9. ומסך השחזור מגיע, בלי שום רענון", (await seeRestore(p)) > 0, (await p.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 80));
    ok("10. והוא אומר איפה הקוד", (await p.locator("text=הקוד נשלח אלייך במייל כשהגיבוי נוצר").count()) > 0);

    await p.locator('input[name^="mp-bk-"]').fill(code);
    await p.waitForTimeout(300);
    await p.locator("text=שחזרי את הנתונים").click();
    await p.waitForTimeout(mode.slowMs ? 14000 : 4000);
    await quiet(p);
    ok("11. השחזור עובד ומחזיר לאפליקציה", (await seeReg(p)) === 0 && (await seeRestore(p)) === 0, (await p.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 80));

    // ועכשיו הכיוון השני: מוחקים שוב, ומדלגים במקום לשחזר.
    await deleteAll(p);
    await signIn(p);
    await p.waitForTimeout(mode.slowMs ? 13000 : 1500);
    ok("12. מסך השחזור מגיע שוב", (await seeRestore(p)) > 0);
    await p.locator("text=התחלה מחדש (בלי שחזור)").click(); await p.waitForTimeout(900);
    ok("13. ואחרי דילוג מגיעים להרשמה", (await seeReg(p)) > 0);
    ok("14. ההרשמה הושלמה שוב", await fillOnboarding(p));
    await p.waitForTimeout(mode.slowMs ? 12000 : 2000);
    ok("15. ומי שדילגה במודע אינה נעצרת שוב", (await seeRestore(p)) === 0 && (await seeReg(p)) === 0);
    await c.close();
  } catch (e) { ok("המסלול עצמו נפל: " + String(e.message).slice(0, 90), false); }
}

console.log(`\nסה"כ: ${pass} עוברים, ${fail} נכשלים\n`);
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
