// ===== הורדת קובץ מהדרייב בשם חשבון השירות. v8.00 =====
//
// **חשבון השירות `names-reader@myprime-app.iam.gserviceaccount.com`** נוצר ב-11.10.2026 על
// ידי רון, והקובץ של הפקידה שותף איתו **כצופה בלבד**. המפתח שלו יושב ב-`GOOGLE_SA_KEY`
// בוורסל, מסומן Sensitive, כ-JSON שלם כפי שגוגל הורידה אותו.
//
// **ההרשאה המבוקשת היא קריאה בלבד** (`drive.readonly`), ולכן גם אם הקוד כאן ישתבש, הוא אינו
// יכול לשנות או למחוק דבר בדרייב. ובלאו הכי הוא רואה רק מה ששותף איתו.

import crypto from "node:crypto";

const b64url = (b) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

async function withTimeout(ms, fn) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try { return await fn(ac.signal); } finally { clearTimeout(t); }
}

export function parseKey(raw) {
  let k = raw;
  if (typeof k === "string") { try { k = JSON.parse(k); } catch (e) { return null; } }
  if (!k || !k.client_email || !k.private_key) return null;
  return k;
}

export async function driveToken(key, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const aud = key.token_uri || "https://oauth2.googleapis.com/token";
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: key.client_email, scope: "https://www.googleapis.com/auth/drive.readonly", aud, iat, exp: iat + 3600,
  }));
  const sig = b64url(crypto.createSign("RSA-SHA256").update(head + "." + claim).sign(key.private_key));
  const r = await withTimeout(15000, (signal) => fetch(aud, {
    method: "POST", signal,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") + "&assertion=" + head + "." + claim + "." + sig,
  }));
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error("drive token " + r.status + " " + (j.error || ""));
  return j.access_token;
}

export async function driveDownload(fileId, key) {
  const token = await driveToken(key);
  const r = await withTimeout(45000, (signal) => fetch(
    "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId) + "?alt=media&supportsAllDrives=true",
    { headers: { Authorization: "Bearer " + token }, signal },
  ));
  if (!r.ok) throw new Error("drive download " + r.status);
  return Buffer.from(await r.arrayBuffer());
}
