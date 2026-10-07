// דף התשלום (pay/) בדפדפן אמיתי. קארדקום מדומה: "טופס התשלום" במסגרת הוא דף
// שלנו שמפנה מיד לדף ההצלחה או לדף הכישלון, בדיוק כמו שקארדקום עושה בסוף עסקה.
//
// node qa/e2e/pay.mjs
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { chromium } from "playwright-core";

const ROOT = new URL("../../pay/", import.meta.url);
const types = { html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8" };
let creates = [], nextOutcome = "fail";

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/api/product") {
    const p = u.searchParams.get("p");
    if (p !== "smart-p261") { res.writeHead(404); return res.end("{}"); }
    const { PRODUCTS } = cache;
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ slug: "smart-p261", ...PRODUCTS["smart-p261"], thankYouUrl: `http://127.0.0.1:${port}/thanks` }));
  }
  if (u.pathname === "/api/create") {
    let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
      creates.push(JSON.parse(b));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ url: `/fake-cardcom?o=${nextOutcome}` }));
    });
    return;
  }
  if (u.pathname === "/fake-cardcom") {
    const to = u.searchParams.get("o") === "ok" ? "/done?p=smart-p261" : "/fail?p=smart-p261";
    res.writeHead(200, { "Content-Type": types.html });
    return res.end(`<!doctype html><p>cardcom</p><script>setTimeout(()=>location.href=${JSON.stringify(to)},300)</script>`);
  }
  if (u.pathname === "/thanks") { res.writeHead(200, { "Content-Type": types.html }); return res.end("<h1>THANKYOU</h1>"); }
  if (u.pathname === "/host") {
    res.writeHead(200, { "Content-Type": types.html });
    return res.end(`<!doctype html><h1>SITE</h1><iframe src="/smart-P261" style="width:100%;height:2400px;border:0"></iframe>`);
  }
  let f = u.pathname === "/" ? "/index.html" : u.pathname;
  if (/^\/[A-Za-z0-9-]+$/.test(f)) f = existsSync(new URL("." + f + ".html", ROOT)) ? f + ".html" : "/index.html";
  const file = new URL("." + f, ROOT);
  if (!existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": types[f.split(".").pop()] || "text/plain" });
  res.end(readFileSync(file));
});
const cache = await import("../../pay/lib/products.js");
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.log("✗", n); } };

const browser = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium" }).catch(() => chromium.launch());
const errors = [];

async function fill(page, extra = {}) {
  await page.fill("#fn", "רונית"); await page.fill("#ln", "כהן");
  await page.fill("#phone", "050-1234567"); await page.fill("#email", "ronit@gmail.com");
  await page.fill("#tz", "000000018");
  if (extra.mkt !== false) await page.check("#mkt");
  await page.check("#terms");
}

