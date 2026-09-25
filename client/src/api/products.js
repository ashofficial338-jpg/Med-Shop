import api from "./client";
import { downloadFile } from "../utils/downloadFile";

export function listProducts(params) {
  return api.get("/products", { params }).then((r) => r.data);
}

export function getProduct(id) {
  return api.get(`/products/${id}`).then((r) => r.data);
}

export function getProductBatches(id) {
  return api.get(`/products/${id}/batches`).then((r) => r.data);
}

export function createProduct(formData) {
  return api.post("/products", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  }).then((r) => r.data);
}

export function updateProduct(id, formData) {
  return api.patch(`/products/${id}`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  }).then((r) => r.data);
}

export function deactivateProduct(id) {
  return api.delete(`/products/${id}`).then((r) => r.data);
}

// One-time, one-way conversion of a pack-only product to also sell loose -
// see the server route's comment for why this isn't just another editable field.
export function enableLooseSelling(id, data) {
  return api.patch(`/products/${id}/enable-loose`, data).then((r) => r.data);
}

export function listCategories() {
  return api.get("/categories").then((r) => r.data);
}

export function downloadImportTemplate() {
  return downloadFile("/products/import/template", {}, "GHM_Product_Import_Template.xlsx");
}

export function getStockReport(params) {
  return api.get("/products/stock-report", { params }).then((r) => r.data);
}

export function exportStockReport(format, params) {
  const ext = format === "pdf" ? "pdf" : "xlsx";
  return downloadFile("/products/stock-report", { ...params, format }, `GHM_Stock_Report.${ext}`);
}

export function importProducts(file) {
  const formData = new FormData();
  formData.append("file", file);
  return api.post("/products/import", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  }).then((r) => r.data);
}
