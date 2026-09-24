// Shared product catalog (server side, in the existing Upstash Redis).
// Grows from foods the app resolves (AI / barcode / food DBs) so they become
// findable in search WITHOUT calling the AI again. Manual entries stay private.
//
// Entry gate: only values that pass plausiblePer100 (Atwater + range) are stored.
// Keys: cat:<normName>      -> { name, per100:{kcal,p,f,c}, unit, source, seen, ts }
//       catidx / catjudge   -> what search shows, and why. v7.48, see below
//                              (search reads ONLY catidx; cat:* is never scanned per keystroke)
//       bc:<code>           -> the SHARED values for a barcode, once two different women
//                              typed the same thing off the package
//       bcv:<code>:<userId> -> one woman's own correction, private until a second woman
//                              agrees. One typo can never become everybody's data.
//
// Routes (all on /api/catalog):
//   POST            { name, per100, unit, source }  (x-user-id header required)  -> add/upsert
//   GET  ?q=...                                                                  -> search (<=8)
//   GET  ?code=<barcode>                          (x-user-id header)             -> our values for a scanned product
//   POST ?action=bc { code, name, per100, unit }  (x-user-id header)             -> her correction from the package label
//   GET/POST ?secret=<NOTIFY_SECRET>&action=list                                 -> review list (by usage)
//   GET/POST ?secret=<NOTIFY_SECRET>&action=del&key=<name|cat:...>               -> delete one entry
//
// Env: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, NOTIFY_SECRET (for admin)

import { normName, plausiblePer100, sourceRank } from "../lib/foodcheck.js";
import { cleanName, nameProblem, indexField, searchKey, escapeGlob, hitRank, JUDGE_SYSTEM, judgePrompt, parseJudge } from "../lib/catfilter.js";
import { DEFAULT_MODEL } from "./ai.js";

// ---------- מה מוצג בחיפוש. v7.48 ----------
// **המאגר `cat:*` ממשיך להתמלא בדיוק כמו קודם.** החיפוש כבר אינו סורק אותו (`KEYS cat:*`
// החזיר 9,000 מפתחות בכל הקשה, ובייצור לא החזיר אף תוצאה), אלא קורא את האינדקס:
//   catidx          hash  שדה = שם נקי   ->  { name, per100, unit, source, seen, ts }
//   catjudge        hash  שדה = שם נקי   ->  { ok, p, why, ts }   תשובת הבינה, עם הערכים שנבדקו
//   catidx:pending  set   מפתחות cat: שממתינים לבדיקה
//   catidx:cursor   מחרוזת  היכן עומד המעבר החד פעמי על מה שכבר במאגר, "done" בסיום
//   catidx:lock     מונע משתי הרצות לבדוק את אותם פריטים
// פריט נכנס לאינדקס רק אם עבר את שלוש הבדיקות של lib/catfilter.js. ראה שם.
const IDX = "catidx", JUDGE = "catjudge", PENDING = "catidx:pending", CURSOR = "catidx:cursor", LOCK = "catidx:lock";
const JUDGE_BATCH = 40;
const INDEX_MAX_AGE_MS = 180 * 24 * 3600 * 1000; // כמו התפוגה של cat:*
const JUDGE_TIMEOUT_MS = 25000;

const qualifies = (o) => !!(o && o.name && o.per100 && Number(o.per100.kcal) > 0 && plausiblePer100(o.per100) && !nameProblem(o.name));
const safeParse = (v) => { if (!v) return null; try { return JSON.parse(v); } catch (e) { return null; } };

async function logJudgeUsage(base, token, usage) {
  // אותם מונים שהדוח היומי של רון קורא, כדי שעלות הבדיקה תופיע בו ולא תהיה נסתרת.
  try {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const c = await redisPost(base, token, ["INCR", `usage:${day}:calls`]);
    await redisPost(base, token, ["INCRBY", `usage:${day}:in`, Number(usage.input_tokens) || 0]);
    await redisPost(base, token, ["INCRBY", `usage:${day}:out`, Number(usage.output_tokens) || 0]);
    if (c === 1) for (const s of ["calls", "in", "out"]) await redisPost(base, token, ["EXPIRE", `usage:${day}:${s}`, 691200]);
  } catch (e) { /* a missing counter never blocks the check */ }
}

// מחזיר מערך תשובות באורך הקלט (true / false / null), או null כשהקריאה עצמה נכשלה.
async function askJudge(entries, base, token) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !entries.length) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), JUDGE_TIMEOUT_MS);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: process.env.AI_MODEL || DEFAULT_MODEL, max_tokens: 1500, system: JUDGE_SYSTEM, messages: [{ role: "user", content: judgePrompt(entries) }] }),
      signal: ctl.signal,
    });
    if (!r.ok) return null;
    const data = await r.json();
    if (data && data.usage) await logJudgeUsage(base, token, data.usage);
    const text = ((data && data.content) || []).filter((b) => b && b.type === "text").map((b) => b.text).join("\n");
    return parseJudge(text, entries.length);
  } catch (e) { return null; }
  finally { clearTimeout(timer); }
}

