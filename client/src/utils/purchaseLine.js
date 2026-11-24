// One line of Purchase Entry: its shape and figures (same arithmetic as the
// server's routes/purchases.js, so the total on screen is the total saved).

export const PACK_UNITS = ["Strip", "Bottle", "Box", "Tube", "Vial", "Jar", "Piece"];
export const LOOSE_UNITS = ["Tablet", "Capsule", "ml", "Piece"];
export const GST_VALUES = [0, 5, 12, 18, 28];

const round2 = (n) => Number(Number(n).toFixed(2));
let nextKey = 1;

export function emptyLine(values = {}) {
  return {
    key: nextKey++,
    product: "",
    name: "",
    // Only used when `name` is a new product.
    gst: "12",
    packUnit: "Strip",
    unitsPerPack: "",
    looseUnitName: "Tablet",
    category: "",
    hsn: "",
    qtyPacks: "",
    costPrice: "",
    costTouched: false, // typed (not looked up), so never overwritten
    discountPercent: "",
    sellingPrice: "",
    sellTouched: false,
    batchNo: "",
    expiryDate: "",
    rack: "",
    showRack: false,
    ...values,
  };
}

export const isBlank = (l) => !l.product && !l.name.trim();
export const isNewProduct = (l) => !l.product && l.name.trim() !== "";

export function lineFigures(line, product) {
  const qty = Number(line.qtyPacks) || 0;
  const rate = Number(line.costPrice) || 0;
  const disc = Math.min(Math.max(Number(line.discountPercent) || 0, 0), 100);
  const net = Number((rate * (1 - disc / 100)).toFixed(4));
  const gross = round2(qty * rate);
  const amount = round2(qty * net);
  const gstPercent = line.product ? product?.gstPercent || 0 : Number(line.gst) || 0;
  const selling = Number(line.sellingPrice) || 0;
  return {
    gross,
    amount,
    discount: round2(gross - amount),
    gstPercent,
    gst: round2((amount * gstPercent) / 100),
    margin: selling > 0 && net > 0 ? ((selling - net) / selling) * 100 : null,
  };
}

// What's wrong with a line, in words, or "" when it can be saved.
export function lineProblem(l) {
  const label = l.name.trim() || "this product";
  if (!(Number(l.qtyPacks) > 0) || !Number.isInteger(Number(l.qtyPacks))) return `Enter the quantity for ${label}.`;
  if (l.costPrice !== "" && !(Number(l.costPrice) >= 0)) return `Check the purchase rate of ${label}.`;
  if (l.discountPercent !== "" && !(Number(l.discountPercent) >= 0 && Number(l.discountPercent) <= 100)) return `The discount on ${label} must be 0 to 100%.`;
  if (l.sellingPrice !== "" && !(Number(l.sellingPrice) >= 0)) return `Check the selling price of ${label}.`;
  return "";
}

export function toItem(l) {
  return {
    ...(l.product
      ? { product: l.product }
      : {
          newProduct: {
            name: l.name.trim(),
            gstPercent: Number(l.gst) || 0,
            packUnit: l.packUnit,
            unitsPerPack: Number(l.unitsPerPack) > 1 ? Number(l.unitsPerPack) : undefined,
            looseUnitName: Number(l.unitsPerPack) > 1 ? l.looseUnitName : undefined,
            category: l.category.trim(),
            hsnCode: l.hsn.trim(),
          },
        }),
    qtyPacks: Number(l.qtyPacks),
    costPrice: l.costPrice === "" ? 0 : Number(l.costPrice),
    discountPercent: l.discountPercent === "" ? 0 : Number(l.discountPercent),
    // Only a price typed here changes the product's current price.
    ...(l.sellTouched && l.sellingPrice !== "" ? { sellingPrice: Number(l.sellingPrice) } : {}),
    batchNo: l.batchNo.trim(),
    expiryDate: l.expiryDate,
    rack: l.rack.trim(),
  };
}
