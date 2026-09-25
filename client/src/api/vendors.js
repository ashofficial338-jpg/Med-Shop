import api from "./client";

export function listVendors(params) {
  return api.get("/vendors", { params }).then((r) => r.data);
}

export function createVendor(data) {
  return api.post("/vendors", data).then((r) => r.data);
}

export function updateVendor(id, data) {
  return api.patch(`/vendors/${id}`, data).then((r) => r.data);
}

export function setVendorActive(id, isActive) {
  return api.patch(`/vendors/${id}/active`, { isActive }).then((r) => r.data);
}

export function getVendorLedger(id) {
  return api.get(`/vendors/${id}/ledger`).then((r) => r.data);
}

export function recordSupplierPayment(id, data) {
  return api.post(`/vendors/${id}/payments`, data).then((r) => r.data);
}

export function getVendorReport(id, period) {
  return api.get(`/vendors/${id}/report`, { params: { period } }).then((r) => r.data);
}

export function rateVendor(id, data) {
  return api.patch(`/vendors/${id}/rating`, data).then((r) => r.data);
}
