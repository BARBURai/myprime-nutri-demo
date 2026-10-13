// רשימת המסלולים לדוח הביטולים בגוגל שיטס. v8.15
//
//   node qa/tracks-check.mjs
//
// GET /api/admin?tracks&key=<ADMIN_KEY> מחזירה מ-mc:rows את כל מי שיש לה מסלול: טלפון,
// מסלול ותאריך התחלה. מריצה את `api/admin.js` האמיתי מול Redis מדומה, בלי רשת.
// **ובודקת שהיא קריאה בלבד:** כל פקודה שאינה HSCAN מפילה בדיקה.

let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (extra ? "  → " + extra : "")); } };

process.env.ADMIN_KEY = "owner-key";
process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";

const START = "360 - FINAL  PERSONAL START";
const row = (cells) => JSON.stringify({ cells, src: "mc" });
let rows = {}, writes = [], scanFail = false;
globalThis.fetch = async (url, opt) => {
  const u = String(url);
  if (u.indexOf("https://redis.test") !== 0) throw new Error("network " + u);
  let cmd;
  if (opt && opt.body) cmd = JSON.parse(opt.body);
  else cmd = u.slice("https://redis.test/".length).split("/").map(decodeURIComponent);
  const c = String(cmd[0]).toUpperCase();
  if (c === "HSCAN" && cmd[1] === "mc:rows") {
    if (scanFail) return { ok: true, json: async () => ({ error: "ERR max request size exceeded" }) };
    // שני עמודים, כדי לבדוק שהדפדוף עובד
    const ent = Object.entries(rows), half = Math.ceil(ent.length / 2);
    const page = cmd[2] === "0" ? ent.slice(0, half) : ent.slice(half);
    return { ok: true, json: async () => ({ result: [cmd[2] === "0" && ent.length > half ? "7" : "0", page.flat()] }) };
  }
  if (c === "HGET" && cmd[1] === "admin:codes") return { ok: true, json: async () => ({ result: cmd[2] === "clerk-code" ? JSON.stringify({ name: "טלי" }) : null }) };
  if (c !== "GET" && c !== "HGET" && c !== "HGETALL" && c !== "HSCAN") writes.push(cmd);
  return { ok: true, json: async () => ({ result: null }) };
};

const { default: handler } = await import("../api/admin.js");
async function call(query) {
  let code = 0, out = null;
  await handler({ method: "GET", query, headers: {} }, { setHeader() {}, status: (c) => { code = c; return { json: (j) => { out = j; }, send: (j) => { out = j; } }; } });
  return { code, out };
}

rows = {
  "972500000010": row({ ID: "972500000010", [START]: "2026-10-11T12:00:00+03:00", SMART: "TRUE", "ביטלה": "TRUE", SOLO10WEEK: "", SOLO6: "", SOLO12: "" }),
  "972500000011": row({ ID: "972500000011", [START]: "2026-10-11T12:00:00+03:00", SMART: "", "ביטלה": "TRUE", SOLO10WEEK: "", SOLO6: "" }),
  "972500000001": row({ ID: "972500000001", [START]: "27/09/2026", SOLO10WEEK: "true" }),
  "972500000002": row({ ID: "972500000002", [START]: "2026-09-02", SOLO6: "TRUE" }),
  "972500000003": row({ ID: "972500000003", [START]: "2026-08-30", SOLO12: "TRUE", SMART: "TRUE" }),
  "972500000004": row({ ID: "972500000004", SMART: "TRUE" }),
  "972500000005": row({ ID: "972500000005", "GLOW-FULL": "TRUE", [START]: "2026-10-04" }),
  "972500000006": "not json",
  "972500000012": row({ ID: "972500000012", "השתתפה בוובינר": "TRUE", "EAT - Personal Start": "2026-09-01" }),
};

console.log("\nמי מקבלת את הרשימה\n");
check("בלי מפתח: 401", (await call({ tracks: "" })).code === 401);
check("קוד של עובדת: 403, כי זו רשימה של כולן", (await call({ tracks: "", key: "clerk-code" })).code === 403);
const r = await call({ tracks: "", key: "owner-key" });
check("מפתח המנהל: 200", r.code === 200, String(r.code));
const by = Object.fromEntries((r.out.rows || []).map((x) => [x.phone, x]));

