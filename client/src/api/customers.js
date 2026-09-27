import api from "./client";
import { downloadFile, reportFileName } from "../utils/downloadFile";

export function searchCustomers(q) {
  return api.get("/customers", { params: { q } }).then((r) => r.data);
}

export function createCustomer(data) {
  return api.post("/customers", data).then((r) => r.data);
}

export function getCustomer(id) {
  return api.get(`/customers/${id}`).then((r) => r.data);
}

export function updateCustomer(id, data) {
  return api.patch(`/customers/${id}`, data).then((r) => r.data);
}

export function deleteCustomer(id) {
  return api.delete(`/customers/${id}`).then((r) => r.data);
}

export function getCustomerLedger(id) {
  return api.get(`/customers/${id}/ledger`).then((r) => r.data);
}

export function recordCustomerPayment(id, data) {
  return api.post(`/customers/${id}/payments`, data).then((r) => r.data);
}

export function exportCustomerLedger(id, format, name) {
  return downloadFile(`/customers/${id}/ledger/export`, { format }, reportFileName(`GHM_Ledger_${name || id}`, format));
}

export function exportCustomers(format, params) {
  return downloadFile("/customers/export", { ...params, format }, reportFileName("GHM_Customers_Report", format));
}
