// Serverless proxy to the Israeli Ministry of Health National Nutrition Database
// (data.gov.il CKAN). No API key required — open government data.
const BASE = "https://data.gov.il/api/3/action";
const DATASET = "nutrition-database";
let cachedResourceIds = null;

async function getResourceIds() {
  if (cachedResourceIds) return cachedResourceIds;
  const r = await fetch(`${BASE}/package_show?id=${DATASET}`);
  const j = await r.json();
  const resources = (j.result && j.result.resources) || [];
  const active = resources.filter((x) => x.datastore_active);
  // Prefer resources that look like the main food table.
  const score = (x) => {
    const n = ((x.name || "") + " " + (x.description || "")).toLowerCase();
    if (/מזון|מצרכ|מאכל|ליבה|food/.test(n)) return 2;
    if (/מתכון|recipe|משקל|weight/.test(n)) return 0;
    return 1;
  };
  cachedResourceIds = active.sort((a, b) => score(b) - score(a)).map((x) => x.id);
  return cachedResourceIds;
}

const num = (v) => {
  const n = parseFloat(String(v).replace(/[^\d.\-]/g, ""));
  return isFinite(n) ? n : 0;
};
function pick(rec, keys, subs) {
  for (const k of keys) if (rec[k] != null && rec[k] !== "") return rec[k];
  for (const key of Object.keys(rec)) {
    const lk = key.toLowerCase();
    if (subs.some((s) => lk.includes(s))) {
      const val = rec[key];
      if (val != null && val !== "") return val;
    }
  }
  return null;
}
function normalize(rec) {
  const name = pick(rec, ["shmmitzrach", "Food_Name", "food_name"], ["שם", "name", "מצרך"]);
  const kcal = pick(rec, ["food_energy", "energy", "Energy"], ["אנרגיה", "קלור", "energy", "kcal"]);
  if (!name || kcal == null) return null;
  return {
    name: String(name).trim(),
    kcal: Math.round(num(kcal)),
    p: Math.round(num(pick(rec, ["protein", "Protein"], ["חלבון", "protein"]))),
    f: Math.round(num(pick(rec, ["total_fat", "fat", "Total_Fat"], ["שומן", "fat"]))),
    c: Math.round(num(pick(rec, ["carbohydrates", "carbohydrate", "Carbohydrates"], ["פחמימ", "carbo"]))),
  };
}

export default async function handler(req, res) {
  const q = (req.query && req.query.q ? String(req.query.q) : "").trim();
  if (!q) return res.status(200).json({ items: [] });
  try {
    const ids = await getResourceIds();
    for (const id of ids.slice(0, 4)) {
      const url = `${BASE}/datastore_search?resource_id=${id}&q=${encodeURIComponent(q)}&limit=20`;
      const r = await fetch(url);
      const j = await r.json();
      const records = (j.result && j.result.records) || [];
      const items = records.map(normalize).filter((x) => x && x.kcal > 0).slice(0, 12);
      if (items.length) return res.status(200).json({ items, resource_id: id });
    }
    return res.status(200).json({ items: [] });
  } catch (e) {
    return res.status(200).json({ items: [], error: String(e) });
  }
}
