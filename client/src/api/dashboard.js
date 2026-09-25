import api from "./client";
import { downloadFile } from "../utils/downloadFile";

export function getDashboardSummary(params) {
  return api.get("/dashboard/summary", { params }).then((r) => r.data);
}

export function downloadDashboardReport(params, format = "excel") {
  const ext = format === "pdf" ? "pdf" : "xlsx";
  return downloadFile("/dashboard/export", { ...params, format }, `GHM_Report.${ext}`);
}
