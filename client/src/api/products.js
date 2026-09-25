import api from "./client";

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

// The template endpoint requires the JWT auth header, so a plain <a href> download
// won't work (browsers don't attach axios's header to a normal navigation) -
// fetch it as a blob instead and trigger the save via a temporary object URL.
export async function downloadImportTemplate() {
  const res = await api.get("/products/import/template", { responseType: "blob" });
  const url = window.URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = "GHM_Product_Import_Template.xlsx";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

export function importProducts(file) {
  const formData = new FormData();
  formData.append("file", file);
  return api.post("/products/import", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  }).then((r) => r.data);
}
