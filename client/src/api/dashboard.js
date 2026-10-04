import api from "./client";
import { downloadFile, reportFileName } from "../utils/downloadFile";
import { compactParams } from "../utils/query";

// params: { from, to, category?, paymentMode? } - the same filters drive the
// summary and both exports, so a download always matches what's on screen.
export function getDashboardSummary(params) {
  return api.get("/dashboard/summary", { params: compactParams(params) }).then((r) => r.data);
}

export function downloadDashboardReport(params, format = "excel") {
  return downloadFile("/dashboard/export", { ...compactParams(params), format }, reportFileName("GHM_PnL_Report", format));
}

export function downloadProfitabilityReport(params, format = "excel") {
  return downloadFile(
    "/dashboard/profitability/export",
    { ...compactParams(params), format },
    reportFileName("GHM_Product_Profitability", format)
  );
}
