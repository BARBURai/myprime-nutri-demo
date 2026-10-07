// רב מסר, ממשק גרסה 2.0.
//
// ⚠ לא אומת מול השרת האמיתי. ההזדהות לקוחה מהמדריך של רב מסר. כתובת השרת
// והנתיב להוספת נמען לרשימה נכתבו לפי מה שאני מכיר, כי התיעוד המלא (swaggerhub)
// חסום ברשת של סביבת העבודה. לפני שזה עולה לייצור חייבים לבדוק את שניהם.
//
// RESPONDER_CLIENT_ID, RESPONDER_CLIENT_SECRET, RESPONDER_USER_TOKEN בוורסל,
// מסומנים Sensitive. בלעדיהם החיבור כבוי והתשלום עצמו עובד כרגיל.

const BASE = "https://graph.responder.live/v2";

export function responderOn() {
  return !!(process.env.RESPONDER_CLIENT_ID && process.env.RESPONDER_CLIENT_SECRET && process.env.RESPONDER_USER_TOKEN);
}

async function call(path, init, ms = 10000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(`${BASE}${path}`, { ...init, signal: ctl.signal });
    const text = await r.text();
    if (!r.ok) throw new Error(`responder ${path} ${r.status} ${text.slice(0, 200)}`);
    try { return JSON.parse(text); } catch { return text; }
  } finally {
    clearTimeout(t);
  }
}

async function accessToken() {
  const res = await call("/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      scope: "*",
      client_id: Number(process.env.RESPONDER_CLIENT_ID),
      client_secret: process.env.RESPONDER_CLIENT_SECRET,
      user_token: process.env.RESPONDER_USER_TOKEN,
    }),
  });
  if (!res || !res.access_token) throw new Error("responder: no access_token");
  return res.access_token;
}

// מוסיף אותה לרשימה. נמענת שכבר ברשימה מתעדכנת ואינה נוצרת פעמיים, לפי רב מסר.
export async function addToList(listId, buyer) {
  const token = await accessToken();
  return call(`/lists/${encodeURIComponent(listId)}/subscribers`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      subscribers: [{
        email: buyer.email,
        first: buyer.firstName,
        last: buyer.lastName,
        phone: buyer.phone,
      }],
    }),
  });
}
