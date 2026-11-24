import api from "./client";
import { downloadFile } from "../utils/downloadFile";

// Purchase / Sales Excel upload - see server/src/routes/imports.js.
// `kind` is "purchases" or "sales".

const TEMPLATE_NAMES = {
  purchases: "GuganMedicals_Purchase_Upload_Template.xlsx",
  sales: "GuganMedicals_Sales_Upload_Template.xlsx",
};

export function downloadUploadTemplate(kind) {
  return downloadFile(`/imports/${kind}/template`, {}, TEMPLATE_NAMES[kind]);
}

// Checks the file's rows - nothing is saved. Returns { entries, ready, alreadySaved, problems }.
export function checkUploadRows(kind, rows) {
  return api.post(`/imports/${kind}/check`, { rows }, { timeout: 120_000 }).then((r) => r.data);
}

// Saves one checked invoice through the module's own save endpoint
// (POST /purchases or /sales).
export function saveUploadedInvoice(endpoint, body) {
  return api.post(endpoint, body).then((r) => r.data);
}
