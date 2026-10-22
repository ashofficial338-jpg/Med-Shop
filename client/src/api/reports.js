import api from "./client";
import { reportFileName } from "../utils/downloadFile";
import { compactParams } from "../utils/query";

// Reports & Analytics. Every call takes the page's filters
// ({ from, to, category, brand, product, supplier, paymentMode, granularity,
// compare }) so the screen, the PDF and the Excel file show the same figures.

export function getReportOptions() {
  return api.get("/reports/options").then((r) => r.data);
}

export function getAnalytics(params) {
  return api.get("/reports/analytics", { params: compactParams(params) }).then((r) => r.data);
}

export function getTransactions(params) {
  return api.get("/reports/transactions", { params: compactParams(params) }).then((r) => r.data);
}

export function getCatalog(params) {
  return api.get("/reports/catalog", { params: compactParams(params) }).then((r) => r.data);
}

// Fetches a generated report as a Blob. onProgress gets { loaded, total }
// (total is 0 when the server streams without a known size, e.g. PDFs).
export async function fetchReport(params, format, onProgress) {
  const res = await api.get("/reports/export", {
    params: { ...compactParams(params), format },
    responseType: "blob",
    onDownloadProgress: (e) => onProgress?.({ loaded: e.loaded, total: e.total || 0 }),
  });
  return res.data;
}

export function saveBlob(blob, base, format) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = reportFileName(base, format);
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}
