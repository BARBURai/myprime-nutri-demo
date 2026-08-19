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

import { loadSheet, israelDay, accessEnd, ymd } from "./_sheet.js";

async function redis(base, token, ...args) {
  const r = await fetch(`${base}/${args.map(encodeURIComponent).join("/")}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error("redis " + r.status);
  return (await r.json()).result;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// The version this screen is served from. The office screen ships with the app, so without
// it on screen there is no way to tell whether what you are looking at is the new code, and
// Ron reported a change as missing when it was simply not deployed yet. Kept in step with
// src/App.jsx by qa/version-check.mjs, which fails on any drift.
const ADMIN_VERSION = "5.45";
const GROUP_RE = /^[\u05d0-\u05ea]$/;   // one Hebrew letter: the cohort runs א through ה

// ManyChat. The registration sheet is exported out of it, so it is the real source, and a
// change written here lands in the right place and reaches WhatsApp and the sheet on its
// own. Three rules hold: the token never leaves the server, only the handful of names
// below can be touched, and nothing here sends a message or starts an automation.
const MC = "https://api.manychat.com";
// She is found by her phone, not her email. The system email and phone fields are empty on
// these subscribers, so findBySystemField returns nothing at all; the phone sitting in this
// custom field is the only reliable key, and it is the sheet's ID column verbatim. An email
// is not even unique here, the same address was found sitting on two separate records.
const MC_WA_PHONE_FIELD = 11510562;
const MC_GROUP_FIELD = "קבוצה";
// Her cohort start. Type datetime in ManyChat, and the name carries TWO spaces after FINAL,
// exactly as the sheet column does. Ron decided that a change here is the same as making it
// inside ManyChat: if an automation hangs off this field it is meant to fire.
const MC_START_FIELD = "360 - FINAL  PERSONAL START";
// Written by id and not by name. The name carries two spaces after FINAL, and a field that
// is not resolved is not an error in ManyChat, it is simply a write that lands nowhere. The
// id cannot be mistyped and cannot drift.
const MC_START_FIELD_ID = 11675348;
// Noon, by Ron. Every cohort begins on a Sunday at 12:00.
//
// A datetime field there does not take just any shape, and the first attempt wrote nothing
// at all: the value was rejected, the answer was never read, and the screen reported success.
// So the shapes are tried in order and each one is verified by reading the field back. The
// first that actually lands wins, and if none does the clerk is told so.
// The first one is the shape ManyChat actually accepted when this was tried against the
// live account on 19 August 2026, so it is first and the rest are only a fallback. Verified
// end to end: the field showed 09/06/2026 12:00 and the automation fired with the right date.
const MC_START_FORMATS = (d) => [
  `${d}T12:00:00+03:00`,
  `${d} 12:00:00`,
  `${d} 12:00`,
  `${d}T12:00:00`,
];
const MC_TAGS = {
  demo: "GLOW- DEMO 💄",                       // the three bonus lessons inside the app
  full: "GLOW-FULL💄💄💄",  // the paid Glow course
  app: "אפליקציה תזונה",  // on the new app, not Kajabi
};

async function mc(path, body) {
  const token = process.env.MANYCHAT_TOKEN;
  if (!token) return { off: true };
  const r = await fetch(MC + path, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null;
  try { j = await r.json(); } catch (e) {}
  // ManyChat answers 200 with a body that says it failed, so the HTTP code alone is not the
  // answer. Not checking this is exactly what made a rejected write look like a success.
  const said = j && typeof j.status === "string" ? j.status : "";
  return { ok: r.ok && said !== "error", status: r.status, j, error: (j && (j.message || j.details)) || "" };
}

async function mcFind(phone) {
  const p = String(phone || "").replace(/[^\d]/g, "");
  if (!p) return null;
  const r = await mc(`/fb/subscriber/findByCustomField?field_id=${MC_WA_PHONE_FIELD}&field_value=${encodeURIComponent(p)}`);
  if (r.off || !r.ok) return null;
  const d = r.j && r.j.data;
  const first = Array.isArray(d) ? d[0] : d;
  return first && first.id ? first : null;
}

// Push the same change into ManyChat. Runs after the local write and never blocks it: if
// ManyChat is unreachable the clerk's change still takes effect in the app, which is the
// thing she is looking at. The screen reports which of the two actually happened.
async function mcPush({ phone, hasGroup, group, start, glow, tag, on }) {
  let sub;
  try { sub = await mcFind(phone); } catch (e) { return "failed"; }
  if (!sub) return "not_found";
  let startEcho = "";
  let startErr = "";
  try {
    if (start) {
      const readBack = async () => {
        try {
          const again = await mcFind(phone);
          const f = again && (again.custom_fields || []).find((x) => x.name === MC_START_FIELD || x.id === MC_START_FIELD_ID);
          return (f && f.value) || "";
        } catch (e) { return ""; }
      };
      for (const value of MC_START_FORMATS(start)) {
        const w = await mc("/fb/subscriber/setCustomField", {
          subscriber_id: sub.id, field_id: MC_START_FIELD_ID, field_value: value,
        });
        if (!w.ok) { startErr = w.error || "נדחה"; continue; }
        // Accepted is not the same as stored, so the field is read back every time.
        startEcho = await readBack();
        if (startEcho) { startErr = ""; break; }
        startErr = "התקבל אבל השדה נשאר ריק";
      }
      if (!startEcho) return "startfail:" + (startErr || "לא נשמר");
    }
    if (hasGroup) {
      await mc("/fb/subscriber/setCustomFieldByName", {
        subscriber_id: sub.id, field_name: MC_GROUP_FIELD, field_value: group,
      });
    }
    // "Back to the sheet" deliberately leaves the tag alone: it means "whatever ManyChat
    // already says", so there is nothing to write.
    if (glow === "1" || glow === "0") {
      await mc(glow === "1" ? "/fb/subscriber/addTagByName" : "/fb/subscriber/removeTagByName", {
        subscriber_id: sub.id, tag_name: MC_TAGS.demo,
      });
    }
    if (tag) {
      await mc(on ? "/fb/subscriber/addTagByName" : "/fb/subscriber/removeTagByName", {
        subscriber_id: sub.id, tag_name: MC_TAGS[tag],
      });
    }
  } catch (e) { return "failed"; }
  return startEcho ? "ok:" + startEcho : "ok";
}

// Codes the office holds, one per person, kept in the Redis hash `admin:codes`:
//   code -> { name, by, at }
// ADMIN_KEY stays the owner key and is the only one that can hand codes out or take them
// back. It is also the way in when everything else is down, so it is never revocable.
//
// The gain beyond access: with an issued code the name comes from the code, so the line in
// a woman's card saying who changed what is a fact rather than something somebody typed.
const CODE_ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";  // no I, O, 0, 1: they are misread aloud
function makeCode() {
  let s = "";
  for (let i = 0; i < 8; i++) { if (i === 4) s += "-"; s += CODE_ABC[Math.floor(Math.random() * CODE_ABC.length)]; }
  return s;
}

async function whoIs(key, RU, RT) {
  const owner = process.env.ADMIN_KEY || "";
  // Constant work regardless of the guess, and never say which part was wrong.
  if (owner && key.length === owner.length && key === owner) return { ok: true, owner: true, name: "" };
  if (!key || !RU || !RT) return { ok: false };
  // Fails closed on purpose: an issued code cannot be verified without Redis, and letting
  // one through unverified would be worse than the owner having to step in.
  try {
    const raw = await redis(RU, RT, "HGET", "admin:codes", key);
    if (!raw) return { ok: false };
    const rec = JSON.parse(raw) || {};
    return { ok: true, owner: false, name: String(rec.name || "") };
  } catch (e) { return { ok: false }; }
}

export default async function handler(req, res) {
  const key = String(req.query.key || "");
  const RU = process.env.UPSTASH_REDIS_REST_URL;
  const RT = process.env.UPSTASH_REDIS_REST_TOKEN;
  const me = await whoIs(key, RU, RT);
  if (!me.ok) return res.status(401).json({ ok: false, error: "unauthorized" });

  // The office codes. Only the owner key may see them or touch them, so a clerk cannot make
  // herself another code or take away someone else's.
  if (req.query.codes !== undefined || (req.method === "POST" && req.body && (req.body.newCode || req.body.dropCode))) {
    if (!me.owner) return res.status(403).json({ ok: false, error: "owner_only" });
    if (!RU || !RT) return res.status(500).json({ ok: false, error: "no_store" });
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    try {
      if (req.method === "POST" && body && body.newCode) {
        const name = String(body.newCode || "").trim().slice(0, 40);
        if (!name) return res.status(400).json({ ok: false, error: "missing_name" });
        const code = makeCode();
        await redis(RU, RT, "HSET", "admin:codes", code, JSON.stringify({ name, by: String(body.by || "").slice(0, 40), at: new Date().toISOString() }));
        return res.status(200).json({ ok: true, code, name });
      }
      if (req.method === "POST" && body && body.dropCode) {
        await redis(RU, RT, "HDEL", "admin:codes", String(body.dropCode));
        return res.status(200).json({ ok: true });
      }
      const flatH = (v) => {
        const out = {};
        if (Array.isArray(v)) { for (let i = 0; i < v.length; i += 2) out[v[i]] = v[i + 1]; return out; }
        return v && typeof v === "object" ? v : out;
      };
      const all = flatH(await redis(RU, RT, "HGETALL", "admin:codes"));
      const codes = Object.keys(all).map((code) => {
        let r = {};
        try { r = JSON.parse(all[code]) || {}; } catch (e) {}
        return { code, name: r.name || "", at: r.at || "" };
      }).sort((a, b) => String(a.name).localeCompare(String(b.name), "he"));
      return res.status(200).json({ ok: true, codes });
    } catch (e) { return res.status(500).json({ ok: false, error: "codes_failed" }); }
  }

  // One woman's live state in ManyChat, read when the clerk opens her card. It is per-woman
  // and on demand on purpose: ManyChat has no endpoint that lists everyone carrying a tag,
  // so the only alternative would be one call per row, and the screen would never load.
  if (req.method === "GET" && req.query.mc) {
    if (!process.env.MANYCHAT_TOKEN) return res.status(200).json({ ok: true, off: true });
    let sub = null;
    try { sub = await mcFind(req.query.mc); }
    catch (e) { return res.status(200).json({ ok: false, error: "mc_failed" }); }
    if (!sub) return res.status(200).json({ ok: true, found: false });
    const names = (sub.tags || []).map((t) => t.name);
    const gf = (sub.custom_fields || []).find((f) => f.name === MC_GROUP_FIELD);
    const sf = (sub.custom_fields || []).find((f) => f.name === MC_START_FIELD);
    return res.status(200).json({
      ok: true,
      found: true,
      group: (gf && gf.value) || "",
      start: (sf && sf.value) || "",
      tags: {
        demo: names.includes(MC_TAGS.demo),
        full: names.includes(MC_TAGS.full),
        app: names.includes(MC_TAGS.app),
      },
    });
  }

  if (req.method === "POST") {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    const email = String((body && body.email) || "").trim().toLowerCase();
    // With an issued code the name is the code's, not whatever was typed in the browser, so
    // the line in her card saying who did this cannot be faked.
    const by = me.owner ? String((body && body.by) || "").trim().slice(0, 40) : me.name;
    // Each field is edited on its own, and an empty string means "back to the sheet". The
    // key being absent is what distinguishes "not touched" from "cleared".
    const hasUntil = body && Object.prototype.hasOwnProperty.call(body, "until");
    const hasGroup = body && Object.prototype.hasOwnProperty.call(body, "group");
    // Her cohort start. Approved by Ron on 19 August 2026, including the write into
    // ManyChat: "it is the same as if she had done it in ManyChat, and if an automation is
    // wired to it, that is as it should be." Always a Sunday, and the screen only ever
    // offers Sundays, so anything else is a bug rather than a choice.
    const hasStart = body && Object.prototype.hasOwnProperty.call(body, "start");
    const start = String((body && body.start) || "").trim();
    // The מיי פריים Glow bonus. "" means back to the sheet, "1" grants it, "0" takes it away
    // even when the sheet says TRUE. Set here rather than in the sheet because Google serves
    // the published CSV from a cache and takes minutes; this takes effect on her next load.
    const hasGlow = body && Object.prototype.hasOwnProperty.call(body, "glow");
    const glow = String((body && body.glow) || "").trim();
    const until = String((body && body.until) || "").trim();
    const group = String((body && body.group) || "").trim();
    // The two Glow-course and new-app tags have no column of their own in the sheet, so
    // ManyChat is the only place they are written. Her phone travels with the request
    // because ManyChat is keyed by it and the sheet is not reloaded on this path.
    const phone = String((body && body.phone) || "").replace(/[^\d]/g, "");
    const tag = String((body && body.tag) || "").trim();
    const on = !!(body && body.on);
    if (!email) return res.status(400).json({ ok: false, error: "missing_email" });
    if (!hasUntil && !hasGroup && !hasGlow && !hasStart && !tag) return res.status(400).json({ ok: false, error: "nothing_to_do" });
    if (tag && tag !== "full" && tag !== "app") return res.status(400).json({ ok: false, error: "bad_tag" });
    if (hasGlow && glow && glow !== "1" && glow !== "0") return res.status(400).json({ ok: false, error: "bad_glow" });
    if (hasUntil && until && !DATE_RE.test(until)) return res.status(400).json({ ok: false, error: "bad_date" });
    if (hasGroup && group && !GROUP_RE.test(group)) return res.status(400).json({ ok: false, error: "bad_group" });
    if (hasStart && start && !DATE_RE.test(start)) return res.status(400).json({ ok: false, error: "bad_date" });
    // A cohort that does not begin on a Sunday splits the two things the app derives from
    // this date: the tracker card opens on days elapsed, its tasks open on the day of the
    // week. On a Sunday cohort they are the same day; on any other, the card renders with
    // no tasks at all. See section 28.
    if (hasStart && start && new Date(start + "T12:00:00Z").getUTCDay() !== 0) return res.status(400).json({ ok: false, error: "not_sunday" });
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
      if ((hasUntil && !cur.until) || (hasGroup && !cur.group) || (hasGlow && !cur.glow) || (hasStart && !cur.start)) {
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
      if (hasStart) {
        log.unshift({ at, by, field: "start", from: cur.start || (sheetRow ? sheetRow.start : "") || "", to: start });
      }
      if (hasGlow) {
        const was = cur.glow || (sheetRow ? (sheetRow.glow ? "1" : "0") : "");
        log.unshift({ at, by, field: "glow", from: was, to: glow });
      }
      // A tag has no stored value of its own here, only a line in the record, so that the
      // office can still see who turned it on and when.
      if (tag) {
        log.unshift({ at, by, field: "tag:" + tag, from: "", to: on ? "1" : "0" });
      }
      const rec = JSON.stringify({
        until: hasUntil ? until : (cur.until || ""),
        group: hasGroup ? group : (cur.group || ""),
        start: hasStart ? start : (cur.start || ""),
        glow: hasGlow ? glow : (cur.glow || ""),
        by, at, log: log.slice(0, 20),
      });
      await redis(RU, RT, "HSET", "admin:overrides", email, rec);
      // Only after the local write, and never allowed to undo it. The local store is what
      // the app reads within seconds; ManyChat is what makes the change permanent and
      // carries it to WhatsApp and to the sheet.
      let mcState = "off";
      if (process.env.MANYCHAT_TOKEN && (hasGroup || start || glow === "1" || glow === "0" || tag)) {
        mcState = await mcPush({ phone, hasGroup, group, start: hasStart ? start : "", glow: hasGlow ? glow : "", tag, on });
      }
      return res.status(200).json({ ok: true, mc: mcState });
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
    // Her cohort. Moving it moves everything that hangs off it, and the end of her access
    // is the one that would otherwise be left behind: it is start plus 70 days plus her
    // months, so it is recomputed here rather than carried over from the sheet.
    const start = (ovr && ovr.start) || w.start || "";
    const sheetEnd = (ovr && ovr.start && start)
      ? ymd(accessEnd(new Date(start + "T00:00:00Z"), w.months))
      : (w.sheetEnd || "");
    const until = (ovr && ovr.until) || sheetEnd || "";
    const group = (ovr && ovr.group) || w.group || "";
    const seenAt = seen[w.email] || "";
    let use = null;
    if (usage[w.email]) { try { use = JSON.parse(usage[w.email]); } catch (e) {} }
    return {
      ...w,
      // Both values travel, here as everywhere on this screen: what is in force, and what
      // the sheet says. The clerk must never have to guess which one she is looking at.
      start,
      sheetStart: w.start || "",
      sheetEnd,
      startOverride: (ovr && ovr.start) ? { start: ovr.start, by: ovr.by || "" } : null,
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
      needsGroup: !w.cancelled && !group && (start === thisWeek || start === nextWeek),
    };
  });

  return res.status(200).json({ ok: true, today, version: ADMIN_VERSION, owner: !!me.owner, me: me.name || "", headers: sheet.headers, skipped: sheet.skipped, sheetNewAppRows: sheet.sheetNewAppRows, rawHeaders: sheet.rawHeaders, women });
}
