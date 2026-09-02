// Shared reader for the registration sheet ("נרשמות 360 לבדיקה").
//
// The gate (api/access.js) and the admin screen (api/admin.js) both need the same rows,
// parsed the same way. Columns are located BY HEADER NAME and never by position: the sheet
// is edited by hand and shared with ManyChat, so a column can move at any time. An old bug
// came from scanning every column for TRUE, which let a TRUE in "הורידה אפליקציה" block
// legitimate women; reading the exact named column is what fixed it.

export function parseCsvLine(line) {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

export function normHeader(s) {
  return String(s || "").replace(/^["']|["']$/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

// Whitespace and quote tolerant: the start-date header carries two spaces after FINAL.
export function findCol(headerCells, names) {
  const norm = (headerCells || []).map(normHeader);
  for (const name of names) {
    const idx = norm.indexOf(normHeader(name));
    if (idx !== -1) return idx;
  }
  return -1;
}

export function parseDateToSunday(s) {
  if (!s) return null;
  const t = String(s).trim().replace(/^["']|["']$/g, "");
  const iso = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const dmy = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  let y, m, d;
  if (iso) { y = +iso[1]; m = +iso[2]; d = +iso[3]; }
  else if (dmy) { d = +dmy[1]; m = +dmy[2]; y = +dmy[3]; }
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (isNaN(dt.getTime())) return null;
  dt.setUTCDate(dt.getUTCDate() - dt.getUTCDay()); // snap to Sunday, the day a cohort starts
  return dt;
}

export function ymd(dt) { return dt.toISOString().slice(0, 10); }

export function israelDay(offsetDays) {
  const d = new Date(Date.now() - (offsetDays || 0) * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

// The access window: 70 programme days plus N months of continued access (default 3).
export function accessEnd(startSunday, extraMonths, solo) {
  const exp = new Date(startSunday.getTime());
  // סולו היא תוכנית בלי ליווי ובלי קבוצה, והחלון שלה נמדד מתאריך ההתחלה ולמשך
  // שישה חודשים או שנה, **בלי 70 הימים ובלי `חודשי גישה נוספים`**. זה מסלול
  // נפרד לגמרי, ולכן הוא נבדק ראשון ויוצא מכאן.
  if (solo === 6 || solo === 12) {
    exp.setUTCMonth(exp.getUTCMonth() + solo);
    return exp;
  }
  const months = (Number.isFinite(extraMonths) && extraMonths > 0) ? Math.floor(extraMonths) : 3;
  exp.setUTCDate(exp.getUTCDate() + 70);
  exp.setUTCMonth(exp.getUTCMonth() + months);
  return exp;
}

const isTrue = (v) => /^(true|yes|1|כן|✓|v)$/i.test(String(v || "").trim());

// תוכנית סולו: שימוש באפליקציה בלבד, בלי ליווי ובלי קבוצה. שתי העמודות
// אופציונליות, והיעדרן פירושו שאף אחת אינה בסולו ושום דבר אינו משתנה.
function soloOf(cells, col) {
  if (col.solo12 !== -1 && isTrue(cells[col.solo12])) return 12;
  if (col.solo6 !== -1 && isTrue(cells[col.solo6])) return 6;
  return 0;
}

// Reads the published CSV and returns one object per registered woman.
// `headers` reports which columns were located, so a renamed column shows up as a missing
// field on screen instead of silently reading as blank.
export async function loadSheet(csvUrl) {
  const bust = (csvUrl.includes("?") ? "&" : "?") + "_=" + Date.now();
  const r = await fetch(csvUrl + bust, { redirect: "follow", cache: "no-store", headers: { "cache-control": "no-cache" } });
  if (!r.ok) throw new Error("sheet fetch failed: " + r.status);
  const lines = (await r.text()).split(/\r?\n/);
  if (!lines.length) return { women: [], headers: {} };

  const header = parseCsvLine(lines[0]);
  const col = {
    cancel: findCol(header, ["ביטלה"]),
    start: findCol(header, ["360 - FINAL PERSONAL START", "FINAL PERSONAL START", "PERSONAL START"]),
    months: findCol(header, ["חודשי גישה נוספים"]),
    phone: findCol(header, ["ID", "טלפון", "phone"]),
    group: findCol(header, ["קבוצה", "group"]),
    first: findCol(header, ["F_NAME", "שם פרטי", "first name", "firstname"]),
    last: findCol(header, ["L_NAME", "שם משפחה", "last name", "lastname"]),
    email: findCol(header, ["CF_EMAIL", "מייל", "email", "אימייל"]),
    // Optional, and Ron is filling it in. The names are matched exactly after whitespace is
    // squeezed, so every spelling he might use is listed rather than matched loosely: the
    // sheet also carries a "הורידה אפליקציה" column, and anything that merely looks for
    // "אפליקצי" would land on that one and read as TRUE for almost everybody.
    newapp: findCol(header, ["אפליקציית תזונה", "אפליקציה תזונה", "אפליקציה חדשה", "אפליקציה"]),
    glow: findCol(header, ["בונוס איפור"]),
    // שתי עמודות אופציונליות של תוכנית סולו. השוואה מדויקת, כמו כל השאר, ולכן
    // SOLO6 ו-SOLO12 לעולם לא יתבלבלו ביניהן.
    solo6: findCol(header, ["SOLO6"]),
    solo12: findCol(header, ["SOLO12"]),
  };

  const women = [];
  const seenEmail = new Set();
  // Why a row in the file never reaches the screen. Ron marked 123 women in the sheet and
  // the screen showed 103, and there was no way to see where the other twenty went. These
  // counters are what the screen uses to say it out loud instead of leaving a silent gap.
  const skipped = { noEmail: 0, duplicate: 0, newAppNoEmail: 0, newAppDuplicate: 0 };
  // Rows with no address at all. Everything downstream is keyed on the address - the gate,
  // her backup, her notes - so such a row is invisible to every screen and to her. They are
  // collected here, keyed by phone, so the office can see that she exists and put the
  // address in, instead of never learning she is missing.
  const noEmail = [];
  let sheetNewAppRows = 0;
  lines.forEach((line, idx) => {
    if (idx === 0) return;
    if (!line.trim()) return;
    const cells = parseCsvLine(line);
    const cell = (i) => (i !== -1 && cells[i] != null ? String(cells[i]).trim() : "");
    const DATE_IN = /\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{4}/;
    const rowNewApp = col.newapp !== -1 ? isTrue(cells[col.newapp]) : false;
    if (rowNewApp) sheetNewAppRows++;

    const email = (cell(col.email).match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/) ||
      line.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/) || [])[0];
    if (!email) {
      skipped.noEmail++;
      if (rowNewApp) skipped.newAppNoEmail++;
      const noEmPhone = cell(col.phone).replace(/[^\d]/g, "");
      // Without a phone there is nothing to identify her by and nothing to write back to
      // ManyChat with, so such a row stays counted and unlisted.
      if (noEmPhone && noEmail.length < 200) {
        let sStr = (cell(col.start).match(DATE_IN) || [])[0] || "";
        if (!sStr) sStr = (line.match(DATE_IN) || [])[0] || "";
        const sSun = parseDateToSunday(sStr);
        const mRaw = cell(col.months).replace(/[^\d]/g, "");
        const m = mRaw ? parseInt(mRaw, 10) : null;
        noEmail.push({
          phone: noEmPhone,
          first: cell(col.first),
          last: cell(col.last),
          group: cell(col.group),
          start: sSun ? ymd(sSun) : "",
          months: Number.isFinite(m) && m > 0 ? m : null,
          cancelled: col.cancel !== -1 ? isTrue(cells[col.cancel]) : false,
          sheetNewApp: rowNewApp,
          glow: col.glow !== -1 ? isTrue(cells[col.glow]) : false,
          solo: soloOf(cells, col),
        });
      }
      return;
    }
    const em = email.toLowerCase();
    // The same address really does sit on more than one row here, so the first one wins and
    // the rest are dropped. Without counting them, a marked woman simply vanishes.
    if (seenEmail.has(em)) { skipped.duplicate++; if (rowNewApp) skipped.newAppDuplicate++; return; }
    seenEmail.add(em);

    // The start cell carries a time ("2026-01-04 0:00:00"), so pull the date out of it
    // rather than parsing the whole cell. Parsing it whole is what made every woman read
    // as having no start date, which in turn emptied the participants list.
    let startStr = (cell(col.start).match(DATE_IN) || [])[0] || "";
    if (!startStr) startStr = (line.match(DATE_IN) || [])[0] || "";
    const startSunday = parseDateToSunday(startStr);

    const monthsRaw = cell(col.months).replace(/[^\d]/g, "");
    const months = monthsRaw ? parseInt(monthsRaw, 10) : null;

    women.push({
      email: em,
      first: cell(col.first),
      last: cell(col.last),
      phone: cell(col.phone).replace(/[^\d]/g, ""),
      group: cell(col.group),
      start: startSunday ? ymd(startSunday) : "",
      months: Number.isFinite(months) && months > 0 ? months : null,
      cancelled: col.cancel !== -1 ? isTrue(cells[col.cancel]) : false,
      sheetNewApp: col.newapp !== -1 ? isTrue(cells[col.newapp]) : false,
      // מיי פריים Glow bonus lessons. Optional column: absent means nobody has it.
      glow: col.glow !== -1 ? isTrue(cells[col.glow]) : false,
      // 6, 12, או 0. אם שתי העמודות מסומנות מנצחת הארוכה, כי אין סיבה לקצר לה.
      solo: soloOf(cells, col),
      sheetEnd: startSunday ? ymd(accessEnd(startSunday, months, soloOf(cells, col))) : "",
    });
  });

  const headers = {};
  for (const k of Object.keys(col)) headers[k] = col[k] !== -1;
  // The sheet's own header row, echoed back so a renamed column can be mapped from what the
  // file actually says instead of by guessing. Guessing is what put email addresses on the
  // admin screen where first and last names belong.
  return { women, noEmail, headers, skipped, sheetNewAppRows, rawHeaders: header.map((h) => String(h || "").trim()).filter(Boolean) };
}
