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

import { decideAccess } from "./_product.js";
import { fetchSheetText } from "./_sheet.js";
// ===== תקרת המתנה ל-Upstash, 3 שניות לפנייה. v7.45 =====
//
// **כל פנייה כאן כבר עטופה ב-try/catch שנכשל לצד הפתוח**, ולכן תקלה אינה נועלת אישה.
// **מה שלא היה מכוסה הוא פנייה שנתקעת ואינה עונה**, כי היא לעולם אינה נכשלת, והאישה
// ממתינה מול המסך בלי סוף. מהביקורת של הופ, ובאישור רון: "מאשר 3 שניות, מקובל עליי".
//
// **נמדד 23.09.2026:** פנייה ישירה 0.23 שניות בחציון ו-0.70 באיטית מתוך 20, **ודרך השרת
// 0.84 באיטית.** כלומר 3 שניות הן פי שלושה ומעלה מהאיטית שנמדדה.
//
// **ואחרי פנייה אחת שנתקעה, השער מוותר על Upstash לשארית הכניסה**, אחרת כל אחת מכעשרים
// הפניות הייתה ממתינה 3 שניות משלה. **המצב נשמר לכל כניסה בנפרד ולא לכל הקובץ**, כי
// וורסל יכולה להריץ כמה כניסות באותו תהליך, ותקיעה אצל אחת אינה אומרת דבר על השנייה.
//
// **המחיר, שרון קיבל במפורש:** בדקות של תקיעה אישה מוקפאת או חסומה עלולה להיכנס, ומי
// שנוספה ביד ואינה בגיליון לא. **כל מי שבגיליון נכנסת כרגיל.**
export const REDIS_WAIT_MS = 3000;
function redisForLogin() {
  let stalled = false;
  const redis = async (base, token, ...args) => {
    if (stalled) throw new Error("redis stalled earlier in this login");
    const path = args.map((a) => encodeURIComponent(String(a))).join("/");
    // טיימר רגיל ולא `AbortSignal.timeout`, כי זה האחרון אינו מחזיק את התהליך חי.
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), REDIS_WAIT_MS);
    try {
      const r = await fetch(`${base}/${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: ctl.signal });
      const d = await r.json();
      return d.result;
    } catch (e) {
      if (ctl.signal.aborted) stalled = true;
      throw e;
    } finally {
      clearTimeout(timer);
    }
  };
  redis.stalled = () => stalled;
  return redis;
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

// **שני חישובי החלון עברו ל-`api/_product.js`**, יחד עם ההכרעה עצמה, כדי שהשער
// ומסך הניהול יקראו בדיוק את אותו כלל. עותק שני כאן היה בדיוק הדרך שבה ב-v6.77
// השניים התחילו לחלוק בשקט.

// Max concurrent devices per email: a phone and a computer. 0 (or less) = no limit.
// The cap EVICTS rather than blocks - see the device section below for why.
const MAX_DEVICES = 2;

export default async function handler(req, res) {
  const redis = redisForLogin();
  const email = String((req.query && req.query.email) || "").trim().toLowerCase();
  const device = String((req.query && req.query.device) || "").trim();
  // Set when she actually typed her email, as opposed to the silent check every time the
  // app loads. An explicit sign-in always wins and pushes someone else out; a silent check
  // from a device that has already been pushed out is what sends her back to the form.
  const isLogin = !!(req.query && (req.query.login === "1" || req.query.login === "true"));
  const sheetUrl = process.env.ACCESS_SHEET_CSV_URL;
  // מפתחות Redis, בראש הקובץ כדי שגם משיכת הגיליון תוכל להשתמש במטמון המשותף.
  // **הם אופציונליים בכל מסלול**, ובלעדיהם הכל עובד בדיוק כמו קודם.
  const RU = process.env.UPSTASH_REDIS_REST_URL, RT = process.env.UPSTASH_REDIS_REST_TOKEN;

  // Logout: free this device's slot. No sheet lookup needed.
  if (req.query && req.query.logout) {
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

  let startStr = null, found = false, cancelled = false, extraMonths = null, phone = "", glow = false, glowFull = false;
  let solo = 0, glowMonths = null, glowPaid = false;
  try {
    // המשיכה עצמה, וביטול המטמון שבתוכה, עברו ל-`_sheet.js` כדי שעותק אחד ישרת את כל
    // הנשים לדקה. **הקריאה נכשלת לצד הפתוח:** בלי Redis או בתקלה שלו היא מושכת מגוגל
    // בדיוק כמו קודם. **ותשובה שאינה תקינה מגוגל זורקת ונוחתת על `fetch_failed`**, שהוא
    // "תקלה טכנית זמנית" ואינו נספר כניסיון כושל, במקום להיקרא כאישה שאינה רשומה.
    // **ואם Upstash כבר נתקע בכניסה הזאת, הולכים ישר לגוגל** בלי לנסות את המטמון,
    // אחרת היא ממתינה עוד 2.5 שניות לקריאה ועוד 4 לכתיבה. v7.45.
    const text = await fetchSheetText(sheetUrl, redis.stalled() ? null : RU, RT);
    const lines = text.split(/\r?\n/);

    // Locate the "ביטלה" (cancellation) and start-date columns by header name.
    // If headers are found, we read those exact columns; otherwise we fall back
    // to the old permissive scan so the gate keeps working on an unexpected sheet.
    let cancelCol = -1, startCol = -1, monthsCol = -1, phoneCol = -1, glowCol = -1, glowFullCol = -1, emailCol = -1, headerFound = false;
    let solo6Col = -1, solo12Col = -1, solo10wCol = -1, glowFullMCol = -1, glowPaidCol = -1;
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
      // קורס האיפור המלא, שניתן במתנה בוובינר. עמודה אופציונלית: כל עוד היא
      // אינה קיימת בגיליון, שום דבר לא משתנה לאף אישה.
      glowFullCol = findCol(header, ["glow-full"]);
      // מספר חודשי הגישה לקורס. עמודה אופציונלית, וריק פירושו ברירת המחדל.
      // ההתאמה היא על שם העמודה המלא, ולכן GLOW-FULL ו-GLOW-FULL-M לעולם לא יתבלבלו.
      glowFullMCol = findCol(header, ["GLOW-FULL-M"]);
      // הסימן שמבדיל בין קורס שנקנה בכסף לבין הקורס שניתן במתנה בוובינר, ובלעדיו
      // שתי הנשים נראות זהות לגמרי. **קנייה שורדת את סיום 360 והמתנה נגמרת איתו.**
      // עמודה אופציונלית: כל עוד היא אינה קיימת, שום דבר לא משתנה לאף אישה.
      // ההתאמה היא על השם המלא, ולכן היא אינה יכולה להתבלבל עם GLOW-FULL.
      glowPaidCol = findCol(header, ["GLOW-PAID"]);
      // שתי עמודות אופציונליות של תוכנית סולו, נקראות כאן בדיוק כמו במסך הניהול
      // כדי ששניהם לא יוכלו לחלוק על אורך החלון שלה.
      solo6Col = findCol(header, ["SOLO6"]);
      solo12Col = findCol(header, ["SOLO12"]);
      // 10 שבועות ולא חודשים, ולכן הערך שלה הוא 10 והחלון נסגר ביום 70. v7.47.
      solo10wCol = findCol(header, ["SOLO10WEEK"]);
      // Read the same column the office screen reads, so the two can never disagree about
      // who a row belongs to.
      emailCol = findCol(header, ["CF_EMAIL", "מייל", "email", "אימייל"]);
      headerFound = cancelCol !== -1 || startCol !== -1;
    }

    // כל השורות שנושאות את הכתובת שלה, ולא הראשונה או האחרונה שנתקלנו בה. אישה
    // אחת יכולה לשבת על כמה שורות בגיליון, ולכן ההכרעה נעשית אחרי המעבר על כולן.
    //
    // עד 4 בספטמבר 2026 כל שורה תואמת דרסה את הקודמת, כלומר **האחרונה בקובץ
    // ניצחה כאן, בעוד מסך הניהול לקח את הראשונה.** לכן המסך הציג מחזור אחד
    // והאפליקציה נתנה לה אחר, ואף מסך לא אמר שיש שתי שורות. **החוק עכשיו זהה
    // בשני הקבצים: תאריך ההתחלה המאוחר ביותר**, וזה `pickRow` ב-`api/_sheet.js`.
    const hits = [];
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
      const isYes = (v) => /^(true|yes|1|כן|✓|v)$/i.test(String(v || "").trim());

      const hit = { phone: "", glow: false, glowFull: false, glowPaid: false, solo: 0, months: null, glowM: null, cancelled: false, start: null };
      if (phoneCol !== -1 && cells[phoneCol]) hit.phone = String(cells[phoneCol]).replace(/[^\d]/g, "");
      if (glowCol !== -1) hit.glow = isYes(cells[glowCol]);
      if (glowFullCol !== -1) hit.glowFull = isYes(cells[glowFullCol]);
      if (glowPaidCol !== -1) hit.glowPaid = isYes(cells[glowPaidCol]);
      if (glowFullMCol !== -1) {
        const gm = parseInt(String(cells[glowFullMCol] || "").replace(/[^\d]/g, ""), 10);
        if (Number.isFinite(gm) && gm > 0) hit.glowM = gm;
      }
      if (solo12Col !== -1 && isYes(cells[solo12Col])) hit.solo = 12;
      else if (solo6Col !== -1 && isYes(cells[solo6Col])) hit.solo = 6;
      else if (solo10wCol !== -1 && isYes(cells[solo10wCol])) hit.solo = 10;

      // Start date: prefer the exact column; else first date-looking token in the row.
      let raw = null;
      if (startCol !== -1 && cells[startCol]) {
        raw = (cells[startCol].match(/\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{4}/) || [])[0] || null;
      }
      if (!raw) raw = (line.match(/\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{4}/) || [])[0] || null;
      // ההשוואה בין השורות היא על יום ראשון של המחזור ולא על המחרוזת עצמה, כי
      // בקובץ יושבות שתי צורות תאריך ומחרוזות כאלה אינן ניתנות להשוואה.
      hit.start = raw;
      hit.sun = raw ? parseDateToSunday(raw) : null;

      // Cancellation: read ONLY the "ביטלה" column when known. This fixes the bug where
      // a TRUE in any other boolean column (e.g. "הורידה אפליקציה") wrongly blocked a user.
      if (cancelCol !== -1) {
        if (isTrue(cells[cancelCol])) hit.cancelled = true;
      } else if (/(^|,)\s*TRUE\s*(,|$)/i.test(line)) {
        hit.cancelled = true; // fallback only when the header wasn't found
      }

      // Extra access months (overrides the default 3). Blank / invalid keeps the default.
      if (monthsCol !== -1 && cells[monthsCol] != null && String(cells[monthsCol]).trim() !== "") {
        const n = parseInt(String(cells[monthsCol]).replace(/[^\d]/g, ""), 10);
        if (Number.isFinite(n) && n > 0) hit.months = n;
      }
      hits.push(hit);
    });

    if (hits.length) {
      // **הביטול נספר מכל השורות ולא מהמנצחת בלבד.** החלטת רון, 4 בספטמבר 2026:
      // "אם מישהי ביטלה ויש לה שתי שורות אז היא ביטלה, ולא צריך להיות לה שום
      // גישה, וזה לא משנה אם יש שתי שורות או שמונה מאות."
      cancelled = hits.some((h) => h.cancelled);
      // **הקנייה נספרת מכל השורות, בדיוק כמו הביטול**, כי היא עובדה על האישה
      // ולא על המחזור. אישה שקנתה את הקורס לא תאבד אותו מפני שהשורה המנצחת
      // היא דווקא זו שאין בה את הסימון.
      glowPaid = hits.some((h) => h.glowPaid);
      let win = hits[0];
      for (let k = 1; k < hits.length; k++) {
        const h = hits[k];
        if (!h.sun) continue;
        if (!win.sun || h.sun.getTime() > win.sun.getTime()) win = h;
      }
      startStr = win.start;
      phone = win.phone;
      glow = win.glow;
      glowFull = win.glowFull;
      solo = win.solo;
      extraMonths = win.months;
      glowMonths = win.glowM;
    }
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
          glowFull = !!m.glowFull;
          glowPaid = !!m.glowPaid;
          solo = (m.solo === 6 || m.solo === 12 || m.solo === 10) ? m.solo : 0;
          const mm = parseInt(m.months, 10);
          if (Number.isFinite(mm) && mm > 0) extraMonths = mm;
          const gm = parseInt(m.glowM, 10);
          if (Number.isFinite(gm) && gm > 0) glowMonths = gm;
        }
      }
    } catch (e) { /* the file stays in charge */ }
  }
  if (!found) return res.status(200).json({ allowed: false, reason: "not_registered", configured: true });
  // **הביטול, ההקפאה והחלון שנגמר אינם יוצאים מכאן יותר, והם עדיין חוסמים.**
  // כולם נאספים כעובדות ונאכפים יחד בבלוק ההכרעה שלמטה, כי מרגע שיש שני מוצרים
  // נפרדים אסור שסגירה של 360 תיקח ממנה קורס איפור ששילמה עליו בנפרד.

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
      if (ovr.glowFull === "1") glowFull = true;
      else if (ovr.glowFull === "0") glowFull = false;
      if (ovr.glowPaid === "1") glowPaid = true;
      else if (ovr.glowPaid === "0") glowPaid = false;
      const gmo = parseInt(ovr.glowM, 10);
      if (Number.isFinite(gmo) && gmo > 0) glowMonths = gmo;
    }
  } catch (e) { /* fall through to the sheet */ }
  const startSunday = parseDateToSunday(clerkStart || startStr);
  const startDate = startSunday ? ymd(startSunday) : null;

  // ============================================================================
  // שני מוצרים, שני חישובים נפרדים.
  //
  // עד 15 בספטמבר 2026 השער שאל שאלה אחת, "יש לה תאריך התחלה?", והסיק ממנה איזה
  // מוצר יש לה. **זה היה נכון רק כל עוד אף אחת עוד לא סיימה 360**, כי תאריך
  // ההתחלה נשאר בגיליון לנצח. ברגע שאישה סיימה וקנתה את קורס האיפור היא נשארה
  // מסומנת כ-360 שהחלון שלו נגמר, כלומר **נחסמה מקורס ששילמה עליו.** אותו דבר
  // קרה למי שביטלה את 360 ולמי שנמצאת בהקפאה.
  //
  // מכאן נשאלות שתי שאלות נפרדות, והמסך נגזר מהן: 360 פתוח לה? הקורס פתוח לה?
  // ============================================================================
  // ההכרעה עצמה יושבת ב-`api/_product.js` ומשמשת גם את מסך הניהול, כדי שהשניים
  // לא יוכלו לחלוק על מה שהאישה רואה. הקריאה הראשונה היא בלי שעון הקורס, רק כדי
  // לדעת אם צריך לתפוס אותו בכלל.
  const facts = {
    startSunday, cancelled, clerkBlocked, clerkUntil, freeze,
    extraMonths, solo, glowFull, glowPaid, glowMonths,
    glowStart: "", today: israelDay(0),
  };
  let glowStart = "";
  if (decideAccess(facts).glowStandalone) {
    const RU0 = process.env.UPSTASH_REDIS_REST_URL, RT0 = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (RU0 && RT0) {
      try {
        const t0 = israelDay(0);
        // HSETNX תופס את היום הראשון פעם אחת ולעולם אינו דורס אותו, ולכן השעון שלה
        // לא מתאפס בכל כניסה ואין מה למלא במשרד.
        await redis(RU0, RT0, "HSETNX", "glow:start", email, t0);
        glowStart = String((await redis(RU0, RT0, "HGET", "glow:start", email)) || t0);
      } catch (e) { glowStart = ""; /* תקלה אצלנו לעולם אינה נועלת אישה משלמת */ }
    }
  }
  // וההכרעה הסופית, עכשיו עם שעון הקורס בידיים.
  facts.glowStart = glowStart;
  const decision = decideAccess(facts);
  const glowOnly = decision.glowOnly;
  // **הקורס המלא נפתח לה ביום 1 ולא לפניו.** לפני זה היא מקבלת בדיוק את מה שיש
  // לה חוץ ממנו: שלושת שיעורי המתנה אם סומנו לה, ואחרת שום דבר מגלו. זה נוסע
  // בשדה `glowFull` עצמו, ולכן המסכים באפליקציה נסגרים מאליהם בלי מסלול נוסף.
  const glowFullNow = decision.glowFullOpen;
  if (!decision.allowed) {
    // **היתר הצפייה בסרטונים נמחק ברגע שהיא נחסמת, ולא ממתין שיפוג.**
    // הסימונים האלה הם מה ש-`api/bunny-token.js` קורא כדי להחליט אם לחתום על
    // קישור צפייה, והם נכתבים מחדש בכל כניסה עם תפוגה של 30 יום. עד כאן הם שרדו
    // את החסימה, כי השער יצא לפני השורות שכותבות אותם: **נעלנו את הדלת ולא לקחנו
    // את הכרטיס שכבר בידה.** מי ששמרה מזהה סרטון מראש עוד יכלה לקבל חתימה.
    //
    // **`glowonly` נשאר בכוונה, והוא ההפך משני האחרים:** הוא זה שמסרב לחתום על
    // 88 סרטוני התוכנית למי שקנתה את הקורס לבדו. מחיקה שלו הייתה פותחת לה דווקא
    // את מה שאסור לה. הכיוון כאן זהה לזה שב-`api/bunny-token.js`.
    const RUx = process.env.UPSTASH_REDIS_REST_URL, RTx = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (RUx && RTx) {
      try {
        await redis(RUx, RTx, "DEL", `glow:${email}`);
        await redis(RUx, RTx, "DEL", `glowfull:${email}`);
      } catch (e) { /* ניקוי שנכשל לעולם אינו משנה את התשובה לאישה */ }
    }
    if (decision.reason === "frozen") return res.status(200).json({ allowed: false, reason: "frozen", configured: true, back: (freeze && freeze.back) || "" });
    if (decision.reason === "cancelled") return res.status(200).json({ allowed: false, reason: "cancelled", configured: true });
    return res.status(200).json({ allowed: false, reason: "expired", configured: true, startDate });
  }

  // 3) optional max-2-concurrent-devices check
  // RU ו-RT כבר הוכרזו בראש הפונקציה, לצד משיכת הגיליון.
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
      // אותו דפוס בדיוק לקורס המלא: נכתב בכל כניסה ונמחק ברגע שהסימון יורד
      // מהגיליון, ולכן הסרה נכנסת לתוקף בטעינה הבאה שלה ולא מתישהו.
      if (glowFullNow) await redis(RU, RT, "SET", `glowfull:${email}`, "1", "EX", 2592000);
      else await redis(RU, RT, "DEL", `glowfull:${email}`);
      // ומי שקנתה את הקורס לבדו מסומנת ככזאת, כדי ש-api/bunny-token.js יסרב לחתום
      // לה על 88 סרטוני התוכנית. רון: "ברור שצריך שמי שקנתה קורס איפור לא תוכל
      // להגיע בשום צורה בדרך ל-360." הסימון נכתב בכל כניסה ונמחק ברגע שנפתח לה
      // מחזור 360, ולכן מתנת הוובינר אינה מושפעת ממנו לרגע.
      if (glowOnly) await redis(RU, RT, "SET", `glowonly:${email}`, "1", "EX", 2592000);
      else await redis(RU, RT, "DEL", `glowonly:${email}`);
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
  return res.status(200).json({ allowed: true, reason: "ok", configured: true, startDate, phone, glow, glowFull: glowFullNow, glowSoon: decision.glowSoon, product: glowOnly ? "glow" : "360", replies, freeze: freeze ? { from: freeze.from || "", back: freeze.back || "", origStart: freeze.origStart || "" } : null });
}
