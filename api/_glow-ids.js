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

// והקורס המלא, שניתן במתנה בוובינר למי שמסומנת בעמודה `GLOW-FULL`. שלושת
// השיעורים החינמיים שלמעלה הם חלק ממנו, ולכן מי שיש לה את המלא רשאית גם להם.
// המזהים כאן חייבים להישאר זהים ל-`src/content/glow.js`, ו-qa/glow-check.mjs
// נופלת על כל הבדל: שיעור שנוסף בצד אחד בלבד יהיה או בלתי ניתן לצפייה, או
// פתוח לכל אישה בתוכנית.
export const GLOW_FULL_VIDEO_IDS = [
  "405fc049-0e7a-4447-9f1d-193845c0b4b9",
  "82f8a94b-12ce-4280-b98c-b5eb5cec6824",
  "c72cbeaa-cf87-411e-a78c-a9d9c72f5f6a",
  "f7dc36be-25b6-45ef-bb9c-4315b94cddb4",
  "6a7b153a-779a-4de9-8c74-8b23f1ff47cb",
  "95b14af8-3cdf-4e18-9a6a-d43d06054586",
  "06281ff4-cdbe-4836-ae9a-962094c537de",
  "1f276a60-68d5-4130-9870-4e320970dff2",
  "81e96d03-c4a6-40e5-9442-432629fd8b33",
  "6c87da14-7747-472e-a68a-c7fefb2e0969",
  "333ac741-4dba-41d5-bdce-946503c74660",
  "50d5ec30-4741-4a86-bbd8-ee5c6237c33b",
  "4ffcb4d6-7f4b-4e4a-9322-f1165ecfbbe3",
  "0bde2e6e-01ec-483d-bcbe-f8a700bdb0bf",
  "3ca16fc0-d817-4985-a421-d0ee98f34d8a",
  "10ac207c-9b8f-4763-ab17-5f743beabb84",
  "e70cd96a-829e-4c34-a0bb-5fe653337457",
  "ab473fd9-60de-4421-b99a-ce43184b0e5e",
  "8a3e3173-0150-4d8e-8080-f31f1661b06d",
  "70db58d5-33cb-40a6-9c25-f5c373da0c44",
  "f21a9dd6-fe84-4223-9cd4-e82e240813a1",
  "3c9713fa-e937-4ddf-a97e-d365d81a7d72",
  "3bb104f4-60e6-4dcd-b210-32eccff7620f",
  "5ff04d74-935c-413f-a592-78fbae3c46d4",
  "37122f6b-4b2c-46b0-9ca0-184e79fba464",
  "c13d503f-ead8-452d-9c3b-8b6655f29111",
  "7d95e3e2-4c9e-4ac8-a13f-fdf4b4635d46",
  "4870cb33-36b0-4a0d-9db4-f99020acfea5",
];

export const isGlowFullVideo = (id) => GLOW_FULL_VIDEO_IDS.includes(String(id || "").trim());
