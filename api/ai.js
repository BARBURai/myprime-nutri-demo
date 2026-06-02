// Vercel serverless function: proxies requests to the Anthropic API.
// Set ANTHROPIC_API_KEY (required) and optionally AI_MODEL in the Vercel project env.
const DEFAULT_MODEL = "claude-sonnet-4-6";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: "missing ANTHROPIC_API_KEY" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    body.model = process.env.AI_MODEL || DEFAULT_MODEL; // always use a current, valid model
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
