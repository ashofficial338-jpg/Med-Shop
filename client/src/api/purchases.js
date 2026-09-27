import api from "./client";
import { downloadFile, reportFileName } from "../utils/downloadFile";

export function listPurchases(params) {
  return api.get("/purchases", { params }).then((r) => r.data);
}

export function createPurchase(data) {
  return api.post("/purchases", data).then((r) => r.data);
}

export function exportPurchases(format, params) {
  return downloadFile("/purchases/export", { ...params, format }, reportFileName("GHM_Purchases_Report", format));
}