console.log("\nהמסלולים\n");
check("**סמארט עם ביטלה יוצאת SMART**, מ-11.10", JSON.stringify(by["972500000010"]) === JSON.stringify({ phone: "972500000010", track: "SMART", start: "2026-10-11" }), JSON.stringify(by["972500000010"]));
check("**ביטלה בלי מסלול אינה ברשימה**", !by["972500000011"]);
check("SOLO10WEEK יוצא SMART", by["972500000001"] && by["972500000001"].track === "SMART");
check("ותאריך בצורה 27/09/2026 יוצא 2026-09-27", by["972500000001"] && by["972500000001"].start === "2026-09-27");
check("SOLO6", by["972500000002"] && by["972500000002"].track === "SOLO6");
check("ותאריך שאינו יום ראשון מעוגל ליום ראשון, כמו בשער", by["972500000002"] && by["972500000002"].start === "2026-08-30", by["972500000002"] && by["972500000002"].start);
check("SOLO12 עם SMART: הארוך מנצח", by["972500000003"] && by["972500000003"].track === "SOLO12");
check("מסלול בלי תאריך התחלה: start ריק", by["972500000004"] && by["972500000004"].start === "");
check("Glow בלי מסלול אינה ברשימה", !by["972500000005"]);
check("שורה פגומה מדולגת ואינה מפילה", !by["972500000006"]);
check("count תואם", r.out.count === 5 && r.out.rows.length === 5, String(r.out.count));
check("ממוין לפי תאריך התחלה", r.out.rows.map((x) => x.start).join() === ["", "2026-08-30", "2026-08-30", "2026-09-27", "2026-10-11"].join(), r.out.rows.map((x) => x.start).join());

console.log("\nנשות 360 בכתובת נפרדת, ?tracks=360. v8.18\n");
// רון: לסמארט ול-360 שני גיליונות, ואסור לערבב. **?tracks נשאר בדיוק כמו קודם**, וזה מה
// שהבדיקות למעלה נועלות: 5 שורות, ואף אחת לא 360.
check("**?tracks לא השתנה: אף שורה של 360**", r.out.rows.every((x) => x.track !== "360"));
const t360 = await call({ tracks: "360", key: "owner-key" });
const b360 = Object.fromEntries((t360.out.rows || []).map((x) => [x.phone, x]));
check("?tracks=360 עונה 200", t360.code === 200, String(t360.code));
check("**ורק 360**", (t360.out.rows || []).every((x) => x.track === "360"));
check("**ביטלה בלי מסלול נספרת**, כי היא במכנה של המחזור", JSON.stringify(b360["972500000011"]) === JSON.stringify({ phone: "972500000011", track: "360", start: "2026-10-11" }), JSON.stringify(b360["972500000011"]));
check("360 עם Glow נספרת", b360["972500000005"] && b360["972500000005"].start === "2026-10-04");
check("סמארט, סולו 6 וסולו 12 אינן שם", !b360["972500000010"] && !b360["972500000002"] && !b360["972500000003"] && !b360["972500000001"]);
check("ליד בלי תאריך של 360 אינו שם, גם עם תאריך בשדה אחר", !b360["972500000012"]);
check("count תואם", t360.out.count === 2 && t360.out.rows.length === 2, String(t360.out.count));
check("ערך אחר מ-360 מחזיר את הרשימה הרגילה", (await call({ tracks: "x", key: "owner-key" })).out.count === 5);

console.log("\nמפתח לדוח בלבד, REPORT_KEY. v8.16\n");
check("בלי המשתנה בוורסל, מפתח ריק אינו פותח", (await call({ tracks: "", key: "" })).code === 401);
process.env.REPORT_KEY = "report-only-key";
const rk = await call({ tracks: "", key: "report-only-key" });
check("**מפתח הדוח פותח את הרשימה**", rk.code === 200 && rk.out.count === 5, rk.code + " " + (rk.out && rk.out.count));
check("**ואינו פותח את מסך הניהול**", (await call({ key: "report-only-key" })).code === 401);
check("ואינו פותח את נתוני השימוש", (await call({ usage: "a@b.com", key: "report-only-key" })).code === 401);
check("מפתח שגוי: 401", (await call({ tracks: "", key: "report-only-kex" })).code === 401);
check("ומפתח המנהל ממשיך לפתוח", (await call({ tracks: "", key: "owner-key" })).code === 200);
const rk360 = await call({ tracks: "360", key: "report-only-key" });
check("**מפתח הדוח פותח גם את ?tracks=360**", rk360.code === 200 && rk360.out.count === 2, rk360.code + " " + (rk360.out && rk360.out.count));

console.log("\nקריאה בלבד, ותקלה נאמרת\n");
check("**שום כתיבה ל-Redis**", writes.length === 0, JSON.stringify(writes));
scanFail = true;
const bad = await call({ tracks: "", key: "owner-key" });
check("קריאה שנכשלה: 502 ולא רשימה ריקה", bad.code === 502 && bad.out.ok === false, bad.code + " " + JSON.stringify(bad.out));

console.log("\n" + pass + " מתוך " + (pass + fail) + " עברו.");
process.exit(fail ? 1 : 0);
