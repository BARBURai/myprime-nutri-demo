// v8.43: מסך לבן כשהטלפון מחזיר מהזיכרון דף מלפני העלאה, שמבקש קובץ קוד שכבר נמחק.
// השרת כאן מחזיר 404 לקובץ שאינו קיים, כמו וורסל. בדפדפן אמיתי ובלי רשת חיצונית.
// 1. דף ישן פעם אחת ואז רגיל: האפליקציה נפתחת, ובדיוק טעינה חוזרת אחת.
// 2. דף ישן תמיד: לא נכנסים ללולאה, לכל היותר טעינה חוזרת אחת.
// 3. דף רגיל: אף טעינה חוזרת.
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { chromium } from "playwright-core";
const DIST = new URL("../../dist", import.meta.url).pathname;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".jpg": "image/jpeg" };
const INDEX = readFileSync(join(DIST, "index.html"), "utf8");
const STALE = INDEX.replace(/\/assets\/index-[^"]+\.js/, "/assets/index-OLD00000.js");
let mode = "fresh", served = 0;
const server = createServer((q, s) => {
  const path = decodeURIComponent((q.url || "/").split("?")[0]);
  if (path.startsWith("/assets/") || path.startsWith("/api/")) {
    const f = join(DIST, path);
    if (path.startsWith("/api/")) { s.writeHead(200, { "content-type": "application/json" }); return s.end(JSON.stringify({ allowed: true, name: "בדיקה", startDate: "2026-10-25" })); }
    if (!existsSync(f) || statSync(f).isDirectory()) { s.writeHead(404); return s.end("not found"); }
    s.writeHead(200, { "content-type": MIME[extname(f)] || "application/octet-stream" }); return s.end(readFileSync(f));
  }
  const f = join(DIST, path);
  if (path !== "/" && existsSync(f) && !statSync(f).isDirectory()) { s.writeHead(200, { "content-type": MIME[extname(f)] || "application/octet-stream" }); return s.end(readFileSync(f)); }
  served++;
  const stale = mode === "always" || (mode === "once" && served === 1);
  s.writeHead(200, { "content-type": "text/html" }); s.end(stale ? STALE : INDEX);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
let pass = 0, fail = 0;
const ok = (n, c, extra) => { console.log(`${c ? "עובר " : "נכשל "}| ${n}` + (!c && extra !== undefined ? "  → " + extra : "")); c ? pass++ : fail++; };

async function run(m) {
  mode = m; served = 0;
  const c = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, locale: "he-IL", timezoneId: "Asia/Jerusalem" });
  await c.addInitScript(() => { localStorage.setItem("myprime_access_email", "a@b.com"); localStorage.setItem("myprime_access_name", "בדיקה"); localStorage.setItem("myprime_install_ack", "1"); });
  const p = await c.newPage();
  await p.goto(BASE, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(4000);
  const kids = await p.evaluate(() => document.getElementById("root") ? document.getElementById("root").childElementCount : -1).catch(() => -2);
  const loads = served;
  await c.close();
  return { kids, loads };
}

try {
  const a = await run("once");
  ok("דף ישן ואז רגיל: האפליקציה נפתחת", a.kids > 0, JSON.stringify(a));
  ok("דף ישן ואז רגיל: טעינה חוזרת אחת בדיוק", a.loads === 2, JSON.stringify(a));
  const b = await run("always");
  ok("דף ישן תמיד: אין לולאה", b.loads <= 2, JSON.stringify(b));
  const n = await run("fresh");
  ok("דף רגיל: נפתח", n.kids > 0, JSON.stringify(n));
  ok("דף רגיל: אין טעינה חוזרת", n.loads === 1, JSON.stringify(n));
} finally { await browser.close(); server.close(); }
console.log(`\n${pass} מתוך ${pass + fail} עברו.`);
process.exit(fail ? 1 : 0);
