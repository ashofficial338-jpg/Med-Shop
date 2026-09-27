import api from "./client";
import { downloadFile, reportFileName } from "../utils/downloadFile";

export function listStockLedger(params) {
  return api.get("/stock-ledger", { params }).then((r) => r.data);
}

export function adjustStock(data) {
  return api.post("/stock-ledger/adjust", data).then((r) => r.data);
}

export function getExpiryTracker() {
  return api.get("/products/expiry-tracker").then((r) => r.data);
}

export function markStockClearance(batchIds) {
  return api.post("/products/stock-clearance", { batchIds }).then((r) => r.data);
}

export function exportStockLedger(format, params) {
  return downloadFile("/stock-ledger/export", { ...params, format }, reportFileName("GHM_Stock_Ledger", format));
}

export function exportExpiryTracker(format) {
  return downloadFile("/products/expiry-tracker/export", { format }, reportFileName("GHM_Expiry_Tracker", format));
}
