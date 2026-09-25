import api from "./client";

export function getDayBookSummary(date) {
  return api.get("/day-book", { params: date ? { date } : {} }).then((r) => r.data);
}

export function recordDayBookAdjustment(data) {
  return api.post("/day-book/adjustments", data).then((r) => r.data);
}
