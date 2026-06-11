// Shared product catalog (server side, in the existing Upstash Redis).
// Grows from foods the app resolves (AI / barcode / food DBs) so they become
// findable in search WITHOUT calling the AI again. Manual entries stay private.
//
// Entry gate: only values that pass plausiblePer100 (Atwater + range) are stored.
// Keys: cat:<normName> -> { name, per100:{kcal,p,f,c}, unit, source, seen, ts }
//
// Routes (all on /api/catalog):
//   POST            { name, per100, unit, source }  (x-user-id header required)  -> add/upsert
//   GET  ?q=...                                                                  -> search (<=8)
//   GET/POST ?secret=<NOTIFY_SECRET>&action=list                                 -> review list (by usage)
//   GET/POST ?secret=<NOTIFY_SECRET>&action=del&key=<name|cat:...>               -> delete one entry
//
// Env: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, NOTIFY_SECRET (for admin)

import { normName, plausiblePer100, sourceRank } from "../lib/foodcheck.js";

async function redisPost(base, token, cmd) {
  const r = await fetch(base, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const d = await r.json();
  return d.result;
}

function toFood(o, key) {
  const p = o.per100 || {};
  const ml = o.unit === "ml";
  return {
    id: "cat_" + key.slice(4),
    name: o.name || key.slice(4),
    search: o.name || "",
    per100: { kcal: Number(p.kcal) || 0, p: Number(p.p) || 0, f: Number(p.f) || 0, c: Number(p.c) || 0 },
    measures: [{ label: ml ? "100 מ\"ל" : "100 ג׳", g: 100 }, { label: "כף", g: 15 }, { label: "כפית", g: 5 }],
    def: 0,
    unit: ml ? "ml" : "g",
    source: o.source || "estimated",
    seen: o.seen || 1,
    fromCatalog: true,
  };
}

export default async function handler(req, res) {
  const base = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!base || !token) return res.status(200).json({ ok: false, reason: "redis_not_configured" });

  const q = req.query || {};
  const adminOk = process.env.NOTIFY_SECRET && q.secret === process.env.NOTIFY_SECRET;

  // --- admin: review / delete ---
  if (q.action === "list" || q.action === "del") {
    if (!adminOk) return res.status(401).json({ ok: false, reason: "unauthorized" });
    if (q.action === "del") {
      const raw = String(q.key || "");
      const k = raw.startsWith("cat:") ? raw : "cat:" + normName(raw);
      await redisPost(base, token, ["DEL", k]);
      return res.status(200).json({ ok: true, deleted: k });
    }
    const keys = (await redisPost(base, token, ["KEYS", "cat:*"])) || [];
    const items = [];
    for (const k of keys.slice(0, 500)) {
      const v = await redisPost(base, token, ["GET", k]);
      if (v) { try { const o = JSON.parse(v); items.push({ key: k, name: o.name, per100: o.per100, source: o.source, seen: o.seen, ts: o.ts }); } catch (e) { /* skip */ } }
    }
    items.sort((a, b) => (b.seen || 0) - (a.seen || 0));
    return res.status(200).json({ ok: true, count: items.length, items });
  }

  // --- search ---
  if (req.method === "GET") {
    const term = String(q.q || "").trim();
    if (term.length < 2) return res.status(200).json({ ok: true, items: [] });
    const nq = normName(term);
    if (!nq) return res.status(200).json({ ok: true, items: [] });
    const keys = (await redisPost(base, token, ["KEYS", "cat:*"])) || [];
    const matched = keys.filter((k) => k.slice(4).includes(nq)).slice(0, 8);
    const items = [];
    for (const k of matched) {
      const v = await redisPost(base, token, ["GET", k]);
      if (v) { try { items.push(toFood(JSON.parse(v), k)); } catch (e) { /* skip */ } }
    }
    return res.status(200).json({ ok: true, items });
  }

  // --- add / upsert ---
  if (req.method === "POST") {
    const uid = String(req.headers["x-user-id"] || "").trim();
    if (!uid) return res.status(200).json({ ok: false, reason: "no_user" }); // light anti-spam
    let body;
    try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; } catch (e) { return res.status(400).json({ ok: false, reason: "bad_body" }); }
    const name = String((body && body.name) || "").trim();
    const per100 = body && body.per100;
    const unit = body && body.unit === "ml" ? "ml" : "g";
    const source = (body && body.source) || "estimated";
    if (source === "manual") return res.status(200).json({ ok: false, reason: "manual_private" }); // manual entries never enter the shared catalog
    if (!name || !plausiblePer100(per100)) return res.status(200).json({ ok: false, reason: "rejected" });
    const nName = normName(name);
    if (!nName) return res.status(200).json({ ok: false, reason: "empty" });
    const clean = { kcal: Math.round(Number(per100.kcal) || 0), p: Math.round(Number(per100.p) || 0), f: Math.round(Number(per100.f) || 0), c: Math.round(Number(per100.c) || 0) };
    const k = "cat:" + nName;
    let entry = null;
    const ex = await redisPost(base, token, ["GET", k]);
    if (ex) { try { entry = JSON.parse(ex); } catch (e) { entry = null; } }
    if (entry) {
      entry.seen = (entry.seen || 1) + 1;
      if (sourceRank(source) >= sourceRank(entry.source)) { entry.per100 = clean; entry.source = source; entry.unit = unit; entry.name = name; }
      entry.ts = Date.now();
    } else {
      entry = { name, per100: clean, unit, source, seen: 1, ts: Date.now() };
    }
    await redisPost(base, token, ["SET", k, JSON.stringify(entry), "EX", "15552000"]); // ~180d, refreshed on each use
    return res.status(200).json({ ok: true, key: k, seen: entry.seen, source: entry.source });
  }

  return res.status(405).json({ ok: false, reason: "method" });
}
