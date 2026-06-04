// Vercel serverless proxy to USDA FoodData Central (FDC) food search.
// Set USDA_API_KEY in the Vercel project env — get a free key at
// https://fdc.nal.usda.gov/api-key-signup.html . Falls back to DEMO_KEY
// (heavily rate-limited) if not set, so the endpoint still answers in dev.
//
// FDC search returns per-100g nutrient values in `foodNutrients` for the
// generic data types (Foundation / SR Legacy / Survey FNDDS) and normalized
// per-100g for Branded too. We read Energy(kcal)=208, Protein=203,
// Total lipid/fat=204, Carbohydrate=205, and prefer generic data types.
//
// Debug: /api/usda?q=grilled%20ribeye%20steak&debug=1

const KEY = process.env.USDA_API_KEY || "DEMO_KEY";
const RANK = { "Foundation": 0, "SR Legacy": 1, "Survey (FNDDS)": 2, "Branded": 3 };

function nutrient(list, number) {
  for (const n of list || []) {
    const num = n.nutrientNumber || (n.nutrient && n.nutrient.number);
    if (String(num) === String(number)) {
      const v = n.value != null ? n.value : (n.amount != null ? n.amount : null);
      if (v != null && isFinite(v)) return Number(v);
    }
  }
  return 0;
}

export default async function handler(req, res) {
  const q = ((req.query && req.query.q) || "").toString().trim();
  if (!q) return res.status(200).json({ items: [] });
  try {
    const dataTypes = encodeURIComponent("Foundation,SR Legacy,Survey (FNDDS),Branded");
    const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(KEY)}&query=${encodeURIComponent(q)}&pageSize=15&dataType=${dataTypes}`;
    const r = await fetch(url);
    if (!r.ok) return res.status(200).json({ items: [], error: "usda " + r.status });
    const data = await r.json();
    const foods = (data.foods || []).slice().sort((a, b) => (RANK[a.dataType] ?? 9) - (RANK[b.dataType] ?? 9));
    const items = [];
    for (const f of foods) {
      const ns = f.foodNutrients || [];
      const kcal = nutrient(ns, 208);
      if (!kcal) continue;
      items.push({
        name: (f.description || "").trim(),
        brand: (f.brandName || f.brandOwner || "").trim(),
        dataType: f.dataType,
        kcal: Math.round(kcal),
        p: Math.round(nutrient(ns, 203)),
        f: Math.round(nutrient(ns, 204)),
        c: Math.round(nutrient(ns, 205)),
      });
      if (items.length >= 10) break;
    }
    if (req.query && req.query.debug) {
      return res.status(200).json({ q, key: KEY === "DEMO_KEY" ? "DEMO_KEY (set USDA_API_KEY!)" : "set", count: items.length, items });
    }
    return res.status(200).json({ items });
  } catch (e) {
    return res.status(200).json({ items: [], error: String(e) });
  }
}
