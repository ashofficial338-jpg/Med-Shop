import api from "./client";
import { downloadFile, reportFileName } from "../utils/downloadFile";

export function listPurchaseReturns(params) {
  return api.get("/purchase-returns", { params }).then((r) => r.data);
}

export function getReturnReasons() {
  return api.get("/purchase-returns/reasons").then((r) => r.data);
}

// An invoice's lines with what can still be returned.
export function getReturnableInvoice(purchaseId) {
  return api.get(`/purchase-returns/invoice/${purchaseId}`).then((r) => r.data);
}

export function createPurchaseReturn(data) {
  return api.post("/purchase-returns", data).then((r) => r.data);
}

export function cancelPurchaseReturn(id, reason) {
  return api.post(`/purchase-returns/${id}/cancel`, { reason }).then((r) => r.data);
}

export function exportPurchaseReturns(format, params) {
  return downloadFile("/purchase-returns/export", { ...params, format }, reportFileName("GuganMedicals_Purchase_Returns", format));
}

export function purchaseReturnPdf(id) {
  return api.get(`/purchase-returns/${id}/pdf`, { responseType: "blob" }).then((r) => r.data);
}
