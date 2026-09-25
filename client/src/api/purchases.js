import api from "./client";
import { downloadFile } from "../utils/downloadFile";

export function listPurchases(params) {
  return api.get("/purchases", { params }).then((r) => r.data);
}

export function createPurchase(data) {
  return api.post("/purchases", data).then((r) => r.data);
}

export function exportPurchases(format, params) {
  const ext = format === "pdf" ? "pdf" : "xlsx";
  return downloadFile("/purchases/export", { ...params, format }, `GHM_Purchases_Report.${ext}`);
}
