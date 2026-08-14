// Progress numbers from a woman's device, for the office screen (public/admin.html).
//
// What arrives here is counts and nothing else: per programme day, how many lessons she
// finished out of how many exist; how many videos she completed; how many repeat views; and
// how many days she filled the tracker. Never what she ate, what she weighs, her measurements
// or anything she typed. Those stay on her device, and her backup stays encrypted with a key
// only she holds. Keep it that way: this endpoint must not grow into a data pipe.
//
// POST /api/usage   { email, days: {"1-1":[2,3], ...}, videosDone, videosTotal, views, trackerDays }
// Stored in the Redis HASH `admin:usage`, field = email.

const MAX_DAYS = 70;

async function redis(base, token, ...args) {
  const r = await fetch(`${base}/${args.map(encodeURIComponent).join("/")}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error("redis " + r.status);
  return (await r.json()).result;
}

const num = (v, max) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : 0;
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const email = String((body && body.email) || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return res.status(400).json({ ok: false, error: "missing_email" });

  // Rebuild the payload rather than storing what was posted: this is an unauthenticated
  // endpoint, so nothing reaches Redis that was not shaped and bounded here.
  const daysIn = (body && body.days) || {};
  const days = {};
  Object.keys(daysIn).slice(0, MAX_DAYS).forEach((k) => {
    if (!/^\d{1,2}-\d{1,2}$/.test(k)) return;
    const pair = daysIn[k];
    if (!Array.isArray(pair)) return;
    const total = num(pair[1], 20);
    if (!total) return;
    days[k] = [Math.min(num(pair[0], 20), total), total];
  });

  const rec = {
    days,
    videosDone: num(body && body.videosDone, 500),
    videosTotal: num(body && body.videosTotal, 500),
    views: num(body && body.views, 100000),
    trackerDays: num(body && body.trackerDays, 400),
    at: new Date().toISOString(),
  };

  const RU = process.env.UPSTASH_REDIS_REST_URL;
  const RT = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!RU || !RT) return res.status(200).json({ ok: true, stored: false });

  try {
    await redis(RU, RT, "HSET", "admin:usage", email, JSON.stringify(rec));
    // "She finished today's tasks", so tonight's reminder can skip her. One day only: it
    // expires on its own, and tomorrow she is back in the list unless she finishes again.
    if (body && body.doneToday) {
      const day = String(body.day || "").match(/^\d{4}-\d{2}-\d{2}$/) ? body.day : null;
      if (day) { try { await redis(RU, RT, "SET", `trk:${day}:${email}`, "1", "EX", 172800); } catch (e) {} }
    }
    return res.status(200).json({ ok: true, stored: true });
  } catch (e) {
    // Never worth surfacing to a participant: this runs in the background on app load.
    return res.status(200).json({ ok: true, stored: false });
  }
}
