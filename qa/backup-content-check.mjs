// v7.75: סימוני הסרטונים נוסעים בגיבוי המוצפן, ושחזור מחזיר אותם.
// מושכת את bkPack ו-bkUnpack מתוך src/App.jsx לפי מחרוזת ומריצה אותן מול
// localStorage מדומה. בלי רשת.
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

function grab(name) {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) return null;
  let d = 0, j = src.indexOf("{", i);
  for (let k = j; k < src.length; k++) { if (src[k] === "{") d++; else if (src[k] === "}") { d--; if (d === 0) return src.slice(i, k + 1); } }
  return null;
}
const keysLine = (src.match(/const BK_CONTENT_KEYS = \[[^\]]*\];/) || [])[0];
const pack = grab("bkPack"), unpack = grab("bkUnpack");
ok(keysLine && pack && unpack, "bkPack / bkUnpack / BK_CONTENT_KEYS קיימים ב-App.jsx");
if (!(keysLine && pack && unpack)) { console.log(`backup-content-check: ${pass}/${pass + fail}`); process.exit(1); }

function mkLS() {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
const make = (ls) => new Function("localStorage", `const STORAGE_KEY = "myprime_demo_state_v1";\n${keysLine}\n${pack}\n${unpack}\nreturn { bkPack, bkUnpack, BK_CONTENT_KEYS };`)(ls);

const STATE = { onboarded: true, profile: { name: "איריס" }, log: [{ id: 1, name: "קוטג'" }] };
const DONE = JSON.stringify({ "w1d1-0": true, "w1d2-1": true, "glow:abc": true });
const FAV = JSON.stringify({ "w2d3-0": true });
const VIEWS = JSON.stringify({ "w1d1-0": 3 });

// 1. גיבוי במכשיר א
const A = mkLS(); const fa = make(A);
ok(fa.BK_CONTENT_KEYS.includes("mp_content_done_v1") && fa.BK_CONTENT_KEYS.includes("mp_content_fav_v1") && fa.BK_CONTENT_KEYS.includes("mp_content_views_v1"), "שלושת מפתחות הסרטונים ברשימה");
ok(fa.BK_CONTENT_KEYS.includes("mp_glow_key_v2"), "סימון ההמרה של גלו נוסע, כדי ששחזור לא ימיר שוב");
A.setItem("myprime_demo_state_v1", JSON.stringify(STATE));
A.setItem("mp_content_done_v1", DONE); A.setItem("mp_content_fav_v1", FAV); A.setItem("mp_content_views_v1", VIEWS); A.setItem("mp_glow_key_v2", "1");
const packed = fa.bkPack();
const po = JSON.parse(packed);
ok(po._content && po._content.mp_content_done_v1 === DONE, "הווים בתוך הטקסט שנשלח לגיבוי");
ok(po.log && po.log.length === 1 && po.profile.name === "איריס", "היומן עצמו לא השתנה באריזה");

// 2. שחזור במכשיר ב ריק
const B = mkLS(); const fb = make(B);
const restored = fb.bkUnpack(packed);
B.setItem("myprime_demo_state_v1", restored);
ok(B.getItem("mp_content_done_v1") === DONE, "שחזור מחזיר את הווים");
ok(B.getItem("mp_content_fav_v1") === FAV, "שחזור מחזיר את המועדפים");
ok(B.getItem("mp_content_views_v1") === VIEWS, "שחזור מחזיר את מונה הצפיות");
ok(B.getItem("mp_glow_key_v2") === "1", "שחזור מחזיר את סימון ההמרה");
ok(!("_content" in JSON.parse(restored)), "_content אינו נשאר בתוך מצב האפליקציה");
ok(JSON.stringify(JSON.parse(restored)) === JSON.stringify(STATE), "מצב האפליקציה המשוחזר זהה למקור");

// 3. גיבוי ישן, בלי _content
const C = mkLS(); const fc = make(C);
C.setItem("mp_content_done_v1", "{\"x\":true}");
const old = JSON.stringify(STATE);
ok(fc.bkUnpack(old) === old, "גיבוי ישן משוחזר בית-בית כמו קודם");
ok(C.getItem("mp_content_done_v1") === "{\"x\":true}", "גיבוי ישן אינו נוגע בווים שבמכשיר");

// 4. בלי סימוני תוכן, האריזה זהה למה שנשלח עד היום
const D = mkLS(); const fd = make(D);
D.setItem("myprime_demo_state_v1", old);
ok(fd.bkPack() === old, "אישה בלי סרטונים: נשלח בדיוק מה שנשלח עד היום");

// 5. מצב פגום אינו זורק
const E = mkLS(); const fe = make(E);
E.setItem("myprime_demo_state_v1", "not json");
ok(fe.bkPack() === "not json", "מצב שאינו JSON נשלח כמו שהוא, בלי לזרוק");
ok(fe.bkUnpack("not json") === "not json", "שחזור של טקסט שאינו JSON אינו זורק");
ok(fe.bkPack() !== undefined && make(mkLS()).bkPack() === null, "אין מצב בכלל: null כמו קודם");
const bad = JSON.stringify({ ...STATE, _content: { mp_content_done_v1: 5, evil_key: "x" } });
const F = mkLS(); make(F).bkUnpack(bad);
ok(F.getItem("evil_key") === null, "שחזור כותב רק את המפתחות שברשימה");
ok(F.getItem("mp_content_done_v1") === null, "ערך שאינו טקסט אינו נכתב");

// 6. החיווט
ok(!/bkUpload\([^)]*localStorage\.getItem\(STORAGE_KEY\)/.test(src), "שום העלאה לא שולחת את המצב בלי האריזה");
ok((src.match(/bkUpload\([^)]*bkPack\(\)/g) || []).length === 4, "ארבע ההעלאות הידניות ארוזות");
ok(/const plaintext = bkPack\(\);\s*\n\s*if \(!plaintext \|\| plaintext === bkSentRef\.current\) return;/.test(src), "הגיבוי האוטומטי ארוז, וההשוואה היא על הטקסט הארוז");
ok(/localStorage\.setItem\(STORAGE_KEY, bkUnpack\(plaintext\)\)/.test(src), "השחזור פורק");
ok(/st\.persist\(\)/.test(src) && /Firefox\|FxiOS/.test(src), "בקשת אחסון קבוע קיימת, ולא בפיירפוקס");

console.log(`backup-content-check: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
