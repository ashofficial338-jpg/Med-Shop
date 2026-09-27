import api from "../api/client";

// Shared blob-download helper - the export routes (and the bill PDF route)
// require the JWT auth header, so a plain <a href> won't work; fetch as a
// blob (with the header attached) and trigger the save via a temporary
// object URL instead.
export async function downloadFile(url, params, filename) {
  const res = await api.get(url, { params, responseType: "blob" });
  const blobUrl = window.URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(blobUrl);
}

// Report downloads are named ReportName_YYYY-MM-DD.xlsx / .pdf (local date),
// with characters that aren't safe in filenames replaced.
export function reportFileName(base, format) {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const safe = base.replace(/[\/:*?"<>|]+/g, "").replace(/\s+/g, "_");
  return `${safe}_${stamp}.${format === "pdf" ? "pdf" : "xlsx"}`;
}
