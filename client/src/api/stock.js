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
  return downloadFile("/stock-ledger/export", { ...params, format }, reportFileName("GuganMedicals_Stock_Ledger", format));
}

export function exportExpiryTracker(format) {
  return downloadFile("/products/expiry-tracker/export", { format }, reportFileName("GuganMedicals_Expiry_Tracker", format));
}

// Extra Stock Addition: stock added by hand, outside any purchase.
export function addExtraStock(data) {
  return api.post("/stock-ledger/extra", data).then((r) => r.data);
}

export function listExtraStock(params) {
  return api.get("/stock-ledger/extra", { params }).then((r) => r.data);
}

export function exportExtraStock(format, params) {
  return downloadFile("/stock-ledger/extra/export", { ...params, format }, reportFileName("GuganMedicals_Extra_Stock_Additions", format));
}

// Stock In report: Purchase Inward and Extra Stock Additions, side by side.
export function getInwardReport(params) {
  return api.get("/stock-ledger/inward-report", { params }).then((r) => r.data);
}

export function exportInwardReport(format, params) {
  return downloadFile("/stock-ledger/inward-report/export", { ...params, format }, reportFileName("GuganMedicals_Stock_Inward", format));
}
