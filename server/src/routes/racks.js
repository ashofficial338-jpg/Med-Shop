import { Router } from "express";
import Rack from "../models/Rack.js";
import Product from "../models/Product.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { positionCode } from "../utils/rack.js";

const router = Router();
const MAX_POSITIONS = 999;

function parsePositions(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= MAX_POSITIONS ? n : null;
}

// Highest position number any active product currently sits on in this rack.
async function highestUsedPosition(letter) {
  const products = await Product.find({ isActive: true, rack: new RegExp(`^${letter}-\\d{3}$`) }).select("rack").lean();
  return products.reduce((max, p) => Math.max(max, Number(p.rack.slice(2))), 0);
}

router.get("/", requireAuth, async (req, res) => {
  const racks = await Rack.find().sort({ letter: 1 });
  res.json(racks);
});

router.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  const letter = String(req.body.letter || "").trim().toUpperCase();
  if (!/^[A-Z]$/.test(letter)) return res.status(400).json({ message: "Please choose a rack letter from A to Z." });
  const positions = parsePositions(req.body.positions);
  if (!positions) return res.status(400).json({ message: `Number of positions must be between 1 and ${MAX_POSITIONS}.` });
  if (await Rack.exists({ letter })) return res.status(409).json({ message: `Rack ${letter} already exists.` });

  const rack = await Rack.create({ letter, positions });
  res.status(201).json(rack);
});

// Changing the position count. Shrinking is blocked while stock still sits
// on a position that would disappear.
router.patch("/:letter", requireAuth, requireRole("admin"), async (req, res) => {
  const rack = await Rack.findOne({ letter: String(req.params.letter).toUpperCase() });
  if (!rack) return res.status(404).json({ message: "No records found." });
  const positions = parsePositions(req.body.positions);
  if (!positions) return res.status(400).json({ message: `Number of positions must be between 1 and ${MAX_POSITIONS}.` });

  const used = await highestUsedPosition(rack.letter);
  if (positions < used) {
    return res.status(400).json({
      message: `Stock is still assigned to ${positionCode(rack.letter, used)}. Move it before reducing Rack ${rack.letter} below ${used} positions.`,
    });
  }
  rack.positions = positions;
  await rack.save();
  res.json(rack);
});

router.delete("/:letter", requireAuth, requireRole("admin"), async (req, res) => {
  const rack = await Rack.findOne({ letter: String(req.params.letter).toUpperCase() });
  if (!rack) return res.status(404).json({ message: "No records found." });
  const inUse = await Product.countDocuments({ isActive: true, rack: new RegExp(`^${rack.letter}-`) });
  if (inUse > 0) {
    return res.status(400).json({ message: `Rack ${rack.letter} still has ${inUse} product${inUse === 1 ? "" : "s"} on it. Move them before deleting the rack.` });
  }
  await rack.deleteOne();
  res.json({ message: `Rack ${rack.letter} deleted.` });
});

export default router;
