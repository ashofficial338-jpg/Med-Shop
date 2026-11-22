import api from "./client";
import { downloadFile, reportFileName } from "../utils/downloadFile";

export function listPurchases(params) {
  return api.get("/purchases", { params }).then((r) => r.data);
}

export function createPurchase(data) {
  return api.post("/purchases", data).then((r) => r.data);
}

// Purchase without a supplier - see server routes/purchases.js POST /direct.
export function createDirectPurchase(data) {
  return api.post("/purchases/direct", data).then((r) => r.data);
}

export function exportPurchases(format, params) {
  return downloadFile("/purchases/export", { ...params, format }, reportFileName("GuganMedicals_Purchases_Report", format));
}

export function listUnregisteredSuppliers() {
  return api.get("/purchases/unregistered-suppliers").then((r) => r.data);
}

// Previous purchase rate (supplier-specific, else latest) to pre-fill a line.
export function getLastPurchaseRate(params) {
  return api.get("/purchases/last-rate", { params }).then((r) => r.data);
}

export function getPurchase(id) {
  return api.get(`/purchases/${id}`).then((r) => r.data);
}

// Corrects a saved purchase - see server routes/purchases.js PUT /:id.
export function updatePurchase(id, data) {
  return api.put(`/purchases/${id}`, data).then((r) => r.data);
}

export function deletePurchase(id) {
  return api.delete(`/purchases/${id}`).then((r) => r.data);
}