for (const [label, vp] of [["phone", { width: 390, height: 844 }], ["desktop", { width: 1280, height: 900 }]]) {
  const page = await browser.newPage({ viewport: vp });
  const before = creates.length;
  page.on("pageerror", (e) => errors.push(`${label}: ${e.message}`));
  await page.goto(`${base}/smart-P261`);
  await page.waitForSelector("#page:not([hidden])");
  ok((await page.textContent("#title")).includes("הרשמה לתכנית מיי פריים סמארט"), `${label}: הכותרת של רון`);
  ok((await page.textContent("#total")).trim() === "590 ₪", `${label}: המחיר`);
  ok((await page.locator("#bullets li").count()) === 4, `${label}: ארבעת הסעיפים`);
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label}: אין גלילה לצדדים`);
  if (label === "desktop") {
    const [a, m] = await Promise.all([page.locator(".aside").boundingBox(), page.locator(".main").boundingBox()]);
    ok(a.x < m.x, "desktop: הסיכום משמאל לטופס");
  }

  await page.click("#go");
  ok((await page.textContent("#err")).startsWith("כדי להמשיך חסר:"), `${label}: טופס ריק נעצר`);
  await fill(page, { mkt: false });
  await page.click("#go");
  ok((await page.textContent("#err")).trim() === "כדי להמשיך חסר: אישור הדיוור", `${label}: בלי דיוור`);
  ok(creates.length === before, `${label}: לא נוצר דף תשלום לפני שהכל מולא`);

  ok((await page.textContent("#per")).trim() === "590 ₪", `${label}: סיכום התשלומים מתחיל בתשלום אחד`);
  await page.selectOption("#np", "3");
  ok((await page.textContent("#per")).trim() === "196.67 ₪" && (await page.textContent("#kind")).includes("קרדיט"), `${label}: 3 תשלומים: 196.67 ₪, תשלומי קרדיט`);
  await page.selectOption("#np", "2");
  ok((await page.textContent("#per")).trim() === "295 ₪" && !(await page.textContent("#kind")), `${label}: 2 תשלומים: 295 ₪, בלי קרדיט`);
  await page.selectOption("#np", "3");

  await page.check("#bizOn");
  ok(await page.isVisible("#bn"), `${label}: חשבונית עסקית פותחת שדות`);
  await page.uncheck("#bizOn");

  // ניסיון שנכשל, ואז ניסיון חוזר שמצליח
  await page.check("#mkt");
  nextOutcome = "fail";
  await page.click("#go");
  await page.waitForSelector("#payErr:not([hidden])", { timeout: 5000 }).catch(() => {});
  ok(await page.isVisible("#payErr") && await page.isVisible("#retry"), `${label}: תשלום שנכשל מציג "לנסות שוב"`);
  ok(await page.isHidden("#frame"), `${label}: המסגרת נסגרת אחרי כישלון`);
  ok(await page.isDisabled("#email"), `${label}: הפרטים נעולים בזמן התשלום`);
  ok(creates.at(-1).email === "ronit@gmail.com" && creates.at(-1).mkt === true && creates.at(-1).payments === 3, `${label}: הפרטים ומספר התשלומים נשלחו לשרת`);
  ok(await page.isDisabled("#np"), `${label}: מספר התשלומים נעול בזמן התשלום`);

  nextOutcome = "ok";
  const n = creates.length;
  await page.click("#retry");
  await page.waitForURL(/\/thanks$/, { timeout: 8000 }).catch(() => {});
  ok(creates.length === n + 1, `${label}: ניסיון חוזר יוצר דף תשלום חדש`);
  ok(page.url().endsWith("/thanks"), `${label}: אחרי תשלום כל הדף עובר לדף התודה, ולא רק המסגרת`);
  await page.close();
}

// משובץ באתר אחר: דף התודה תופס את כל החלון
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${base}/host`);
  const fr = page.frameLocator("iframe");
  await fr.locator("#page:not([hidden])").waitFor();
  await fr.locator("#fn").fill("רונית"); await fr.locator("#ln").fill("כהן");
  await fr.locator("#phone").fill("0501234567"); await fr.locator("#email").fill("r@gmail.com");
  await fr.locator("#tz").fill("000000018"); await fr.locator("#mkt").check(); await fr.locator("#terms").check();
  nextOutcome = "ok";
  await fr.locator("#go").click();
  await page.waitForURL(/\/thanks$/, { timeout: 8000 }).catch(() => {});
  ok(page.url().endsWith("/thanks"), "משובץ באתר: דף התודה נפתח בחלון כולו");
  await page.close();
}

{
  const page = await browser.newPage();
  await page.goto(`${base}/nope`);
  await page.waitForSelector("#nf:not([hidden])");
  ok(true, "מוצר שלא קיים: הדף אומר שאינו קיים");
  await page.close();
}

ok(errors.length === 0, "בלי שגיאות ריצה: " + errors.join(" | "));
await browser.close();
server.close();
console.log(`${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
