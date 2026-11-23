// Sales Entry amounts - a copy of server/src/utils/salesEntryCalc.js (keep in
// sync). The screen shows these live; the server works them out again on save.
//
// Per line:  amount   = qty x rate
//            discount = amount x discount% / 100
//            taxable  = amount - discount
//            GST      = taxable x GST% / 100, split CGST + SGST half each
//                       (or all IGST for an inter-state supply)
// Invoice:   grand total = taxable + all GST, rounded to the nearest rupee
//            (the difference is shown as Round Off, as in Tally).

export const GST_RATES = [0, 5, 12, 18, 28];
export const PAYMENT_MODES = ["Cash", "UPI", "Bank Transfer", "Credit"];

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function calcLine(item, interState) {
  const qty = num(item.qty);
  const rate = num(item.rate);
  const discountPercent = Math.min(Math.max(num(item.discountPercent), 0), 100);
  const gstPercent = num(item.gstPercent);
  const amount = r2(qty * rate);
  const discountAmount = r2((amount * discountPercent) / 100);
  const taxableAmount = r2(amount - discountAmount);
  const gst = r2((taxableAmount * gstPercent) / 100);
  const cgst = interState ? 0 : r2(gst / 2);
  const sgst = interState ? 0 : r2(gst - cgst);
  const igst = interState ? gst : 0;
  return { qty, rate, discountPercent, gstPercent, amount, discountAmount, taxableAmount, cgst, sgst, igst, total: r2(taxableAmount + gst) };
}

export function calcInvoice(items, interState) {
  const lines = items.map((it) => ({ ...it, ...calcLine(it, interState) }));
  const sum = (k) => r2(lines.reduce((s, l) => s + l[k], 0));
  const taxableTotal = sum("taxableAmount");
  const cgstTotal = sum("cgst");
  const sgstTotal = sum("sgst");
  const igstTotal = sum("igst");
  const exact = r2(taxableTotal + cgstTotal + sgstTotal + igstTotal);
  const grandTotal = Math.round(exact);
  return {
    lines,
    subtotal: sum("amount"),
    discountTotal: sum("discountAmount"),
    taxableTotal,
    cgstTotal,
    sgstTotal,
    igstTotal,
    roundOff: r2(grandTotal - exact),
    grandTotal,
    amountInWords: amountInWords(grandTotal),
  };
}

// Indian numbering: 1,23,456 -> "One Lakh Twenty Three Thousand Four Hundred Fifty Six".
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n) {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
}
function belowThousand(n) {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", rest ? belowHundred(rest) : ""].filter(Boolean).join(" ");
}
function wholeWords(n) {
  if (n === 0) return "Zero";
  const parts = [];
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${wholeWords(crore)} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (rest) parts.push(belowThousand(rest));
  return parts.join(" ");
}

export function amountInWords(value) {
  const n = Math.abs(r2(value));
  const rupees = Math.floor(n);
  const paise = Math.round((n - rupees) * 100);
  return `Rupees ${wholeWords(rupees)}${paise ? ` and ${belowHundred(paise)} Paise` : ""} Only`;
}
