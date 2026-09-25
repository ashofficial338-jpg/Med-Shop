import api from "./client";

export function listExpenses(params) {
  return api.get("/expenses", { params }).then((r) => r.data);
}

export function createExpense(data) {
  return api.post("/expenses", data).then((r) => r.data);
}
