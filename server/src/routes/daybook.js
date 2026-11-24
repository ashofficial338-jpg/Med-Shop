import { Router } from "express";
import DayBookAdjustment from "../models/DayBookAdjustment.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { dayBookSummary, DAY_BOOKS } from "../utils/dayBookHelpers.js";
import { shopDay, streamExcelReport, streamPdfReport } from "../utils/reportExport.js";

const router = Router();
router.use(requireAuth, requireRole("admin"));

// ?date=yyyy-mm-dd (today when left out), or null after answering 400.
function dayOr400(req, res) {
  const date = req.query.date ? new Date(req.query.date) : new Date();
  if (!Number.isNaN(date.getTime())) return date;
  res.status(400).json({ message: "Please enter a valid date." });
  return null;
}

router.get("/", async (req, res) => {
  const date = dayOr400(req, res);
  if (!date) return;
  const summary = await dayBookSummary(date);
  res.json({ date: shopDay(date), ...summary });
});

router.get("/export", async (req, res) => {
  const date = dayOr400(req, res);
  if (!date) return;
  const dateLabel = shopDay(date);
  const summary = await dayBookSummary(date);

  const rows = DAY_BOOKS.map(([key, type]) => ({ type, ...summary[key] }));

  if (req.query.format === "pdf") {
    return streamPdfReport(res, `GuganMedicals_DayBook_${dateLabel}.pdf`, {
      title: "Gugan Medicals - Day Book",
      subtitle: dateLabel,
      columns: [
        { header: "Type", key: "type" },
        { header: "Opening", key: "opening", align: "right" },
        { header: "In", key: "in", align: "right" },
        { header: "Out", key: "out", align: "right" },
        { header: "Closing", key: "closing", align: "right" },
      ],
      rows,
    });
  }

  return streamExcelReport(res, `GuganMedicals_DayBook_${dateLabel}.xlsx`, [
    {
      name: "Day Book",
      columns: [
        { header: "Type", key: "type", width: 12 },
        { header: "Opening", key: "opening", width: 14 },
        { header: "In", key: "in", width: 14 },
        { header: "Out", key: "out", width: 14 },
        { header: "Closing", key: "closing", width: 14 },
      ],
      rows,
    },
  ]);
});

// Balance corrections recorded for one day, so a wrong one can be deleted.
router.get("/adjustments", async (req, res) => {
  const day = req.query.date ? new Date(req.query.date) : new Date();
  if (Number.isNaN(day.getTime())) return res.status(400).json({ message: "Please enter a valid date." });
  const start = new Date(shopDay(day));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const list = await DayBookAdjustment.find({ date: { $gte: start, $lt: end } }).populate("setBy", "username").sort({ createdAt: -1 });
  res.json(list);
});

router.delete("/adjustments/:id", async (req, res) => {
  const adj = await DayBookAdjustment.findByIdAndDelete(req.params.id).catch(() => null);
  if (!adj) return res.status(404).json({ message: "No records found." });
  res.json({ message: "Balance correction deleted." });
});

router.post("/adjustments", async (req, res) => {
  // The balance is what this records; type defaults to Cash, date to today.
  const { balance, note } = req.body;
  const type = req.body.type || "Cash";
  const date = req.body.date || shopDay(new Date());
  if (!DAY_BOOKS.some(([, t]) => t === type)) return res.status(400).json({ message: "Please choose Cash, UPI, Card, Bank Transfer or Credit." });
  if (balance === undefined || balance === null || balance === "" || !(Number(balance) >= 0)) {
    return res.status(400).json({ message: "Enter the balance to record." });
  }

  await DayBookAdjustment.create({
    type,
    date,
    balance: Number(balance),
    note: note || "",
    setBy: req.user._id,
  });

  const summary = await dayBookSummary(new Date(date));
  res.status(201).json({ date, ...summary });
});

export default router;
