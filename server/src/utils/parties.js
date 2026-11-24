import Customer from "../models/Customer.js";
import Vendor from "../models/Vendor.js";
import { nextSequence } from "../models/Counter.js";

// Suppliers and customers named on an entry - typed by hand or in an Excel
// file - are found in the list, or added to it, in one place. Names are
// compared ignoring case, spaces and punctuation ("ABC Pharma" = "abc-pharma"),
// so the same supplier or customer is never added twice.

export const partyKey = (name) =>
  String(name || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]/gu, "");
const cleanName = (name, max) => String(name || "").trim().replace(/\s+/g, " ").slice(0, max);

// "98765 43210", "+91-9876543210" -> "9876543210"; "" when it isn't a number.
export function cleanPhone(v) {
  if (v === undefined || v === null || v === "") return "";
  let d = String(typeof v === "number" ? Math.round(v) : v).replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^\d{10}$/.test(d) ? d : "";
}

// Call inside a transaction before adding one: two entries naming the same new
// party at the same moment then run one after the other, and the second finds
// what the first added.
const oneAtATime = (kind) => nextSequence(`lock:${kind}`);

export async function findVendorByName(name) {
  const key = partyKey(name);
  if (!key) return null;
  const same = (await Vendor.find({}, "name isActive").lean()).filter((v) => partyKey(v.name) === key);
  return same.find((v) => v.isActive !== false) || same[0] || null;
}

export async function findOrCreateVendor(name) {
  const found = await findVendorByName(name);
  if (found) {
    // A removed supplier that is bought from again comes back to the list.
    if (found.isActive === false) await Vendor.updateOne({ _id: found._id }, { $set: { isActive: true } });
    return { vendor: await Vendor.findById(found._id), created: false };
  }
  await oneAtATime("vendor");
  const vendor = new Vendor({ name: cleanName(name, 150) });
  await vendor.save();
  return { vendor, created: true };
}

// By phone first, then by name. A different phone means a different person,
// even with the same name.
export async function findCustomer({ name, phone }) {
  const digits = cleanPhone(phone);
  if (digits) {
    const byPhone = await Customer.findOne({ phone: digits });
    if (byPhone) return byPhone;
  }
  const key = partyKey(name);
  if (!key) return null;
  const same = (await Customer.find({}, "name phone isActive").lean()).filter((c) => partyKey(c.name) === key && (!digits || !c.phone));
  const pick = same.find((c) => c.isActive !== false) || same[0];
  return pick ? Customer.findById(pick._id) : null;
}

// Returns { customer, created } or { error }.
export async function findOrCreateCustomer({ name, phone }) {
  const digits = cleanPhone(phone);
  if (String(phone ?? "").trim() && !digits) return { error: "Enter a valid 10-digit phone number for the customer, or leave it blank." };
  if (!partyKey(name) && !digits) return { error: "Enter the customer's name." };
  const found = await findCustomer({ name, phone: digits });
  if (found) {
    if (found.isActive === false || (digits && !found.phone)) {
      found.isActive = true;
      if (digits) found.phone = digits;
      await found.save();
    }
    return { customer: found, created: false };
  }
  await oneAtATime("customer");
  const customer = new Customer({ name: cleanName(name, 100) || `Customer ${digits}`, phone: digits || undefined });
  await customer.save();
  return { customer, created: true };
}
