import { Router } from "express";
import Category from "../models/Category.js";
import Product from "../models/Product.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { resolveCategory } from "../utils/productHelpers.js";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const categories = await Category.find({ isActive: true }).sort({ name: 1 });
  res.json(categories);
});

// resolveCategory matches case-insensitively and brings a deleted category
// back, so re-adding an old name never trips the unique index.
router.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).json({ message: "This field is required." });
  if (name.length > 50) return res.status(400).json({ message: "Category name must be 50 characters or fewer." });

  const existing = await Category.findOne({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"), isActive: true });
  if (existing) return res.status(409).json({ message: "A category with this name already exists." });

  const category = await resolveCategory(name);
  res.status(201).json(category);
});

// Soft delete: old products and bills still reference the category by id.
// Blocked while any active product uses it, so no product is left pointing at
// a hidden category.
router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category || !category.isActive) return res.status(404).json({ message: "No records found." });

  const inUse = await Product.countDocuments({ category: category._id, isActive: true });
  if (inUse) {
    return res.status(400).json({
      message: `This category is used by ${inUse} product${inUse === 1 ? "" : "s"}. Move or delete them first.`,
    });
  }

  category.isActive = false;
  await category.save();
  res.json({ message: "Category deleted." });
});

export default router;
