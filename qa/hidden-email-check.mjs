// v8.68: תווים נסתרים במייל. shushkok@gmail.com, 23.11.2026: U+200F בסוף כתובת שהודבקה
// במסך הניהול, ההחלפה נשמרה, והכתובת הנקייה נחסמה. בלי רשת.
//
//   node qa/hidden-email-check.mjs

import fs from "node:fs";
import { cleanEmail, HIDDEN_CHARS } from "../api/_email.js";

process.env.ADMIN_KEY = "k";
process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "t";
let writes = 0;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (/\/(HSET|SET|DEL|HDEL|RENAME|RENAMENX|HSETNX)\//.test(u)) writes++;
  return { ok: true, json: async () => ({ result: null }) };
};
const { default: admin } = await import("../api/admin.js");

let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x ? "  → " + x : "")); } };

const RLM = "‏", LRM = "‎", ZW = "​", BOM = "﻿";
check("**U+200F בסוף נמחק** (המקרה של shushkok)", cleanEmail("shushkok@gmail.com" + RLM) === "shushkok@gmail.com");
check("U+200E בהתחלה נמחק", cleanEmail(LRM + "a@b.com") === "a@b.com");
check("רווח ברוחב אפס באמצע נמחק", cleanEmail("a" + ZW + "b@c.com") === "ab@c.com");
check("BOM ורווחים נמחקים, ואותיות קטנות", cleanEmail(BOM + "  Dana@Test.COM  ") === "dana@test.com");
check("U+202A עד U+202E נמחקים", cleanEmail("‫a@b.com‬") === "a@b.com");
check("U+2066 עד U+2069 נמחקים", cleanEmail("⁦a@b.com⁩") === "a@b.com");
check("כתובת תקינה אינה משתנה", cleanEmail("tal.167400+x@gmail.com") === "tal.167400+x@gmail.com");
check("null וריק", cleanEmail(null) === "" && cleanEmail("") === "");

const mkRes = () => { const r = { code: 0, body: null }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.setHeader = () => {}; r.send = (b) => { r.body = b; return r; }; return r; };
{
  writes = 0;
  const res = mkRes();
  await admin({ method: "POST", query: { key: "k" }, headers: {}, body: { email: "shushkok@gmail.com", newEmail: "shushkok@gmail.com" + RLM, phone: "972500000000", by: "טלי" } }, res);
  check("**החלפה לכתובת עם תו נסתר: same_email, ושום דבר לא נכתב**", res.code === 400 && res.body && res.body.error === "same_email" && writes === 0, JSON.stringify(res.body) + " writes " + writes);
}
{
  const res = mkRes();
  await admin({ method: "POST", query: { key: "k" }, headers: {}, body: { email: "shushkok@gmail.com" + RLM, newEmail: "SHUSHKOK@gmail.com", phone: "972500000000", by: "טלי" } }, res);
  check("וגם כשהתו בכתובת הישנה", res.code === 400 && res.body && res.body.error === "same_email");
}

const src = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const access = src("api/access.js"), adminJs = src("api/admin.js"), html = src("public/admin.html"), app = src("src/App.jsx");
check("**השער מנקה את המייל שהוקלד**", access.includes("const email = cleanEmail(req.query && req.query.email);"));
check("השער מנקה את הכתובת מהגשר", access.includes("if (was) lookFor = cleanEmail(was);"));
check("מסך הניהול: החלפה, חסר מייל והוספת משתתפת עוברים ב-cleanEmail",
  adminJs.includes("const to = cleanEmail(body && body.newEmail);") && adminJs.includes("const to = cleanEmail(body && body.fixEmail);") && adminJs.includes("const email = cleanEmail(a.email);"));
const pat = HIDDEN_CHARS.source;
check("**אותה רשימת תווים במסך הניהול ובאפליקציה**", html.includes(pat) && app.includes(pat), pat);
check("במסך: החלפה וחסר מייל עוברים ב-cleanMail", html.includes('var to=cleanMail(box?box.value:"");') && html.includes('var mail = cleanMail(box ? box.value : "");'));
check("**הנוסח שאושר, בשני המקומות במסך**", (html.match(/הכתובת החדשה זהה לכתובת הקיימת\. לא שונה דבר\./g) || []).length >= 3);
check("באפליקציה: השדה מתעדכן לכתובת הנקייה", app.includes("if (e !== gateEmail) setGateEmail(e);"));

console.log(`\n${pass} עברו, ${fail} נכשלו`);
process.exit(fail ? 1 : 0);
