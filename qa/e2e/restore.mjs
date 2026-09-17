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
const ok = (n, c) => { console.log(`${c ? "עובר " : "נכשל "}| ${n}`); c ? pass++ : fail++; };

async function ctxWith({ hasBackup = true, delayMs = 0 } = {}) {
  const c = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, locale: "he-IL", timezoneId: "Asia/Jerusalem", userAgent: "Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36" });
  await c.route("**/api/**", async (route) => {
    const url = route.request().url();
    const json = (b) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
    if (url.includes("/api/backup")) { if (delayMs) await new Promise((r) => setTimeout(r, delayMs)); return json({ ok: true, exists: hasBackup, blob: "x", salt: "y", iv: "z" }); }
    if (url.includes("/api/access")) return json({ allowed: true, name: "אילה", startDate: start });
    return json({ ok: true });
  });
  await c.addInitScript(() => { localStorage.setItem("myprime_access_email", "a@b.com"); localStorage.setItem("myprime_access_name", "אילה"); localStorage.setItem("myprime_install_ack", "1"); });
  return c;
}
const seeRestore = (p) => p.locator("text=מצאנו גיבוי מוצפן").count();
const seeReg = (p) => p.locator("text=נעים להכיר").count();

/* eslint-disable */
/* 1. המסלול של אילה: פתיחה שנקטעה, ואז כניסה */
try {
  const c = await ctxWith({}); const p = await c.newPage();
  await p.addInitScript(() => localStorage.removeItem("myprime_access_email"));
  await p.goto(BASE, { waitUntil: "domcontentloaded" }); await p.waitForTimeout(3000);
  const wrote = await p.evaluate(() => !!localStorage.getItem("myprime_demo_state_v1"));
  await c.addInitScript(() => localStorage.setItem("myprime_access_email", "a@b.com"));
  const p2 = await c.newPage(); await p2.goto(BASE, { waitUntil: "domcontentloaded" }); await p2.waitForTimeout(3600);
  ok("פתיחה מוקדמת אכן כותבת על המכשיר (כך זה נשבר)", wrote);
  ok("ואחריה מסך השחזור בכל זאת מגיע", (await seeRestore(p2)) > 0);
  await c.close();
} catch (e) { ok("התרחיש עצמו נפל: " + String(e.message).slice(0,60), false); }
/* 2. אין גיבוי: ממשיכה להרשמה כרגיל */
try {
  const c = await ctxWith({ hasBackup: false }); const p = await c.newPage();
  await p.goto(BASE, { waitUntil: "domcontentloaded" }); await p.waitForTimeout(3600);
  ok("אין גיבוי: אין מסך שחזור", (await seeRestore(p)) === 0);
  ok("אין גיבוי: מגיעה להרשמה", (await seeReg(p)) > 0);
  await c.close();
} catch (e) { ok("התרחיש עצמו נפל: " + String(e.message).slice(0,60), false); }
/* 3. שרת תקוע: לא נתקעת, מגיעה להרשמה */
try {
  const c = await ctxWith({ delayMs: 30000 }); const p = await c.newPage();
  await p.goto(BASE, { waitUntil: "domcontentloaded" }); await p.waitForTimeout(9000);
  ok("שרת שלא עונה: לא נתקעת על טוען, מגיעה להרשמה", (await seeReg(p)) > 0);
  await c.close();
} catch (e) { ok("התרחיש עצמו נפל: " + String(e.message).slice(0,60), false); }
/* 4. השורה מוצגת רק כשלא הצלחנו לברר, ולא לאישה חדשה */
try {
  // השרת ענה ואין לה גיבוי. **אישה חדשה לא אמורה להישאל על זה בכלל.**
  const c = await ctxWith({ hasBackup: false }); const p = await c.newPage();
  await p.goto(BASE, { waitUntil: "domcontentloaded" }); await p.waitForTimeout(3600);
  ok("נבדק ואין לה גיבוי: אין שורה כלל", (await p.locator("text=כבר היו לך נתונים באפליקציה?").count()) === 0);
  await c.close();
} catch (e) { ok("התרחיש עצמו נפל: " + String(e.message).slice(0,60), false); }
try {
  // השרת לא ענה. **כאן ורק כאן השורה מוצדקת**, כי לא ידוע אם יש לה גיבוי.
  const c = await ctxWith({ delayMs: 30000 }); const p = await c.newPage();
  await p.goto(BASE, { waitUntil: "domcontentloaded" }); await p.waitForTimeout(9000);
  await p.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important}" }).catch(() => {});
  ok("השרת לא ענה: השורה כן מוצגת", (await p.locator("text=כבר היו לך נתונים באפליקציה?").count()) > 0);
  ok("והיא בראש המסך ולא בתחתית", (await p.locator("text=כבר היו לך נתונים באפליקציה?").first().boundingBox()).y < (await p.locator("text=משקל נוכחי").first().boundingBox()).y);
  await p.locator("text=שחזור מגיבוי").first().click(); await p.waitForTimeout(800);
  ok("וההקשה עליה פותחת את מסך השחזור", (await seeRestore(p)) > 0);
  await c.close();
} catch (e) { ok("התרחיש עצמו נפל: " + String(e.message).slice(0,60), false); }
/* 5. החסימה בסיום ההרשמה: דילגה, מילאה, ונעצרת לפני דריסה */
try {
  const c = await ctxWith({}); const p = await c.newPage();
  await p.goto(BASE, { waitUntil: "domcontentloaded" }); await p.waitForTimeout(3600);
  await p.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important}" }).catch(() => {});
  const had = (await seeRestore(p)) > 0;
  await p.locator("text=התחלה מחדש (בלי שחזור)").click(); await p.waitForTimeout(700);
  ok("אחרי דילוג היא מגיעה להרשמה", had && (await seeReg(p)) > 0);
  await c.close();
} catch (e) { ok("התרחיש עצמו נפל: " + String(e.message).slice(0,60), false); }
console.log(`\nסה"כ: ${pass} עוברים, ${fail} נכשלים`);
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
