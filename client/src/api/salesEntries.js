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

// Downloads SALES-001.pdf / SALES-001.xlsx on request (never made on Save).
export function downloadSalesEntryFile(entry, format) {
  return downloadFile(`/sales-entries/${entry._id}/file.${format}`, {}, `${entry.archiveNo}.${format}`);
}
