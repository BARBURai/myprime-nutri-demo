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
  if (RU && RT) {
    const flat = (v) => {
      const out = {};
      if (Array.isArray(v)) { for (let i = 0; i < v.length; i += 2) out[v[i]] = v[i + 1]; return out; }
      return v && typeof v === "object" ? v : out;
    };
    try { overrides = flat(await redis(RU, RT, "HGETALL", "admin:overrides")); } catch (e) {}
    try { seen = flat(await redis(RU, RT, "HGETALL", "admin:seen")); } catch (e) {}
  }

  const today = israelDay(0);
  const women = sheet.women.map((w) => {
    let ovr = null;
    const raw = overrides[w.email];
    if (raw) { try { ovr = JSON.parse(raw); } catch (e) {} }
    const until = (ovr && ovr.until) || w.sheetEnd || "";
    return {
      ...w,
      seen: seen[w.email] || "",
      until,
      override: ovr ? { until: ovr.until, by: ovr.by || "", at: ovr.at || "", prev: ovr.prev || "" } : null,
      expired: !!until && today > until,
    };
  });

  return res.status(200).json({ ok: true, today, headers: sheet.headers, rawHeaders: sheet.rawHeaders, women });
}