// פריט שעבר נכנס לאינדקס. אם כבר יש שם פריט באותו שם נקי, מנצח המקור האמין יותר.
async function putIndex(base, token, field, o) {
  const ex = safeParse(await redisPost(base, token, ["HGET", IDX, field]));
  if (ex && sourceRank(ex.source) > sourceRank(o.source)) {
    ex.seen = Math.max(ex.seen || 1, o.seen || 1); ex.ts = Math.max(ex.ts || 0, o.ts || 0);
    await redisPost(base, token, ["HSET", IDX, field, JSON.stringify(ex)]);
    return;
  }
  const rec = { name: cleanName(o.name), per100: o.per100, unit: o.unit === "ml" ? "ml" : "g", source: o.source || "estimated", seen: Math.max(o.seen || 1, (ex && ex.seen) || 1), ts: o.ts || Date.now() };
  await redisPost(base, token, ["HSET", IDX, field, JSON.stringify(rec)]);
}

// **העבודה שמכניסה פריטים לאינדקס.** רצה בסוף כל רישום של מזון, ולוקחת עד 40 פריטים:
// קודם אלה שנוספו לאחרונה, ואז מה שכבר היה במאגר לפני הגרסה הזאת, עד שהמעבר עליו נגמר.
// **האפליקציה אינה ממתינה לה**, כי הרישום נשלח ברקע ואיש אינו קורא את התשובה.
export async function fillIndex(base, token) {
  if (!process.env.ANTHROPIC_API_KEY) return { ran: false, reason: "no_key" };
  const got = await redisPost(base, token, ["SET", LOCK, "1", "NX", "EX", "60"]);
  if (got !== "OK") return { ran: false, reason: "locked" };
  try {
    // **קוראים ולא מוציאים.** פריט יוצא מרשימת ההמתנה רק אחרי שהוטפל, ולכן ריצה שנקטעה
    // באמצע אינה מאבדת אותו.
    let keys = (await redisPost(base, token, ["SRANDMEMBER", PENDING, String(JUDGE_BATCH)])) || [];
    if (!Array.isArray(keys)) keys = [keys];
    const fromPending = [...keys];
    let cursor = await redisPost(base, token, ["GET", CURSOR]);
    let nextCursor = null;
    if (keys.length < JUDGE_BATCH && cursor !== "done") {
      const sc = await redisPost(base, token, ["SCAN", cursor || "0", "MATCH", "cat:*", "COUNT", "80"]);
      if (Array.isArray(sc)) { nextCursor = String(sc[0]); keys = keys.concat(sc[1] || []); }
    }
    keys = [...new Set(keys)];
    const done = async () => {
      // מה שלא נשאר לבדיקה חוזרת יוצא מרשימת ההמתנה
      const drop = fromPending.filter((k) => !retrySet.has(k));
      if (drop.length) await redisPost(base, token, ["SREM", PENDING, ...drop]);
    };
    const retrySet = new Set();
    if (!keys.length) { if (nextCursor !== null) await redisPost(base, token, ["SET", CURSOR, nextCursor === "0" ? "done" : nextCursor]); return { ran: true, judged: 0 }; }

    const vals = (await redisPost(base, token, ["MGET", ...keys])) || [];
    // שם נקי אחד -> הפריט הטוב ביותר מאלה שהגיעו
    const byField = new Map();
    keys.forEach((k, i) => {
      const o = safeParse(vals[i]);
      if (!qualifies(o)) return;
      const f = indexField(o.name);
      const cur = byField.get(f);
      if (!cur || sourceRank(o.source) > sourceRank(cur.o.source) || (sourceRank(o.source) === sourceRank(cur.o.source) && (o.seen || 1) > (cur.o.seen || 1))) byField.set(f, { k, o });
    });
    const fields = [...byField.keys()];
    const verdicts = fields.length ? ((await redisPost(base, token, ["HMGET", JUDGE, ...fields])) || []) : [];
    const toJudge = [];
    for (let i = 0; i < fields.length; i++) {
      const { k, o } = byField.get(fields[i]);
      const v = safeParse(verdicts[i]);
      // כבר נבדק על אותם ערכים: לא שואלים שוב
      if (v && (v.admin || sameValues(v.p, o.per100))) { if (v.ok) await putIndex(base, token, fields[i], o); continue; }
      toJudge.push({ field: fields[i], k, o });
    }
    const now = toJudge.slice(0, JUDGE_BATCH), later = toJudge.slice(JUDGE_BATCH);
    if (later.length) await redisPost(base, token, ["SADD", PENDING, ...later.map((x) => x.k)]);
    let judged = 0;
    if (now.length) {
      const res = await askJudge(now.map((x) => ({ name: cleanName(x.o.name), per100: x.o.per100, unit: x.o.unit })), base, token);
      const retry = [];
      for (let i = 0; i < now.length; i++) {
        const ans = res ? res.ok[i] : null;
        if (ans === null) { retry.push(now[i].k); continue; } // לא ענתה: נבדוק שוב בפעם הבאה
        judged++;
        const { field, o } = now[i];
        await redisPost(base, token, ["HSET", JUDGE, field, JSON.stringify({ ok: ans, p: o.per100, why: res.why[i], ts: Date.now() })]);
        if (ans) await putIndex(base, token, field, o);
        else {
          // נפסל: יוצא מהאינדקס, אבל רק אם מה שיושב שם הוא אותם ערכים שנפסלו
          const ex = safeParse(await redisPost(base, token, ["HGET", IDX, field]));
          if (ex && sameValues(ex.per100, o.per100)) await redisPost(base, token, ["HDEL", IDX, field]);
        }
      }
      retry.forEach((k) => retrySet.add(k));
      if (retry.length) await redisPost(base, token, ["SADD", PENDING, ...retry]);
    }
    later.forEach((x) => retrySet.add(x.k));
    await done();
    if (nextCursor !== null) await redisPost(base, token, ["SET", CURSOR, nextCursor === "0" ? "done" : nextCursor]);
    return { ran: true, judged };
  } finally {
    await redisPost(base, token, ["DEL", LOCK]);
  }
}

