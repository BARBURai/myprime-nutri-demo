// חיפוש בתוך "האחרונים והמועדפים שלי". בלי רשת ובלי עלות.
//
//   node qa/hist-search-check.mjs
//
// בקשה של הילה, 21 באוגוסט 2026: "כדאי להוסיף חיפוש במאכלים האחרונים שאכלתי."
// ההחלטה של רון: החיפוש חוצה את שתי הלשוניות. אישה שמחפשת במועדפים ולא מוצאת
// לא תחשוב להחליף לשונית ולחפש שוב, היא תסיק שהפריט לא קיים.
//
// שלוש ההחלטות שנעולות כאן: שני תווים, שדה רק מעל שמונה פריטים, ומועדפים ראשונים
// עם פריט כפול פעם אחת בלבד.
//
// הפונקציות נמשכות מ-src/App.jsx לפי מחרוזת ואינן מועתקות, כי העתק נסחף בעריכה
// הראשונה. זו בדיוק המלכודת ש-qa/prompt-sync-check.mjs קיימת כדי למנוע.

import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  ← " + extra : "")); }
};

console.log("\nהמסלול עצמו, נמשך מהקוד");

const grab = (re, label) => {
  const m = src.match(re);
  check(label + " נמצא ב-App.jsx", !!m);
  return m ? m[0] : "";
};

const normSrc = grab(/const norm = \(s\) => String\(s \|\| ""\)\.trim\(\)\.toLowerCase\(\);/, "norm");
const hitSrc = grab(/const hit = \(f\) => norm\(f\.name\)\.includes\(norm\(hq\)\);/, "hit");
const favSrc = grab(/const favHits = hSearch \? favs\.filter\(hit\) : \[\];/, "סינון המועדפים");
const namesSrc = grab(/const favNames = new Set\(favHits\.map\(\(f\) => norm\(f\.name\)\)\);/, "רשימת השמות שכבר הוצגו");
const recSrc = grab(/const recHits = hSearch \? recs\.filter\(\(f\) => hit\(f\) && !favNames\.has\(norm\(f\.name\)\)\) : \[\];/, "סינון האחרונים");
const thrSrc = grab(/const hSearch = hq\.length >= 2;/, "סף שני התווים");
const showSrc = grab(/const showHistSearch = favs\.length \+ recs\.length > 8;/, "התנאי להצגת השדה");

// מריצים בדיוק את מה שהמסך מריץ, ולא העתק שלו. כשמסלול חסר, כל השאר נופל
// ומדווח, במקום לקרוס ולהשאיר את הספירה בלי מספר.
const ready = [normSrc, hitSrc, favSrc, namesSrc, recSrc, thrSrc, showSrc].every(Boolean);
const run = !ready ? () => ({ hSearch: false, favHits: [], recHits: [], showHistSearch: false }) : new Function("favs", "recs", "rawQ", `
  const hq = String(rawQ).trim();
  ${thrSrc}
  ${normSrc}
  ${hitSrc}
  ${favSrc}
  ${namesSrc}
  ${recSrc}
  ${showSrc}
  return { hSearch, favHits, recHits, showHistSearch };
`);

const f = (name) => ({ id: name, name });
const FAVS = [f("יוגורט ביו 5%"), f("יוגורט עם גרנולה"), f("סלט ירקות")];
const RECS = [f("יוגורט יווני"), f("יוגורט ביו 5%"), f("לחם מלא"), f("ביצה קשה")];

console.log("\nשני תווים, לא פחות");
check("תו אחד אינו מתחיל חיפוש", run(FAVS, RECS, "י").hSearch === false);
check("שני תווים כן", run(FAVS, RECS, "יו").hSearch === true);
check("רווחים לבדם אינם חיפוש", run(FAVS, RECS, "   ").hSearch === false);

console.log("\nהחיפוש חוצה את שתי הלשוניות");
const r = run(FAVS, RECS, "יוגורט");
check("נמצא גם במועדפים וגם באחרונים", r.favHits.length === 2 && r.recHits.length === 1,
  "מועדפים " + r.favHits.length + " · אחרונים " + r.recHits.length);
check("ופריט שנמצא בשתי הרשימות מוצג פעם אחת, תחת מועדפים",
  r.recHits.every((x) => x.name !== "יוגורט ביו 5%"),
  r.recHits.map((x) => x.name).join(","));
const only = run(FAVS, RECS, "ביצה");
check("פריט שקיים רק באחרונים כן נמצא", only.favHits.length === 0 && only.recHits.length === 1);
const nothing = run(FAVS, RECS, "פסטה");
check("ומה שאין מחזיר שתי רשימות ריקות", nothing.favHits.length === 0 && nothing.recHits.length === 0);
check("החיפוש אינו תלוי באותיות גדולות או ברווחים בקצה",
  run([f(" Cottage ")], [], "cottage").favHits.length === 1);

console.log("\nמתי השדה מוצג");
check("שמונה פריטים בסך הכל: אינו מוצג",
  run(Array.from({ length: 4 }, (_, i) => f("א" + i)), Array.from({ length: 4 }, (_, i) => f("ב" + i)), "").showHistSearch === false);
check("תשעה: מוצג",
  run(Array.from({ length: 4 }, (_, i) => f("א" + i)), Array.from({ length: 5 }, (_, i) => f("ב" + i)), "").showHistSearch === true);
check("והספירה היא של שתי הרשימות יחד ולא של הפעילה",
  run(Array.from({ length: 9 }, (_, i) => f("א" + i)), [], "").showHistSearch === true);

console.log("\nמה שרואים על המסך");
check("מועדפים מוצגים לפני האחרונים",
  src.indexOf('histHead("מועדפים (" + favHits.length') < src.indexOf('histHead("אחרונים (" + recHits.length'));
check("שתי הלשוניות נעלמות בזמן חיפוש", /\{!hSearch && \(\n\s*<div style=\{\{ display: "flex", gap: 4, background: C\.bg/.test(src));
check("וכשאין תוצאות נאמר את זה במפורש", src.includes("לא נמצא פריט בשם הזה."));
check("יש כפתור ניקוי לשדה", /aria-label="ניקוי החיפוש"/.test(src));
check("הרשימה הרגילה חוזרת כשמוחקים את החיפוש", /\{list\.map\(\(f\) => histRow\(f, histTab\)\)\}/.test(src));
check("שורת פריט אחת משמשת את שני המצבים", (src.match(/const histRow = \(f, listId\) => \{/g) || []).length === 1);
check("והמחיקה יודעת מאיזו רשימה להסיר", /setDelTarget\(\{ item: f, list: listId \}\)/.test(src));
check("כניסה למסך מנקה חיפוש קודם", /go: \(\) => \{ setHistQ\(""\); setStep\("history"\); \}/.test(src));

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.");
process.exit(fail ? 1 : 0);
