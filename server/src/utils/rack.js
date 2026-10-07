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
