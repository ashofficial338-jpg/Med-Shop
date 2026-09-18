import { useCallback, useEffect, useState } from "react";
import Layout from "../components/Layout";
import ProductTile from "../components/ProductTile";
import ProductFormModal from "../components/ProductFormModal";
import ProductDetailPanel from "../components/ProductDetailPanel";
import ImportModal from "../components/ImportModal";
import FloatingCartBar from "../components/FloatingCartBar";
import { listProducts, listCategories } from "../api/products";
import { useAuth } from "../context/AuthContext";
import { useCart } from "../context/CartContext";

export default function Products() {
  const { user } = useAuth();
  const { cartCount } = useCart();
  const isAdmin = user.role === "admin";

  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [availability, setAvailability] = useState("");
  const [loading, setLoading] = useState(true);

  const [editingProduct, setEditingProduct] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    const params = {};
    if (query) params.q = query;
    if (category) params.category = category;
    if (availability) params.availability = availability;
    listProducts(params).then((data) => {
      setProducts(data);
      setLoading(false);
    });
  }, [query, category, availability]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    listCategories().then(setCategories);
  }, []);

  const handleSaved = () => {
    setEditingProduct(null);
    setShowAddForm(false);
    load();
    listCategories().then(setCategories);
  };

  const selectCls =
    "rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none";

  return (
    <Layout>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-text">Products</h1>
        {isAdmin && (
          <div className="flex gap-2">
            <button
              onClick={() => setShowImport(true)}
              className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-primary hover:bg-surface"
            >
              Import Excel
            </button>
            <button
              onClick={() => setShowAddForm(true)}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-95"
            >
              Add Product
            </button>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Search by name or code (e.g. dolo or DOL100)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={`${selectCls} w-full max-w-xs`}
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={selectCls}>
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c._id} value={c._id}>{c.name}</option>
          ))}
        </select>
        <select value={availability} onChange={(e) => setAvailability(e.target.value)} className={selectCls}>
          <option value="">All Availability</option>
          <option value="available">Available</option>
          <option value="low">Low Stock</option>
          <option value="out">Out of Stock</option>
        </select>
      </div>

      <div className="mt-6 flex items-start gap-4">
        <div
          className={`grid min-w-0 flex-1 grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(190px,1fr))] ${
            cartCount > 0 ? "pb-20" : ""
          }`}
        >
          {loading && <p className="col-span-full text-sm text-muted">Loading…</p>}
          {!loading && products.length === 0 && (
            <p className="col-span-full text-sm text-muted">No records found.</p>
          )}
          {products.map((p) => (
            <ProductTile
              key={p._id}
              product={p}
              isAdmin={isAdmin}
              onEdit={setEditingProduct}
              onOpen={setSelectedProductId}
            />
          ))}
        </div>

        {selectedProductId && (
          <ProductDetailPanel
            productId={selectedProductId}
            isAdmin={isAdmin}
            onClose={() => setSelectedProductId(null)}
            onChanged={load}
          />
        )}
      </div>

      <FloatingCartBar />

      {(showAddForm || editingProduct) && (
        <ProductFormModal
          product={editingProduct}
          onClose={() => {
            setShowAddForm(false);
            setEditingProduct(null);
          }}
          onSaved={handleSaved}
        />
      )}

      {showImport && (
        <ImportModal onClose={() => setShowImport(false)} onImported={load} />
      )}
    </Layout>
  );
}
