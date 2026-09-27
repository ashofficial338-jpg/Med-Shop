import { useState } from "react";
import { downloadImportTemplate, importProducts } from "../api/products";

export default function ImportModal({ onClose, onImported }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState("");

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const data = await importProducts(file);
      setResults(data.results);
      onImported();
    } catch (err) {
      setError(err.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold text-text">Import Products</h2>
          <button onClick={onClose} className="text-muted hover:text-text" aria-label="Close">✕</button>
        </div>

        <button
          onClick={downloadImportTemplate}
          className="mt-4 text-sm font-semibold text-primary hover:underline"
        >
          Download Excel Template
        </button>

        <div className="mt-4">
          <input
            type="file"
            accept=".xlsx"
            onChange={(e) => setFile(e.target.files[0] || null)}
            className="block w-full text-sm text-text file:mr-3 file:rounded-lg file:border-0 file:bg-bg file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-primary"
          />
        </div>

        {error && <p className="mt-2 text-sm text-danger">{error}</p>}

        <button
          onClick={handleUpload}
          disabled={!file || uploading}
          className="mt-4 w-full rounded-lg bg-primary py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-primary-dark"
        >
          {uploading ? "Uploading…" : "Upload"}
        </button>

        {results && (
          <div className="mt-4 max-h-64 space-y-1 overflow-y-auto rounded-lg border border-border p-3">
            {results.map((r) => (
              <p key={r.row} className={`text-xs ${r.status === "success" ? "text-success" : "text-danger"}`}>
                Row {r.row} ({r.name}): {r.message}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
