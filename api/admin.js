// Admin screen data, for the office. Served to public/admin.html.
//
// Read side: the registration sheet, filtered down to the fields the office actually uses.
// Write side: NOTHING is written back into that sheet. It is the file ManyChat works from
// and the one the gate reads for every woman, and a bad write there would take out WhatsApp
// automation and access at once. Instead a clerk's change is stored here, in a Redis HASH,
// and api/access.js prefers it over the sheet. The screen always shows both values, so a
// manual change is visible rather than hidden.
//
//   admin:overrides  field = email, value = JSON({ until, group, glow, by, at, log[] })
//   admin:seen       field = email, value = "YYYY-MM-DD" of her last app open
//   admin:usage      field = email, value = JSON from api/usage.js (counts only)
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
const GROUP_RE = /^[\u05d0-\u05ea]$/;   // one Hebrew letter: the cohort runs א through ה

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
    const by = String((body && body.by) || "").trim().slice(0, 40);
    // Each field is edited on its own, and an empty string means "back to the sheet". The
    // key being absent is what distinguishes "not touched" from "cleared".
    const hasUntil = body && Object.prototype.hasOwnProperty.call(body, "until");
    const hasGroup = body && Object.prototype.hasOwnProperty.call(body, "group");
    // The מיי פריים Glow bonus. "" means back to the sheet, "1" grants it, "0" takes it away
    // even when the sheet says TRUE. Set here rather than in the sheet because Google serves
    // the published CSV from a cache and takes minutes; this takes effect on her next load.
    const hasGlow = body && Object.prototype.hasOwnProperty.call(body, "glow");
    const glow = String((body && body.glow) || "").trim();
    const until = String((body && body.until) || "").trim();
    const group = String((body && body.group) || "").trim();
    if (!email) return res.status(400).json({ ok: false, error: "missing_email" });
    if (!hasUntil && !hasGroup && !hasGlow) return res.status(400).json({ ok: false, error: "nothing_to_do" });
    if (hasGlow && glow && glow !== "1" && glow !== "0") return res.status(400).json({ ok: false, error: "bad_glow" });
    if (hasUntil && until && !DATE_RE.test(until)) return res.status(400).json({ ok: false, error: "bad_date" });
    if (hasGroup && group && !GROUP_RE.test(group)) return res.status(400).json({ ok: false, error: "bad_group" });
    if (!RU || !RT) return res.status(500).json({ ok: false, error: "no_store" });
    try {
      // Every change is kept: who, when, and the exact move from one date to another. A
      // clearing is a change too, so the record stays with an empty `until` rather than being
      // deleted, which would take the history with it.
      let cur = {};
      try {
        const old = await redis(RU, RT, "HGET", "admin:overrides", email);
        if (old) cur = JSON.parse(old) || {};
      } catch (e) {}

      // What the value was before this edit. With no override in force that is the sheet's
      // own value, so read it rather than logging a blank.
      let sheetRow = null;
      if ((hasUntil && !cur.until) || (hasGroup && !cur.group) || (hasGlow && !cur.glow)) {
        try {
          const sheet = await loadSheet(process.env.ACCESS_SHEET_CSV_URL);
          sheetRow = sheet.women.find((w) => w.email === email) || null;
        } catch (e) { /* an unreadable sheet must not block the save */ }
      }

      const log = Array.isArray(cur.log) ? cur.log.slice(0, 19) : [];
      const at = new Date().toISOString();
      if (hasUntil) {
        log.unshift({ at, by, field: "until", from: cur.until || (sheetRow ? sheetRow.sheetEnd : "") || "", to: until });
      }
      if (hasGroup) {
        log.unshift({ at, by, field: "group", from: cur.group || (sheetRow ? sheetRow.group : "") || "", to: group });
      }
      if (hasGlow) {
        const was = cur.glow || (sheetRow ? (sheetRow.glow ? "1" : "0") : "");
        log.unshift({ at, by, field: "glow", from: was, to: glow });
      }
      const rec = JSON.stringify({
        until: hasUntil ? until : (cur.until || ""),
        group: hasGroup ? group : (cur.group || ""),
        glow: hasGlow ? glow : (cur.glow || ""),
        by, at, log: log.slice(0, 20),
      });
      await redis(RU, RT, "HSET", "admin:overrides", email, rec);
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
  let overrides = {}, seen = {}, usage = {};
  const appEmails = new Set();
  if (RU && RT) {
    const flat = (v) => {
      const out = {};
      if (Array.isArray(v)) { for (let i = 0; i < v.length; i += 2) out[v[i]] = v[i + 1]; return out; }
      return v && typeof v === "object" ? v : out;
    };
    try { overrides = flat(await redis(RU, RT, "HGETALL", "admin:overrides")); } catch (e) {}
    try { seen = flat(await redis(RU, RT, "HGETALL", "admin:seen")); } catch (e) {}
    try { usage = flat(await redis(RU, RT, "HGETALL", "admin:usage")); } catch (e) {}

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
  // A woman with no group letter cannot be placed in the partnership feature. Exactly two
  // cohorts matter: the one running this week, and next week's, which Ron assigns on the
  // Thursday before it starts. Anything older has missed its window, and anything further
  // out is not being placed yet. Cohorts always begin on a Sunday.
  const sundayOfWeek = (weeksAhead) => {
    const d = new Date(israelDay(0) + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - d.getUTCDay() + weeksAhead * 7);
    return d.toISOString().slice(0, 10);
  };
  const thisWeek = sundayOfWeek(0), nextWeek = sundayOfWeek(1);
  const women = sheet.women.map((w) => {
    let ovr = null;
    const raw = overrides[w.email];
    if (raw) { try { ovr = JSON.parse(raw); } catch (e) {} }
    const until = (ovr && ovr.until) || w.sheetEnd || "";
    const group = (ovr && ovr.group) || w.group || "";
    const seenAt = seen[w.email] || "";
    let use = null;
    if (usage[w.email]) { try { use = JSON.parse(usage[w.email]); } catch (e) {} }
    return {
      ...w,
      seen: seenAt,
      // Opening the app at least once is what puts her on the new app. This only counts
      // from the day admin:seen started being written, so the list fills in over a few days
      // as each woman next opens the app.
      newApp: !!w.sheetNewApp || appEmails.has(w.email),
      usage: use,
      group,
      sheetGroup: w.group || "",
      groupOverride: (ovr && ovr.group) ? { group: ovr.group, by: ovr.by || "" } : null,
      // Both values travel to the screen: what the sheet says, and what is in force. The
      // clerk must never have to guess which of the two she is looking at.
      glow: (ovr && ovr.glow) ? ovr.glow === "1" : !!w.glow,
      sheetGlow: !!w.glow,
      glowOverride: (ovr && ovr.glow) ? { glow: ovr.glow, by: ovr.by || "" } : null,
      until,
      // `override` is only in force while it carries a date. The log survives a clearing, so
      // the office can always see what was done and by whom.
      override: (ovr && ovr.until) ? { until: ovr.until, by: ovr.by || "", at: ovr.at || "" } : null,
      log: (ovr && Array.isArray(ovr.log)) ? ovr.log : [],
      expired: !!until && today > until,
      needsGroup: !w.cancelled && !group && (w.start === thisWeek || w.start === nextWeek),
    };
  });

  return res.status(200).json({ ok: true, today, headers: sheet.headers, rawHeaders: sheet.rawHeaders, women });
}
