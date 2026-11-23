// Invoice Saver - runs on the shop PC and saves a PDF + Excel copy of every
// POS sale and purchase into:
//   reports\sales\<Year>\<Month>\<DD-MM-YYYY>\SALES-001.pdf / .xlsx
//   reports\purchase\<Year>\<Month>\<DD-MM-YYYY>\PUR-001.pdf / .xlsx
//
// The backend (Render) can't write to this PC, so this program asks it every
// few seconds for invoices that haven't been saved yet, downloads both files
// and writes them here. Numbers come from the server, so they're continuous
// and never reused. An existing file is never overwritten.
//
// Usage:  node saver.mjs          keep running (start-invoice-saver.bat)
//         node saver.mjs --once   save everything pending, then exit
// Settings: .env next to this file (copy .env.example).
import fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// Minimal .env reader (KEY=value lines), so no packages need installing.
function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
loadEnv(path.join(here, ".env"));

const API_URL = (process.env.API_URL || "https://med-shop-3.onrender.com/api").replace(/\/+$/, "");
const FOLDERS = {
  // String.raw: Windows backslashes are kept exactly as written.
  sales: process.env.SALES_DIR || String.raw`C:\Users\ASHWIN\OneDrive\Desktop\Med Shop\reports\sales`,
  purchase: process.env.PURCHASE_DIR || String.raw`C:\Users\ASHWIN\OneDrive\Desktop\Med Shop\reports\purchase`,
};
// Sales Entry invoices are data only (no files), so they aren't listed here.
const KIND_ORDER = ["sales", "purchase"];
const EMAIL = process.env.SAVER_EMAIL;
const PASSWORD = process.env.SAVER_PASSWORD;
const POLL_SECONDS = Math.max(Number(process.env.POLL_SECONDS) || 10, 3);
const ONCE = process.argv.includes("--once");

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

// Year / Month / DD-MM-YYYY of when the invoice was made, in this PC's time zone.
export function datedFolder(root, createdAt) {
  const d = new Date(createdAt);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return path.join(root, String(d.getFullYear()), MONTHS[d.getMonth()], `${dd}-${mm}-${d.getFullYear()}`);
}

let token = null;

async function login() {
  if (!EMAIL || !PASSWORD) throw new Error("Set SAVER_EMAIL and SAVER_PASSWORD (an Admin login) in tools/invoice-saver/.env");
  const res = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Login failed (${res.status}): ${body.message || res.statusText}`);
  if (body.user?.role !== "admin") throw new Error("SAVER_EMAIL must be an Admin account.");
  token = body.token;
}

// Signs in when needed and again once if the token expired (12h by default).
async function api(pathname, { method = "GET", binary = false } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!token) await login();
    const res = await fetch(`${API_URL}${pathname}`, { method, headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) {
      token = null;
      continue;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`${method} ${pathname} -> ${res.status} ${body.message || ""}`.trim());
    }
    return binary ? Buffer.from(await res.arrayBuffer()) : res.json();
  }
  throw new Error("The server rejected the saver's login.");
}

// Writes `data` to `file` only if it doesn't exist yet. The data goes to a
// temporary file first and is then linked into place - a link fails if the
// name is taken, so an existing invoice can never be overwritten, and a
// half-written file never appears under the real name.
export async function writeNew(file, data) {
  if (existsSync(file)) return false;
  const temp = `${file}.${process.pid}.part`;
  await fs.writeFile(temp, data);
  try {
    await fs.link(temp, file);
  } catch (err) {
    if (err.code === "EEXIST") return false;
    // Filesystems without hard links: copy, still refusing to replace a file.
    await fs.copyFile(temp, file, fs.constants.COPYFILE_EXCL).catch((e) => {
      if (e.code !== "EEXIST") throw e;
    });
  } finally {
    await fs.unlink(temp).catch(() => {});
  }
  return true;
}

// Saves one copy of an invoice. `inv.fileName` is "SALES-001" for the first
// copy and "SALES-001 (edited 1)" / "SALES-001 (void)" after a change - the
// earlier copies are left exactly as they are. Returns false when the
// invoice changed while being saved (it's listed again with the change).
async function saveOne(kind, inv) {
  const name = inv.fileName || inv.archiveNo;
  const version = inv.version ?? "";
  const dir = datedFolder(FOLDERS[kind], inv.createdAt);
  await fs.mkdir(dir, { recursive: true });
  // Both files are downloaded before either is written, so a PDF and Excel
  // with the same name always show the same version of the invoice.
  const files = [];
  try {
    for (const format of ["pdf", "xlsx"]) {
      const file = path.join(dir, `${name}.${format}`);
      if (existsSync(file)) continue; // already saved earlier - keep it as is
      files.push({ file, data: await api(`/invoice-archive/${kind}/${inv.id}/file.${format}?version=${version}`, { binary: true }) });
    }
  } catch (err) {
    if (/ -> 409/.test(err.message)) return false;
    throw err;
  }
  const saved = [];
  for (const { file, data } of files) if (await writeNew(file, data)) saved.push(path.basename(file));
  await api(`/invoice-archive/${kind}/${inv.id}/saved?version=${version}`, { method: "POST" });
  log(`${name}: ${saved.length ? `saved ${saved.join(", ")}` : "already on disk"} -> ${dir}`);
  return true;
}

// Saves every pending invoice of both kinds; returns how many were saved.
async function saveAllPending() {
  let count = 0;
  for (const kind of KIND_ORDER) {
    const tried = new Set();
    for (;;) {
      const pending = await api(`/invoice-archive/${kind}/pending?limit=25`);
      // Each invoice version is tried once per round; one that keeps
      // changing is picked up on the next round instead of looping here.
      const fresh = pending.filter((inv) => !tried.has(`${inv.id}@${inv.version}`));
      if (!fresh.length) break;
      for (const inv of fresh) {
        tried.add(`${inv.id}@${inv.version}`);
        if (await saveOne(kind, inv)) count++;
      }
    }
  }
  return count;
}

async function main() {
  for (const dir of new Set(Object.values(FOLDERS))) await fs.mkdir(dir, { recursive: true });
  log(`Invoice Saver -> ${API_URL}`);
  log(`Sales folder:    ${FOLDERS.sales}`);
  log(`Purchase folder: ${FOLDERS.purchase}`);
  for (;;) {
    let delay = POLL_SECONDS;
    try {
      const n = await saveAllPending();
      if (ONCE) {
        log(`Done - ${n} invoice(s) saved.`);
        return;
      }
    } catch (err) {
      log(`Problem: ${err.message}`);
      if (/SAVER_EMAIL|Admin account|Login failed \(4/.test(err.message) || ONCE) process.exitCode = 1;
      if (ONCE) return;
      delay = Math.max(POLL_SECONDS, 30); // server asleep/restarting - try again shortly
    }
    await new Promise((r) => setTimeout(r, delay * 1000));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
