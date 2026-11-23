import api from "./client";
import { downloadFile } from "../utils/downloadFile";

// Sales Entry - see server routes/salesEntries.js.

export function getSalesEntryMeta() {
  return api.get("/sales-entries/meta").then((r) => r.data);
}

export function listSalesEntries(params) {
  return api.get("/sales-entries", { params }).then((r) => r.data);
}

export function getSalesEntry(id) {
  return api.get(`/sales-entries/${id}`).then((r) => r.data);
}

export function createSalesEntry(data) {
  return api.post("/sales-entries", data).then((r) => r.data);
}

export function updateSalesEntry(id, data) {
  return api.put(`/sales-entries/${id}`, data).then((r) => r.data);
}

// Older entries without a bill: record their sale now (Admin).
export function linkSalesEntry(id) {
  return api.post(`/sales-entries/${id}/link`).then((r) => r.data);
}
export function unlinkedSalesEntryCount() {
  return api.get("/sales-entries/unlinked-count").then((r) => r.data.count);
}
export function linkAllSalesEntries() {
  return api.post("/sales-entries/link-all").then((r) => r.data);
}

// Deletes the entry and its bill (stock put back, payments removed).
export function deleteSalesEntry(id) {
  return api.delete(`/sales-entries/${id}`).then((r) => r.data);
}

// Downloads SALES-001.pdf / SALES-001.xlsx on request (never made on Save).
export function downloadSalesEntryFile(entry, format) {
  return downloadFile(`/sales-entries/${entry._id}/file.${format}`, {}, `${entry.archiveNo}.${format}`);
}

// ---- Excel template / upload ----
export function downloadSalesEntryTemplate() {
  return downloadFile("/sales-entries/import/template", {}, "Sales_Entry_Template.xlsx");
}

// Reads the file and returns a preview - nothing is saved.
export function previewSalesEntryImport(file) {
  const fd = new FormData();
  fd.append("file", file);
  return api.post("/sales-entries/import/preview", fd, { headers: { "Content-Type": "multipart/form-data" } }).then((r) => r.data);
}

// Saves the invoices confirmed in the preview.
export function importSalesEntries(invoices) {
  return api.post("/sales-entries/import", { invoices }).then((r) => r.data);
}
