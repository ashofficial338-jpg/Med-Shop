import api from "./client";
import { downloadFile, reportFileName } from "../utils/downloadFile";

export function listExpenses(params) {
  return api.get("/expenses", { params }).then((r) => r.data);
}

export function createExpense(data) {
  return api.post("/expenses", data).then((r) => r.data);
}

export function deleteExpense(id) {
  return api.delete(`/expenses/${id}`).then((r) => r.data);
}

export function exportExpenses(format, params) {
  return downloadFile("/expenses/export", { ...params, format }, reportFileName("GHM_Expenses_Report", format));
}
