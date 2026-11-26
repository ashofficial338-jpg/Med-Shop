import api from "./client";
import { downloadFile, reportFileName } from "../utils/downloadFile";

export function listPurchaseOrders(params) {
  return api.get("/purchase-orders", { params }).then((r) => r.data);
}

export function getPurchaseOrder(id) {
  return api.get(`/purchase-orders/${id}`).then((r) => r.data);
}

export function createPurchaseOrder(data) {
  return api.post("/purchase-orders", data).then((r) => r.data);
}

export function updatePurchaseOrder(id, data) {
  return api.put(`/purchase-orders/${id}`, data).then((r) => r.data);
}

export function raisePurchaseOrder(id) {
  return api.post(`/purchase-orders/${id}/raise`).then((r) => r.data);
}

export function cancelPurchaseOrder(id, reason) {
  return api.post(`/purchase-orders/${id}/cancel`, { reason }).then((r) => r.data);
}

export function deletePurchaseOrder(id) {
  return api.delete(`/purchase-orders/${id}`).then((r) => r.data);
}

export function exportPurchaseOrders(format, params) {
  return downloadFile("/purchase-orders/export", { ...params, format }, reportFileName("GuganMedicals_Purchase_Orders", format));
}

export function purchaseOrderPdf(id) {
  return api.get(`/purchase-orders/${id}/pdf`, { responseType: "blob" }).then((r) => r.data);
}
