#!/usr/bin/env node
// המיקרופון שנכשל בשקט, וסוג המכשיר בכרטיס במסך הניהול. v8.34. בלי רשת.
//
//   node qa/mic-device-check.mjs
//
// **המיקרופון.** 21.10.2026, משתתפת באנדרואיד: "לא מצליחה להפעיל את המקרופון, למרות
// שפעלתי לפי ההוראות". כשזיהוי הדיבור נכשל האפליקציה רק כיבתה את מצב ההקשבה, והיא ראתה
// כפתור שלא עושה כלום. **סוג המכשיר.** רון: "אני שואל אותה במהלך ההתקנה איזה טלפון יש
// לה". האפליקציה ידעה וזרקה, ועכשיו זה נשלח עם נתוני השימוש ומוצג בכרטיס.
//
// הפונקציות נמשכות מ-`src/App.jsx` ומ-`public/admin.html` לפי מחרוזת ומורצות, ו-
// `api/usage.js` האמיתי רץ מול Redis מדומה.

import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const html = readFileSync(new URL("../public/admin.html", import.meta.url), "utf8");
const kb = readFileSync(new URL("../api/_kb.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (extra != null ? "  ← " + extra : "")); } };
const grab = (src, from, end = "\n}\n") => {
  const a = src.indexOf(from), b = src.indexOf(end, a);
  if (a < 0 || b < 0) { console.log("✗ לא נמצא בקוד: " + from); process.exit(1); }
  return src.slice(a, b + end.length);
};

const A = new Function(
  grab(app, "const MIC_ERR_TEXT = {", "\n};\n") + grab(app, "function micErrKind(") + grab(app, "function deviceOf(") +
  "return { MIC_ERR_TEXT, micErrKind, deviceOf };")();

console.log("\nהמיקרופון: מה שהדפדפן אומר, ומה שהיא רואה");
check("אין הרשאה: חסום", A.micErrKind("not-allowed") === "blocked");
check("שירות הדיבור חסום: חסום", A.micErrKind("service-not-allowed") === "blocked");
check("אין מיקרופון זמין: חסום", A.micErrKind("audio-capture") === "blocked");
check("לא נשמע דיבור", A.micErrKind("no-speech") === "nospeech");
check("רשת: תקלה אחרת", A.micErrKind("network") === "other");
check("שגיאה לא מוכרת: תקלה אחרת", A.micErrKind("whatever") === "other" && A.micErrKind(undefined) === "other");
check("**עצירה שלה אינה תקלה**", A.micErrKind("aborted") === null);

console.log("\nהנוסחים, מילה במילה כפי שאושרו");
check("חסום", A.MIC_ERR_TEXT.blocked === "המיקרופון חסום.");
check("לא נשמע", A.MIC_ERR_TEXT.nospeech === "לא נשמע דיבור. אפשר לנסות שוב.");
check("תקלה אחרת", A.MIC_ERR_TEXT.other === "זיהוי הדיבור לא עבד הפעם. אפשר לנסות שוב, או להקליד.");
check("לא נתמך", A.MIC_ERR_TEXT.unsupported === "זיהוי דיבור לא נתמך בדפדפן הזה.");
check("הקישור, בנוסח של רון", app.includes(">מעבר להנחיות</span>"));
check("הקישור רק בחסום ובלא נתמך", app.includes('(aiMicErr === "blocked" || aiMicErr === "unsupported") && <>'));
check("**החלונית הקופצת הישנה ירדה**", !app.includes('alert("זיהוי דיבור לא נתמך'));
check("קול המערכת: בלי ענת ובלי אמוג'י", !/ענת|[\u{1F300}-\u{1FAFF}]/u.test(Object.values(A.MIC_ERR_TEXT).join(" ")));

console.log("\nהשורה מתחלפת וחוזרת");
check("בהקשה הבאה על המיקרופון השורה מתאפסת", grab(app, "const startMic = () => {", "\n  };\n").includes("setAiMicErr(null);"));
check("כשמתחילה להקליד השורה מתאפסת", app.includes("setAiInput(e.target.value); if (aiMicErr) setAiMicErr(null);"));
check("ההנחיה הרגילה מוסתרת בזמן השורה", app.includes("{!kbOpen && !aiMicErr && <div"));
check("**כפתור החזרה של הטלפון סוגר את ההנחיות ולא את השיחה**", app.includes("if (micHelp) { setMicHelp(false); return true; }"));

console.log("\nהתשובה בשאלות ותשובות, ואותה אחת בחלונית");
const faq = new Function("return " + grab(app, "const FAQ_ITEMS = [", "\n];\n").replace("const FAQ_ITEMS = ", "").replace(/;\n$/, ""))();
const mic = faq.find((f) => f.key === "mic");
check("השאלה קיימת עם המפתח", !!mic && mic.q === "המיקרופון לא עובד, מה עושים?");
check("המיקרופון של המקלדת קודם", !!mic && mic.a.startsWith("הדרך הכי פשוטה: מקישים על שדה הכתיבה, ואז על סמל המיקרופון שבמקלדת של הטלפון"));
check("אנדרואיד ואייפון", !!mic && mic.a.includes("באנדרואיד: פותחים את Chrome") && mic.a.includes("באייפון: נכנסים בהגדרות הטלפון ל-Safari"));
check("החלונית קוראת את אותה תשובה ולא עותק", app.includes('FAQ_ITEMS.find((x) => x.key === "mic")'));
check("ובמאגר הידע של 'נסחי לי תשובה'", kb.includes("המיקרופון ב\"ספרי לי מה אכלת\" לא עובד"));

console.log("\nסוג המכשיר");
const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iphoneApp: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1",
  iphoneFb: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0]",
  ipadOs: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  android: "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  samsung: "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
  webview: "Mozilla/5.0 (Linux; Android 14; SM-S918B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36",
  win: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
};
const eq = (d, dev, br) => d.dev === dev && d.br === br;
check("אייפון בספארי", eq(A.deviceOf(UA.iphone, 0, 5), "iphone", "safari"));
check("**אייפון מותקנת, בלי Version/: ספארי ולא דפדפן פנימי**", eq(A.deviceOf(UA.iphoneApp, 1, 5), "iphone", "safari"));
check("אותה זהות בלי התקנה: דפדפן פנימי", eq(A.deviceOf(UA.iphoneApp, 0, 5), "iphone", "inapp"));
check("אייפון בכרום", eq(A.deviceOf(UA.iphoneChrome, 0, 5), "iphone", "chrome"));
check("אייפון בפייסבוק", eq(A.deviceOf(UA.iphoneFb, 0, 5), "iphone", "inapp"));
check("אייפד שמציג את עצמו כמק", eq(A.deviceOf(UA.ipadOs, 0, 5), "ipad", "safari"));
check("אנדרואיד בכרום", eq(A.deviceOf(UA.android, 0, 5), "android", "chrome"));
check("אנדרואיד בדפדפן סמסונג", eq(A.deviceOf(UA.samsung, 0, 5), "android", "samsung"));
check("אנדרואיד בתוך אפליקציה", eq(A.deviceOf(UA.webview, 0, 5), "android", "inapp"));
check("מחשב בכרום", eq(A.deviceOf(UA.win, 0, 0), "desktop", "chrome"));
check("מחשב ב-Edge", eq(A.deviceOf(UA.edge, 0, 0), "desktop", "edge"));
check("מק בספארי, בלי מגע", eq(A.deviceOf(UA.mac, 0, 0), "desktop", "safari"));
check("אין זהות בכלל", eq(A.deviceOf("", 0, 0), "desktop", "other"));
check("נשלח עם נתוני השימוש", app.includes('dev: device.dev || "", br: device.br || ""'));

