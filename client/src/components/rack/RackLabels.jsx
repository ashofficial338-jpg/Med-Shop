import { useState } from "react";
import QRCode from "qrcode";
import { toast } from "react-toastify";
import { getRackStock } from "../../api/racks";
import { positionsOf, describePosition, rackScanUrl, rackLayout } from "../../utils/rack";
import { btnCls } from "./RackCommon";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Rack QR codes + label printing. Each QR holds a link that opens the
// Rack Center scanner on that rack / shelf / position, so any phone camera
// (or the in-app scanner, or a handheld scanner) jumps straight to its stock.
export default function RackLabels({ racks }) {
  const [letters, setLetters] = useState(() => racks.map((r) => r.letter));
  const [level, setLevel] = useState("position");
  const [withContents, setWithContents] = useState(true);
  const [busy, setBusy] = useState(false);

  const toggle = (l) => setLetters((ls) => (ls.includes(l) ? ls.filter((x) => x !== l) : [...ls, l]));

  const print = async () => {
    const chosen = racks.filter((r) => letters.includes(r.letter));
    if (!chosen.length) return;
    // Open first (synchronously) so pop-up blockers allow it.
    const win = window.open("", "_blank");
    if (!win) {
      toast.error("Allow pop-ups to print labels.");
      return;
    }
    win.document.write("<p style='font-family:sans-serif'>Preparing labels…</p>");
    setBusy(true);
    try {
      const labels = [];
      for (const rack of chosen) {
        const contents = new Map();
        if (withContents && level === "position") {
          const { rows } = await getRackStock(rack.letter);
          for (const r of rows) {
            const list = contents.get(r.rack) || new Set();
            list.add(r.name);
            contents.set(r.rack, list);
          }
        }
        if (level === "rack") {
          labels.push({ code: rack.letter, title: `RACK ${rack.letter}`, sub: rack.name || `${rack.positions} positions`, lines: [] });
        } else if (level === "shelf") {
          const { shelves } = rackLayout(rack);
          for (let s = 1; s <= shelves; s++) labels.push({ code: `${rack.letter}-S${s}`, title: `${rack.letter} · SHELF ${s}`, sub: rack.name || `Rack ${rack.letter}`, lines: [] });
        } else {
          for (const code of positionsOf(rack)) {
            const d = describePosition(code, rack);
            labels.push({ code, title: code, sub: d.shelf ? `Shelf ${d.shelf} · Row ${d.row} · Bin ${d.bin}` : `Rack ${rack.letter}`, lines: [...(contents.get(code) || [])].slice(0, 3) });
          }
        }
      }
      const withQr = await Promise.all(labels.map(async (l) => ({ ...l, qr: await QRCode.toDataURL(rackScanUrl(l.code), { margin: 1, width: 220, errorCorrectionLevel: "M" }) })));
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>Rack labels</title><style>
        @page { margin: 8mm; }
        body { font-family: Arial, sans-serif; margin: 0; color: #111; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(62mm, 1fr)); gap: 4mm; }
        .label { border: 1px dashed #999; border-radius: 3mm; padding: 3mm; display: flex; gap: 3mm; align-items: center; break-inside: avoid; }
        .label img { width: 24mm; height: 24mm; }
        .t { font-size: 15pt; font-weight: 800; letter-spacing: .5px; }
        .s { font-size: 8.5pt; color: #333; margin-top: 1mm; }
        .c { font-size: 7.5pt; color: #555; margin-top: 1mm; }
        .shop { font-size: 7pt; color: #777; text-transform: uppercase; letter-spacing: 1px; }
        @media print { .noprint { display: none; } }
      </style></head><body>
      <p class="noprint" style="font-size:13px">${withQr.length} labels · <button onclick="window.print()">Print</button></p>
      <div class="grid">${withQr
        .map(
          (l) => `<div class="label"><img src="${l.qr}" alt="QR ${esc(l.code)}"><div><div class="shop">Gugan Medicals</div><div class="t">${esc(l.title)}</div><div class="s">${esc(l.sub)}</div>${
            l.lines.length ? `<div class="c">${l.lines.map(esc).join("<br>")}</div>` : ""
          }</div></div>`
        )
        .join("")}</div>
      <script>window.onload = () => setTimeout(() => window.print(), 300);</script>
      </body></html>`;
      win.document.open();
      win.document.write(html);
      win.document.close();
    } catch {
      win.close();
      toast.error("Could not prepare the labels.");
    } finally {
      setBusy(false);
    }
  };

  if (!racks.length) return <p className="text-sm text-muted">Add racks first (Rack Finder → Manage Racks).</p>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Print QR labels for racks, shelves or individual positions. Scanning a label opens that location's stock.</p>
      <div className="flex flex-wrap gap-1.5">
        {racks.map((r) => (
          <button
            key={r.letter}
            type="button"
            onClick={() => toggle(r.letter)}
            aria-pressed={letters.includes(r.letter)}
            className={`h-10 min-w-10 rounded-lg px-3 text-sm font-bold ${letters.includes(r.letter) ? "bg-primary text-white" : "border border-border text-text"}`}
          >
            {r.letter}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 text-sm text-text">
        {[
          ["rack", "One per rack"],
          ["shelf", "One per shelf"],
          ["position", "One per position (bin)"],
        ].map(([v, label]) => (
          <label key={v} className="flex items-center gap-1.5">
            <input type="radio" name="label-level" checked={level === v} onChange={() => setLevel(v)} className="accent-primary" />
            {label}
          </label>
        ))}
      </div>
      {level === "position" && (
        <label className="flex items-center gap-2 text-sm text-text">
          <input type="checkbox" checked={withContents} onChange={(e) => setWithContents(e.target.checked)} className="accent-primary" />
          Print the medicines currently stored on each position
        </label>
      )}
      <button type="button" disabled={busy || !letters.length} onClick={print} className={btnCls}>
        {busy ? "Preparing…" : "Print labels"}
      </button>
    </div>
  );
}
