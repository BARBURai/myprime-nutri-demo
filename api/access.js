// Vercel serverless function: gates access to the app.
//  1) Verifies the email is on the program's registered list (a Google Sheet).
//  2) Reads that participant's program START DATE from the same sheet row.
//  3) Enforces a usage window: 10 weeks (70 days) + 3 months from the start date.
//  4) Optionally enforces a max of 2 concurrent devices per email.
//
// SETUP (no code needed):
//  A. Registered list - publish the Google Sheet to the web as CSV
//     (File -> Share -> Publish to web -> the sheet -> CSV), then in Vercel:
//     Settings -> Environment Variables -> ACCESS_SHEET_CSV_URL = <CSV link> -> Redeploy.
//     (While unset, the gate stays open = demo mode.)
//     Each row must contain the participant's email and her start date.
//     Date format: DD/MM/YYYY (e.g. 15/06/2026) or YYYY-MM-DD. Column order does
//     not matter; a header row is fine. The start date is snapped to its Sunday.
//  B. 2-device limit (optional) - create a free Upstash Redis database, then set:
//     UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in Vercel env -> Redeploy.

async function redis(base, token, ...args) {
  const path = args.map((a) => encodeURIComponent(String(a))).join("/");
  const r = await fetch(`${base}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const d = await r.json();
  return d.result;
}

function parseDateToSunday(s) {
  if (!s) return null;
  const t = String(s).trim().replace(/^["']|["']$/g, "");
  let y, m, d;
  const iso = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const dmy = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (iso) { y = +iso[1]; m = +iso[2]; d = +iso[3]; }
  else if (dmy) { d = +dmy[1]; m = +dmy[2]; y = +dmy[3]; }
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (isNaN(dt.getTime())) return null;
  dt.setUTCDate(dt.getUTCDate() - dt.getUTCDay()); // snap to Sunday (0 = Sun)
  return dt;
}

function ymd(dt) { return dt.toISOString().slice(0, 10); }

// Israel-local date, so "was she in the app yesterday" flips at local midnight.
function israelDay(offsetDays) {
  const d = new Date(Date.now() - (offsetDays || 0) * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

// Parse one CSV line into cells, respecting double-quoted fields (which may contain commas).
function parseCsvLine(line) {
  const out = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else {
      if (ch === '"') q = true;
      else if (ch === ",") { out.push(cur); cur = ""; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

// Normalize a header cell for matching: lowercase, collapse whitespace, strip quotes.
function normHeader(s) { return String(s || "").replace(/^["']|["']$/g, "").replace(/\s+/g, " ").trim().toLowerCase(); }

// Find a column index whose header matches any of the given names (whitespace/quote tolerant).
function findCol(headerCells, names) {
  const norm = headerCells.map(normHeader);
  for (const name of names) {
    const target = normHeader(name);
    const idx = norm.indexOf(target);
    if (idx !== -1) return idx;
  }
  return -1;
}

function isTrue(v) { return /^\s*true\s*$/i.test(String(v || "")); }

// Access window ends 70 days + N months after the (Sunday) start date, inclusive of the
// last day. N defaults to 3 but can be overridden per participant via the sheet.
function isExpired(startSunday, extraMonths) {
  const months = (Number.isFinite(extraMonths) && extraMonths > 0) ? Math.floor(extraMonths) : 3;
  const exp = new Date(startSunday.getTime());
  exp.setUTCDate(exp.getUTCDate() + 70);
  exp.setUTCMonth(exp.getUTCMonth() + months);
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return today.getTime() > exp.getTime();
}

// Max concurrent devices per email: a phone and a computer. 0 (or less) = no limit.
// The cap EVICTS rather than blocks - see the device section below for why.
const MAX_DEVICES = 2;

export default async function handler(req, res) {
  const email = String((req.query && req.query.email) || "").trim().toLowerCase();
  const device = String((req.query && req.query.device) || "").trim();
  // Set when she actually typed her email, as opposed to the silent check every time the
  // app loads. An explicit sign-in always wins and pushes someone else out; a silent check
  // from a device that has already been pushed out is what sends her back to the form.
  const isLogin = !!(req.query && (req.query.login === "1" || req.query.login === "true"));
  const sheetUrl = process.env.ACCESS_SHEET_CSV_URL;

  // Logout: free this device's slot. No sheet lookup needed.
  if (req.query && req.query.logout) {
    const RU = process.env.UPSTASH_REDIS_REST_URL, RT = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (RU && RT && email && device) { try { await redis(RU, RT, "ZREM", `devices:${email}`, device); } catch (e) {} }
    return res.status(200).json({ ok: true });
  }

  // 1) registration + start-date lookup
  if (!sheetUrl) return res.status(200).json({ allowed: true, reason: "not_configured", configured: false });
  if (!email) return res.status(200).json({ allowed: false, reason: "not_registered", configured: true });

  let startStr = null, found = false, cancelled = false, extraMonths = null, phone = "", glow = false;
  try {
    // Cache-busting: Google's published CSV can serve a stale copy for a few minutes.
    // Appending a timestamp helps fetch a fresher version, and we ask fetch not to cache.
    const bust = (sheetUrl.indexOf("?") === -1 ? "?" : "&") + "_cb=" + Date.now();
    const r = await fetch(sheetUrl + bust, { redirect: "follow", cache: "no-store", headers: { "cache-control": "no-cache" } });
    const text = await r.text();
    const lines = text.split(/\r?\n/);

    // Locate the "ביטלה" (cancellation) and start-date columns by header name.
    // If headers are found, we read those exact columns; otherwise we fall back
    // to the old permissive scan so the gate keeps working on an unexpected sheet.
    let cancelCol = -1, startCol = -1, monthsCol = -1, phoneCol = -1, glowCol = -1, headerFound = false;
    if (lines.length) {
      const header = parseCsvLine(lines[0]);
      cancelCol = findCol(header, ["ביטלה"]);
      // Her phone, so a note she leaves in the app can be answered. It lives in the
      // registration sheet's first column under the header "ID", already in the
      // international 972... form that wa.me links take.
      phoneCol = findCol(header, ["ID", "טלפון", "phone"]);
      startCol = findCol(header, ["360 - FINAL PERSONAL START", "FINAL PERSONAL START", "PERSONAL START"]);
      monthsCol = findCol(header, ["חודשי גישה נוספים"]);
      // Optional. Marks the women who also received the מיי פריים Glow bonus lessons.
      glowCol = findCol(header, ["בונוס איפור"]);
      headerFound = cancelCol !== -1 || startCol !== -1;
    }

    lines.forEach((line, idx) => {
      if (idx === 0 && headerFound) return; // skip header row
      const em = (line.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/) || [])[0];
      if (!em || em.toLowerCase() !== email) return;
      found = true;
      const cells = parseCsvLine(line);

      if (phoneCol !== -1 && cells[phoneCol]) phone = String(cells[phoneCol]).replace(/[^\d]/g, "");
      if (glowCol !== -1) glow = /^(true|yes|1|כן|✓|v)$/i.test(String(cells[glowCol] || "").trim());

      // Start date: prefer the exact column; else first date-looking token in the row.
      if (startCol !== -1 && cells[startCol]) {
        const dm = (cells[startCol].match(/\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{4}/) || [])[0];
        if (dm) startStr = dm;
      }
      if (!startStr) {
        const dm = (line.match(/\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{4}/) || [])[0];
        if (dm) startStr = dm;
      }

      // Cancellation: read ONLY the "ביטלה" column when known. This fixes the bug where
      // a TRUE in any other boolean column (e.g. "הורידה אפליקציה") wrongly blocked a user.
      if (cancelCol !== -1) {
        if (isTrue(cells[cancelCol])) cancelled = true;
      } else if (/(^|,)\s*TRUE\s*(,|$)/i.test(line)) {
        cancelled = true; // fallback only when the header wasn't found
      }

      // Extra access months (overrides the default 3). Blank / invalid keeps the default.
      if (monthsCol !== -1 && cells[monthsCol] != null && String(cells[monthsCol]).trim() !== "") {
        const n = parseInt(String(cells[monthsCol]).replace(/[^\d]/g, ""), 10);
        if (Number.isFinite(n) && n > 0) extraMonths = n;
      }
    });
  } catch (e) {
    return res.status(200).json({ allowed: false, reason: "fetch_failed", configured: true });
  }
  if (!found) return res.status(200).json({ allowed: false, reason: "not_registered", configured: true });
  if (cancelled) return res.status(200).json({ allowed: false, reason: "cancelled", configured: true });

  // 2) usage window (only when a parseable start date exists for this participant)
  // A clerk can extend or end a woman's access from the admin screen. That decision is
  // stored on our side (admin:overrides) and wins over the sheet, so nothing ever writes
  // back into the file ManyChat and this gate both read. Never fatal: a Redis hiccup must
  // leave the sheet in charge rather than lock a paying woman out.
  let clerkUntil = "";
  let clerkStart = "";
  let clerkBlocked = false;
  try {
    const raw = await redis(process.env.UPSTASH_REDIS_REST_URL, process.env.UPSTASH_REDIS_REST_TOKEN, "HGET", "admin:overrides", email);
    if (raw) {
      const ovr = JSON.parse(raw) || {};
      clerkUntil = ovr.until || "";
      // Her cohort, moved from the office screen. It is also written into ManyChat, which
      // exports the sheet, but that trip takes minutes at best; this is what makes the move
      // real on her next load. Read BEFORE the start date is parsed, so everything derived
      // from it - her day in the programme and the end of her access - follows along.
      clerkStart = ovr.start || "";
      // "ביטול בתהליך" from the office screen. Ron's decision on 19 August 2026: the moment
      // he marks it, she is out of the new app. Reversible in one click, and the screen says
      // so. The sheet's own "ביטלה" column still blocks independently of this.
      if (ovr.blocked === "1") clerkBlocked = true;
      // The Glow bonus, set from the office screen. "1" grants it and "0" takes it away even
      // when the sheet says TRUE; anything else leaves the sheet in charge. This is the fast
      // path: the sheet reaches us through Google's cache and lags by minutes.
      if (ovr.glow === "1") glow = true;
      else if (ovr.glow === "0") glow = false;
    }
  } catch (e) { /* fall through to the sheet */ }
  // Same answer as the sheet's own cancellation, so she sees the one screen that already
  // exists and points her at support, rather than a second wording for the same thing.
  if (clerkBlocked) return res.status(200).json({ allowed: false, reason: "cancelled", configured: true });
  const startSunday = parseDateToSunday(clerkStart || startStr);
  const startDate = startSunday ? ymd(startSunday) : null;
  const pastWindow = clerkUntil
    ? israelDay(0) > clerkUntil
    : (startSunday && isExpired(startSunday, extraMonths));
  if (pastWindow) {
    return res.status(200).json({ allowed: false, reason: "expired", configured: true, startDate });
  }

  // 3) optional max-2-concurrent-devices check
  const RU = process.env.UPSTASH_REDIS_REST_URL;
  const RT = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (RU && RT && device) {
    const TTL = 60 * 60 * 24; // a device counts as "active" for 24h since last seen
    const now = Date.now();
    const key = `devices:${email}`;
    try {
      await redis(RU, RT, "ZREMRANGEBYSCORE", key, "-inf", now - TTL * 1000);
      // Evict, never block. Refusing the third device is what drove the support load:
      // on iPhone, Safari and the installed app hold separate storage, so one woman with
      // one phone already spent both slots, and any reinstall after that hit a screen
      // telling her to log out on a device she could not reach. Dropping the
      // least-recently-used device instead means the phone in her hand always works,
      // while three active devices keep knocking each other out - annoying enough to
      // make a shared email impractical, invisible to a woman using her own phone and
      // computer, and it turns "I am locked out" into "I typed my email again".
      if (MAX_DEVICES > 0) {
        const known = await redis(RU, RT, "ZSCORE", key, device);
        if (known === null || known === undefined) {
          const count = Number(await redis(RU, RT, "ZCARD", key)) || 0;
          // Already at capacity and this device is not on the list, so it is the one that
          // was pushed out. On a silent check send it back to the sign-in form; typing the
          // email arrives here with login=1 and is always let in. Without this half the
          // eviction was invisible: the dropped device never noticed and simply re-added
          // itself on its next load.
          if (!isLogin && count >= MAX_DEVICES) {
            return res.status(200).json({ allowed: false, reason: "signed_out", configured: true, startDate });
          }
          const excess = count - MAX_DEVICES + 1; // room for the one about to be added
          if (excess > 0) await redis(RU, RT, "ZREMRANGEBYRANK", key, 0, excess - 1);
        }
      }
      await redis(RU, RT, "ZADD", key, now, device);
      await redis(RU, RT, "EXPIRE", key, TTL);
    } catch (e) { /* never lock a registered user out on a Redis hiccup */ }
  }

  // Daily activity flag. The app calls this endpoint every time it loads, so opening the
  // app IS the signal - which is exactly what the morning push asks about ("if you did not
  // manage to get into the app yesterday"). No new endpoint and no extra call from the
  // phone. Two days of life is enough for a job that only ever looks at yesterday.
  if (RU && RT) {
    // Durable last-seen for the admin screen. The act: flag above lives two days, which is
    // all the morning notification needs but not enough to answer "when was she last here".
    try { await redis(RU, RT, "HSET", "admin:seen", email, israelDay(0)); } catch (e) { /* never worth failing a login */ }
    try { await redis(RU, RT, "SET", `act:${israelDay(0)}:${email}`, "1", "EX", 172800); } catch (e) { /* a flag is never worth failing a login over */ }
    // Entitlement to the מיי פריים Glow bonus, so api/bunny-token.js can refuse to sign
    // those videos for anyone else. Rewritten on every entry and deleted the moment the
    // TRUE leaves the sheet, so it can never outlive the sheet by more than one load.
    try {
      if (glow) await redis(RU, RT, "SET", `glow:${email}`, "1", "EX", 2592000);
      else await redis(RU, RT, "DEL", `glow:${email}`);
    } catch (e) { /* the bonus is never worth failing a login over */ }
  }

  return res.status(200).json({ allowed: true, reason: "ok", configured: true, startDate, phone, glow });
}
