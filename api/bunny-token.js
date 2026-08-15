import crypto from "node:crypto";
import { isGlowVideo } from "./glow-ids.js";

// Bunny Stream library that holds the MyPrime course videos.
// The library ID and CDN hostname are NOT secret (they appear in every play URL),
// so they live here. The signing key is secret and is read from the environment.
const LIBRARY_ID = "681869";
const TOKEN_TTL_SECONDS = 3 * 60 * 60; // signed embed URL is valid for 3 hours

// Embed View Token Authentication (Bunny): the token is the HEX SHA256 of
// (security_key + video_id + expiration_unix_seconds). The embedded player
// then signs its own CDN requests, so we only sign the iframe embed URL here.
// Docs: https://docs.bunny.net/docs/stream-embed-token-authentication
export default async function handler(req, res) {
  const videoId = String((req.query && req.query.videoId) || "").trim();
  if (!videoId || !/^[a-zA-Z0-9-]{8,}$/.test(videoId)) {
    res.status(400).json({ error: "bad_video_id" });
    return;
  }
  const key = process.env.BUNNY_TOKEN_KEY;
  if (!key) {
    res.status(500).json({ error: "not_configured" });
    return;
  }

  // The bonus lessons are the only videos here that not every participant is entitled to.
  // The flag is written by api/access.js on every entry, so removing the TRUE in the sheet
  // takes her access away on her next load rather than at some later refresh.
  //
  // Deliberately fail CLOSED: no email, no flag, or Redis unreachable all mean no. The
  // programme's own 88 videos are untouched by this and keep working in every case, so a
  // Redis hiccup can never lock a woman out of the course she paid for.
  if (isGlowVideo(videoId)) {
    const email = String((req.query && req.query.email) || "").trim().toLowerCase();
    const RU = process.env.UPSTASH_REDIS_REST_URL;
    const RT = process.env.UPSTASH_REDIS_REST_TOKEN;
    let ok = false;
    if (email && email.includes("@") && RU && RT) {
      try {
        const r = await fetch(`${RU}/GET/${encodeURIComponent("glow:" + email)}`, { headers: { Authorization: `Bearer ${RT}` } });
        if (r.ok) ok = (await r.json()).result === "1";
      } catch (e) { ok = false; }
    }
    if (!ok) {
      res.status(403).json({ error: "not_entitled" });
      return;
    }
  }
  const expires = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const token = crypto.createHash("sha256").update(key + videoId + expires).digest("hex");
  const url = `https://iframe.mediadelivery.net/embed/${LIBRARY_ID}/${videoId}?token=${token}&expires=${expires}&autoplay=false&preload=false`;
  // Short browser cache so a quick re-open does not re-sign, but well under the TTL.
  res.setHeader("Cache-Control", "private, max-age=600");
  res.status(200).json({ url, expires });
}
