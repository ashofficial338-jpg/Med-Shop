import { useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";
import Icon from "./Icon";
import { saveBlobAs } from "../utils/downloadFile";
import { errorMessage } from "./ReportDownloadButtons";

// Preview of a purchase document (PO / Purchase Invoice / Purchase Return).
// The preview IS the PDF the server makes, so Print and Download give exactly
// what is on screen. Phones that can't show a PDF inline get "Open".
export default function DocumentViewer({ title, filename, load, onClose }) {
  const [url, setUrl] = useState("");
  const [blob, setBlob] = useState(null);
  const [error, setError] = useState("");
  const frame = useRef(null);

  useEffect(() => {
    let made = "";
    let cancelled = false;
    load()
      .then((b) => {
        if (cancelled) return;
        const pdf = b.type === "application/pdf" ? b : new Blob([b], { type: "application/pdf" });
        made = URL.createObjectURL(pdf);
        setBlob(pdf);
        setUrl(made);
      })
      .catch(async (err) => !cancelled && setError((await errorMessage(err)) || "Could not load the document."));
    return () => {
      cancelled = true;
      if (made) setTimeout(() => URL.revokeObjectURL(made), 60_000);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const print = () => {
    try {
      frame.current.contentWindow.focus();
      frame.current.contentWindow.print();
    } catch {
      window.open(url, "_blank");
      toast.info("Use your browser's Print in the new tab.");
    }
  };

  const btn = "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50";
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/50 p-2 sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <div className="mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-surface shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="font-display text-lg font-semibold text-text">{title}</h2>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={print} disabled={!url} className={`${btn} bg-primary text-white hover:bg-primary-dark`}>
              <Icon name="receipt" size={16} /> Print
            </button>
            <button type="button" onClick={() => saveBlobAs(blob, filename)} disabled={!blob} className={`${btn} border border-border text-primary hover:bg-bg`}>
              <Icon name="download" size={16} /> Download PDF
            </button>
            <a href={url || undefined} target="_blank" rel="noreferrer" className={`${btn} border border-border text-text hover:bg-bg sm:hidden ${url ? "" : "pointer-events-none opacity-50"}`}>
              Open
            </a>
            <button type="button" onClick={onClose} className={`${btn} text-muted hover:bg-bg`} aria-label="Close">
              ✕
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 bg-bg">
          {error && <p className="p-6 text-sm text-danger">{error}</p>}
          {!error && !url && <p className="p-6 text-sm text-muted">Preparing the document…</p>}
          {url && <iframe ref={frame} src={url} title={title} className="h-full w-full border-0" />}
        </div>
      </div>
    </div>
  );
}
