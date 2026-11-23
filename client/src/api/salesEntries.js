import api from "./client";

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
