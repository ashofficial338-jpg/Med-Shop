// Rule-based purchase-bill parser. Takes the plain text produced by OCR (or
// read straight out of a PDF) and picks out supplier, invoice no, date, line
// items and totals using regular expressions, column headers and simple
// arithmetic checks (qty x rate ~ amount). No AI / ML: every decision below is
// a fixed rule, so the same text always gives the same result. Anything it
// can't find is simply left blank for the user to fill in.

const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DEC: 12 };
const MONTH_RE = "JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEPT?|OCT|NOV|DEC";
const GST_RATES = [0, 5, 12, 18, 28];
const GSTIN_RE = /\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b/;

const pad = (n) => String(n).padStart(2, "0");
const round2 = (n) => Math.round(n * 100) / 100;
const close = (a, b, tol = 0.02) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * tol);

// "1,234.50" / "1234,50" / "Rs.1234" -> 1234.5 ; null if not a number.
export function toNumber(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim().replace(/^(RS\.?|INR|₹)/i, "").replace(/[₹\s]/g, "");
  if (!s) return null;
  if (/^\d{1,3}(,\d{2,3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

const validYmd = (y, m, d) => {
  if (y < 2000 || y > 2099 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
};
const fullYear = (y) => (String(y).length === 2 ? 2000 + Number(y) : Number(y));

// Full dates (day-first, as Indian bills are) -> "YYYY-MM-DD".
const DATE_PATTERNS = [
  { re: /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/, f: (m) => validYmd(+m[1], +m[2], +m[3]) },
  { re: /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/, f: (m) => validYmd(fullYear(m[3]), +m[2], +m[1]) },
  {
    re: new RegExp(`\\b(\\d{1,2})[-/.\\s]*(${MONTH_RE})[A-Z]*[-/.,\\s]*(\\d{4}|\\d{2})\\b`, "i"),
    f: (m) => validYmd(fullYear(m[3]), MONTHS[m[2].toUpperCase()], +m[1]),
  },
  {
    re: new RegExp(`\\b(${MONTH_RE})[A-Z]*[-/.\\s]*(\\d{1,2}),?[-/.\\s]*(\\d{4})\\b`, "i"),
    f: (m) => validYmd(+m[3], MONTHS[m[1].toUpperCase()], +m[2]),
  },
];

export function findDate(text) {
  let best = null;
  for (const { re, f } of DATE_PATTERNS) {
    const m = re.exec(text);
    if (m) {
      const v = f(m);
      if (v && (best === null || m.index < best.index)) best = { value: v, index: m.index };
    }
  }
  return best?.value || "";
}

// Expiry like "12/27", "12-2027", "DEC-27", "DEC 2027" -> last day of that month.
// "." only with a 4-digit year - "12.27" is far more likely a price.
const EXPIRY_NUM_RE = /^(0?[1-9]|1[0-2])(?:[-/](\d{2}|20\d{2})|\.(20\d{2}))$/;
const EXPIRY_MON_RE = new RegExp(`^(${MONTH_RE})[A-Z]*[-/.']?(\\d{2}|20\\d{2})$`, "i");
export function parseExpiry(token) {
  const t = String(token || "").trim().toUpperCase();
  let m = EXPIRY_NUM_RE.exec(t);
  let month;
  let year;
  if (m) {
    month = +m[1];
    year = fullYear(m[2] || m[3]);
  } else if ((m = EXPIRY_MON_RE.exec(t))) {
    month = MONTHS[m[1].slice(0, 3)];
    year = fullYear(m[2]);
  } else return "";
  if (year < 2015 || year > 2060) return "";
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(last)}`;
}

// ---------- header fields ----------

const INVOICE_LABEL_RE =
  /\b(?:TAX\s+)?(?:INVOICE|INV|BILL|VOUCHER|VCH|CASH\s*MEMO|MEMO)\s*\.?\s*(?:NO|NUMBER|NUM|#)\b\.?\s*[:.\-#]*\s*([A-Z0-9][A-Z0-9/\-_.]*)/i;
const INVOICE_LABEL_ALT_RE = /\b(?:INVOICE|BILL)\s*[:#]\s*([A-Z0-9][A-Z0-9/\-_.]*)/i;

function findInvoiceNo(lines) {
  for (const line of lines) {
    for (const re of [INVOICE_LABEL_RE, INVOICE_LABEL_ALT_RE]) {
      const m = re.exec(line);
      if (!m) continue;
      const v = m[1].replace(/[.\-/]+$/, "");
      // Must contain a digit and not be a date or a label word.
      if (/\d/.test(v) && !/^(DATE|DT)$/i.test(v) && !findDate(v)) return v.slice(0, 40);
    }
  }
  return "";
}

const DATE_LABEL_RE = /\b(?:INVOICE|INV|BILL|VOUCHER)?\s*\.?\s*(?:DATE|DT|DATED)\b/i;
function findInvoiceDate(lines) {
  for (const line of lines) {
    const m = DATE_LABEL_RE.exec(line);
    if (m && !/\b(EXP|EXPIRY|DUE|MFG|DL)\b/i.test(line.slice(Math.max(0, m.index - 12), m.index + m[0].length))) {
      const v = findDate(line.slice(m.index));
      if (v) return v;
    }
  }
  for (const line of lines.slice(0, 25)) {
    const v = findDate(line);
    if (v) return v;
  }
  return "";
}

const SUPPLIER_HINT_RE =
  /\b(PHARMA|PHARMACEUTICALS?|AGENC(?:Y|IES)|DISTRIBUTORS?|DISTRIBUTION|MEDICALS?|MEDICINES|ENTERPRISES?|TRADERS?|TRADING|LTD|LIMITED|PVT|PRIVATE|STORES?|HEALTH\s*CARE|HEALTHCARE|LABS?|LABORATORIES|SURGICALS?|CHEMISTS?|DRUGS?|WHOLESALE|MARKETING|CORPORATION|CO\.)\b/i;
const NOT_SUPPLIER_RE =
  /\b(TAX\s+INVOICE|INVOICE|BILL\s+OF\s+SUPPLY|CASH\s+MEMO|ORIGINAL|DUPLICATE|TRIPLICATE|GSTIN|GST\s*NO|PHONE|PH\s*[:.]|MOB|MOBILE|EMAIL|E-MAIL|D\.?\s*L\.?\s*NO|DL\s*NO|FSSAI|PAN|STATE|PIN|ROAD|STREET|NAGAR|DATE|BILL\s+TO|SHIP\s+TO|BUYER|CUSTOMER|PATIENT|DR\.?\s|PAGE)\b/i;
const SUPPLIER_LABEL_RE = /\b(?:SUPPLIER|VENDOR|SOLD\s+BY|FROM|SELLER|PARTY)\s*(?:NAME)?\s*[:-]\s*(.+)$/i;
const BUYER_LABEL_RE = /\b(BILL\s+TO|SHIP\s+TO|BUYER|CONSIGNEE|M\/S|CUSTOMER|SOLD\s+TO)\b/i;

const cleanName = (s) =>
  s
    .replace(/[|_*~"`]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[^A-Z0-9]+|[^A-Z0-9.)]+$/gi, "")
    .trim();

function findSupplier(lines) {
  for (const line of lines.slice(0, 30)) {
    const m = SUPPLIER_LABEL_RE.exec(line);
    if (m && !BUYER_LABEL_RE.test(line)) {
      const v = cleanName(m[1].split(/\s{3,}/)[0]);
      if (/[A-Z]{3}/i.test(v)) return v.slice(0, 100);
    }
  }
  // Seller's name is printed at the top of a bill; stop at the buyer block.
  const top = [];
  for (const line of lines.slice(0, 15)) {
    if (BUYER_LABEL_RE.test(line)) break;
    top.push(line);
  }
  const candidates = top
    .map((l) => cleanName(l.split(/\s{3,}/)[0]))
    .filter((l) => l.length >= 3 && /[A-Z]{3}/i.test(l))
    .filter((l) => (l.match(/[A-Z]/gi) || []).length / l.length > 0.6);
  const hinted = candidates.find((l) => SUPPLIER_HINT_RE.test(l) && !NOT_SUPPLIER_RE.test(l));
  if (hinted) return hinted.slice(0, 100);
  const plain = candidates.find((l) => !NOT_SUPPLIER_RE.test(l));
  return plain ? plain.slice(0, 100) : "";
}

// ---------- totals ----------

const lastNumberOn = (line) => {
  const nums = (line.match(/\d[\d,]*\.?\d*/g) || []).map(toNumber).filter((n) => n !== null);
  return nums.length ? nums[nums.length - 1] : null;
};

const TOTAL_RULES = [
  { key: "total", re: /\b(GRAND\s*TOTAL|NET\s*(?:AMOUNT|AMT|PAYABLE|TOTAL|VALUE)|INVOICE\s*(?:TOTAL|AMOUNT|VALUE)|BILL\s*AMOUNT|AMOUNT\s*PAYABLE|TOTAL\s*PAYABLE|TOTAL\s*AMOUNT|TOTAL\s*AMT|ROUNDED\s*TOTAL)\b/i, rank: 2 },
  { key: "total", re: /^\W*TOTAL\b/i, rank: 1 },
  { key: "subtotal", re: /\b(SUB\s*-?\s*TOTAL|TAXABLE\s*(?:VALUE|AMOUNT|AMT)|GROSS\s*(?:AMOUNT|AMT|VALUE|TOTAL)|GOODS\s*VALUE)\b/i, rank: 1 },
  { key: "gstAmount", re: /\b(TOTAL\s*(?:GST|TAX)|GST\s*(?:AMOUNT|AMT|TOTAL)|TAX\s*AMOUNT)\b/i, rank: 2 },
  { key: "discount", re: /\b(DISCOUNT|DISC\.?\s*(?:AMT|AMOUNT)?|LESS\s*:?\s*DISC|CASH\s*DISC|TRADE\s*DISC)\b/i, rank: 1 },
];

function findTotals(lines) {
  const out = {};
  const rank = {};
  let cgst = null;
  let sgst = null;
  let igst = null;
  for (const line of lines) {
    const n = lastNumberOn(line);
    if (n === null) continue;
    for (const rule of TOTAL_RULES) {
      const m = rule.re.exec(line);
      if (!m || (rank[rule.key] !== undefined && rule.rank < rank[rule.key])) continue;
      // The amount comes after its label - this also skips table headers
      // like "Sl ... Disc% GST% Amount".
      const after = line.slice(m.index + m[0].length);
      if (/^\s*%/.test(after)) continue;
      const v = lastNumberOn(after);
      if (v === null) continue;
      out[rule.key] = v;
      rank[rule.key] = rule.rank;
      break;
    }
    if (/\bCGST\b/i.test(line) && !/\bSGST\b/i.test(line)) cgst = n;
    if (/\b[SU]GST\b/i.test(line) && !/\bCGST\b/i.test(line)) sgst = n;
    if (/\bIGST\b/i.test(line)) igst = n;
  }
  if (out.gstAmount === undefined) {
    if (cgst !== null && sgst !== null) out.gstAmount = round2(cgst + sgst);
    else if (igst !== null) out.gstAmount = igst;
  }
  return out;
}

// ---------- line items ----------

const HEADER_WORDS = {
  qty: /^(QTY|QUANTITY|QNTY|QTY\.|NOS|UNITS?|BILLED)$/i,
  free: /^(FREE|FR|BONUS|SCH|SCHEME)$/i,
  mrp: /^(MRP|M\.R\.P\.?)$/i,
  rate: /^(RATE|PRICE|PTR|P\.T\.R\.?|PTS|UNIT\s*PRICE|NET\s*RATE|PUR\.?\s*RATE)$/i,
  disc: /^(DISC|DISC%|DISC\.|DISCOUNT|DIS%|DIS|D%|CD%?|TD%?)$/i,
  gst: /^(GST|GST%|TAX|TAX%|IGST|GST\s*%|TAX\s*%)$/i,
  amount: /^(AMOUNT|AMT|TOTAL|VALUE|NET\s*AMT|NET\s*AMOUNT|TAXABLE|NET)$/i,
  batch: /^(BATCH|BATCH\s*NO|B\.?NO\.?|LOT|BATCH\.?)$/i,
  expiry: /^(EXP|EXPIRY|EXP\.|EXP\s*DT|EXP\.?DATE|EXPIRY\s*DATE)$/i,
  hsn: /^(HSN|HSN\/SAC|HSN\s*CODE|SAC)$/i,
};
const PRODUCT_HEADER_RE = /\b(PRODUCT|ITEM|DESCRIPTION|PARTICULARS|MEDICINE|NAME\s+OF\s+(?:THE\s+)?(?:PRODUCT|ITEM|GOODS))\b/i;
const TABLE_END_RE = /\b(SUB\s*-?\s*TOTAL|GRAND\s*TOTAL|TOTAL|TAXABLE|NET\s*AMOUNT|AMOUNT\s*IN\s*WORDS|RUPEES|CGST|SGST|IGST|ROUND\s*OFF|TERMS|DECLARATION|E\.?\s*&\s*O\.?\s*E|SIGNATURE|AUTHORI[SZ]ED)\b/i;

function headerColumns(line) {
  const tokens = line.replace(/[|]/g, " ").split(/\s+/).filter(Boolean);
  const cols = [];
  for (let i = 0; i < tokens.length; i++) {
    // Join two-word headers like "BATCH NO", "EXP DT", "UNIT PRICE", "NET AMT".
    const two = i + 1 < tokens.length ? `${tokens[i]} ${tokens[i + 1]}` : null;
    let hit = null;
    for (const [key, re] of Object.entries(HEADER_WORDS)) {
      if (two && re.test(two)) {
        hit = key;
        i++;
        break;
      }
      if (re.test(tokens[i].replace(/[:.]$/, ""))) {
        hit = key;
        break;
      }
    }
    if (hit && !cols.includes(hit)) cols.push(hit);
  }
  return cols;
}

function findItemHeader(lines) {
  let best = null;
  lines.forEach((line, idx) => {
    const cols = headerColumns(line);
    const hasProduct = PRODUCT_HEADER_RE.test(line);
    const score = cols.length + (hasProduct ? 2 : 0);
    if (cols.includes("qty") || cols.includes("rate") || cols.includes("amount")) {
      if (score >= 3 && (!best || score > best.score)) best = { idx, cols, score };
    }
  });
  return best;
}

const STRENGTH_RE = /^\d+(\.\d+)?(MG|MCG|ML|G|GM|GMS|IU|%|KG|L|LTR|MM|CM)$/i;
const PACK_RE = /^(\d+'?S|\d+X\d+(\.\d+)?|1X\d+[A-Z]*|\d+\s*TAB(S|LETS)?|\d+\s*CAP(S)?)$/i;
const isBatchToken = (t) =>
  /^(?=.*\d)(?=.*[A-Z])[A-Z0-9\-/]{4,}$/i.test(t) && !STRENGTH_RE.test(t) && !PACK_RE.test(t) && !parseExpiry(t);
const isHsnToken = (t) => /^(30|33|34|38|39|40|48|90|96)\d{2,6}$/.test(t) || /^\d{6,8}$/.test(t);
const isNumberToken = (t) => toNumber(t) !== null;

// Splits one table row into name / batch / expiry / hsn / numbers.
function splitRow(raw) {
  let line = raw.replace(/[|]/g, " ").replace(/\s+/g, " ").trim();
  line = line.replace(/^\d{1,3}\s*[.)]?\s+(?=[A-Z])/i, ""); // serial number
  const tokens = line.split(" ").filter(Boolean);

  let nameEnd = tokens.length;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const restHasWords = tokens.slice(i + 1).some((x) => /^[A-Z][A-Z.'-]{1,}$/i.test(x) && !/^(RS|INR|NOS|PCS)$/i.test(x));
    if (i === 0) continue;
    if (/^\d+\.\d+$/.test(t) || isHsnToken(t) || parseExpiry(t) || (isBatchToken(t) && !restHasWords)) {
      nameEnd = i;
      break;
    }
    if (/^\d+$/.test(t) && !restHasWords) {
      nameEnd = i;
      break;
    }
  }
  const name = tokens.slice(0, nameEnd).join(" ");
  const rest = tokens.slice(nameEnd);
  const row = { name, batchNo: "", expiryDate: "", hsn: "", pack: "", nums: [], tokens: rest };
  for (const t of rest) {
    if (!row.expiryDate && parseExpiry(t)) row.expiryDate = parseExpiry(t);
    else if (!row.hsn && isHsnToken(t)) row.hsn = t;
    else if (!row.pack && PACK_RE.test(t)) row.pack = t;
    else if (isNumberToken(t)) row.nums.push(toNumber(t.replace(/%$/, "")));
    else if (/^\d+(\.\d+)?%$/.test(t)) row.nums.push(Number(t.slice(0, -1)));
    else if (!row.batchNo && isBatchToken(t)) row.batchNo = t.toUpperCase();
  }
  return row;
}

const NUMERIC_COLS = ["qty", "free", "mrp", "rate", "disc", "gst", "amount"];

// Assigns a row's numbers to qty / rate / discount / gst / amount. First by the
// header's column order when the counts line up, then (or if that doesn't add
// up) by searching for the qty x rate pair that reproduces the line amount.
function assignNumbers(nums, headerCols) {
  const cols = (headerCols || []).filter((c) => NUMERIC_COLS.includes(c));
  let res = null;
  if (cols.length && nums.length === cols.length) {
    res = {};
    cols.forEach((c, i) => (res[c] = nums[i]));
  } else if (cols.length && nums.length > cols.length && cols[cols.length - 1] === "amount") {
    // Extra numbers (CGST/SGST splits, pack size) - align from the right edge.
    res = {};
    const off = nums.length - cols.length;
    cols.forEach((c, i) => (res[c] = nums[i + off]));
  }
  if (res && res.qty > 0 && res.rate > 0 && res.amount > 0 && checkAmount(res)) return finish(res);

  // Arithmetic search: amount is the last number; find qty (whole) * rate.
  if (nums.length >= 2) {
    const amount = nums[nums.length - 1];
    const pool = nums.slice(0, -1);
    const discCand = pool.filter((n) => n > 0 && n < 100);
    const gstCand = pool.filter((n) => GST_RATES.includes(n) && n > 0);
    for (let i = 0; i < pool.length; i++) {
      for (let j = 0; j < pool.length; j++) {
        if (i === j) continue;
        const qty = pool[i];
        const rate = pool[j];
        if (!(qty > 0) || !Number.isInteger(qty) || !(rate > 0)) continue;
        const base = qty * rate;
        const tries = [{}];
        for (const d of discCand) tries.push({ disc: d });
        for (const g of gstCand) tries.push({ gst: g });
        for (const d of discCand) for (const g of gstCand) if (d !== g) tries.push({ disc: d, gst: g });
        for (const t of tries) {
          let v = base * (1 - (t.disc || 0) / 100);
          if (t.gst !== undefined && close(v * (1 + t.gst / 100), amount, 0.005)) return finish({ qty, rate, amount, ...t, amountInclGst: true });
          if (close(v, amount, 0.005)) {
            const gst = res?.gst ?? gstCand.find((g) => g !== t.disc);
            return finish({ qty, rate, amount, ...t, gst });
          }
        }
      }
    }
  }
  // Nothing adds up - keep the header mapping if we had one, else best guess.
  if (res && (res.qty || res.rate)) return finish(res);
  if (nums.length >= 3) return finish({ qty: Number.isInteger(nums[0]) ? nums[0] : null, rate: nums[nums.length - 2], amount: nums[nums.length - 1] });
  if (nums.length === 2) return finish({ qty: Number.isInteger(nums[0]) ? nums[0] : null, amount: nums[1] });
  return finish({});
}

function checkAmount(r) {
  const base = r.qty * r.rate * (1 - (r.disc || 0) / 100);
  return close(base, r.amount) || (r.gst !== undefined && close(base * (1 + r.gst / 100), r.amount));
}

function finish(r) {
  let gst = r.gst;
  // OCR often misreads one digit of a rate (98.40 -> 98.48). When qty x rate
  // is close to - but not exactly - the line amount, and the amount divides
  // back into a clean 2-decimal rate, trust that rate instead.
  if (r.qty > 0 && r.rate > 0 && r.amount > 0 && !r.amountInclGst) {
    const factor = r.qty * (1 - (r.disc || 0) / 100);
    const derived = r.amount / factor;
    const exact = Math.abs(r.qty * r.rate * (1 - (r.disc || 0) / 100) - r.amount) <= 0.01;
    if (!exact && Math.abs(derived - round2(derived)) < 0.0005 && close(derived, r.rate, 0.02)) r = { ...r, rate: round2(derived) };
  }
  // A CGST/SGST half (2.5 / 6 / 9 / 14) means double that as the full rate.
  if (gst !== undefined && !GST_RATES.includes(gst) && GST_RATES.includes(gst * 2)) gst *= 2;
  if (gst !== undefined && !GST_RATES.includes(gst)) gst = undefined;
  return {
    qty: r.qty > 0 ? r.qty : null,
    free: r.free > 0 ? r.free : null,
    mrp: r.mrp > 0 ? r.mrp : null,
    rate: r.rate > 0 ? r.rate : null,
    discountPercent: r.disc > 0 && r.disc < 100 ? r.disc : null,
    gstPercent: gst ?? null,
    amount: r.amount > 0 ? r.amount : null,
    verified: Boolean(r.qty > 0 && r.rate > 0 && r.amount > 0 && checkAmount({ ...r, gst })),
  };
}

const looksLikeItem = (row) => row.name.replace(/[^A-Z]/gi, "").length >= 3 && row.nums.length >= 2;

function findItems(lines) {
  const header = findItemHeader(lines);
  const start = header ? header.idx + 1 : 0;
  const items = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (header && items.length && TABLE_END_RE.test(line)) break;
    if (!header && TABLE_END_RE.test(line)) continue;
    if (GSTIN_RE.test(line) || /\b(INVOICE|BILL)\s*(NO|DATE)/i.test(line)) continue;
    const row = splitRow(line);
    if (!looksLikeItem(row)) continue;
    const nums = assignNumbers(row.nums, header?.cols);
    // Without a header, keep only rows whose numbers actually add up.
    if (!header && !nums.verified) continue;
    if (!nums.qty && !nums.rate && !nums.amount) continue;
    items.push({
      name: row.name.slice(0, 150),
      batchNo: row.batchNo.slice(0, 40),
      expiryDate: row.expiryDate,
      hsn: row.hsn,
      ...nums,
    });
  }
  return items;
}

// ---------- entry point ----------

export function parseInvoiceText(text) {
  const lines = String(text || "")
    .replace(/\r/g, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[—–]/g, "-")
    .split("\n")
    .map((l) => l.replace(/\t/g, "  ").trimEnd())
    .filter((l) => l.trim());

  const gstinMatch = lines.join("\n").match(new RegExp(GSTIN_RE.source, "g")) || [];
  const totals = findTotals(lines);
  const items = findItems(lines);
  const result = {
    supplierName: findSupplier(lines),
    supplierGstin: gstinMatch[0] || "",
    invoiceNo: findInvoiceNo(lines),
    invoiceDate: findInvoiceDate(lines),
    items,
    subtotal: totals.subtotal ?? null,
    gstAmount: totals.gstAmount ?? null,
    discount: totals.discount ?? null,
    total: totals.total ?? null,
  };
  if (result.total === null && items.length) {
    const sum = items.reduce((s, it) => s + (it.amount || 0), 0);
    if (sum > 0) result.itemsAmount = round2(sum);
  }
  return result;
}

// ---------- matching against the catalog ----------

const FILLER = new Set([
  "TAB", "TABS", "TABLET", "TABLETS", "CAP", "CAPS", "CAPSULE", "CAPSULES", "SYP", "SYR", "SYRUP", "INJ", "INJECTION",
  "SUSP", "SUSPENSION", "OINT", "OINTMENT", "CREAM", "GEL", "DROP", "DROPS", "IP", "BP", "USP", "STRIP", "STRIPS",
  "BOTTLE", "THE", "OF", "AND", "LTD", "PVT", "LIMITED", "PRIVATE", "M/S", "MS",
]);

export function normalizeName(s) {
  return String(s || "")
    .toUpperCase()
    .replace(/(\d)\s+(MG|MCG|ML|GM|G|IU)\b/g, "$1$2")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t && !FILLER.has(t))
    .join(" ");
}

function bigrams(s) {
  const t = s.replace(/\s+/g, "");
  const out = new Map();
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    out.set(g, (out.get(g) || 0) + 1);
  }
  return out;
}

