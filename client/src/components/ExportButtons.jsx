import { useState } from "react";

// Small "PDF" / "Excel" button pair reused across every report page - each
// caller just provides onExport(format), which calls the matching export*()
// function from that resource's api/*.js file.
export default function ExportButtons({ onExport }) {
  const [exporting, setExporting] = useState("");

  const handle = async (format) => {
    setExporting(format);
    try {
      await onExport(format);
    } finally {
      setExporting("");
    }
  };

  const btnCls =
    "rounded-lg border border-border px-3 py-2 text-sm font-semibold text-primary hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="flex gap-2">
      <button onClick={() => handle("pdf")} disabled={Boolean(exporting)} className={btnCls}>
        {exporting === "pdf" ? "Exporting…" : "PDF"}
      </button>
      <button onClick={() => handle("excel")} disabled={Boolean(exporting)} className={btnCls}>
        {exporting === "excel" ? "Exporting…" : "Excel"}
      </button>
    </div>
  );
}
