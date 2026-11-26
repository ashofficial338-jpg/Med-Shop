import api from "./client";
import { downloadFile } from "../utils/downloadFile";

// Extra Purchase Excel upload - see server/src/routes/extraPurchases.js.

export function downloadExtraTemplate() {
  return downloadFile("/extra-purchases/template", {}, "GuganMedicals_Extra_Purchase_Template.xlsx");
}

// raw: rows as read from the file; rows: edited preview rows. Nothing is saved.
export function previewExtraRows(payload) {
  return api.post("/extra-purchases/preview", payload, { timeout: 120_000 }).then((r) => r.data);
}

export function importExtraRows(payload) {
  return api.post("/extra-purchases/import", payload, { timeout: 300_000 }).then((r) => r.data);
}

export function listExtraImports() {
  return api.get("/extra-purchases/history").then((r) => r.data);
}

export function getExtraImport(id) {
  return api.get(`/extra-purchases/history/${id}`).then((r) => r.data);
}

export function downloadExtraOriginal(id, fileName) {
  return downloadFile(`/extra-purchases/history/${id}/file`, {}, fileName || "upload.xlsx");
}

export function extraImportPdf(id) {
  return api.get(`/extra-purchases/history/${id}/pdf`, { responseType: "blob" }).then((r) => r.data);
}

export function listIncompletePurchases(status) {
  return api.get("/extra-purchases/incomplete", { params: { status } }).then((r) => r.data);
}

export function updateIncompletePurchase(id, data) {
  return api.put(`/extra-purchases/incomplete/${id}`, data).then((r) => r.data);
}

export function completeIncompletePurchase(id, data) {
  return api.post(`/extra-purchases/incomplete/${id}/complete`, data).then((r) => r.data);
}

export function discardIncompletePurchase(id) {
  return api.post(`/extra-purchases/incomplete/${id}/discard`).then((r) => r.data);
}
