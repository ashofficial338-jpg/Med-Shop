import Rack from "../models/Rack.js";

// Every stock-in (opening stock, purchase, manual add) must say where it was
// shelved: a rack position, or "No Rack" as the deliberate fallback.
export const RACK_REQUIRED_MESSAGE = "Please select a rack and rack position (or No Rack) before saving the stock.";

// Sent by the stock forms when the user picks "No Rack". Stored as "".
export const NO_RACK = "NONE";

// Position codes look like "A-001": rack letter, dash, 3-digit position.
export const POSITION_PATTERN = /^([A-Z])-(\d{3})$/;

export function positionCode(letter, n) {
  return `${letter}-${String(n).padStart(3, "0")}`;
}

// The value to store on Product.rack: a trimmed, uppercase position code,
// or "" for No Rack (including the explicit NO_RACK choice).
export function cleanRack(value) {
  const rack = String(value ?? "").trim().toUpperCase().slice(0, 20);
  return rack === NO_RACK ? "" : rack;
}

// Null when `value` is "No Rack" or a real position on a rack that exists,
// otherwise the message to show. With `required`, leaving it blank (no choice
// made at all) is an error; choosing NO_RACK never is.
export async function rackPositionError(value, { required = true } = {}) {
  const raw = String(value ?? "").trim().toUpperCase();
  if (raw === NO_RACK) return null;
  if (!raw) return required ? RACK_REQUIRED_MESSAGE : null;
  const match = POSITION_PATTERN.exec(raw);
  if (!match) return "Please select a valid rack position (e.g. A-001).";
  const [, letter, num] = match;
  const rack = await Rack.findOne({ letter });
  if (!rack) return `Rack ${letter} does not exist. Choose another rack or No Rack.`;
  const n = Number(num);
  if (n < 1 || n > rack.positions) {
    return `${raw} is not a position on Rack ${letter} (it has positions ${positionCode(letter, 1)} to ${positionCode(letter, rack.positions)}).`;
  }
  return null;
}

// A rack's shelf x row x bin layout. Older racks (no layout saved) are one
// shelf, one row, all positions as bins.
export function rackLayout(rack) {
  const shelves = rack.shelves || 1;
  const rows = rack.rowsPerShelf || 1;
  const bins = rack.binsPerRow || Math.ceil(rack.positions / (shelves * rows));
  return { shelves, rows, bins };
}

// "A-014" on a 3 shelf x 2 row x 4 bin rack -> Shelf 2, Row 2, Bin 2.
// rackDoc may be null (unknown rack): only the code is returned then.
export function describePosition(code, rackDoc) {
  const raw = String(code || "");
  if (!raw) return { code: "", label: "No Rack", rack: "", shelf: null, row: null, bin: null };
  const m = POSITION_PATTERN.exec(raw);
  if (!m || !rackDoc) return { code: raw, label: raw, rack: m ? m[1] : "", shelf: null, row: null, bin: null };
  const { rows, bins } = rackLayout(rackDoc);
  const idx = Number(m[2]) - 1;
  const bin = (idx % bins) + 1;
  const row = (Math.floor(idx / bins) % rows) + 1;
  const shelf = Math.floor(idx / (bins * rows)) + 1;
  return { code: raw, rack: m[1], shelf, row, bin, label: `Rack ${m[1]} · Shelf ${shelf} · Row ${row} · Bin ${bin}` };
}

// Position codes on one shelf of a rack.
export function shelfPositions(rackDoc, shelf) {
  const { rows, bins } = rackLayout(rackDoc);
  const per = rows * bins;
  const out = [];
  for (let n = (shelf - 1) * per + 1; n <= Math.min(shelf * per, rackDoc.positions); n++) out.push(positionCode(rackDoc.letter, n));
  return out;
}

// What a scanned rack QR / barcode (or typed code) points at: a whole rack
// ("A"), a shelf ("A-S2") or one position ("A-014"). Accepts the label URLs
// too (…?loc=A-014). Null when it isn't a rack code.
export function parseRackCode(text) {
  let raw = String(text || "").trim();
  const fromUrl = raw.match(/[?&](?:loc|rack)=([^&#]+)/i);
  if (fromUrl) raw = decodeURIComponent(fromUrl[1]);
  raw = raw.toUpperCase().replace(/^RACK[\s:-]*/, "");
  if (/^[A-Z]$/.test(raw)) return { level: "rack", letter: raw, code: raw };
  const shelf = raw.match(/^([A-Z])-S(\d{1,2})$/);
  if (shelf) return { level: "shelf", letter: shelf[1], shelf: Number(shelf[2]), code: raw };
  const pos = POSITION_PATTERN.exec(raw);
  if (pos) return { level: "position", letter: pos[1], code: raw };
  if (raw === NO_RACK || raw === "NO RACK") return { level: "none", letter: "", code: "" };
  return null;
}
