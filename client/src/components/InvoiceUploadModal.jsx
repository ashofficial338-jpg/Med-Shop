import { useEffect, useRef, useState } from "react";
import { listProducts } from "../api/products";
import { checkDuplicatePurchase } from "../api/purchases";
import { ACCEPT, MAX_FILE_MB, MAX_PDF_PAGES, extractBillText, isPdf, validateBillFile } from "../utils/invoiceOcr";
import { bestMatch, parseInvoiceText } from "../utils/invoiceParser";
import { validPosition } from "../utils/rack";
import { todayLocal } from "../utils/date";

const round2 = (n) => Math.round(n * 100) / 100;
const money = (n) => (n == null ? "—" : `₹${Number(n).toFixed(2)}`);
const GST_VALUES = [0, 5, 12, 18, 28];

// Purchase entry from an uploaded bill: the bill's text is read in the
// browser (PDF text layer, or Tesseract OCR for photos/scans), picked apart by
// fixed rules (utils/invoiceParser.js), matched against the catalog, and then
// handed to the same Purchase Entry form - pre-filled, for the user to check
// and correct before saving as usual.
export default function InvoiceUploadModal({ vendors, onClose, onContinue }) {
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ stage: "", progress: 0 });
  const [products, setProducts] = useState([]);
  const [scan, setScan] = useState(null); // { parsed, text, method }
  const [supplierName, setSupplierName] = useState("");
  const [target, setTarget] = useState("none"); // vendor id | "unregistered" | "none"
  const [invoiceNo, setInvoiceNo] = useState("");
  const [date, setDate] = useState("");
  const [duplicates, setDuplicates] = useState([]);
  const abortRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    listProducts().then(setProducts).catch(() => {});
    return () => abortRef.current?.abort();
  }, []);

  // Free the preview's memory when the file changes or the modal closes.
  useEffect(() => () => previewUrl && URL.revokeObjectURL(previewUrl), [previewUrl]);

  const activeVendors = (vendors || []).filter((v) => v.isActive !== false);

  const pickFile = async (f) => {
    setError("");
    setScan(null);
    setDuplicates([]);
    setPreviewUrl("");
    setFile(null);
    if (!f) return;
    const problem = await validateBillFile(f);
    if (problem) {
      setError(problem);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setFile(f);
    if (!isPdf(f)) setPreviewUrl(URL.createObjectURL(f));
  };

  const findVendor = (parsed) => {
    const gstin = parsed.supplierGstin?.toUpperCase();
    if (gstin) {
      const byGst = activeVendors.find((v) => (v.gstNumber || "").toUpperCase().replace(/\s/g, "") === gstin);
      if (byGst) return byGst;
    }
    return parsed.supplierName ? bestMatch(parsed.supplierName, activeVendors, (v) => v.name, 0.75)?.item || null : null;
  };

  const runScan = async () => {
    if (!file || scanning) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setScanning(true);
    setError("");
    setScan(null);
    setDuplicates([]);
    try {
      const { text, method } = await extractBillText(file, { onProgress: setProgress, signal: controller.signal });
      if (!text.trim()) {
        setError("No text could be read from this file. Try a clearer, well-lit photo taken straight on - or use manual entry.");
        return;
      }
      const parsed = parseInvoiceText(text);
      const vendor = findVendor(parsed);
      setScan({ parsed, text, method });
      setSupplierName(parsed.supplierName || "");
      setTarget(vendor ? vendor._id : parsed.supplierName ? "unregistered" : "none");
      setInvoiceNo(parsed.invoiceNo || "");
      setDate(parsed.invoiceDate || todayLocal());
      lookForDuplicates(parsed.invoiceNo, parsed.invoiceDate, parsed.total);
    } catch (e) {
      if (e?.name !== "AbortError") {
        setError(e?.message && !/^\w+Error/.test(e.message) && e.message.length < 160
          ? e.message
          : "The bill couldn't be read. Check your internet connection (the OCR engine loads on first use) and try again.");
      }
    } finally {
      setScanning(false);
      abortRef.current = null;
    }
  };

  const lookForDuplicates = (no, d, total) => {
    if (!no && !(d && total)) return setDuplicates([]);
    checkDuplicatePurchase({ invoiceNo: no || undefined, date: d || undefined, total: total || undefined })
      .then(setDuplicates)
      .catch(() => setDuplicates([]));
  };

  const matched = (scan?.parsed.items || []).map((it) => {
    const m = bestMatch(it.name, products, (p) => p.name);
    return { it, product: m?.item || null, score: m?.score ?? null };
  });

  // Purchase Entry's line shape (utils/purchaseLine.js), plus a `scan` note for
  // hints. A line that matches no product becomes a new product, by name.
  const buildLines = () =>
    matched.map(({ it, product, score }) => {
      const rate = it.rate ?? (it.qty && it.amount ? round2(it.amount / it.qty) : null);
      const mrp = !product && it.mrp ? String(it.mrp) : "";
      return {
        product: product?._id || "",
        name: product?.name || it.name || "",
        qtyPacks: it.qty ? String(it.qty) : "",
        costPrice: rate != null ? String(rate) : "",
        costTouched: rate != null,
        discountPercent: it.discountPercent ? String(it.discountPercent) : "",
        sellingPrice: mrp,
        sellTouched: Boolean(mrp),
        ...(GST_VALUES.includes(it.gstPercent) ? { gst: String(it.gstPercent) } : {}),
        batchNo: it.batchNo || "",
        expiryDate: it.expiryDate || "",
        rack: validPosition(product?.rack) || "",
        scan: {
          name: it.name,
          score: product ? score : null,
          gstPercent: it.gstPercent,
          free: it.free,
          amount: it.amount,
        },
      };
    });

  const handleContinue = () => {
    const direct = target === "unregistered" || target === "none";
    const lines = buildLines();
    const initialData = {
      invoiceNo: invoiceNo.trim(),
      date,
      supplierName: target === "unregistered" ? supplierName.trim() : "",
      lines,
      fileName: file?.name || "",
      newCount: lines.filter((l) => !l.product).length,
      billTotals: {
        subtotal: scan.parsed.subtotal,
        gstAmount: scan.parsed.gstAmount,
        discount: scan.parsed.discount,
        total: scan.parsed.total ?? scan.parsed.itemsAmount ?? null,
      },
    };
    onContinue(
      direct ? { initialData } : { vendor: activeVendors.find((v) => v._id === target), initialData }
    );
  };

  const inputCls =
    "w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-text focus:border-primary focus:outline-none";
  const labelCls = "block text-xs font-medium text-muted";
  const p = scan?.parsed;
  const matchedCount = matched.filter((m) => m.product).length;
  const sameNo = duplicates.filter((d) => d.sameInvoiceNo);
  const canContinue = scan && !scanning && (target !== "unregistered" || supplierName.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-8">
      <div className="w-full max-w-2xl space-y-4 rounded-2xl bg-surface p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-xl font-semibold text-text">Upload Purchase Bill</h2>
            <p className="text-xs text-muted">
              JPG, PNG or PDF up to {MAX_FILE_MB} MB. The bill is read on this device — it isn't uploaded or stored.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-muted hover:text-text" aria-label="Close">✕</button>
        </div>

        <div className="space-y-2">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            disabled={scanning}
            onChange={(e) => pickFile(e.target.files?.[0] || null)}
            className="block w-full text-sm text-text file:mr-3 file:rounded-lg file:border-0 file:bg-bg file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-primary"
          />
          {file && isPdf(file) && (
            <p className="text-xs text-muted">📄 {file.name} — up to the first {MAX_PDF_PAGES} pages are read.</p>
          )}
          {previewUrl && (
            <img src={previewUrl} alt="Bill preview" className="max-h-56 rounded-lg border border-border object-contain" />
          )}
        </div>

        {scanning && (
          <div className="space-y-1">
            <p className="text-xs text-muted">{progress.stage || "Working…"}</p>
            <div className="h-2 w-full overflow-hidden rounded-full bg-bg">
              <div className="h-full bg-primary transition-all" style={{ width: `${Math.round((progress.progress || 0) * 100)}%` }} />
            </div>
          </div>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}

        {!scan && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={runScan}
              disabled={!file || scanning}
              className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-primary-dark"
            >
              {scanning ? "Reading bill…" : "Read Bill"}
            </button>
            {scanning ? (
              <button type="button" onClick={() => abortRef.current?.abort()} className="rounded-lg px-5 py-2 text-sm font-semibold text-muted hover:bg-bg">
                Stop
              </button>
            ) : (
              <button type="button" onClick={onClose} className="rounded-lg px-5 py-2 text-sm font-semibold text-muted hover:bg-bg">
                Cancel
              </button>
            )}
          </div>
        )}

        {scan && (
          <div className="space-y-4 border-t border-border pt-4">
            <p className="text-xs text-muted">
              Read by {scan.method === "pdf-text" ? "PDF text" : scan.method === "mixed" ? "PDF text + OCR" : "OCR"} ·{" "}
              {p.items.length} item line{p.items.length === 1 ? "" : "s"} found
              {p.items.length > 0 && `, ${matchedCount} matched to your products`}. Anything missing can be filled in on the next step.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className={labelCls}>Supplier on bill{p.supplierGstin && ` (GSTIN ${p.supplierGstin})`}</label>
                <input type="text" maxLength={100} value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="Not found — type it if needed" className={inputCls} />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Enter this purchase as</label>
                <select value={target} onChange={(e) => setTarget(e.target.value)} className={inputCls}>
                  <optgroup label="Your suppliers">
                    {activeVendors.map((v) => (
                      <option key={v._id} value={v._id}>{v.name}</option>
                    ))}
                  </optgroup>
                  <option value="unregistered">New supplier{supplierName.trim() ? ` — ${supplierName.trim()}` : ""}</option>
                  <option value="none">No supplier</option>
                </select>
                {target === "unregistered" && !supplierName.trim() && (
                  <p className="mt-1 text-xs text-warning">Type the supplier's name above.</p>
                )}
              </div>
              <div>
                <label className={labelCls}>Invoice No</label>
                <input
                  type="text"
                  value={invoiceNo}
                  onChange={(e) => setInvoiceNo(e.target.value)}
                  onBlur={() => lookForDuplicates(invoiceNo.trim(), date, p.total)}
                  placeholder="Not found — auto-generated if blank"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Invoice Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  onBlur={() => lookForDuplicates(invoiceNo.trim(), date, p.total)}
                  className={inputCls}
                />
              </div>
            </div>

            {duplicates.length > 0 && (
              <div className="rounded-xl border border-warning/40 bg-bg p-3 text-xs text-warning">
                <p className="font-semibold">
                  {sameNo.length ? "This invoice number is already recorded:" : "A purchase with the same date and total is already recorded:"}
                </p>
                <ul className="mt-1 space-y-0.5">
                  {duplicates.map((d) => (
                    <li key={d._id}>
                      {d.supplier} — {d.invoiceNo} · {new Date(d.date).toLocaleDateString()} · {money(d.total)}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-muted">Check it isn't the same bill before continuing.</p>
              </div>
            )}

            {p.items.length > 0 ? (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-bg text-left text-muted">
                    <tr>
                      <th className="px-2 py-1.5 font-medium">On bill</th>
                      <th className="px-2 py-1.5 font-medium">Your product</th>
                      <th className="px-2 py-1.5 text-right font-medium">Qty</th>
                      <th className="px-2 py-1.5 text-right font-medium">Rate</th>
                      <th className="px-2 py-1.5 text-right font-medium">Disc%</th>
                      <th className="px-2 py-1.5 text-right font-medium">GST%</th>
                      <th className="px-2 py-1.5 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matched.map(({ it, product, score }, i) => (
                      <tr key={i} className="border-t border-border text-text">
                        <td className="px-2 py-1.5">{it.name}</td>
                        <td className="px-2 py-1.5">
                          {product ? (
                            <span>
                              {product.name} <span className="text-success">({Math.round(score * 100)}%)</span>
                            </span>
                          ) : (
                            <span className="text-warning">New product</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono">{it.qty ?? "—"}{it.free ? ` +${it.free}` : ""}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{it.rate ?? "—"}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{it.discountPercent ?? "—"}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{it.gstPercent ?? "—"}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{it.amount ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-warning">No item lines could be picked out — you can add them on the next step.</p>
            )}

            <div className="text-right text-sm text-text">
              {p.subtotal != null && <p>Bill subtotal: {money(p.subtotal)}</p>}
              {p.discount != null && <p>Bill discount: {money(p.discount)}</p>}
              {p.gstAmount != null && <p>Bill GST: {money(p.gstAmount)}</p>}
              <p className="font-semibold">Bill total: {money(p.total ?? p.itemsAmount)}</p>
            </div>

            <details className="rounded-xl border border-border p-3 text-xs">
              <summary className="cursor-pointer font-semibold text-muted">Text read from the bill</summary>
              <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-text">{scan.text}</pre>
            </details>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleContinue}
                disabled={!canContinue}
                className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-primary-dark"
              >
                Continue to Purchase Entry
              </button>
              <button
                type="button"
                onClick={() => {
                  setScan(null);
                  pickFile(null);
                  if (inputRef.current) inputRef.current.value = "";
                }}
                className="rounded-lg border border-border px-5 py-2 text-sm font-semibold text-primary hover:bg-bg"
              >
                Use Another File
              </button>
              <button type="button" onClick={onClose} className="rounded-lg px-5 py-2 text-sm font-semibold text-muted hover:bg-bg">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
