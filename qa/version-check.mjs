// The version shown inside the app must match the one recorded in CLAUDE.md.
//
// They drifted once, silently: a sed that bumped CLAUDE.md succeeded while the matching sed
// on src/App.jsx found nothing, so every later bump looked for a string that was no longer
// there. The app kept reporting v4.86 through twenty-four releases, which is exactly the
// number Ron reads to know whether his phone has the new code.
//
//   node qa/version-check.mjs

import { readFileSync } from "node:fs";

const app = readFileSync("src/App.jsx", "utf8");
const md = readFileSync("CLAUDE.md", "utf8");

const admin = readFileSync("api/admin.js", "utf8");

const inApp = (app.match(/const VERSION = "([^"]+)"/) || [])[1];
const inMd = (md.match(/\*\*גרסה נוכחית: v([0-9.]+)\*\*/) || [])[1];
const inAdmin = (admin.match(/const ADMIN_VERSION = "([^"]+)"/) || [])[1];

if (!inApp) { console.log("✗ לא נמצא VERSION ב-src/App.jsx"); process.exit(1); }
if (!inMd) { console.log("✗ לא נמצאה שורת הגרסה ב-CLAUDE.md"); process.exit(1); }
if (!inAdmin) { console.log("✗ לא נמצא ADMIN_VERSION ב-api/admin.js"); process.exit(1); }

if (inApp !== inMd || inApp !== inAdmin) {
  console.log(`✗ הגרסאות אינן תואמות: App.jsx אומר ${inApp}, CLAUDE.md אומר ${inMd}, api/admin.js אומר ${inAdmin}`);
  process.exit(1);
}
console.log(`✓ הגרסה תואמת בשלושת המקומות: v${inApp}`);
