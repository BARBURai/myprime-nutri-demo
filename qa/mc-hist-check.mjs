// יומן מלא בכרטיס: שינויים ממניצ'ט וקניות. v8.71
//
//   node qa/mc-hist-check.mjs
//
// רון: "שביומן יהיה רשום שם הכל כל מה שהיא עשתה לפי תאריכים". בלי רשת: Redis בזיכרון.
process.env.UPSTASH_REDIS_REST_URL = "redis://r";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";
delete process.env.MANYCHAT_TOKEN;
import fs from "node:fs";

let H = {}, redisDown = false;
const hash = (k) => (H[k] = H[k] || {});
function run(cmd) {
  const [c, ...a] = cmd.map(String);
  switch (c) {
    case "HGET": return (H[a[0]] || {})[a[1]] ?? null;
    case "HSET": { const h = hash(a[0]); for (let i = 1; i + 1 < a.length; i += 2) h[a[i]] = a[i + 1]; return 1; }
    case "HDEL": if (H[a[0]]) for (const f of a.slice(1)) delete H[a[0]][f]; return 1;
    default: return 1;
  }
}
globalThis.fetch = async (url, opt) => {
  const u = String(url);
  if (u.startsWith("redis://")) {
    if (redisDown === true) throw new Error("down");
    const cmd = opt && opt.body ? JSON.parse(opt.body) : u.slice(10).split("/").map(decodeURIComponent);
    if (redisDown === "hist" && cmd[1] === "admin:hist") throw new Error("down");
    return { ok: true, json: async () => ({ result: run(cmd) }) };
  }
  throw new Error("רשת לא צפויה: " + u);
};

let pass = 0, fail = 0;
const ck = (name, ok, extra) => { if (ok) pass++; else { fail++; console.log("  ✗ " + name, extra !== undefined ? JSON.stringify(extra) : ""); } };

const { ingest, mcHistDiff, histAdd, HIST_KEY, HIST_MAX } = await import("../api/_mcsync.js");
const START = "360 - FINAL  PERSONAL START";
const body = (o) => ({ ID: "972501111111", CF_EMAIL: "a@test.com", ...o });
const hist = (em = "a@test.com") => JSON.parse((H[HIST_KEY] || {})[em] || "[]");

// ---------- הפונקציה עצמה ----------
const row = (cells, tags) => ({ cells, ...(tags ? { tags } : {}) });
ck("שורה ראשונה: נרשמה עם מחזור", JSON.stringify(mcHistDiff(null, { [START]: "2026-11-29 12:00" }, null)) === JSON.stringify([{ field: "mc:join", to: "2026-11-29" }]));
ck("אין שינוי: אין שורה", mcHistDiff(row({ [START]: "2026-11-29", SMART: "TRUE", "קבוצה": "א" }), { [START]: "2026-11-29", SMART: "TRUE", "קבוצה": "א" }, null).length === 0);
ck("תאריך התחלה שונה", JSON.stringify(mcHistDiff(row({ [START]: "16/03/2025" }), { [START]: "2026-11-30" }, null)) === JSON.stringify([{ field: "mc:start", from: "2025-03-16", to: "2026-11-29" }]), mcHistDiff(row({ [START]: "16/03/2025" }), { [START]: "2026-11-30" }, null));
ck("תאריך ראשון אחרי שלא היה: נרשמה", mcHistDiff(row({ SMART: "TRUE" }), { SMART: "TRUE", [START]: "2026-11-29" }, null)[0].field === "mc:join");
const d = mcHistDiff(row({ [START]: "2026-11-29", "ביטלה": "TRUE" }), { [START]: "2026-11-29", SMART: "TRUE", "ביטלה": "", "GLOW-FULL": "TRUE", "GLOW-SOLO": "TRUE", "קבוצה": "ב" }, null);
const f = (x) => d.find((e) => e.field === x);
ck("סמארט נוסף", f("mc:smart") && f("mc:smart").to === "1");
ck("SOLO10WEEK נחשב סמארט", mcHistDiff(row({ SOLO10WEEK: "TRUE" }), { SMART: "TRUE" }, null).length === 0);
ck("ביטול 360 הוסר", f("mc:cancelled") && f("mc:cancelled").to === "");
ck("קורס מלא נוסף", f("mc:glowfull") && f("mc:glowfull").to === "1");
ck("הטבת Glow נוספה", f("mc:glowsolo") && f("mc:glowsolo").to === "1");
ck("קבוצה שונתה מריק", f("mc:group") && f("mc:group").from === "" && f("mc:group").to === "ב");
const t = mcHistDiff(row({}, ["הקפאה", "ביטול בתהליך ❌❌"]), {}, ["X"]);
ck("הקפאה הוסרה", t.some((e) => e.field === "mc:freeze" && e.to === ""));
ck("ביטול בתהליך הוסר", t.some((e) => e.field === "mc:cancelproc" && e.to === ""));
ck("תגית נוספה", mcHistDiff(row({}, []), {}, ["הקפאה"]).some((e) => e.field === "mc:freeze" && e.to === "1"));
ck("**בלי רשימת תגיות באחת הבקשות, תגיות אינן נבדקות**", mcHistDiff(row({}, ["הקפאה"]), {}, null).length === 0 && mcHistDiff(row({}), {}, ["הקפאה"]).length === 0);

