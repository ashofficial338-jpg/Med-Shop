import api from "./client";
import { downloadFile, reportFileName } from "../utils/downloadFile";

export function listRacks() {
  return api.get("/racks").then((r) => r.data);
}

export function createRack(data) {
  return api.post("/racks", data).then((r) => r.data);
}

export function updateRack(letter, data) {
  return api.patch(`/racks/${letter}`, data).then((r) => r.data);
}

export function deleteRack(letter) {
  return api.delete(`/racks/${letter}`).then((r) => r.data);
}

export function getRackSummary() {
  return api.get("/racks/summary").then((r) => r.data);
}

// Stock on a rack ("A"), shelf ("A-S2"), position ("A-014") or NONE / all.
export function getRackStock(scope) {
  return api.get("/racks/stock", { params: scope ? { scope } : {} }).then((r) => r.data);
}

export function exportRackStock(format, scope) {
  return downloadFile("/racks/stock", { ...(scope ? { scope } : {}), format }, reportFileName("GuganMedicals_Rack_Stock", format));
}

export function getRackExpiry(params) {
  return api.get("/racks/expiry", { params }).then((r) => r.data);
}

export function exportRackExpiry(format, params) {
  return downloadFile("/racks/expiry", { ...params, format }, reportFileName("GuganMedicals_Rack_Expiry", format));
}

export function locateMedicine(q) {
  return api.get("/racks/locate", { params: { q } }).then((r) => r.data);
}

export function transferStock(data) {
  return api.post("/racks/transfer", data).then((r) => r.data);
}

export function saveStockAudit(data) {
  return api.post("/racks/audit", data).then((r) => r.data);
}

export function listStockAudits(scope) {
  return api.get("/racks/audits", { params: scope ? { scope } : {} }).then((r) => r.data);
}

export function getRackHistory(scope) {
  return api.get("/racks/history", { params: scope ? { scope } : {} }).then((r) => r.data);
}