// ערך ל-100 נשמר בעשירית ולא כמספר שלם. עיגול לשלם כאן היה מוחק את מה שהאפליקציה
// שלחה נכון: 8.4 גרם חלבון הופכים ל-8, וגביע של 500 מ״ל נרשם 40 במקום 42.
// ראה את אותה הערה ב-src/App.jsx. נמצא על ידי רון, 17 בספטמבר 2026.
const per100Round = (n) => Math.round((Number(n) || 0) * 10) / 10;

async function redisPost(base, token, cmd) {
  const r = await fetch(base, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const d = await r.json();
  return d.result;
}

// Two readings of the same label should agree closely. A little slack absorbs one woman
// rounding 8.0 to 8 and another typing 7.5, without letting a different product through.
function sameValues(a, b) {
  if (!a || !b) return false;
  const near = (x, y, abs, pct) => Math.abs((Number(x) || 0) - (Number(y) || 0)) <= Math.max(abs, ((Number(x) || 0) * pct));
  return near(a.kcal, b.kcal, 5, 0.03) && near(a.p, b.p, 1, 0.05) && near(a.f, b.f, 1, 0.05) && near(a.c, b.c, 2, 0.05);
}

function toFood(o, field) {
  const p = o.per100 || {};
  const ml = o.unit === "ml";
  return {
    id: "cat_" + field,
    name: o.name || field,
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
      const old = safeParse(await redisPost(base, token, ["GET", k]));
      await redisPost(base, token, ["DEL", k]);
      // ויוצא גם מהחיפוש, ונרשם כפסול כדי שרישום הבא של אותו שם לא יחזיר אותו
      const f = indexField(old ? old.name : k.slice(4));
      if (f) {
        await redisPost(base, token, ["HDEL", IDX, f]);
        await redisPost(base, token, ["HSET", JUDGE, f, JSON.stringify({ ok: false, p: old ? old.per100 : null, why: "deleted by admin", ts: Date.now(), admin: true })]);
      }
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

  // --- a scanned product: what WE hold for this barcode ---
  // Shared values win over the global database, because they were read off the Israeli
  // package by two different women. Otherwise her own correction, if she made one.
  if (q.code) {
    const code = String(q.code).replace(/[^0-9]/g, "");
    const uid = String(req.headers["x-user-id"] || "").trim();
    if (!code) return res.status(200).json({ ok: false, reason: "no_code" });
    const shared = await redisPost(base, token, ["GET", `bc:${code}`]);
    if (shared) { try { return res.status(200).json({ ok: true, scope: "shared", item: JSON.parse(shared) }); } catch (e) { /* fall through */ } }
    if (uid) {
      const mine = await redisPost(base, token, ["GET", `bcv:${code}:${uid}`]);
      if (mine) { try { return res.status(200).json({ ok: true, scope: "mine", item: JSON.parse(mine) }); } catch (e) { /* fall through */ } }
    }
    return res.status(200).json({ ok: true, scope: "none", item: null });
  }

  // --- search ---
  if (req.method === "GET") {
    const term = String(q.q || "").trim();
    if (term.length < 2) return res.status(200).json({ ok: true, items: [] });
    const nq = searchKey(term);
    if (!nq) return res.status(200).json({ ok: true, items: [] });
    // האינדקס בלבד, כלומר רק מה שעבר את שלוש הבדיקות. Redis מסנן בעצמו ומחזיר רק את
    // ההתאמות, ולכן הקשה אחת אינה מושכת את כל המאגר כמו ש-KEYS עשה.
    const hits = [];
    try {
      let cur = "0";
      for (let i = 0; i < 10; i++) {
        const sc = await redisPost(base, token, ["HSCAN", IDX, cur, "MATCH", "*" + escapeGlob(nq) + "*", "COUNT", "5000"]);
        if (!Array.isArray(sc)) break;
        const flat = sc[1] || [];
        for (let j = 0; j + 1 < flat.length; j += 2) {
          const o = safeParse(flat[j + 1]);
          if (o && o.per100 && Date.now() - (o.ts || 0) < INDEX_MAX_AGE_MS) hits.push({ field: flat[j], o });
        }
        cur = String(sc[0]);
        if (cur === "0") break;
      }
    } catch (e) { return res.status(200).json({ ok: true, items: [] }); }
    hits.sort((a, b) => hitRank(a.field, nq) - hitRank(b.field, nq) || (b.o.seen || 1) - (a.o.seen || 1) || a.field.length - b.field.length);
    const items = hits.slice(0, 8).map((h) => toFood(h.o, h.field));
    return res.status(200).json({ ok: true, items });
  }

  // --- her correction, read off the package ---
  if (req.method === "POST" && q.action === "bc") {
    const uid = String(req.headers["x-user-id"] || "").trim();
    if (!uid) return res.status(200).json({ ok: false, reason: "no_user" });
    let body;
    try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; } catch (e) { return res.status(400).json({ ok: false, reason: "bad_body" }); }
    const code = String((body && body.code) || "").replace(/[^0-9]/g, "");
    const name = String((body && body.name) || "").trim();
    const per100 = body && body.per100;
    const unit = body && body.unit === "ml" ? "ml" : "g";
    if (!code || !name) return res.status(200).json({ ok: false, reason: "no_code" });
    // The same arithmetic guard the shared catalog already uses: a number that cannot be
    // true never reaches storage, shared or private.
    if (!plausiblePer100(per100)) return res.status(200).json({ ok: false, reason: "rejected" });
    const clean = { kcal: per100Round(per100.kcal), p: per100Round(per100.p), f: per100Round(per100.f), c: per100Round(per100.c) };
    const record = { name, per100: clean, unit, ts: Date.now() };
    await redisPost(base, token, ["SET", `bcv:${code}:${uid}`, JSON.stringify(record), "EX", "31536000"]); // a year

    // Does someone else already say the same thing? Then it stops being one woman's note.
    let shared = false;
    try {
      const keys = (await redisPost(base, token, ["KEYS", `bcv:${code}:*`])) || [];
      for (const k of keys) {
        if (k === `bcv:${code}:${uid}`) continue;
        const v = await redisPost(base, token, ["GET", k]);
        if (!v) continue;
        let other; try { other = JSON.parse(v); } catch (e) { continue; }
        if (sameValues(clean, other.per100)) {
          await redisPost(base, token, ["SET", `bc:${code}`, JSON.stringify({ ...record, source: "label", confirmed: 2 }), "EX", "31536000"]);
          shared = true;
          break;
        }
      }
    } catch (e) { /* staying private is the safe failure */ }
    return res.status(200).json({ ok: true, shared });
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
    const clean = { kcal: per100Round(per100.kcal), p: per100Round(per100.p), f: per100Round(per100.f), c: per100Round(per100.c) };
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

    // **מכאן v7.48: האם הפריט מוצג בחיפוש.** המאגר כבר התעדכן למעלה בדיוק כמו קודם, וכל
    // מה שלמטה עטוף כך שתקלה בו לעולם אינה משנה את התשובה.
    try {
      if (qualifies(entry)) {
        const f = indexField(entry.name);
        const v = safeParse(await redisPost(base, token, ["HGET", JUDGE, f]));
        if (v && (v.admin || sameValues(v.p, entry.per100))) { if (v.ok) await putIndex(base, token, f, entry); }
        else await redisPost(base, token, ["SADD", PENDING, k]);
      }
      await fillIndex(base, token);
    } catch (e) { /* the log itself already succeeded */ }
    return res.status(200).json({ ok: true, key: k, seen: entry.seen, source: entry.source });
  }

  return res.status(405).json({ ok: false, reason: "method" });
}
