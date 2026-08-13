// Admin screen data, for the office. Served to public/admin.html.
//
// Read side: the registration sheet, filtered down to the fields the office actually uses.
// Write side: NOTHING is written back into that sheet. It is the file ManyChat works from
// and the one the gate reads for every woman, and a bad write there would take out WhatsApp
// automation and access at once. Instead a clerk's change is stored here, in a Redis HASH,
// and api/access.js prefers it over the sheet. The screen always shows both values, so a
// manual change is visible rather than hidden.
//
//   admin:overrides  field = email, value = JSON({ until, by, at, prev })
//   admin:seen       field = email, value = "YYYY-MM-DD" of her last app open
//
// GET  /api/admin?key=<ADMIN_KEY>              -> { ok, women[], headers, today }
// POST /api/admin?key=<ADMIN_KEY>              -> { email, until, by }   ("" clears it)

import { loadSheet, israelDay } from "./_sheet.js";

async function redis(base, token, ...args) {
  const r = await fetch(`${base}/${args.map(encodeURIComponent).join("/")}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error("redis " + r.status);
  return (await r.json()).result;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function handler(req, res) {
  const key = String(req.query.key || "");
  const expected = process.env.ADMIN_KEY || "";
  // Constant work regardless of the guess, and never say which part was wrong.
  if (!expected || key.length !== expected.length || key !== expected) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  const RU = process.env.UPSTASH_REDIS_REST_URL;
  const RT = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (req.method === "POST") {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    const email = String((body && body.email) || "").trim().toLowerCase();
    const until = String((body && body.until) || "").trim();
    const by = String((body && body.by) || "").trim().slice(0, 40);
    if (!email) return res.status(400).json({ ok: false, error: "missing_email" });
    if (until && !DATE_RE.test(until)) return res.status(400).json({ ok: false, error: "bad_date" });
    if (!RU || !RT) return res.status(500).json({ ok: false, error: "no_store" });
    try {
      if (!until) {
        await redis(RU, RT, "HDEL", "admin:overrides", email);
      } else {
        let prev = "";
        try {
          const old = await redis(RU, RT, "HGET", "admin:overrides", email);
          if (old) prev = (JSON.parse(old) || {}).until || "";
        } catch (e) {}
        const rec = JSON.stringify({ until, by, at: new Date().toISOString(), prev });
        await redis(RU, RT, "HSET", "admin:overrides", email, rec);
      }
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "write_failed" });
    }
  }

  const csvUrl = process.env.ACCESS_SHEET_CSV_URL;
  if (!csvUrl) return res.status(500).json({ ok: false, error: "no_sheet" });

  let sheet;
  try { sheet = await loadSheet(csvUrl); }
  catch (e) { return res.status(502).json({ ok: false, error: "sheet_failed" }); }

  // Two HGETALLs for the whole cohort, not one lookup per woman: at 1,300 rows the
  // per-woman version would be 2,600 round trips and the screen would never load.
  let overrides = {}, seen = {};
  const appEmails = new Set();
  if (RU && RT) {
    const flat = (v) => {
      const out = {};
      if (Array.isArray(v)) { for (let i = 0; i < v.length; i += 2) out[v[i]] = v[i + 1]; return out; }
      return v && typeof v === "object" ? v : out;
    };
    try { overrides = flat(await redis(RU, RT, "HGETALL", "admin:overrides")); } catch (e) {}
    try { seen = flat(await redis(RU, RT, "HGETALL", "admin:seen")); } catch (e) {}

    // Who is on the new app. admin:seen only starts at v4.87, so it alone would report far
    // fewer women than really moved over. Every other durable trace a woman leaves by
    // opening the app counts too: her encrypted backup (written automatically since v4.72),
    // her device list, and her notification registration. None of these can be forgotten or
    // mistyped the way a manual tag can.
    Object.keys(seen).forEach((e) => appEmails.add(e.toLowerCase()));
    const scan = async (pattern, prefixLen) => {
      try {
        const keys = (await redis(RU, RT, "KEYS", pattern)) || [];
        keys.forEach((k) => {
          const e = String(k).slice(prefixLen).toLowerCase();
          if (e.includes("@")) appEmails.add(e);
        });
      } catch (e) { /* one missing source must not empty the whole list */ }
    };
    await scan("bk:*", 3);
    await scan("devices:*", 8);
    try {
      const subs = flat(await redis(RU, RT, "HGETALL", "push:subs"));
      Object.values(subs).forEach((v) => {
        try { const j = JSON.parse(v); if (j && j.email) appEmails.add(String(j.email).toLowerCase()); } catch (e) {}
      });
    } catch (e) {}
  }

  const today = israelDay(0);
  // A woman with no group letter cannot be placed in the partnership feature. Only her
  // cohort's first week counts: before it starts nobody has been assigned a letter yet, so
  // flagging it would be noise, and once more than a week has passed the placement window
  // has closed and it is no longer worth chasing.
  const FRESH_DAYS = 7;
  const daysBetween = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
  const women = sheet.women.map((w) => {
    let ovr = null;
    const raw = overrides[w.email];
    if (raw) { try { ovr = JSON.parse(raw); } catch (e) {} }
    const until = (ovr && ovr.until) || w.sheetEnd || "";
    const seenAt = seen[w.email] || "";
    return {
      ...w,
      seen: seenAt,
      // Opening the app at least once is what puts her on the new app. This only counts
      // from the day admin:seen started being written, so the list fills in over a few days
      // as each woman next opens the app.
      newApp: !!w.sheetNewApp || appEmails.has(w.email),
      until,
      override: ovr ? { until: ovr.until, by: ovr.by || "", at: ovr.at || "", prev: ovr.prev || "" } : null,
      expired: !!until && today > until,
      needsGroup: (() => {
        if (w.cancelled || !w.start || w.group) return false;
        const age = daysBetween(w.start, today);
        return age >= 0 && age <= FRESH_DAYS;
      })(),
    };
  });

  return res.status(200).json({ ok: true, today, headers: sheet.headers, rawHeaders: sheet.rawHeaders, women });
}
