// **v8.68: תווים נסתרים במייל.** shushkok@gmail.com, 23.11.2026: כתובת שהודבקה במסך הניהול
// נשאה U+200F בסופה, ו-trim() אינו מוחק אותו (רק רווחים ו-U+FEFF). ההחלפה נשמרה, הכתובת
// הנקייה סומנה כישנה, והשער ענה "לא רשומה". רון: "מאשר את סעיף 1 ואת הנוסח".
// כל מייל שנכנס מבחוץ עובר כאן לפני כל השוואה: סימני כיוון, רווחים ברוחב אפס, ומקף רך.
export const HIDDEN_CHARS = /[\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
export function cleanEmail(s) {
  return String(s == null ? "" : s).replace(HIDDEN_CHARS, "").trim().toLowerCase();
}
