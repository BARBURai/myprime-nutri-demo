// Vercel serverless function: stores an END-TO-END ENCRYPTED backup of a user's
// app data, keyed by her email. The payload arrives already encrypted in the
// browser (AES-GCM, key derived from the user's personal code via PBKDF2), so
// this server - and Upstash - only ever see ciphertext. No one, including
// MyPrime, can read the contents without the user's code.
//
// Reuses the SAME Upstash Redis used by the access gate. Requires:
//   UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN  (Vercel env)
// The email must be on the registered list (ACCESS_SHEET_CSV_URL) to read/write,
// matching the access gate. While Upstash vars are unset, backup is simply off.
//
//   GET  /api/backup?email=...        -> { ok, exists, blob? }
//   POST /api/backup  { email, blob } -> { ok }
//   POST /api/backup  { email, blob, code, notify:1 } -> also emails her the code once
//
// About `code`, because it is the one thing here that must never be misunderstood:
// the code is the key to her data. It is sent ONLY when the app asks us to mail it,
// which happens exactly twice in a woman's life - when the backup is first created,
// and if she changes the code herself. It is used to compose one email and is then
// dropped. **It is never written to Redis, never logged, and never returned.** What
// we do store is a five-minute marker saying an email went out, so a retry or a
// double mount cannot send it twice.
//
// The reason this exists at all: the code used to live only on the device it was
// protecting, which meant it was available every moment except the one moment it
// was needed. A participant lost ten weeks of tracking that way on 22 August 2026.

async function redisCmd(base, token, cmd) {
  const r = await fetch(base, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const d = await r.json();
  return d.result;
}

async function isRegistered(email) {
  const sheetUrl = process.env.ACCESS_SHEET_CSV_URL;
  if (!sheetUrl) return true; // demo mode: gate is open, so allow
  try {
    const r = await fetch(sheetUrl, { redirect: "follow" });
    const text = await r.text();
    const list = (text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).map((e) => e.toLowerCase());
    return list.includes(email);
  } catch (e) {
    return false;
  }
}

// הקופי של המייל, במקום אחד ובנפרד מהלוגיקה, כדי ששינוי נוסח לא ייגע בקוד.
// **קול המערכת ולא קולה של ענת:** זו הודעה שהאפליקציה מחליטה עליה ואינה תוכן
// שענת כתבה, ולכן בלי גוף ראשון, בלי אמוג'י ובלי חתימה בשמה. ראה סעיף 8.
const MAIL_SUBJECT = "קוד הגיבוי שלך למיי פריים 360";
function mailHtml(code) {
  const safe = String(code).replace(/[<>&]/g, "");
  return `<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;font-size:16px;color:#3A2B30;line-height:1.7;max-width:520px">
    <p>שמרנו עבורך גיבוי מוצפן של המעקב שלך באפליקציה.</p>
    <p><b>זהו קוד הגיבוי האישי שלך:</b></p>
    <p style="font-size:26px;font-weight:bold;letter-spacing:2px;direction:ltr;text-align:center;background:#FCEEF2;padding:16px;border-radius:10px">${safe}</p>
    <p>הקוד הזה הוא מה שיחזיר לך את כל המעקב אם תחליפי טלפון, תמחקי את האפליקציה או תתקיני אותה מחדש.</p>
    <p><b>כדאי לשמור את המייל הזה.</b> הקוד שמור אצלך בלבד, ולכן בלי הקוד לא נוכל לשחזר את הנתונים גם אנחנו.</p>
    <p style="color:#7A6B70;font-size:14px">אין צורך לענות למייל הזה.</p>
  </div>`;
}

// One email, carrying the code, sent from the endpoint that already exists. A new file
// under api/ would push Vercel past its twelve-function ceiling and fail the whole
// deploy, which is why this lives here and not in a mailer of its own.
async function mailCode(RU, RT, email, code) {
  const KEY = process.env.RESEND_API_KEY;
  if (!KEY) return false;
  try {
    // Five minutes, so a retry cannot send twice, while a deliberate code change later
    // still gets its own email. The marker holds a timestamp and never the code.
    const seen = await redisCmd(RU, RT, ["SET", `bkmail:${email}`, String(Date.now()), "NX", "EX", 300]);
    if (seen !== "OK") return false;
    const from = process.env.REPORT_FROM || "MyPrime <onboarding@resend.dev>";
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [email], subject: MAIL_SUBJECT, html: mailHtml(code) }),
    });
    return r.ok;
  } catch (e) { return false; }
}

export default async function handler(req, res) {
  const RU = process.env.UPSTASH_REDIS_REST_URL;
  const RT = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!RU || !RT) return res.status(200).json({ ok: false, exists: false, reason: "not_configured" });

  const body = req.body || {};
  const email = String((req.query && req.query.email) || body.email || "").trim().toLowerCase();
  if (!email) return res.status(200).json({ ok: false, exists: false, reason: "no_email" });
  if (!(await isRegistered(email))) return res.status(200).json({ ok: false, exists: false, reason: "not_registered" });

  const key = `bk:${email}`;
  try {
    if (req.method === "POST") {
      const blob = body.blob;
      if (!blob || !blob.ct || !blob.salt || !blob.iv) return res.status(200).json({ ok: false, reason: "no_blob" });
      await redisCmd(RU, RT, ["SET", key, JSON.stringify(blob)]);
      // The backup itself is saved first and its success never depends on the email.
      // A mail provider having a bad minute must not cost her a backup.
      let mailed = false;
      if (body.notify && typeof body.code === "string" && body.code.trim()) {
        mailed = await mailCode(RU, RT, email, body.code.trim());
      }
      return res.status(200).json({ ok: true, mailed });
    }
    const raw = await redisCmd(RU, RT, ["GET", key]);
    if (!raw) return res.status(200).json({ ok: true, exists: false });
    let blob = null;
    try { blob = JSON.parse(raw); } catch (e) { return res.status(200).json({ ok: true, exists: false }); }
    return res.status(200).json({ ok: true, exists: true, blob });
  } catch (e) {
    return res.status(200).json({ ok: false, exists: false, reason: "error" });
  }
}
