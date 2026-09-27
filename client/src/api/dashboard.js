import api from "./client";
import { downloadFile, reportFileName } from "../utils/downloadFile";

export function getDashboardSummary(params) {
  return api.get("/dashboard/summary", { params }).then((r) => r.data);
}

export function downloadDashboardReport(params, format = "excel") {
  return downloadFile("/dashboard/export", { ...params, format }, reportFileName("GHM_PnL_Report", format));
}
