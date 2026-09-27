import { useState } from "react";
import { toast } from "react-toastify";

const LABELS = { excel: "Excel", pdf: "PDF" };

// Export requests use responseType "blob", so an error response body arrives
// as a Blob too and has to be read back as JSON to get the server's message.
async function errorMessage(err) {
  const data = err.response?.data;
  if (data instanceof Blob) {
    try {
      return JSON.parse(await data.text()).message;
    } catch {
      return null;
    }
  }
  return data?.message;
}

// "Download Excel" / "Download PDF" pair for report pages. Each caller
// provides onExport(format), which calls the matching export*() function
// from that resource's api/*.js file with the page's current filters.
export default function ReportDownloadButtons({ onExport }) {
  const [exporting, setExporting] = useState("");

  const handle = async (format) => {
    setExporting(format);
    try {
      await onExport(format);
      toast.success(`${LABELS[format]} download started.`);
    } catch (err) {
      toast.error((await errorMessage(err)) || `Couldn't download the ${LABELS[format]} file. Please try again.`);
    } finally {
      setExporting("");
    }
  };

  const btnCls =
    "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-primary hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="flex flex-wrap gap-2">
      {["excel", "pdf"].map((format) => (
        <button key={format} onClick={() => handle(format)} disabled={Boolean(exporting)} className={btnCls}>
          <span aria-hidden="true">⬇</span>
          {exporting === format ? "Preparing…" : `Download ${LABELS[format]}`}
        </button>
      ))}
    </div>
  );
}
