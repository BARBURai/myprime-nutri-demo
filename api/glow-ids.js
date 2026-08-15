// The Bunny video ids of the מיי פריים Glow bonus lessons.
//
// Why this list exists on the server at all: every video id in the app ships inside the
// JavaScript bundle, so anyone who opens the app once can read all of them. For the 60
// programme days that costs nothing - she is a registered participant either way. The bonus
// is different: it is given to some women and not others, and it is the taster for a course
// we intend to sell. So api/bunny-token.js refuses to sign these four ids unless the caller
// is a woman the registration sheet marks with `בונוס איפור`.
//
// This list MUST stay identical to src/content/glow.js. qa/glow-check.mjs compares the two
// and fails on any difference: a new bonus lesson added on one side only would either be
// unplayable for everyone, or open to everyone.
export const GLOW_VIDEO_IDS = [
  "405fc049-0e7a-4447-9f1d-193845c0b4b9",
  "f7dc36be-25b6-45ef-bb9c-4315b94cddb4",
  "81e96d03-c4a6-40e5-9442-432629fd8b33",
  "333ac741-4dba-41d5-bdce-946503c74660",
];

export const isGlowVideo = (id) => GLOW_VIDEO_IDS.includes(String(id || "").trim());
