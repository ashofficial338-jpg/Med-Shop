import api from "./client";

export function listSales(params) {
  return api.get("/sales", { params }).then((r) => r.data);
}

export function getSale(id) {
  return api.get(`/sales/${id}`).then((r) => r.data);
}

export function createSale(data) {
  return api.post("/sales", data).then((r) => r.data);
}

export function voidSale(id, reason) {
  return api.post(`/sales/${id}/void`, { reason }).then((r) => r.data);
}

// The PDF route requires the JWT auth header, so a plain link/iframe src won't
// work - fetch it as a blob (with the header) and open that in a new tab instead.
export async function openSalePdf(id) {
  const res = await api.get(`/sales/${id}/pdf`, { responseType: "blob" });
  const url = window.URL.createObjectURL(res.data);
  window.open(url, "_blank");
}
