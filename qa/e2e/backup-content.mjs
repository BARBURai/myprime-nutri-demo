// v7.75: סימוני הסרטונים עוברים בגיבוי המוצפן ממכשיר למכשיר, בדפדפן אמיתי.
// מכשיר א מעלה גיבוי אמיתי (מוצפן באמת), והבדיקה תופסת אותו. מכשיר ב נקי
// מקבל אותו בחזרה, היא מקלידה את הקוד, ובודקים שהווים חזרו. בלי רשת חיצונית.
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
const ok = (n, c, extra) => { console.log(`${c ? "עובר " : "נכשל "}| ${n}` + (!c && extra !== undefined ? "  → " + extra : "")); c ? pass++ : fail++; };
const UA = "Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36";
const CODE = "TEST-CODE";
const DONE = JSON.stringify({ "w1d1-0": true, "w1d2-1": true });
const FAV = JSON.stringify({ "w1d2-1": true });
const VIEWS = JSON.stringify({ "w1d1-0": 2 });

let uploaded = null;
async function ctx(getBlob) {
  const c = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, locale: "he-IL", timezoneId: "Asia/Jerusalem", userAgent: UA });
  await c.route("**/api/**", async (route) => {
    const req = route.request(); const url = req.url();
    const json = (b) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
    if (url.includes("/api/backup")) {
      if (req.method() === "POST") { try { const b = JSON.parse(req.postData() || "{}"); if (b.blob) uploaded = b.blob; } catch (e) {} return json({ ok: true }); }
      const blob = getBlob(); return json(blob ? { ok: true, exists: true, blob } : { ok: true, exists: false });
    }
    if (url.includes("/api/access")) return json({ allowed: true, name: "איריס", startDate: start });
    return json({ ok: true });
  });
  await c.addInitScript(() => { localStorage.setItem("myprime_access_email", "a@b.com"); localStorage.setItem("myprime_access_name", "איריס"); localStorage.setItem("myprime_install_ack", "1"); });
  return c;
}

try {
  /* מכשיר א: אישה בתוכנית, עם גיבוי פעיל ועם וי על שני סרטונים */
  const a = await ctx(() => null);
  await a.addInitScript(({ sd, DONE, FAV, VIEWS, CODE }) => {
    if (localStorage.getItem("qa_seeded")) return;
    localStorage.setItem("qa_seeded", "1");
    localStorage.setItem("myprime_demo_state_v1", JSON.stringify({
      onboarded: true,
      profile: { age: 52, heightCm: 165, weightKg: 72, activity: "יושבני", weeklyRateG: 250, goalWeightKg: 66, startDate: sd, name: "איריס", tipsSeen: ["cal","steps","tracker","cabinet","trackerfill","stepbaseline","water","protein","weeklysummary","notifyAsked"], cupMl: 250, diet: [], allergies: [], backup: { enabled: true, email: "a@b.com" } },
      log: [{ id: 1, date: sd, name: "יוגורט", kcal: 120 }], weights: [], activityLog: [], waterByDate: {}, stepsByDate: {}, favorites: [], recents: [], checkins: {}, goalAckWeek: 99,
    }));
    localStorage.setItem("myprime_bk_code", CODE);
    localStorage.setItem("mp_content_done_v1", DONE);
    localStorage.setItem("mp_content_fav_v1", FAV);
    localStorage.setItem("mp_content_views_v1", VIEWS);
  }, { sd: start, DONE, FAV, VIEWS, CODE });
  const pa = await a.newPage();
  await pa.goto(BASE, { waitUntil: "domcontentloaded" }); await pa.waitForTimeout(3600);
  // היא יוצאת מהאפליקציה: זה מה שמריץ את הגיבוי מיד ולא אחרי 12 שניות.
  await pa.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  for (let i = 0; i < 40 && !uploaded; i++) await pa.waitForTimeout(250);
  ok("מכשיר א העלה גיבוי מוצפן", !!uploaded);
  ok("הגיבוי מוצפן ואין בו את הווים כטקסט גלוי", !!uploaded && !JSON.stringify(uploaded).includes("w1d1-0"));
  await a.close();

  /* מכשיר ב: נקי לגמרי, השרת מחזיר את הגיבוי שנתפס */
  const b = await ctx(() => uploaded);
  const pb = await b.newPage();
  await pb.goto(BASE, { waitUntil: "domcontentloaded" }); await pb.waitForTimeout(3600);
  await pb.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important}" }).catch(() => {});
  ok("במכשיר הנקי מסך השחזור מגיע", (await pb.locator("text=מצאנו גיבוי מוצפן").count()) > 0);
  const inputs = await pb.locator("input").evaluateAll((els) => els.map((e, i) => ((e.style.webkitTextSecurity || "") === "disc" ? i : -1)).filter((i) => i >= 0));
  await pb.locator("input").nth(inputs[0]).fill(CODE);
  await Promise.all([pb.waitForNavigation({ timeout: 15000 }).catch(() => {}), pb.locator("text=שחזרי את הנתונים").click()]);
  await pb.waitForTimeout(3600);
  const got = await pb.evaluate(() => ({ done: localStorage.getItem("mp_content_done_v1"), fav: localStorage.getItem("mp_content_fav_v1"), views: localStorage.getItem("mp_content_views_v1"), st: localStorage.getItem("myprime_demo_state_v1") }));
  ok("**הווים על הסרטונים חזרו**", got.done === DONE, got.done);
  ok("המועדפים חזרו", got.fav === FAV, got.fav);
  ok("מונה הצפיות חזר", got.views === VIEWS, got.views);
  let st = null; try { st = JSON.parse(got.st); } catch (e) {}
  ok("היומן חזר", !!st && st.onboarded === true && Array.isArray(st.log) && st.log.length === 1);
  ok("ובמצב האפליקציה לא נשאר _content", !!st && !("_content" in st));
  ok("והיא באפליקציה ולא בהרשמה", (await pb.locator("text=נעים להכיר").count()) === 0 && (await pb.locator("text=מצאנו גיבוי מוצפן").count()) === 0);
  await b.close();
} catch (e) { ok("התרחיש עצמו נפל: " + String(e.message).slice(0, 80), false); }

/* אחסון קבוע: האפליקציה מבקשת אותו פעם אחת בטעינה, ובפיירפוקס לא */
async function persistCalls(ua) {
  const c = await browser.newContext({ viewport: { width: 360, height: 800 }, locale: "he-IL", timezoneId: "Asia/Jerusalem", userAgent: ua });
  await c.route("**/api/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ allowed: true, name: "איריס", startDate: start, ok: true }) }));
  await c.addInitScript(() => {
    window.__persist = 0;
    try { const st = navigator.storage; st.persisted = () => Promise.resolve(false); st.persist = () => { window.__persist++; return Promise.resolve(true); }; } catch (e) {}
  });
  const p = await c.newPage(); await p.goto(BASE, { waitUntil: "domcontentloaded" }); await p.waitForTimeout(2500);
  const n = await p.evaluate(() => window.__persist); await c.close(); return n;
}
try {
  const n = await persistCalls(UA);
  ok("**כרום באנדרואיד: האפליקציה מבקשת אחסון קבוע**", n >= 1, n);
  const f = await persistCalls("Mozilla/5.0 (Android 13; Mobile; rv:120.0) Gecko/120.0 Firefox/120.0");
  ok("פיירפוקס: לא מבקשת, כי שם זו חלונית", f === 0, f);
} catch (e) { ok("התרחיש עצמו נפל: " + String(e.message).slice(0, 80), false); }

console.log(`\nסה"כ: ${pass} עוברים, ${fail} נכשלים`);
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
