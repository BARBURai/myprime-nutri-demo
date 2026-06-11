// Shared helpers for the product catalog (used by api/ai.js and api/catalog.js).
// Kept OUTSIDE /api so Vercel does not treat it as a route.

// Normalize a food name / query into a stable catalog key fragment.
export function normName(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/["'`.,!?:;]/g, "")
    .replace(/\s+/g, " ");
}

// Plausibility gate for per-100 nutrition values (Atwater + range sanity).
// Returns true only if the values look like real food data. This is the
// entry condition for the SHARED catalog - anything failing stays private.
export function plausiblePer100(p) {
  if (!p) return false;
  const kcal = Number(p.kcal), prot = Number(p.p), fat = Number(p.f), carb = Number(p.c);
  if (![kcal, prot, fat, carb].every((x) => Number.isFinite(x) && x >= 0)) return false;
  // hard range limits per 100g/ml
  if (kcal > 900 || prot > 100 || fat > 100 || carb > 100) return false;
  if (prot + fat + carb > 105) return false; // a little slack for rounding
  // Atwater consistency: kcal ~= 4*protein + 9*fat + 4*carbs, with generous slack
  // (rounding, fiber, sugar alcohols, alcohol). Catches gross errors (e.g. 2x off).
  const atwater = 4 * prot + 9 * fat + 4 * carb;
  const hi = atwater * 1.5 + 25;
  const lo = Math.max(0, atwater * 0.5 - 25);
  return kcal <= hi && kcal >= lo;
}

// Source trust ranking - higher wins when merging entries for the same name.
export function sourceRank(src) {
  if (src === "verified") return 3;      // matched to a real food DB / barcode
  if (src === "barcode") return 3;
  if (src === "estimated") return 1;     // AI estimate
  return 0;
}
