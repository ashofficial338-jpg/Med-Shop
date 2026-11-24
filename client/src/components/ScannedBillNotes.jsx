// Notes shown on the purchase forms when they were pre-filled from a scanned
// bill (see InvoiceUploadModal). Purely informational - they never change
// what gets saved; the form's own fields are the single source of truth.

const money = (n) => `₹${Number(n).toFixed(2)}`;

export function ScannedBillBanner({ scan, computedTotal }) {
  if (!scan) return null;
  const billTotal = scan.billTotals?.total;
  const differs = billTotal != null && Math.abs(billTotal - computedTotal) > 1;
  const added = scan.newCount || 0;
  return (
    <div className="space-y-1 rounded-xl border border-primary/30 bg-primary-soft p-3 text-xs text-text">
      <p className="font-semibold">
        Filled from scanned bill{scan.fileName ? ` “${scan.fileName}”` : ""} — please check every field before saving.
      </p>
      {added > 0 && (
        <p className="text-warning">
          {added} line{added === 1 ? " isn't" : "s aren't"} in your Product List – pick the right product below, or {added === 1 ? "it" : "they"} will be added as new.
        </p>
      )}
      {billTotal != null && (
        <p className={differs ? "text-warning" : "text-muted"}>
          Bill total {money(billTotal)} · this entry {money(computedTotal)}
          {differs && " — amounts differ; check quantities, rates and each product's GST %."}
        </p>
      )}
    </div>
  );
}

export function ScannedLineHint({ line, productGst }) {
  const s = line.scan;
  if (!s) return null;
  const notes = [];
  if (s.free) notes.push(`bill also lists ${s.free} free — add to Qty if received`);
  if (s.gstPercent != null && productGst != null && Number(productGst) !== Number(s.gstPercent)) {
    notes.push(`bill GST ${s.gstPercent}% vs product's ${productGst}% (product's rate is used)`);
  }
  if (s.amount != null) notes.push(`bill amount ${money(s.amount)}`);
  return (
    <p className="mt-1 text-xs text-muted">
      <span className="font-medium text-text">Scanned:</span> “{s.name || "—"}”
      {s.score != null ? (
        <span className="text-success"> · matched {Math.round(s.score * 100)}%</span>
      ) : (
        <span className="text-warning"> · no matching product</span>
      )}
      {notes.length > 0 && ` · ${notes.join(" · ")}`}
    </p>
  );
}
