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
function isExpired(startSunday, extraMonths, solo) {
  const exp = new Date(startSunday.getTime());
  // סולו: שימוש באפליקציה בלבד, בלי ליווי ובלי קבוצה. החלון נמדד מתאריך ההתחלה
  // ולמשך שישה חודשים או שנה, **בלי 70 הימים ובלי `חודשי גישה נוספים`**.
  if (solo === 6 || solo === 12) {
    exp.setUTCMonth(exp.getUTCMonth() + solo);
  } else {
    const months = (Number.isFinite(extraMonths) && extraMonths > 0) ? Math.floor(extraMonths) : 3;
    exp.setUTCDate(exp.getUTCDate() + 70);
    exp.setUTCMonth(exp.getUTCMonth() + months);
  }
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

  // Her address may have just been changed from the office screen. ManyChat took it, but the
  // sheet is exported from there on its own schedule, so for a while the file still carries
  // the old one. Without this she would be told she is not registered while holding the
  // address the office just gave her, which is exactly the state we were fixing.
  //
  // `lookFor` is the address to look for in the FILE. It is only different from the address
  // she typed while the export has not caught up, and the moment it does, the map is no
  // longer consulted and is cleared by the office screen.
  let lookFor = email;
  try {
    const RUm = process.env.UPSTASH_REDIS_REST_URL, RTm = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (RUm && RTm) {
      // The old address stops working the moment the new one is issued, so the two can never
      // both be live and split her data in half.
      const gone = await redis(RUm, RTm, "HGET", "admin:emailold", email);
      if (gone) return res.status(200).json({ allowed: false, reason: "not_registered", configured: true });
      const was = await redis(RUm, RTm, "HGET", "admin:emailmap", email);
      if (was) lookFor = String(was).trim().toLowerCase();
    }
  } catch (e) { /* the map is a bridge, never a gate: a Redis hiccup falls back to the file */ }

  let startStr = null, found = false, cancelled = false, extraMonths = null, phone = "", glow = false;
  let solo = 0;
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
    let cancelCol = -1, startCol = -1, monthsCol = -1, phoneCol = -1, glowCol = -1, emailCol = -1, headerFound = false;
    let solo6Col = -1, solo12Col = -1;
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
      // שתי עמודות אופציונליות של תוכנית סולו, נקראות כאן בדיוק כמו במסך הניהול
      // כדי ששניהם לא יוכלו לחלוק על אורך החלון שלה.
      solo6Col = findCol(header, ["SOLO6"]);
      solo12Col = findCol(header, ["SOLO12"]);
      // Read the same column the office screen reads, so the two can never disagree about
      // who a row belongs to.
      emailCol = findCol(header, ["CF_EMAIL", "מייל", "email", "אימייל"]);
      headerFound = cancelCol !== -1 || startCol !== -1;
    }

    lines.forEach((line, idx) => {
      if (idx === 0 && headerFound) return; // skip header row
      // Her address is the CF_EMAIL column, and only if that cell holds nothing usable do we
      // fall back to scanning the row. Scanning first is what made this a real hazard: any
      // other address sitting anywhere in her row would win, and she would be refused entry
      // with her own address while nothing on any screen said why.
      const cellsE = parseCsvLine(line);
      const EMAIL_IN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
      const em = ((emailCol !== -1 && cellsE[emailCol] ? String(cellsE[emailCol]).match(EMAIL_IN) : null) ||
        line.match(EMAIL_IN) || [])[0];
      if (!em || em.toLowerCase() !== lookFor) return;
      found = true;
      const cells = parseCsvLine(line);

      if (phoneCol !== -1 && cells[phoneCol]) phone = String(cells[phoneCol]).replace(/[^\d]/g, "");
      if (glowCol !== -1) glow = /^(true|yes|1|כן|✓|v)$/i.test(String(cells[glowCol] || "").trim());
      const isYes = (v) => /^(true|yes|1|כן|✓|v)$/i.test(String(v || "").trim());
      if (solo12Col !== -1 && isYes(cells[solo12Col])) solo = 12;
      else if (solo6Col !== -1 && isYes(cells[solo6Col])) solo = 6;

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
  // A woman the office added by hand, or one whose row in the file carries no address until
  // a clerk supplied one. The file is tried first and always wins; this is consulted only
  // when the file does not hold her, which is exactly the window between the office fixing
  // it and ManyChat's next export. Never a gate of its own: an unreachable store simply
  // leaves the file in charge, and she gets the same answer she would have got anyway.
  if (!found) {
    try {
      const raw = await redis(process.env.UPSTASH_REDIS_REST_URL, process.env.UPSTASH_REDIS_REST_TOKEN, "HGET", "admin:manual", email);
      if (raw) {
        const m = JSON.parse(raw) || {};
        if (m.start) {
          found = true;
          startStr = m.start;
          phone = String(m.phone || "").replace(/[^\d]/g, "");
          glow = !!m.glow;
          solo = (m.solo === 6 || m.solo === 12) ? m.solo : 0;
          const mm = parseInt(m.months, 10);
          if (Number.isFinite(mm) && mm > 0) extraMonths = mm;
        }
      }
    } catch (e) { /* the file stays in charge */ }
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
  let freeze = null;
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
      // On a freeze. She stays out of the app until the Sunday she comes back on, and a
      // freeze with no date yet keeps her out until the office sets one. Nothing runs at
      // midnight to let her back in: the date passes, and this comparison answers
      // differently on her next load.
      if (ovr.freeze) freeze = ovr.freeze;
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
  // Missing either half means the freeze cannot resolve, and she waits rather than being let
  // in with a week nobody chose for her.
  if (freeze && (!freeze.back || !freeze.week || israelDay(0) < freeze.back)) {
    return res.status(200).json({ allowed: false, reason: "frozen", configured: true, back: freeze.back || "" });
  }
  const startSunday = parseDateToSunday(clerkStart || startStr);
  const startDate = startSunday ? ymd(startSunday) : null;
  const pastWindow = clerkUntil
    ? israelDay(0) > clerkUntil
    : (startSunday && isExpired(startSunday, extraMonths, solo));
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

  // Answers the office wrote to her notes, and which she has not read yet. They ride the
  // gate because it already runs on every load: no new endpoint, and Vercel Hobby is on
  // twelve functions out of twelve.
  let replies = [];
  if (RU && RT) {
    try {
      const raw = await redis(RU, RT, "HGET", "notes:replies", email);
      const list = raw ? JSON.parse(raw) : [];
      replies = list.filter((r) => r && r.text && !r.read)
        .map((r) => ({ id: r.id, text: r.text, at: r.at }))
        .slice(-5);
    } catch (e) { /* an answer is never worth failing a login over */ }
  }

  // `freeze` travels on so the diary can leave the frozen days out of her day strip and
  // label the days before them for what they are. Nothing of hers is deleted.
  return res.status(200).json({ allowed: true, reason: "ok", configured: true, startDate, phone, glow, replies, freeze: freeze ? { from: freeze.from || "", back: freeze.back || "", origStart: freeze.origStart || "" } : null });
}
