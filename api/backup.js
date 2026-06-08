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
      return res.status(200).json({ ok: true });
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
