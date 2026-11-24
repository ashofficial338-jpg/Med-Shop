import { useEffect, useState } from "react";
import { lineRate } from "../../context/CartContext";
import { describePosition, rackLetter } from "../../utils/rack";
import { makerOf } from "../../utils/medicine";
import { availableFor, hasRack, lineUnits, unitsLabel } from "../../utils/billLine";

function where(code, racks) {
  if (!code) return "No Rack";
  const d = describePosition(code, racks.find((r) => r.letter === rackLetter(code)));
  return d.shelf ? `${code} (Shelf ${d.shelf}, Row ${d.row}, Bin ${d.bin})` : code;
}

// A number box that can be emptied and retyped; it only reports valid numbers.
function NumberBox({ value, onCommit, min = 0, integer = false, label, className, invalid }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText((t) => (Number(t) === Number(value) && t !== "" ? t : String(value))), [value]);
  return (
    <input
      type="text"
      inputMode={integer ? "numeric" : "decimal"}
      aria-label={label}
      value={text}
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        const t = e.target.value;
        if (!(integer ? /^\d*$/ : /^\d*\.?\d{0,2}$/).test(t)) return;
        setText(t);
        if (t !== "" && t !== "." && Number(t) >= min) onCommit(Number(t));
      }}
      onBlur={() => (text === "" || text === "." || Number(text) < min) && setText(String(value))}
      className={`rounded-lg border bg-surface text-sm tabular-nums text-text focus:border-primary focus:outline-none ${invalid ? "border-danger" : "border-border"} ${className}`}
    />
  );
}

// One product on the bill: quantity, pack/loose, rate and amount. Stock is
// taken earliest-expiry-first by itself; "Change batch" is there for the times
// a particular batch or rack position is wanted.
export default function BillLine({ line, batches, racks, canEditRate, total, onQty, onUnit, onRate, onBatch, onRemove }) {
  const [choosing, setChoosing] = useState(Boolean(line.batch));
  const { product } = line;
  const available = availableFor(line, batches);
  const short = available !== null && lineUnits(line) > available;
  const rate = lineRate(line);
  const loose = product.soldAs === "pack-and-loose";
  const unitName = line.unitType === "pack" ? product.packUnit : product.looseUnitName;
  const exp = (d) => new Date(d).toLocaleDateString(undefined, { month: "short", year: "numeric" });

  const picked = (batches || []).find((b) => b._id === line.batch);
  const first = batches?.[0];
  let pickFrom = null;
  if (line.batch && hasRack(line)) pickFrom = `${where(line.rack, racks)}${picked ? ` · batch ${picked.batchNo}` : ""}`;
  else if (picked) pickFrom = `${picked.locations.map((l) => where(l.rack, racks)).join(" / ")} · batch ${picked.batchNo}`;
  else if (first?.locations?.[0]) pickFrom = `${where(first.locations[0].rack, racks)} · batch ${first.batchNo}${first.expiryDate ? `, exp ${exp(first.expiryDate)}` : ""}`;

  return (
    <li className="px-3 py-3 sm:px-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-[150px] flex-1">
          <p className="text-sm font-semibold text-text">
            {product.name}
            {makerOf(product) && <span className="ml-1.5 text-xs font-normal text-muted">{makerOf(product)}</span>}
          </p>
          <p className={`mt-0.5 text-xs ${short ? "font-semibold text-danger" : "text-muted"}`}>
            {available === null
              ? "Checking stock…"
              : `${short ? "Not enough stock – only " : ""}${unitsLabel(product, available)} ${short ? "left" : "in stock"} · GST ${product.gstPercent}%`}
          </p>
        </div>

        {loose && (
          <div className="inline-flex rounded-lg border border-border p-0.5" role="group" aria-label={`Unit for ${product.name}`}>
            {[
              ["pack", product.packUnit],
              ["loose", product.looseUnitName],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => onUnit(key)}
                aria-pressed={line.unitType === key}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold ${line.unitType === key ? "bg-primary text-white" : "text-muted hover:text-text"}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-1">
          <button type="button" aria-label="One less" onClick={() => onQty(line.qty - 1)} className="h-9 w-9 rounded-lg bg-bg text-lg leading-none text-text hover:bg-border">
            −
          </button>
          <NumberBox value={line.qty} min={1} integer label={`Quantity of ${product.name}`} onCommit={onQty} invalid={short} className="h-9 w-14 text-center font-semibold" />
          <button type="button" aria-label="One more" onClick={() => onQty(line.qty + 1)} className="h-9 w-9 rounded-lg bg-bg text-lg leading-none text-text hover:bg-border">
            +
          </button>
        </div>

        <div className="flex items-center gap-1 text-sm text-muted">
          <span>₹</span>
          {canEditRate ? (
            <NumberBox value={rate} label={`Rate of ${product.name}`} onCommit={onRate} invalid={!(rate > 0)} className="h-9 w-[72px] px-2 text-right" />
          ) : (
            <span className="tabular-nums text-text">{rate.toFixed(2)}</span>
          )}
          <span className="text-xs">/ {unitName}</span>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <p className="w-[84px] text-right text-base font-semibold tabular-nums text-text">₹{total.toFixed(2)}</p>
          <button type="button" onClick={onRemove} aria-label={`Remove ${product.name}`} className="rounded-lg px-2 py-1 text-muted hover:bg-danger/10 hover:text-danger">
            ✕
          </button>
        </div>
      </div>

      {rate === 0 && (
        <p className="mt-1.5 text-xs font-semibold text-warning">
          {canEditRate ? "This product has no selling price yet – type the rate." : "This product has no selling price yet. Ask an Admin to set it."}
        </p>
      )}

      {batches && batches.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {pickFrom && <span className="text-primary">📍 Pick from {pickFrom}</span>}
          {!choosing ? (
            <button type="button" onClick={() => setChoosing(true)} className="font-semibold text-muted underline hover:text-primary">
              Change batch
            </button>
          ) : (
            <select
              aria-label={`Batch and rack for ${product.name}`}
              value={line.batch ? `${line.batch}|${hasRack(line) ? line.rack : "*"}` : ""}
              onChange={(e) => {
                if (!e.target.value) {
                  onBatch(null, null);
                  setChoosing(false);
                  return;
                }
                const [batchId, rack] = e.target.value.split("|");
                onBatch(batchId, rack === "*" ? null : rack);
              }}
              className="max-w-full rounded-md border border-border bg-surface px-1.5 py-1 text-xs text-text focus:border-primary focus:outline-none"
            >
              <option value="">Automatic (earliest expiry first)</option>
              {batches.map((b) => (
                <optgroup key={b._id} label={`Batch ${b.batchNo} · exp ${b.expiryDate ? exp(b.expiryDate) : "—"} · ${unitsLabel(product, b.qtyRemaining)}`}>
                  {b.locations.length > 1 && <option value={`${b._id}|*`}>Batch {b.batchNo} – any rack</option>}
                  {b.locations.map((l) => (
                    <option key={l.rack || "none"} value={`${b._id}|${l.rack}`}>
                      {b.batchNo} @ {where(l.rack, racks)} · {unitsLabel(product, l.qty)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}
        </div>
      )}
    </li>
  );
}
