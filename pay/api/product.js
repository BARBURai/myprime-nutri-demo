// GET /api/product?p=smart  ->  מה שהדף צריך כדי לצייר את עצמו. בלי שום דבר פנימי.
import { productOf, publicProduct } from "../lib/products.js";

export default function handler(req, res) {
  const p = productOf(req.query && req.query.p);
  if (!p) return res.status(404).json({ error: "not_found" });
  res.setHeader("Cache-Control", "public, max-age=60");
  return res.status(200).json(publicProduct(p));
}
