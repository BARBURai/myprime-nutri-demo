// Every file that the content asks for must actually exist under public.
//
// Why this exists: two lessons were broken in production for two months and nothing caught it.
// The images of "הפינה המתוקה של מיי פריים" (שבוע 3 יום 5) were uploaded on 5 July as
// W03D05-sweets01.jpg ... sweets14.jpg, while data.js asked for W03D05-sweets-1.jpg ... -14.jpg,
// and the page image of "משימת צום לסירוגין" (שבוע 8 יום 4) had the same kind of mismatch.
// The names differ by one hyphen and a leading zero, so nothing looked wrong in the diff.
//
// Nothing else could have caught it: the code is valid, the build passes, and no scenario in
// layer 3 loads a lesson page image. A missing image is invisible to every other check we have
// and perfectly visible to the woman, who gets a blank rectangle where a recipe page should be.
//
// The walk is deliberately generic: it takes ANY string in the content tree that ends in an
// asset extension, so a new field added to data.js tomorrow is covered without touching this
// file. Today those fields are pdf, pageImages, downloads[].file and the guide step images.
//
//   node qa/assets-check.mjs

import { readFileSync, existsSync } from "node:fs";

const src = readFileSync("src/content/data.js", "utf8");

// PDF_BASE is the prefix the app puts in front of every one of these names.
const base = (src.match(/export const PDF_BASE\s*=\s*"([^"]*)"/) || [])[1];
if (base === undefined) {
  console.log("✗ לא נמצא PDF_BASE ב-src/content/data.js");
  process.exit(1);
}
if (base !== "/pdf/") {
  console.log(`✗ PDF_BASE השתנה ל-"${base}". הבדיקה מחפשת קבצים תחת public/pdf, ויש לעדכן אותה.`);
  process.exit(1);
}

const days = JSON.parse(src.slice(src.indexOf("["), src.lastIndexOf("]") + 1));

const wanted = new Map(); // filename -> where it came from
const isAsset = (s) => /\.(jpg|jpeg|png|pdf)$/i.test(s);

function walk(node, where) {
  if (Array.isArray(node)) {
    node.forEach((v) => walk(v, where));
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) walk(v, where + "/" + k);
  } else if (typeof node === "string" && isAsset(node)) {
    if (!wanted.has(node)) wanted.set(node, where);
  }
}

for (const day of days) {
  walk(day.lessons, `שבוע ${day.week} יום ${day.day}`);
}

// One file is knowingly missing and is waiting on a decision from Ron, not on work.
// W08D04-task.pdf was never in the repo at all: only an image of that page was ever uploaded.
// Either Ron sends the PDF, or the "pdf" line comes out of data.js and the lesson keeps the
// page image alone. Removing a download that a woman was promised is his call and not mine,
// so it sits here in the open instead of being quietly deleted. The check still fails on
// anything that is not on this list, which is the whole point of the list being this short.
const KNOWN_MISSING = new Set(["W08D04-task.pdf"]);

// The recipe and sweets cards carry their own images, and they name them as full paths
// ("/recipes/12.jpg") rather than through PDF_BASE. Same class of bug, same blind spot, so
// they are checked here too instead of waiting for their own two broken months.
for (const f of ["src/sweets.js", "src/recipes.js"]) {
  const body = readFileSync(f, "utf8");
  for (const m of body.matchAll(/"(\/[A-Za-z0-9_./-]+\.(?:jpg|jpeg|png|pdf))"/g)) {
    if (!wanted.has(m[1])) wanted.set(m[1], f);
  }
}

// A name from data.js is relative to public/pdf; one from the recipe files is already absolute.
const pathOf = (file) => (file.startsWith("/") ? "public" + file : "public/pdf/" + file);

const missing = [];
const known = [];
for (const [file, where] of wanted) {
  if (existsSync(pathOf(file))) continue;
  (KNOWN_MISSING.has(file) ? known : missing).push({ file, where });
}

for (const k of known) {
  console.log(`⚠ ${k.file} (${k.where}) חסר ביודעין, וממתין להחלטה של רון. ראה KNOWN_MISSING בקובץ הזה.`);
}

if (missing.length) {
  console.log(`✗ ${missing.length} קבצים שהתוכן מבקש אינם קיימים תחת public:`);
  for (const m of missing) console.log(`   ${m.file}   (${m.where})`);
  console.log("\nאישה שתפתח את השיעור הזה תראה מלבן ריק במקום עמוד, או כפתור הורדה שמחזיר שגיאה.");
  process.exit(1);
}

console.log(`✓ כל ${wanted.size - known.length} הקבצים שהתוכן מבקש קיימים תחת public`);
