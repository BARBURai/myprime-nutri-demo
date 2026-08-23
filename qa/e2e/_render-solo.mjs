import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { chromium } from "playwright-core";
const DIR = "/home/user/myprime-nutri-demo/qa/shots/solo";
const MIME = { ".html": "text/html", ".jpg": "image/jpeg", ".png": "image/png", ".css": "text/css", ".js": "text/javascript", ".ico": "image/x-icon" };
const server = createServer((req, res) => {
  const p = decodeURIComponent((req.url || "/").split("?")[0]);
  let f = join(DIR, p === "/" ? "index.html" : p);
  if (!existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); return res.end(""); }
  res.writeHead(200, { "content-type": MIME[extname(f)] || "application/octet-stream" });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
for (const [name, vp, dpr] of [["mobile", { width: 390, height: 844 }, 2], ["desktop", { width: 1280, height: 900 }, 1]]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: dpr, locale: "he-IL", isMobile: name === "mobile", hasTouch: name === "mobile" });
  await ctx.route("**", (route) => {
    const u = route.request().url();
    if (u.startsWith("http://127.0.0.1")) return route.continue();
    if (u.includes("fonts.googleapis.com") || u.includes("fonts.gstatic.com")) return route.continue();
    return route.abort();
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important}" });
  await page.evaluate(() => document.querySelectorAll(".rv").forEach((e) => e.classList.add("in")));
  await page.locator("#demo").scrollIntoViewIfNeeded();
  await page.waitForTimeout(900);
  await page.locator("#demo").screenshot({ path: `/home/user/myprime-nutri-demo/qa/shots/solo/_preview-${name}.png` });
  console.log("preview", name, await page.evaluate(() => getComputedStyle(document.body).fontFamily));
  await ctx.close();
}
await browser.close(); server.close();
