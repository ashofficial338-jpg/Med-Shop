import { useEffect, useRef, useState } from "react";
import { parseRackCode, NO_RACK } from "../../utils/rack";

export const inputCls =
  "h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text focus:border-primary focus:outline-none";
export const btnCls = "rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50";
export const ghostBtnCls = "rounded-lg border border-border px-3 py-2 text-sm font-semibold text-primary hover:bg-bg disabled:opacity-50";

export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—");
export const money = (n) => (n == null ? "—" : `₹${Number(n).toFixed(2)}`);

export function expiryTone(days) {
  if (days === null || days === undefined) return "text-muted";
  if (days < 0) return "text-danger";
  if (days <= 30) return "text-warning";
  return "text-muted";
}

// Internal stock units -> "3 Strips + 4 Tablets" for a row that carries its unit info.
export function unitsText(row, units) {
  if (row.soldAs === "pack-and-loose" && row.unitsPerPack > 1) {
    const packs = Math.floor(units / row.unitsPerPack);
    const loose = units % row.unitsPerPack;
    return `${packs} ${row.packUnit}${packs === 1 ? "" : "s"}${loose ? ` + ${loose} ${row.looseUnitName}` : ""}`;
  }
  return `${units} ${row.packUnit}${units === 1 ? "" : "s"}`;
}

// One stock row (position + batch) as a compact, phone-friendly card line.
export function StockRowCard({ row, right }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-border bg-surface p-3">
      <div className="min-w-0">
        <p className="font-medium text-text">
          {row.name} <span className="font-mono text-xs text-muted">{row.productCode}</span>
        </p>
        <p className="text-xs text-muted">
          {[row.manufacturer, row.composition].filter(Boolean).join(" · ") || "—"}
        </p>
        <p className="mt-1 text-xs">
          <span className="rounded bg-primary-soft px-1.5 py-0.5 font-mono font-semibold text-primary">{row.rack || "No Rack"}</span>{" "}
          <span className="text-muted">{row.rack ? row.location : ""}</span>
        </p>
        <p className="mt-1 text-xs text-muted">
          Batch <span className="font-mono text-text">{row.batchNo}</span> · exp{" "}
          <span className={expiryTone(row.daysToExpiry)}>{fmtDate(row.expiryDate)}</span>
          {row.daysToExpiry === null ? "" : row.daysToExpiry < 0 ? " (expired)" : row.daysToExpiry <= 90 ? ` (${row.daysToExpiry} days)` : ""}
        </p>
      </div>
      <div className="text-right">
        <p className="font-semibold text-text">{row.qtyDisplay}</p>
        {right}
      </div>
    </div>
  );
}

// Text box that accepts a typed or scanned rack code (USB/Bluetooth scanners
// type it and press Enter), plus an optional camera scan where the browser
// supports BarcodeDetector (Chrome / Edge on Android, most desktops).
export function RackCodeInput({ onCode, placeholder = "Scan or type a rack code (A, A-S2, A-014)", autoFocus = false }) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [camera, setCamera] = useState(false);

  const submit = (value) => {
    const code = parseRackCode(value);
    if (!code) {
      setError("Not a rack code. Use a rack letter (A), shelf (A-S2), position (A-014) or NONE.");
      return;
    }
    setError("");
    setText(code === NO_RACK ? "NONE" : code);
    onCode(code);
  };

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(text);
        }}
        className="flex gap-2"
      >
        <input
          aria-label="Rack code"
          value={text}
          autoFocus={autoFocus}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          className={inputCls}
        />
        <button type="submit" className={btnCls}>Go</button>
        {"BarcodeDetector" in window && (
          <button type="button" onClick={() => setCamera(true)} className={ghostBtnCls} aria-label="Scan with camera">
            📷
          </button>
        )}
      </form>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      {camera && (
        <CameraScanner
          onResult={(value) => {
            setCamera(false);
            submit(value);
          }}
          onClose={() => setCamera(false)}
        />
      )}
    </div>
  );
}

function CameraScanner({ onResult, onClose }) {
  const videoRef = useRef(null);
  const resultRef = useRef(onResult);
  const [error, setError] = useState("");

  useEffect(() => {
    resultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    let stream;
    let timer;
    let stopped = false;
    (async () => {
      try {
        const detector = new BarcodeDetector({ formats: ["qr_code", "code_128", "code_39", "ean_13"] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stopped) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const tick = async () => {
          if (stopped) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes[0]?.rawValue) return resultRef.current(codes[0].rawValue);
          } catch {
            /* keep trying */
          }
          timer = setTimeout(tick, 250);
        };
        tick();
      } catch {
        setError("Camera not available. Type the code or use a handheld scanner instead.");
      }
    })();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm space-y-3 rounded-2xl bg-surface p-4">
        <p className="text-sm font-semibold text-text">Point the camera at a rack QR code</p>
        {error ? <p className="text-sm text-danger">{error}</p> : <video ref={videoRef} className="aspect-square w-full rounded-xl bg-black object-cover" muted playsInline />}
        <button type="button" onClick={onClose} className={`${ghostBtnCls} w-full`}>Cancel</button>
      </div>
    </div>
  );
}
