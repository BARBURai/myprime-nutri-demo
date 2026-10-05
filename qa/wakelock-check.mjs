// v7.76: המסך נשאר דלוק כל עוד סרטון רץ. מושכת את makeWakeKeeper מתוך
// src/content/ContentModule.jsx ומריצה אותה מול דפדפן מדומה. בלי רשת.
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../src/content/ContentModule.jsx", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x === undefined ? "" : x); } };
function grab(name) {
  const i = src.indexOf(`function ${name}(`); if (i < 0) return null;
  let d = 0; for (let k = src.indexOf("{", i); k < src.length; k++) { if (src[k] === "{") d++; else if (src[k] === "}") { d--; if (d === 0) return src.slice(i, k + 1); } }
  return null;
}
const fn = grab("makeWakeKeeper");
ok(!!fn, "makeWakeKeeper קיימת");
if (!fn) { console.log(`wakelock-check: ${pass}/${pass + fail}`); process.exit(1); }
const makeWakeKeeper = new Function(`${fn}; return makeWakeKeeper;`)();
const tick = () => new Promise((r) => setTimeout(r, 0));

function fakes({ supported = true, reject = false } = {}) {
  const st = { requests: 0, releases: 0, live: 0, sentinels: [] };
  const doc = { visibilityState: "visible", ls: {}, addEventListener(t, f) { (this.ls[t] ||= []).push(f); }, removeEventListener(t, f) { this.ls[t] = (this.ls[t] || []).filter((x) => x !== f); }, fire(t) { (this.ls[t] || []).forEach((f) => f()); } };
  const nav = supported ? { wakeLock: { request(type) {
    st.requests++; if (reject) return Promise.reject(new Error("NotAllowed"));
    const s = { type, released: false, ls: [], addEventListener(t, f) { if (t === "release") this.ls.push(f); }, release() { if (!this.released) { this.released = true; st.releases++; st.live--; this.ls.forEach((f) => f()); } return Promise.resolve(); } };
    st.live++; st.sentinels.push(s); return Promise.resolve(s);
  } } } : {};
  // הטלפון מבטל את הבקשה מעצמו כשיוצאים מהאפליקציה
  const background = () => { doc.visibilityState = "hidden"; st.sentinels.forEach((s) => s.release()); doc.fire("visibilitychange"); };
  const foreground = () => { doc.visibilityState = "visible"; doc.fire("visibilitychange"); };
  return { st, doc, nav, background, foreground };
}

{ // ריצה רגילה
  const f = fakes(); const w = makeWakeKeeper(f.nav, f.doc);
  ok(f.st.requests === 0 && !w.held(), "לפני שהסרטון רץ: אין בקשה");
  w.play(); await tick();
  ok(f.st.requests === 1 && w.held(), "**הסרטון רץ: המסך נשאר דלוק**");
  ok(f.st.sentinels[0].type === "screen", "הבקשה היא על המסך");
  w.play(); w.play(); await tick();
  ok(f.st.requests === 1, "אירועי ריצה חוזרים אינם מבקשים שוב", f.st.requests);
  w.stop(); await tick();
  ok(f.st.live === 0 && !w.held(), "**עצירה משחררת**");
  w.play(); await tick(); ok(w.held() && f.st.requests === 2, "המשך ריצה מבקש מחדש");
  w.dispose(); await tick();
  ok(f.st.live === 0, "**עזיבת השיעור משחררת**");
  ok((f.doc.ls.visibilitychange || []).length === 0, "ועזיבה מסירה את המאזין");
}
{ // שתי בקשות במקביל לפני שהראשונה חזרה
  const f = fakes(); const w = makeWakeKeeper(f.nav, f.doc);
  w.play(); w.play(); w.play(); await tick();
  ok(f.st.requests === 1 && f.st.live === 1, "שלוש הפעלות רצופות: בקשה אחת", f.st.requests);
}
{ // עצירה לפני שהבקשה חזרה
  const f = fakes(); const w = makeWakeKeeper(f.nav, f.doc);
  w.play(); w.stop(); await tick();
  ok(f.st.live === 0 && !w.held(), "עצרה לפני שהבקשה חזרה: המסך אינו נשאר דלוק", f.st.live);
}
{ // יציאה וחזרה
  const f = fakes(); const w = makeWakeKeeper(f.nav, f.doc);
  w.play(); await tick(); f.background(); await tick();
  ok(!w.held(), "ברקע: הבקשה בוטלה על ידי הטלפון");
  f.foreground(); await tick();
  ok(w.held() && f.st.requests === 2, "**חזרה כשהסרטון רץ: המסך שוב נשאר דלוק**", f.st.requests);
  w.stop(); f.background(); f.foreground(); await tick();
  ok(!w.held() && f.st.requests === 2, "חזרה כשהסרטון עצור: אין בקשה", f.st.requests);
}
{ // ברקע אין בקשה
  const f = fakes(); f.doc.visibilityState = "hidden"; const w = makeWakeKeeper(f.nav, f.doc);
  w.play(); await tick(); ok(f.st.requests === 0, "לא מבקשים כשהאפליקציה ברקע");
}
{ // אין תמיכה
  const f = fakes({ supported: false }); let threw = false; let w;
  try { w = makeWakeKeeper(f.nav, f.doc); w.play(); await tick(); w.stop(); w.dispose(); } catch (e) { threw = true; }
  ok(!threw && !w.held(), "דפדפן בלי תמיכה: שום דבר לא נשבר");
  let threw2 = false; try { const x = makeWakeKeeper(null, null); x.play(); x.stop(); x.dispose(); } catch (e) { threw2 = true; }
  ok(!threw2, "בלי navigator ובלי document: לא זורק");
}
{ // הדפדפן מסרב
  const f = fakes({ reject: true }); const w = makeWakeKeeper(f.nav, f.doc);
  w.play(); await tick(); ok(!w.held(), "הדפדפן מסרב: לא נתקע ולא זורק");
  w.play(); await tick(); ok(f.st.requests === 2, "וניסיון הבא אחרי סירוב יוצא", f.st.requests);
}
// החיווט בנגן
ok(/player\.on\("play", \(\) => \{ sawPlay = true; wake\.play\(\); \}\);/.test(src), "ריצה מבקשת");
ok(/player\.on\("pause", \(\) => wake\.stop\(\)\);/.test(src) && /player\.on\("ended", \(\) => wake\.stop\(\)\);/.test(src), "עצירה וסוף משחררים");
ok(/if \(!sawPlay\) wake\.play\(\);/.test(src), "גיבוי לנגן שאינו שולח play");
ok(/return \(\) => \{ cancelled = true; wake\.dispose\(\);/.test(src), "עזיבת השיעור משחררת");
ok(!/wakeLock/.test(readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8")), "אין בקשה נוספת בשום מקום אחר באפליקציה");

console.log(`wakelock-check: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
