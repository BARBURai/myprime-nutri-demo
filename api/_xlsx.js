// ===== קורא xlsx קטן, בלי ספרייה. v8.00 =====
//
// **למה בלי ספרייה:** האקסל של הפקידה הוא קובץ xlsx רגיל בדרייב, ואנחנו צריכים ממנו רק
// טקסט של תאים. קובץ xlsx הוא zip של קובצי XML, ו-Node כבר יודע לפתוח zip (`zlib`), ולכן
// מאה שורות כאן חוסכות תלות חיצונית שצריך לעדכן ולבדוק.
//
// **מה הוא קורא:** את כל הלשוניות, כל אחת כמערך של שורות, וכל שורה כמערך של טקסט לפי
// מיקום העמודה (A=0). תא ריק הוא "". **מה הוא לא קורא:** נוסחאות (רק הערך השמור שלהן),
// עיצוב, ותאריכים כתאריכים (הם מגיעים כמספר, ואנחנו לא צריכים אותם).

import zlib from "node:zlib";

// פתיחת ה-zip לפי התיקייה המרכזית שבסוף הקובץ, ולא לפי הכותרות המקומיות, כי שם הגודל
// תמיד נכון גם כשהקובץ נכתב בזרם.
export function unzip(buf) {
  const files = new Map();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("xlsx: not a zip");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("xlsx: bad directory");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nlen);
    p += 46 + nlen + elen + clen;
    files.set(name, () => {
      if (buf.readUInt32LE(off) !== 0x04034b50) throw new Error("xlsx: bad entry");
      const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
      const raw = buf.subarray(start, start + csize);
      if (method === 0) return Buffer.from(raw);
      if (method === 8) return zlib.inflateRawSync(raw);
      throw new Error("xlsx: unsupported method " + method);
    });
  }
  return files;
}

export function decodeXml(s) {
  return String(s || "")
    .replace(/_x([0-9A-Fa-f]{4})_/g, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#x([0-9A-Fa-f]+);/g, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// כל הטקסט שבתוך קטע, מכל ה-<t> שבו. טקסט עשיר מגיע בכמה ריצות, וההגייה (rPh) אינה חלק ממנו.
function textOf(xml) {
  const body = String(xml || "").replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  const re = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  let m;
  while ((m = re.exec(body))) out += m[1];
  return decodeXml(out);
}

const attr = (s, name) => {
  const m = String(s).match(new RegExp("\\b" + name + '="([^"]*)"'));
  return m ? decodeXml(m[1]) : "";
};

function colIndex(ref) {
  const m = String(ref || "").match(/^([A-Z]+)/);
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function numText(v) {
  const s = String(v || "").trim();
  // מספר טלפון שנשמר כמספר יכול להישמר בכתיב מדעי. מחזירים אותו כספרות.
  if (/^-?\d+(\.\d+)?[eE][+-]?\d+$/.test(s)) { const n = Number(s); if (Number.isFinite(n)) return n.toFixed(0); }
  return s;
}

export function readSheetXml(xml, shared) {
  const rows = [];
  const rowRe = /<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const row = [];
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm, next = 0;
    const inner = rm[1] || "";
    while ((cm = cellRe.exec(inner))) {
      const a = cm[1] || "";
      const body = cm[2] || "";
      let i = colIndex(attr(a, "r"));
      if (i < 0) i = next;
      next = i + 1;
      const t = attr(a, "t");
      let v = "";
      if (t === "inlineStr") v = textOf(body);
      else {
        const vm = body.match(/<v>([\s\S]*?)<\/v>/);
        const raw = vm ? vm[1] : "";
        if (t === "s") v = shared[parseInt(raw, 10)] || "";
        else if (t === "str" || t === "e") v = decodeXml(raw);
        else if (t === "b") v = raw === "1" ? "TRUE" : "FALSE";
        else v = numText(decodeXml(raw));
      }
      while (row.length < i) row.push("");
      row[i] = v;
    }
    rows.push(row);
  }
  return rows;
}

// כל הלשוניות, לפי הסדר שבחוברת: [{ name, rows }].
export function readXlsx(buf) {
  const files = unzip(buf);
  const get = (n) => { const f = files.get(n); return f ? f().toString("utf8") : null; };
  const wb = get("xl/workbook.xml");
  if (!wb) throw new Error("xlsx: no workbook");
  const rels = get("xl/_rels/workbook.xml.rels") || "";
  const target = {};
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) target[attr(m[1], "Id")] = attr(m[1], "Target");
  const sst = get("xl/sharedStrings.xml") || "";
  const shared = [];
  for (const m of sst.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)) shared.push(textOf(m[1] || ""));
  const sheets = [];
  for (const m of wb.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = attr(m[1], "name");
    let t = target[attr(m[1], "r:id")] || "";
    if (!t) continue;
    t = t.startsWith("/") ? t.slice(1) : "xl/" + t.replace(/^\.\//, "");
    const xml = get(t);
    if (xml == null) continue;
    sheets.push({ name, rows: readSheetXml(xml, shared) });
  }
  return sheets;
}
