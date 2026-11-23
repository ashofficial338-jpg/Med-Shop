import api from "./client";
import { downloadFile } from "../utils/downloadFile";

// Sales Entry (Tally-style sales voucher) - see server routes/salesEntries.js.

export function getSalesEntryMeta() {
  return api.get("/sales-entries/meta").then((r) => r.data);
}

export function suggestSalesEntryCustomers(q) {
  return api.get("/sales-entries/customers", { params: { q } }).then((r) => r.data);
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

// Saves SALES-001.pdf / SALES-001.xlsx.
export function downloadSalesEntryFile(entry, format) {
  return downloadFile(`/sales-entries/${entry._id}/file.${format}`, {}, `${entry.archiveNo}.${format}`);
}

export function exportSalesEntries(params) {
  return downloadFile("/sales-entries/export", params, "Sales_Entries.xlsx");
}

// Opens the invoice PDF in a hidden frame and shows the browser's print
// dialog. Falls back to opening it in a new tab if the frame can't print.
export async function printSalesEntry(entry) {
  const res = await api.get(`/sales-entries/${entry._id}/file.pdf`, { params: { inline: 1 }, responseType: "blob" });
  const url = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  frame.src = url;
  document.body.appendChild(frame);
  frame.onload = () => {
    try {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } catch {
      window.open(url, "_blank");
    }
    // Leave it long enough for the print dialog to use it.
    setTimeout(() => {
      frame.remove();
      URL.revokeObjectURL(url);
    }, 60_000);
  };
}
