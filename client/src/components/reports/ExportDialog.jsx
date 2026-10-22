import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import Icon from "../Icon";
import { errorMessage } from "../ReportDownloadButtons";
import { fetchReport, saveBlob } from "../../api/reports";

export const SECTIONS = [
  { key: "consolidated", label: "Consolidated Report", hint: "Financial health, balances, expiry, month/year comparisons" },
  { key: "summary", label: "Dashboard Summary", hint: "KPIs, comparison, trend charts" },
  { key: "sales", label: "Revenue and Sales", hint: "Payment modes, categories, bills" },
  { key: "expenses", label: "Expenses", hint: "By category and every entry" },
  { key: "purchases", label: "Purchases", hint: "By supplier and every invoice" },
  { key: "products", label: "Products and Brands", hint: "Product & brand performance, catalog" },
  { key: "inventory", label: "Inventory and Stock", hint: "Valuation, low stock, expiring" },
  { key: "parties", label: "Customers and Suppliers", hint: "Receivables and payables" },
  { key: "gst", label: "GST and Tax Reports", hint: "Output / input GST by slab" },
  { key: "pnl", label: "Profit and Loss", hint: "P&L statement, EBITDA, cash flow" },
  { key: "transactions", label: "Transaction History", hint: "Every money movement" },
];
const ALL = SECTIONS.map((s) => s.key);

// Built-in templates. Period templates also set the date range and chart
// resolution, so the export matches a "daily / weekly / ..." report.
export const TEMPLATES = [
  { key: "consolidated", title: "Consolidated financial report", sections: ["consolidated", "summary", "sales", "expenses", "purchases", "inventory", "parties", "gst", "pnl"] },
  { key: "complete", title: "Complete business report", sections: ALL },
  { key: "daily", title: "Daily report", preset: "Today", granularity: "day", sections: ["summary", "sales", "expenses", "purchases", "pnl", "transactions"] },
  { key: "weekly", title: "Weekly report", preset: "This week", granularity: "day", sections: ["summary", "sales", "expenses", "purchases", "pnl", "gst"] },
  { key: "monthly", title: "Monthly report", preset: "This month", granularity: "week", sections: ["summary", "sales", "expenses", "purchases", "products", "pnl", "gst"] },
  { key: "quarterly", title: "Quarterly report", preset: "This quarter", granularity: "month", sections: ["summary", "sales", "expenses", "purchases", "products", "pnl", "gst", "parties"] },
  { key: "yearly", title: "Yearly report", preset: "This year", granularity: "month", sections: ALL },
  { key: "inventory", title: "Inventory report", sections: ["inventory", "products"] },
  { key: "financial", title: "Financial report", sections: ["summary", "pnl", "gst", "parties", "expenses", "purchases"] },
  { key: "product", title: "Product performance report", sections: ["products", "sales", "inventory"] },
];

// Saved custom templates live in this browser only - a per-user convenience.
const STORAGE_KEY = "ghm.reportTemplates";
function loadSaved() {
  try {
    const list = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(list) ? list.filter((t) => t && t.name && Array.isArray(t.sections)) : [];
  } catch {
    return [];
  }
}
function storeSaved(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Storage blocked (private mode etc.) - the template just isn't remembered.
  }
}

const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function Progress({ progress }) {
  if (!progress) return null;
  const pct = progress.total ? Math.min(100, Math.round((progress.loaded / progress.total) * 100)) : null;
  return (
    <div className="mt-4" role="status" aria-live="polite">
      <div className="flex justify-between text-xs text-muted">
        <span>{progress.loaded ? `Downloading ${progress.label}…` : `Generating ${progress.label}…`}</span>
        <span className="tnum">{progress.loaded ? (pct !== null ? `${pct}%` : kb(progress.loaded)) : ""}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-bg">
        <div
          className={`h-full rounded-full bg-primary transition-all duration-300 ${pct === null ? "w-1/3 animate-pulse" : ""}`}
          style={pct !== null ? { width: `${Math.max(pct, 4)}%` } : undefined}
        />
      </div>
    </div>
  );
}

