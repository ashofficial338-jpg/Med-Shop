import api from "./client";

// Clear All Transaction Records (Admin) - see server routes/maintenance.js.
export function getTransactionCounts() {
  return api.get("/maintenance/transactions").then((r) => r.data);
}

export function createTransactionBackup() {
  return api.post("/maintenance/transactions/backup").then((r) => r.data);
}

export function clearTransactionRecords(data) {
  return api.post("/maintenance/transactions/clear", data).then((r) => r.data);
}
