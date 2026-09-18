// שאלה שהגיעה מחוץ לאפליקציה, בוואטסאפ או במייל. בקשה של רון, 17 בספטמבר 2026:
// "לא אמורה להיות אפשרות לכתוב הערה בעצמי, כמו מה שביקשתי להעתיק ממייל או מוואטסאפ
// שמישהי שלחה, ולקבל תשובה מה-AI? וגם שתהיה אפשרות לחזור אליה דרך הממשק."
//
// **מה שכבר היה:** הניסוח בשרת מקבל טקסט חופשי ואינו דורש שההערה תגיע מהאפליקציה.
// מה שחסר היה המסך, ומסלול אחד שרושם את השאלה ואת התשובה יחד.
//
// **וזה מה שהבדיקה נועלת, כי זה מה שיכול להישבר בשקט:**
//   1. ההערה נולדת **עם** תשובה ולכן לעולם אינה נוחתת בתור כממתינה.
//   2. המונה `notes:pending` אינו זז, אחרת האריח היה מציג מספר שגוי.
//   3. שום דבר אינו נכתב למניצ'ט ואינו נוגע ברשומה שקובעת גישה.
//   4. והאישה באמת מקבלת את התשובה בפתיחה הבאה שלה.
//
//   node qa/outside-note-check.mjs

import adminHandler from "../api/admin.js";
import accessHandler from "../api/access.js";
import { readFileSync } from "node:fs";

const KEY = "k-test";
process.env.ADMIN_KEY = KEY;
process.env.ACCESS_SHEET_CSV_URL = "https://sheet.test/csv";
process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";
process.env.MANYCHAT_TOKEN = "mc-test";

const EM = "dana@test.com";
const sunday = (() => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 7) % 7) - 7);
  return d.toISOString().slice(0, 10);
})();
const CSV = [
  "ID,F_NAME,L_NAME,CF_EMAIL,360 - FINAL  PERSONAL START,ביטלה,קבוצה",
  `972500000001,דנה,כהן,${EM},${sunday} 0:00:00,,א`,
].join("\n");

const store = { hash: {}, kv: {}, list: {} };
const MC = { calls: 0 };

globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith("https://sheet.test")) return { ok: true, text: async () => CSV };
  // כל קריאה למניצ'ט נספרת. הבדיקה נופלת אם יצאה ולו אחת, בדיוק כמו בהוספת משתתפת.
  if (u.startsWith("https://api.manychat.com")) {
    MC.calls++;
    return { ok: true, json: async () => ({ status: "success", data: { id: 1, custom_fields: [], tags: [] } }) };
  }
  const parts = u.replace("https://redis.test/", "").split("/").map(decodeURIComponent);
  const [cmd, a, b, c] = parts;
  const H = (k) => (store.hash[k] = store.hash[k] || {});
  let result = null;
  if (cmd === "HSET") { H(a)[b] = c; result = 1; }
  else if (cmd === "HGET") result = H(a)[b] ?? null;
  else if (cmd === "HDEL") { delete H(a)[b]; result = 1; }
  else if (cmd === "HGETALL") { const o = H(a); result = Object.keys(o).flatMap((k) => [k, o[k]]); }
  else if (cmd === "KEYS") { const pre = String(a).replace(/\*$/, ""); result = Object.keys(store.kv).filter((k) => k.startsWith(pre)); }
  else if (cmd === "SET") { store.kv[a] = b; result = "OK"; }
  else if (cmd === "GET") result = store.kv[a] ?? null;
  else if (cmd === "DEL") { delete store.kv[a]; result = 1; }
  else if (cmd === "HINCRBY") { const h = H(a); h[b] = String((parseInt(h[b], 10) || 0) + parseInt(c, 10)); result = Number(h[b]); }
  else if (cmd === "LPUSH") { store.list[a] = store.list[a] || []; store.list[a].unshift(c ?? b); result = store.list[a].length; }
  else if (cmd === "LTRIM") { const L = store.list[a] || []; store.list[a] = L.slice(Number(b), Number(c) + 1); result = "OK"; }
  else if (cmd === "LRANGE") { const L = store.list[a] || []; result = L.slice(Number(b), Number(c) + 1); }
  else result = 0;
  if (cmd === "ZRANGE" || cmd === "ZREVRANGE") result = [];
  return { ok: true, json: async () => ({ result }) };
};

function mkRes() {
  const r = { code: 0, body: null };
  r.status = (x) => { r.code = x; return r; };
  r.json = (x) => { r.body = x; return r; };
  return r;
}
const post = async (body) => {
  const res = mkRes();
  await adminHandler({ query: { key: KEY }, method: "POST", body }, res);
  return res;
};
const openApp = async (email) => {
  const res = mkRes();
  await accessHandler({ query: { email, device: "d1" }, method: "GET" }, res);
  return res;
};

let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (extra ? "  → " + extra : "")); } };

const ASK = "אכלתי יוגורט והחלבון יצא נמוך, זה נראה לי לא נכון";
const ANS = "הערכים של המוצר הזה מגיעים ממאגר כללי. סריקת הברקוד תיתן את המספרים שעל האריזה.";

