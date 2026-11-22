import { Router } from "express";
import Product from "../models/Product.js";
import Category from "../models/Category.js";
import Sale from "../models/Sale.js";

// Public, unauthenticated data for the Gugan Medicals homepage: categories,
// featured products and best sellers. Only shop-window fields leave here -
// never costs, stock quantities, suppliers or sales figures.
const router = Router();

const CACHE_MS = 10 * 60 * 1000;
const BEST_SELLER_DAYS = 90;
let cache = { at: 0, data: null, pending: null };

function publicProduct(p) {
  return {
    _id: p._id,
    name: p.name,
    brand: p.manufacturer || p.brand || "",
    category: p.category?.name || "",
    categoryId: p.category?._id || null,
    image: p.image || "",
    strength: p.strengthValue ? `${p.strengthValue} ${p.strengthUnit || ""}`.trim() : "",
    packUnit: p.packUnit,
    price: p.packRate,
    dosageForm: p.dosageForm || "",
    composition: p.composition || p.genericName || "",
    inStock: p.qty > 0,
  };
}

async function buildShowcase() {
  const since = new Date(Date.now() - BEST_SELLER_DAYS * 24 * 60 * 60 * 1000);
  const [categories, counts, products, top] = await Promise.all([
    Category.find({ isActive: true }).select("name").sort({ name: 1 }).lean(),
    Product.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: "$category", count: { $sum: 1 } } },
    ]),
    Product.find({ isActive: true, qty: { $gt: 0 } })
      .select("name brand manufacturer category image strengthValue strengthUnit packUnit packRate qty dosageForm composition genericName")
      .populate("category", "name")
      .sort({ updatedAt: -1 })
      .limit(60)
      .lean(),
    Sale.aggregate([
      { $match: { paymentStatus: "completed", createdAt: { $gte: since } } },
      { $unwind: "$items" },
      { $group: { _id: "$items.product", lines: { $sum: 1 } } },
      { $sort: { lines: -1 } },
      { $limit: 8 },
    ]),
  ]);

  const countBy = new Map(counts.map((c) => [String(c._id), c.count]));
  const topIds = top.map((t) => t._id);
  const topProducts = topIds.length
    ? await Product.find({ _id: { $in: topIds }, isActive: true })
        .select("name brand manufacturer category image strengthValue strengthUnit packUnit packRate qty dosageForm composition genericName")
        .populate("category", "name")
        .lean()
    : [];
  const byId = new Map(topProducts.map((p) => [String(p._id), p]));

  // Products with photos first: they make the best shop window.
  const featured = [...products].sort((a, b) => Number(Boolean(b.image)) - Number(Boolean(a.image)));

  return {
    categories: categories
      .map((c) => ({ _id: c._id, name: c.name, count: countBy.get(String(c._id)) || 0 }))
      .filter((c) => c.count > 0),
    featured: featured.map(publicProduct),
    bestSellers: topIds.map((id) => byId.get(String(id))).filter(Boolean).map(publicProduct),
    productCount: counts.reduce((sum, c) => sum + c.count, 0),
  };
}

router.get("/showcase", async (req, res) => {
  const fresh = cache.data && Date.now() - cache.at < CACHE_MS;
  if (!fresh) {
    // One rebuild at a time, however many visitors arrive together.
    cache.pending ||= buildShowcase()
      .then((data) => {
        cache = { at: Date.now(), data, pending: null };
      })
      .catch((err) => {
        cache.pending = null;
        throw err;
      });
    try {
      await cache.pending;
    } catch (err) {
      // Serve the last good copy if there is one; otherwise let it 500.
      if (!cache.data) throw err;
    }
  }
  res.set("Cache-Control", "public, max-age=300");
  res.json(cache.data);
});

export default router;