// ---------- histAdd ----------
H = {};
const rp = (cmd) => Promise.resolve(run(cmd));
await histAdd(rp, "b@test.com", [{ field: "buy", to: "SMART", order: "o1" }], Date.parse("2026-11-23T10:00:00Z"));
await histAdd(rp, "b@test.com", [{ field: "buy", to: "SMART", order: "o1" }]);
ck("**אותה הזמנה נרשמת פעם אחת**", hist("b@test.com").length === 1 && hist("b@test.com")[0].at === "2026-11-23T10:00:00.000Z");
await histAdd(rp, "b@test.com", [{ field: "buy", to: "360", order: "o2" }]);
ck("החדש למעלה", hist("b@test.com")[0].order === "o2");
for (let i = 0; i < HIST_MAX + 10; i++) await histAdd(rp, "c@test.com", [{ field: "mc:group", to: String(i) }]);
ck("תקרה של " + HIST_MAX, hist("c@test.com").length === HIST_MAX && hist("c@test.com")[0].to === String(HIST_MAX + 9));
ck("בלי מייל לא נכתב", (await histAdd(rp, "", [{ field: "x" }])) === 0);

// ---------- דרך ingest האמיתי ----------
H = {};
let r = await ingest(body({ [START]: "2026-11-29 12:00", "קבוצה": "" }), "redis://r", "t", Date.parse("2026-11-23T08:00:00Z"));
ck("ingest: 200", r.status === 200, r);
ck("ingest: הרשמה ראשונה ביומן", hist().length === 1 && hist()[0].field === "mc:join" && hist()[0].to === "2026-11-29", hist());
await ingest(body({ [START]: "2026-11-29 12:00", SMART: "TRUE" }), "redis://r", "t", Date.parse("2026-11-23T09:00:00Z"));
ck("ingest: סמארט נוסף ביומן", hist()[0].field === "mc:smart" && hist().length === 2, hist());
await ingest(body({ [START]: "2026-11-29 12:00", SMART: "TRUE" }), "redis://r", "t");
ck("ingest: בקשה בלי שינוי אינה מוסיפה", hist().length === 2);
ck("**היומן אינו יוצר רשומה בסימוני המשרד**", !(H["admin:overrides"] || {})["a@test.com"]);
redisDown = "hist";
r = await ingest(body({ [START]: "2026-12-06 12:00", SMART: "TRUE" }), "redis://r", "t");
redisDown = false;
ck("**תקלה ביומן אינה מכשילה את הבקשה**", r.status === 200 && JSON.parse(H["mc:rows"]["972501111111"]).cells[START].startsWith("2026-12-06"), r);

