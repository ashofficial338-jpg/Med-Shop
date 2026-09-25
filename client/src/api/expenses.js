import api from "./client";
import { downloadFile } from "../utils/downloadFile";

export function listExpenses(params) {
  return api.get("/expenses", { params }).then((r) => r.data);
}

export function createExpense(data) {
  return api.post("/expenses", data).then((r) => r.data);
}

export function exportExpenses(format, params) {
  const ext = format === "pdf" ? "pdf" : "xlsx";
  return downloadFile("/expenses/export", { ...params, format }, `GHM_Expenses_Report.${ext}`);
}
