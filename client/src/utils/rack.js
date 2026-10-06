// Mirrors server/src/utils/rack.js.
export const RACK_REQUIRED_MESSAGE = "Please select a rack and rack position before saving the stock.";

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
