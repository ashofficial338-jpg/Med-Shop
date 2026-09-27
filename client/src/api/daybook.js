import api from "./client";
import { downloadFile } from "../utils/downloadFile";

export function getDayBookSummary(date) {
  return api.get("/day-book", { params: date ? { date } : {} }).then((r) => r.data);
}

export function recordDayBookAdjustment(data) {
  return api.post("/day-book/adjustments", data).then((r) => r.data);
}

export function exportDayBook(date, format) {
  // The file is named after the day it covers, not the download date.
  return downloadFile("/day-book/export", { date, format }, `GHM_DayBook_${date}.${format === "pdf" ? "pdf" : "xlsx"}`);
}
