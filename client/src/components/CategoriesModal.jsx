import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { listCategories, createCategory, deleteCategory } from "../api/products";

export default function CategoriesModal({ onClose, onChanged }) {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState(null);

  const load = () =>
    listCategories().then((data) => {
      setCategories(data);
      setLoading(false);
    });

  useEffect(() => {
    load();
  }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      const created = await createCategory(name.trim());
      toast.success(`Category "${created.name}" added.`);
      setName("");
      await load();
      onChanged?.();
    } catch (err) {
      setError(err.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (c) => {
    if (!window.confirm(`Delete the category "${c.name}"?`)) return;
    setDeletingId(c._id);
    try {
      await deleteCategory(c._id);
      toast.success(`Category "${c.name}" deleted.`);
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl bg-surface p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold text-text">Categories</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-text" aria-label="Close">✕</button>
        </div>

        <form onSubmit={handleAdd} className="mt-4 flex gap-2">
          <input
            type="text"
            maxLength={50}
            placeholder="New category name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
          />
          <button
            type="submit"
            disabled={!name.trim() || saving}
            className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:brightness-95"
          >
            {saving ? "Adding…" : "Add"}
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}

        <div className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto">
          {loading && <p className="text-sm text-muted">Loading…</p>}
          {!loading && categories.length === 0 && <p className="text-sm text-muted">No records found.</p>}
          {categories.map((c) => (
            <div key={c._id} className="flex items-center justify-between gap-2 rounded-lg bg-bg px-3 py-2">
              <span className="truncate text-sm text-text">{c.name}</span>
              <button
                onClick={() => handleDelete(c)}
                disabled={deletingId === c._id}
                className="shrink-0 rounded-lg px-3 py-1 text-sm font-semibold text-danger hover:bg-danger/10 disabled:opacity-50"
              >
                {deletingId === c._id ? "Deleting…" : "Delete"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
