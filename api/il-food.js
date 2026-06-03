// Serverless proxy to the Israeli national nutrition database ("צמרת", Ministry of Health)
// published on data.gov.il (CKAN). No API key required — open government data.
//
// The dataset's resources are NOT datastore-active (they are downloadable CSV files,
// last updated 2022), so `datastore_search` returns nothing. This function therefore
// downloads the CSV resource(s) directly (works from Vercel's open network), parses and
// caches them in module scope, and does a substring search over the Hebrew food names.
// It still tries `datastore_search` first in case a resource ever becomes queryable.

const BASE = "https://data.gov.il/api/3/action";
const DATASET = "nutrition-database";

let cachedResources = null;          // resource metadata list
const csvFoodCache = new Map();      // url -> { foods: [...], headers: [...] }

async function getResources() {
  if (cachedResources) return cachedResources;
  const r = await fetch(`${BASE}/package_show?id=${DATASET}`);
  const j = await r.json();
  const resources = (j.result && j.result.resources) || [];
  // Score: prefer the per-100g food/ingredient table, deprioritize recipes/weights.
  const score = (x) => {
    const n = ((x.name || "") + " " + (x.description || "")).toLowerCase();
    if (/מתכון|recipe|משקל|weight|מנה|portion/.test(n)) return 0;
    if (/מזון|מצרכ|מאכל|רכיב|תזונ|100|food|nutri/.test(n)) return 3;
    return 1;
  };
  cachedResources = resources
    .map((x) => ({ id: x.id, name: x.name || "", description: x.description || "", url: x.url || "", format: (x.format || "").toLowerCase(), datastore_active: !!x.datastore_active, _score: score(x) }))
    .sort((a, b) => b._score - a._score);
  return cachedResources;
}

const num = (v) => {
  const n = parseFloat(String(v == null ? "" : v).replace(/[^\d.\-]/g, ""));
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
  const name = pick(rec, ["shmmitzrach", "Food_Name", "food_name", "Name"], ["שם", "מצרך", "מאכל", "name"]);
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

// Minimal RFC-4180-ish CSV parser (handles quotes, commas, CRLF).
function parseCSV(text) {
  const rows = [];
  let field = "", row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\r") { /* skip */ }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const hebCount = (s) => (s.match(/[\u0590-\u05FF]/g) || []).length;

async function fetchTextSmart(url) {
  const r = await fetch(url);
  const buf = await r.arrayBuffer();
  let txt = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  if (hebCount(txt.slice(0, 4000)) < 3) {
    try {
      const alt = new TextDecoder("windows-1255").decode(buf);
      if (hebCount(alt.slice(0, 4000)) > hebCount(txt.slice(0, 4000))) txt = alt;
    } catch (e) { /* keep utf-8 */ }
  }
  return txt;
}

async function getCsvFoods(url) {
  if (csvFoodCache.has(url)) return csvFoodCache.get(url);
  const text = await fetchTextSmart(url);
  const rows = parseCSV(text);
  if (!rows.length) { const empty = { foods: [], headers: [] }; csvFoodCache.set(url, empty); return empty; }
  const headers = rows[0].map((h) => String(h).trim());
  const foods = [];
  for (let i = 1; i < rows.length; i++) {
    const rec = {};
    for (let j = 0; j < headers.length; j++) rec[headers[j]] = rows[i][j];
    const norm = normalize(rec);
    if (norm && norm.name && norm.kcal > 0) foods.push(norm);
  }
  const result = { foods, headers };
  csvFoodCache.set(url, result);
  return result;
}

async function datastoreSearch(id, q) {
  const url = `${BASE}/datastore_search?resource_id=${id}&q=${encodeURIComponent(q)}&limit=20`;
  const r = await fetch(url);
  const j = await r.json();
  const records = (j.result && j.result.records) || [];
  return records.map(normalize).filter((x) => x && x.kcal > 0).slice(0, 12);
}

function toItems(list) {
  return list.map((it, i) => ({
    id: "il_" + i,
    name: it.name,
    per100: { kcal: it.kcal, p: it.p, f: it.f, c: it.c },
    measures: [{ label: "100 ג׳", g: 100 }],
    def: 0,
  }));
}

export default async function handler(req, res) {
  const q = (req.query && req.query.q ? String(req.query.q) : "").trim();
  const debug = !!(req.query && req.query.debug);
  if (!q && !debug) return res.status(200).json({ items: [] });
  try {
    const resources = await getResources();

    // 1) Try datastore (fast) in case a resource is queryable.
    for (const r of resources.filter((x) => x.datastore_active).slice(0, 4)) {
      const items = await datastoreSearch(r.id, q);
      if (items.length) return res.status(200).json({ items: toItems(items), source: "datastore", resource_id: r.id });
    }

    // 2) CSV fallback — download + parse + cache, then substring-search the names.
    const csvRes = resources.filter((x) => /csv/.test(x.format) || /\.csv(\?|$)/i.test(x.url)).slice(0, 4);
    let firstHeaders = null;
    for (const r of csvRes) {
      const { foods, headers } = await getCsvFoods(r.url);
      if (!firstHeaders && headers.length) firstHeaders = headers;
      if (!q && debug) continue;
      const ql = q.toLowerCase();
      const hits = foods.filter((f) => f.name && (f.name.includes(q) || f.name.toLowerCase().includes(ql))).slice(0, 12);
      if (hits.length) return res.status(200).json({ items: toItems(hits), source: "csv", resource: r.name });
    }

    if (debug) {
      return res.status(200).json({
        items: [],
        resources: resources.map((r) => ({ name: r.name, format: r.format, datastore_active: r.datastore_active, url: r.url })),
        csv_headers: firstHeaders,
        csv_count: csvRes.length ? (csvFoodCache.get(csvRes[0].url) || {}).foods?.length || 0 : 0,
      });
    }
    return res.status(200).json({ items: [] });
  } catch (e) {
    return res.status(200).json({ items: [], error: String(e) });
  }
}
