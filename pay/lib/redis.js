// Upstash דרך REST, כמו באפליקציה. בלי Redis הכל עדיין עובד חוץ משני דברים:
// הגנה מפני דיווח כפול של אותה עסקה, ורשימת "לא השלימה רכישה".

export function redisOn() {
  return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

export async function redis(cmd, ms = 4000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(process.env.UPSTASH_REDIS_REST_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(cmd),
      signal: ctl.signal,
    });
    if (!r.ok) throw new Error("redis " + r.status);
    return (await r.json()).result;
  } finally {
    clearTimeout(t);
  }
}