console.log("\nהשאלה נרשמת ונענית באותה פעולה");
{
  const before = { ...(store.hash["notes:pending"] || {}) };
  const r = await post({ email: EM, by: "טלי", outside: { text: ASK, answer: ANS, via: "וואטסאפ" } });
  check("הפעולה מצליחה", r.code === 200 && r.body && r.body.ok === true, JSON.stringify(r.body));

  const notes = (store.list["notes:" + EM] || []).map((x) => JSON.parse(x));
  check("ההערה נכתבה תחת הכתובת שלה", notes.length === 1, "נמצאו " + notes.length);
  check("עם הטקסט שהודבק, כלשונו", !!notes[0] && notes[0].text === ASK);
  check('ומסומנת שהיא הגיעה מוואטסאפ', notes[0] && notes[0].screen === "וואטסאפ");

  const reps = JSON.parse((store.hash["notes:replies"] || {})[EM] || "[]");
  check("והתשובה נרשמה מולה", reps.length === 1 && reps[0].to === notes[0].id);
  check("עם הטקסט שנשלח", reps[0] && reps[0].text === ANS);
  check("ועם השם של מי שענתה", reps[0] && reps[0].by === "טלי");

  // זה הלב: הערה שנולדה עם תשובה מעולם לא הייתה ממתינה, ולכן האריח אינו זז.
  const after = store.hash["notes:pending"] || {};
  check("המונה של הממתינות לא זז", String(after[EM] || "0") === String(before[EM] || "0"),
    "היה " + (before[EM] || 0) + " ועכשיו " + (after[EM] || 0));
  check("ושום דבר לא נכתב למניצ'ט", MC.calls === 0, MC.calls + " קריאות");
  check("ורשומת הגישה שלה לא נגעה", !(store.hash["admin:overrides"] || {})[EM]);
}

console.log("\nוהיא באמת מקבלת את התשובה באפליקציה");
{
  const r = await openApp(EM);
  const reps = (r.body && r.body.replies) || [];
  check("השער מחזיר לה את התשובה בפתיחה הבאה", reps.length === 1, JSON.stringify(reps));
  check("והיא בדיוק מה שנשלח", reps[0] && reps[0].text === ANS);
}

console.log("\nמה שנדחה, ולמה");
{
  // הערה בלי תשובה הייתה נוחתת בתור כממתינה, וזו בדיוק העבודה שהמסך בא לחסוך.
  const a = await post({ email: EM, by: "טלי", outside: { text: ASK, answer: "" } });
  check("שאלה בלי תשובה נדחית", a.code === 400 && a.body.error === "no_text");
  const b = await post({ email: EM, by: "טלי", outside: { text: "", answer: ANS } });
  check("ותשובה בלי שאלה נדחית", b.code === 400 && b.body.error === "no_text");
  const c = await post({ email: "לא-מייל", by: "טלי", outside: { text: ASK, answer: ANS } });
  check("וכתובת שאינה מייל נדחית", c.code === 400 && c.body.error === "bad_email");
  check("ורשומה נוספת לא נוצרה מהנסיונות שנדחו", (store.list["notes:" + EM] || []).length === 1,
    "יש " + (store.list["notes:" + EM] || []).length);
}

console.log("\nהמסך עצמו");
{
  const html = readFileSync(new URL("../public/admin.html", import.meta.url), "utf8");
  check("הכפתור קיים בראש תור המענה", /שאלה שהגיעה בוואטסאפ או במייל/.test(html));
  check("והוא מוצג גם כשאין אף הערה ממתינה", /return outsideBox\(\)\+'<div class="empty">אין הערות/.test(html));
  check("השדות חיים במשתנה ולא בתיבה בלבד", /OUT\.text = this\.value/.test(html) && /var OUT = null/.test(html),
    "אחרת כל ציור מחדש היה מוחק את מה שהודבק");
  check("שדה החיפוש מחזיר את הסמן אחרי הציור", /setSelectionRange\(v,v\); \};\n\s*app\.querySelectorAll\("\[data-outdraft\]/.test(html) || /out_f"\); if\(n\)\{ n\.focus\(\); n\.setSelectionRange\(v,v\); \}/.test(html));
  check("יש כפתור העתקה", /data-outcopy/.test(html));
  check("ויש שליחה אליה באפליקציה", /data-outsend/.test(html));
  check("שמופיעה רק כשזיהו אותה", /picked\s*\n?\s*\?\s*'<button class="btn" data-outsend/.test(html.replace(/\s+/g, " ")) || /\(picked[\s\S]{0,40}data-outsend/.test(html));
  check("והשליחה שואלת לפני, כי אי אפשר לבטל", /לשלוח לה את התשובה\?/.test(html));
  check("השמירה לבנק דלוקה כברירת מחדל", /id="out_k"'\+\(OUT\.keep\?' checked':''\)/.test(html));
  // העתקה לבדה אינה נכנסת לבנק: אין לנו דרך לדעת אם באמת נשלח לה משהו.
  const copyBlock = html.slice(html.indexOf('data-outcopy]'), html.indexOf('data-outsend]'));
  check("והעתקה לבדה אינה שומרת לבנק", !/bankAdd/.test(copyBlock));
}

console.log("\n" + (fail ? "✗" : "✓") + " " + pass + " מתוך " + (pass + fail));
process.exit(fail ? 1 : 0);