// 0..1 similarity of two names: character-bigram Dice blended with whole-word
// overlap; a mismatched strength (DOLO 650 vs DOLO 500) is penalised hard.
export function nameSimilarity(a, b) {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const ga = bigrams(x);
  const gb = bigrams(y);
  let inter = 0;
  let total = 0;
  for (const [g, n] of ga) {
    inter += Math.min(n, gb.get(g) || 0);
    total += n;
  }
  for (const n of gb.values()) total += n;
  const dice = total ? (2 * inter) / total : 0;
  const ta = x.split(" ");
  const tb = y.split(" ");
  const common = ta.filter((t) => tb.includes(t)).length;
  const words = common / Math.max(ta.length, tb.length);
  let score = 0.6 * dice + 0.4 * words;
  const numsA = ta.filter((t) => /\d/.test(t));
  const numsB = tb.filter((t) => /\d/.test(t));
  if (numsA.length && numsB.length && !numsA.some((n) => numsB.includes(n))) score *= 0.6;
  // One name fully contained in the other ("DOLO 650" in "DOLO 650 15S").
  if (score < 0.85 && (x.includes(y) || y.includes(x)) && Math.min(x.length, y.length) >= 4) score = Math.max(score, 0.85);
  return Math.round(score * 100) / 100;
}

export function bestMatch(name, list, getName, threshold = 0.6) {
  let best = null;
  for (const item of list) {
    const s = nameSimilarity(name, getName(item));
    if (s >= threshold && (!best || s > best.score)) best = { item, score: s };
  }
  return best;
}
