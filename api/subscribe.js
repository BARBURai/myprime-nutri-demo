// Web Push subscription endpoint for the daily 19:00 diary reminder.
//   GET  /api/subscribe                         -> { ok, publicKey }  (client needs this before subscribing)
//   POST /api/subscribe { email, subscription } -> { ok }             (stores / refreshes the subscription)
// Subscriptions live in a Redis HASH `push:subs`: field = endpoint, value = JSON({ email, sub, ts }).
// Reuses the SAME Upstash Redis as the access gate / backup.
//   Env: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, VAPID_PUBLIC

async function redisCmd(base, token, cmd) {
  const r = await fetch(base, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const d = await r.json();
  return d.result;
}

export default async function handler(req, res) {
  const PUB = process.env.VAPID_PUBLIC || "";

  if (req.method === "GET") {
    return res.status(200).json({ ok: !!PUB, publicKey: PUB });
  }
  if (req.method !== "POST") return res.status(405).json({ ok: false });

  const RU = process.env.UPSTASH_REDIS_REST_URL;
  const RT = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!RU || !RT) return res.status(200).json({ ok: false, reason: "not_configured" });

  const body = req.body || {};
  const email = String(body.email || "").trim().toLowerCase();
  const sub = body.subscription;
  if (!sub || !sub.endpoint) return res.status(200).json({ ok: false, reason: "no_sub" });

  const record = JSON.stringify({ email, sub, ts: Date.now() });
  try {
    await redisCmd(RU, RT, ["HSET", "push:subs", sub.endpoint, record]);
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: "store_failed" });
  }
}
