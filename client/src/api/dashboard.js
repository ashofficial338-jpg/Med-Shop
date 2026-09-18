import api from "./client";

export function getDashboardSummary(params) {
  return api.get("/dashboard/summary", { params }).then((r) => r.data);
}

// The export endpoint requires the JWT auth header, so a plain <a href> download
// won't work - fetch it as a blob and trigger the save via a temporary object URL.
export async function downloadDashboardReport(params) {
  const res = await api.get("/dashboard/export", { params, responseType: "blob" });
  const url = window.URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = "GHM_Report.xlsx";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}