// Export Report dialog: pick a template (or tick sections), then download
// PDF / Excel or preview the PDF here first. `params` are the page's
// filters; `onApplyPeriod` lets a period template change the page's range.
export default function ExportDialog({ params, periodLabel, onApplyPeriod, onClose }) {
  const [template, setTemplate] = useState("consolidated");
  const [sections, setSections] = useState(TEMPLATES[0].sections);
  const [saved, setSaved] = useState(loadSaved);
  const [progress, setProgress] = useState(null);
  const [preview, setPreview] = useState(null); // { url, blob }
  const busy = Boolean(progress);

  useEffect(() => () => preview && URL.revokeObjectURL(preview.url), [preview]);
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !busy && (preview ? setPreview(null) : onClose());
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, preview, onClose]);

  const pickTemplate = (t) => {
    setTemplate(t.key);
    setSections(t.sections);
    if (t.preset || t.granularity) onApplyPeriod({ preset: t.preset, granularity: t.granularity });
  };
  const pickSaved = (t) => {
    setTemplate("custom");
    setSections(t.sections);
    if (t.granularity) onApplyPeriod({ granularity: t.granularity });
  };
  const toggle = (key) => {
    setTemplate("custom");
    setSections((s) => (s.includes(key) ? s.filter((k) => k !== key) : ALL.filter((k) => s.includes(k) || k === key)));
  };
  const saveTemplate = () => {
    const name = window.prompt("Name this report template:", "My report");
    if (!name?.trim()) return;
    const next = [...saved.filter((t) => t.name !== name.trim()), { name: name.trim(), sections, granularity: params.granularity || "" }];
    setSaved(next);
    storeSaved(next);
    toast.success(`Template “${name.trim()}” saved in this browser.`);
  };
  const removeSaved = (name) => {
    const next = saved.filter((t) => t.name !== name);
    setSaved(next);
    storeSaved(next);
  };

  const title = TEMPLATES.find((t) => t.key === template)?.title || "Custom report";
  const exportParams = { ...params, sections: sections.join(","), template };

  const run = async (format, { asPreview = false } = {}) => {
    if (!sections.length) {
      toast.error("Choose at least one section to include.");
      return;
    }
    const label = format === "pdf" ? "PDF" : "Excel workbook";
    setProgress({ label, loaded: 0, total: 0 });
    try {
      const blob = await fetchReport(exportParams, format, (p) => setProgress({ label, ...p }));
      if (asPreview) {
        setPreview({ url: URL.createObjectURL(blob), blob });
      } else {
        saveBlob(blob, `GHM_${title}`, format);
        toast.success(`${format === "pdf" ? "PDF" : "Excel"} report downloaded.`);
      }
    } catch (err) {
      toast.error((await errorMessage(err)) || `Couldn't create the ${label}. Please try again.`);
    } finally {
      setProgress(null);
    }
  };

  const chip = (active) =>
    `rounded-xl border px-3 py-2 text-left text-sm transition ${active ? "border-primary/50 bg-primary-soft font-semibold text-primary" : "border-border text-text hover:border-primary/30"}`;
  const btn = "inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";

  if (preview) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 sm:p-6" role="dialog" aria-modal="true" aria-label="Report preview">
        <div className="flex h-full w-full max-w-5xl flex-col rounded-2xl bg-surface p-4 shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-lg font-bold text-text">Preview · {title}</h2>
              <p className="text-xs text-muted">{periodLabel}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  saveBlob(preview.blob, `GHM_${title}`, "pdf");
                  toast.success("PDF report downloaded.");
                }}
                className={`${btn} bg-primary text-white hover:bg-primary-dark`}
              >
                <Icon name="download" size={16} />
                Download PDF
              </button>
              <button onClick={() => setPreview(null)} className={`${btn} border border-border text-text hover:bg-bg`}>
                Back
              </button>
            </div>
          </div>
          <iframe title="Report preview" src={preview.url} className="mt-3 w-full flex-1 rounded-xl border border-border bg-bg" />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Export report">
      <div className="max-h-full w-full max-w-3xl overflow-y-auto rounded-2xl bg-surface p-5 shadow-xl sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-bold text-text">Export Report</h2>
            <p className="mt-0.5 text-sm text-muted">
              {periodLabel} · the current filters apply to the export.
            </p>
          </div>
          <button onClick={onClose} disabled={busy} className="rounded-lg p-1.5 text-muted hover:bg-bg hover:text-text" aria-label="Close">
            <Icon name="close" />
          </button>
        </div>

        <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted">Template</p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {TEMPLATES.map((t) => (
            <button key={t.key} onClick={() => pickTemplate(t)} disabled={busy} className={chip(template === t.key)}>
              {t.title}
              {t.preset && <span className="block text-[11px] font-normal text-muted">{t.preset}</span>}
            </button>
          ))}
        </div>

        {saved.length > 0 && (
          <>
            <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted">Your saved templates</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {saved.map((t) => (
                <span key={t.name} className="inline-flex items-center overflow-hidden rounded-xl border border-border">
                  <button onClick={() => pickSaved(t)} disabled={busy} className="px-3 py-1.5 text-sm text-text hover:bg-bg">
                    {t.name}
                  </button>
                  <button onClick={() => removeSaved(t.name)} className="border-l border-border px-2 py-1.5 text-muted hover:bg-bg hover:text-danger" aria-label={`Delete template ${t.name}`}>
                    <Icon name="close" size={13} />
                  </button>
                </span>
              ))}
            </div>
          </>
        )}

        <div className="mt-5 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Sections ({sections.length}/{ALL.length})
          </p>
          <div className="flex gap-1">
            <button onClick={() => { setTemplate("custom"); setSections(ALL); }} className="rounded-lg px-2 py-1 text-xs font-semibold text-primary hover:bg-primary-soft">
              Select all
            </button>
            <button onClick={() => { setTemplate("custom"); setSections([]); }} className="rounded-lg px-2 py-1 text-xs font-semibold text-muted hover:bg-bg">
              Clear
            </button>
            <button onClick={saveTemplate} disabled={!sections.length} className="rounded-lg px-2 py-1 text-xs font-semibold text-primary hover:bg-primary-soft disabled:opacity-40">
              Save as template
            </button>
          </div>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {SECTIONS.map((s) => (
            <label key={s.key} className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 text-sm transition ${sections.includes(s.key) ? "border-primary/40 bg-primary-soft/50" : "border-border hover:border-primary/30"}`}>
              <input type="checkbox" className="mt-0.5" checked={sections.includes(s.key)} disabled={busy} onChange={() => toggle(s.key)} />
              <span>
                <span className="block font-medium text-text">{s.label}</span>
                <span className="block text-xs text-muted">{s.hint}</span>
              </span>
            </label>
          ))}
        </div>

        <Progress progress={progress} />

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button onClick={() => run("pdf", { asPreview: true })} disabled={busy} className={`${btn} border border-border text-text hover:bg-bg`}>
            <Icon name="eye" size={16} />
            Preview PDF
          </button>
          <button onClick={() => run("excel")} disabled={busy} className={`${btn} border border-primary/40 text-primary hover:bg-primary-soft`}>
            <Icon name="download" size={16} />
            Download Excel
          </button>
          <button onClick={() => run("pdf")} disabled={busy} className={`${btn} bg-primary text-white hover:bg-primary-dark`}>
            <Icon name="download" size={16} />
            Download PDF
          </button>
        </div>
        <p className="mt-3 text-[11px] text-muted">
          Excel: one sheet per section with live formulas, totals, filters, highlighting and charts. PDF: summary cards, charts, tables with totals and page numbers.
        </p>
      </div>
    </div>
  );
}
