// Mirrors server/src/utils/rack.js.
export const RACK_REQUIRED_MESSAGE = "Please select a rack and rack position (or No Rack) before saving the stock.";

// The stock forms' value for the "No Rack" choice; the server stores it as "".
export const NO_RACK = "NONE";

// Every possible rack letter. Only racks added under Manage Racks can hold stock.
export const RACK_LETTERS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));

// Position codes look like "A-001": rack letter, dash, 3-digit position.
export const POSITION_PATTERN = /^([A-Z])-(\d{3})$/;

export function positionCode(letter, n) {
  return `${letter}-${String(n).padStart(3, "0")}`;
}

// All position codes on a rack: { letter: "A", positions: 3 } -> A-001, A-002, A-003.
export function positionsOf(rack) {
  return Array.from({ length: rack.positions }, (_, i) => positionCode(rack.letter, i + 1));
}

// The rack letter a position code sits on ("A-001" -> "A"), or "" if none.
export function rackLetter(code) {
  const first = String(code || "").charAt(0).toUpperCase();
  return RACK_LETTERS.includes(first) ? first : "";
}

// `code` if it is a proper position code, otherwise "" - used when
// pre-filling forms so an old free-text rack never counts as chosen.
export function validPosition(code) {
  return POSITION_PATTERN.test(code || "") ? code : "";
}

// Whether a stock form's rack value is a complete choice: a position or No Rack.
export function isRackChoice(value) {
  return value === NO_RACK || Boolean(validPosition(value));
}

// Mirrors server/src/utils/rack.js: a rack's shelf x row x bin layout.
export function rackLayout(rack) {
  const shelves = rack.shelves || 1;
  const rows = rack.rowsPerShelf || 1;
  const bins = rack.binsPerRow || Math.ceil(rack.positions / (shelves * rows));
  return { shelves, rows, bins };
}

// { shelf, row, bin, label } for a position code; rack may be undefined.
export function describePosition(code, rack) {
  if (!code) return { code: "", short: "No Rack", label: "No Rack", shelf: null, row: null, bin: null };
  const m = POSITION_PATTERN.exec(code);
  if (!m || !rack) return { code, short: code, label: code, shelf: null, row: null, bin: null };
  const { rows, bins } = rackLayout(rack);
  const idx = Number(m[2]) - 1;
  const bin = (idx % bins) + 1;
  const row = (Math.floor(idx / bins) % rows) + 1;
  const shelf = Math.floor(idx / (bins * rows)) + 1;
  return { code, shelf, row, bin, short: `S${shelf} R${row} B${bin}`, label: `Rack ${m[1]} · Shelf ${shelf} · Row ${row} · Bin ${bin}` };
}

// Human location for a code using a racks list ([{ letter, ... }]).
export function locationLabel(code, racks) {
  return describePosition(code, (racks || []).find((r) => r.letter === rackLetter(code))).label;
}

export function shelfPositions(rack, shelf) {
  const { rows, bins } = rackLayout(rack);
  const per = rows * bins;
  const out = [];
  for (let n = (shelf - 1) * per + 1; n <= Math.min(shelf * per, rack.positions); n++) out.push(positionCode(rack.letter, n));
  return out;
}

// What a scanned / typed rack code means: "A", "A-S2", "A-014", NONE, or a
// label URL (…?loc=A-014). Returns the canonical scope code, or null.
export function parseRackCode(text) {
  let raw = String(text || "").trim();
  const fromUrl = raw.match(/[?&](?:loc|rack)=([^&#]+)/i);
  if (fromUrl) raw = decodeURIComponent(fromUrl[1]);
  raw = raw.toUpperCase().replace(/^RACK[\s:-]*/, "");
  if (/^[A-Z]$/.test(raw) || /^[A-Z]-S\d{1,2}$/.test(raw) || POSITION_PATTERN.test(raw)) return raw;
  if (raw === NO_RACK || raw === "NO RACK") return NO_RACK;
  return null;
}

// The URL a rack label's QR code holds: opens the Rack Center scanner on it.
export function rackScanUrl(code) {
  return `${window.location.origin}/rack-center?loc=${encodeURIComponent(code)}`;
}