console.log("\nהשרת שומר רק קודים מהרשימה");
const written = {};
process.env.UPSTASH_REDIS_REST_URL = "http://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";
globalThis.fetch = async (url) => {
  const parts = String(url).replace("http://redis.test/", "").split("/").map(decodeURIComponent);
  if (parts[0] === "HSET") { written[parts[1]] = written[parts[1]] || {}; written[parts[1]][parts[2]] = parts[3]; return { ok: true, json: async () => ({ result: 1 }) }; }
  return { ok: true, json: async () => ({ result: null }) };
};
const { default: handler } = await import("../api/usage.js");
const res = () => { const r = {}; r.status = () => r; r.json = () => r; r.setHeader = () => {}; r.end = () => r; return r; };
const post = async (body) => handler({ method: "POST", body }, res());
const BASE = { email: "a@test.com", days: {}, videosDone: 1, videosTotal: 2, views: 0, trackerDays: 3, standalone: 1 };
await post({ ...BASE, dev: "android", br: "samsung" });
let rec = JSON.parse(written["admin:usage"]["a@test.com"]);
check("אנדרואיד ודפדפן סמסונג נשמרים", rec.dev === "android" && rec.br === "samsung");
await post({ ...BASE, dev: "<script>", br: "Mozilla/5.0 (iPhone...)" });
rec = JSON.parse(written["admin:usage"]["a@test.com"]);
check("**זהות דפדפן מלאה או זבל אינם נשמרים**", rec.dev === "" && rec.br === "");
await post({ ...BASE });
rec = JSON.parse(written["admin:usage"]["a@test.com"]);
check("גרסה ישנה בלי השדות: ריק, והשאר כרגיל", rec.dev === "" && rec.br === "" && rec.standalone === 1);

console.log("\nבמסך הניהול");
const helpers = "function esc(s){return String(s==null?'':s);}";
const entryOf = new Function(helpers + grab(html, "  function entryOf(w){", "\n  }\n") + "return entryOf;")();
check("השורה המלאה", entryOf({ usage: { standalone: 1, dev: "android", br: "chrome" } }) === "אנדרואיד · Chrome · אפליקציה מותקנת", entryOf({ usage: { standalone: 1, dev: "android", br: "chrome" } }));
check("אייפון בדפדפן", entryOf({ usage: { standalone: 0, dev: "iphone", br: "safari" } }) === "אייפון · Safari · דפדפן, לא מותקנת");
check("דפדפן בתוך אפליקציה אחרת", entryOf({ usage: { standalone: 0, dev: "iphone", br: "inapp" } }) === "אייפון · דפדפן בתוך אפליקציה אחרת · דפדפן, לא מותקנת");
check("**מי שלא פתחה מאז: השורה כמו קודם**", entryOf({ usage: { standalone: 1 } }) === "אפליקציה מותקנת");
check("דפדפן 'אחר' אינו מוצג כמילה", entryOf({ usage: { standalone: 0, dev: "desktop", br: "other" } }) === "מחשב · דפדפן, לא מותקנת");
check("בלי נתונים: לא ידוע עדיין", entryOf({}) === "לא ידוע עדיין");

console.log(`\n${pass} מתוך ${pass + fail} עברו.\n`);
process.exit(fail ? 1 : 0);
