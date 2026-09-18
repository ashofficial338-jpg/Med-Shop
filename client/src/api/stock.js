import api from "./client";

export function listStockLedger(params) {
  return api.get("/stock-ledger", { params }).then((r) => r.data);
}

export function adjustStock(data) {
  return api.post("/stock-ledger/adjust", data).then((r) => r.data);
}

export function getExpiryTracker() {
  return api.get("/products/expiry-tracker").then((r) => r.data);
}

export function markStockClearance(batchIds) {
  return api.post("/products/stock-clearance", { batchIds }).then((r) => r.data);
}
