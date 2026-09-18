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