// ---------- הכפילות עם סימון המשרד ----------
H = {};
hash("mc:rows")["972501111111"] = JSON.stringify({ cells: { ID: "972501111111", CF_EMAIL: "a@test.com", [START]: "2026-11-29" }, tags: ["ביטול בתהליך ❌❌"], src: "mc" });
hash("admin:overrides")["a@test.com"] = JSON.stringify({ blocked: "1", log: [] });
await ingest({ id: "1", whatsapp_phone: "972501111111", custom_fields: { CF_EMAIL: "a@test.com", [START]: "2026-11-29" }, tags: [] }, "redis://r", "t");
const ov = JSON.parse(H["admin:overrides"]["a@test.com"]);
ck("סימון המשרד הוסר ונרשם ביומן המשרד", ov.blocked === "" && ov.log[0].field === "mc:cancelproc");
ck("**ולא נרשם פעם שנייה ביומן ממניצ'ט**", !hist().some((e) => e.field === "mc:cancelproc"), hist());

// ---------- המסך ----------
const html = fs.readFileSync("public/admin.html", "utf8");
const src = html.slice(html.indexOf("  function mcHistText(L){"), html.indexOf("  function logLines(w){"));
const il = (x) => { const p = x.split("-"); return p[2] + "." + p[1] + "." + p[0]; };
const esc = (x) => String(x);
const mcHistText = new Function("il", "esc", src + "; return mcHistText;")(il, esc);
const T = (L) => mcHistText(L);
const want = [
  [{ field: "mc:join", to: "2026-11-30" }, "נרשמה, מחזור של 30.11.2026"],
  [{ field: "mc:start", from: "2025-03-16", to: "2026-11-30" }, "תאריך ההתחלה שונה מ-16.03.2025 ל-30.11.2026"],
  [{ field: "mc:smart", to: "1" }, "נרשמה לסמארט"], [{ field: "mc:smart", to: "" }, "סמארט הוסר"],
  [{ field: "mc:cancelled", to: "1" }, "סומנה כמבטלת 360"], [{ field: "mc:cancelled", to: "" }, "הביטול של 360 הוסר"],
  [{ field: "mc:cancelproc", to: "1" }, "סומנה כביטול בתהליך"], [{ field: "mc:cancelproc", to: "" }, "ביטול בתהליך הוסר"],
  [{ field: "mc:glowfull", to: "1" }, "קיבלה את קורס האיפור המלא"], [{ field: "mc:glowfull", to: "" }, "קורס האיפור המלא הוסר"],
  [{ field: "mc:glowsolo", to: "1" }, "קיבלה את הטבת Glow"], [{ field: "mc:glowsolo", to: "" }, "הטבת Glow הוסרה"],
  [{ field: "mc:freeze", to: "1" }, "נכנסה להקפאה"], [{ field: "mc:freeze", to: "" }, "ההקפאה הוסרה"],
  [{ field: "mc:group", from: "א", to: "ב" }, "הקבוצה שונתה מ-א ל-ב"],
  [{ field: "buy", to: "SMART" }, "קנתה סמארט"], [{ field: "buy", to: "360" }, "קנתה 360"],
];
for (const [L, w] of want) ck("נוסח: " + w, T(L) === w, T(L));
ck("במסך: היומן ממוזג עם יומן המשרד", html.includes("(w.log||[]).concat((w.mcHist||[])") && html.includes("w.mcHist = s.state === \"ok\""));
const adm = fs.readFileSync("api/admin.js", "utf8");
ck("השרת: היומן חוזר עם נתוני השימוש", adm.includes("return res.status(200).json({ ok: true, usage, hist });"));
ck("השרת: קנייה נרשמת בשני הנתיבים", (adm.match(/await histBuy\(body, "(SMART|360)"/g) || []).length === 2);

console.log(`\nmc-hist-check: ${pass} מתוך ${pass + fail}`);
process.exit(fail ? 1 : 0);
