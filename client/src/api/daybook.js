import api from "./client";
import { downloadFile } from "../utils/downloadFile";

export function getDayBookSummary(date) {
  return api.get("/day-book", { params: date ? { date } : {} }).then((r) => r.data);
}

export function recordDayBookAdjustment(data) {
  return api.post("/day-book/adjustments", data).then((r) => r.data);
}

export function exportDayBook(date, format) {
  const ext = format === "pdf" ? "pdf" : "xlsx";
  return downloadFile("/day-book/export", { date, format }, `GHM_DayBook_${date}.${ext}`);
}
