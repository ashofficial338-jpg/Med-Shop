import Rack from "../models/Rack.js";

// Every stock-in (opening stock, purchase, manual add, import) must say which
// rack position it was shelved on, so Rack Finder can always point to it.
export const RACK_REQUIRED_MESSAGE = "Please select a rack and rack position before saving the stock.";

// Position codes look like "A-001": rack letter, dash, 3-digit position.
export const POSITION_PATTERN = /^([A-Z])-(\d{3})$/;

export function positionCode(letter, n) {
  return `${letter}-${String(n).padStart(3, "0")}`;
}

// Same normalisation as Product.rack (trimmed, uppercase, max 20 chars).
export function cleanRack(value) {
  return String(value ?? "").trim().toUpperCase().slice(0, 20);
}

// Null when `code` is a real position on a rack that has been added,
// otherwise the message to show. Blank is only allowed when `required` is off.
export async function rackPositionError(code, { required = true } = {}) {
  if (!code) return required ? RACK_REQUIRED_MESSAGE : null;
  const match = POSITION_PATTERN.exec(code);
  if (!match) return "Please select a valid rack position (e.g. A-001).";
  const [, letter, num] = match;
  const rack = await Rack.findOne({ letter });
  if (!rack) return `Rack ${letter} has not been added yet. Add it under Manage Racks first.`;
  const n = Number(num);
  if (n < 1 || n > rack.positions) {
    return `${code} is not a position on Rack ${letter} (it has positions ${positionCode(letter, 1)} to ${positionCode(letter, rack.positions)}).`;
  }
  return null;
}
