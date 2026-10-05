import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Layout from "../components/Layout";
import ProductTile from "../components/ProductTile";
import ProductFormModal from "../components/ProductFormModal";
import ProductDetailPanel from "../components/ProductDetailPanel";
import ImportModal from "../components/ImportModal";
import CategoriesModal from "../components/CategoriesModal";
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
  const [searchParams] = useSearchParams();
  const urlQuery = searchParams.get("q") || "";
  const [query, setQuery] = useState(urlQuery);
  // Dashboard links can preset these (?category, ?availability) and open a
  // product's detail panel directly (?product=<id>).
  const [category, setCategory] = useState(searchParams.get("category") || "");
  const [availability, setAvailability] = useState(searchParams.get("availability") || "");
  const urlProduct = searchParams.get("product");
  const [loading, setLoading] = useState(true);

  const [editingProduct, setEditingProduct] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showCategories, setShowCategories] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState(urlProduct);

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

  // The top-bar search navigates here with ?q=, including while already on this page.
  useEffect(() => {
    setQuery(urlQuery);
  }, [urlQuery]);

  useEffect(() => {
    if (urlProduct) setSelectedProductId(urlProduct);
  }, [urlProduct]);

  const handleSaved = () => {
    setEditingProduct(null);
    setShowAddForm(false);
    load();
    listCategories().then(setCategories);
  };

  const selectCls =
    "h-11 rounded-xl border border-border bg-surface px-3.5 text-sm text-text shadow-[0_1px_2px_rgba(16,36,48,0.04)] focus:outline-none";

  return (
    <Layout>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold tracking-tight text-text sm:text-[28px]">Products</h1>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setShowCategories(true)}
              className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-primary hover:bg-surface"
            >
              Categories
            </button>
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
          className={`stagger grid min-w-0 flex-1 grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(190px,1fr))] ${
            cartCount > 0 ? "pb-20" : ""
          }`}
        >
          {loading &&
            products.length === 0 &&
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="card overflow-hidden">
                <div className="skeleton h-28 rounded-none" />
                <div className="space-y-2 p-3.5">
                  <div className="skeleton h-3.5 w-3/4" />
                  <div className="skeleton h-3 w-1/2" />
                  <div className="skeleton mt-4 h-8 w-full rounded-xl" />
                </div>
              </div>
            ))}
          {!loading && products.length === 0 && (
            <div className="card col-span-full flex flex-col items-center gap-2 py-14 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">💊</span>
              <p className="font-display font-semibold text-text">No records found</p>
              <p className="text-sm text-muted">Try a different search, category or availability filter.</p>
            </div>
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
            onDeleted={() => {
              setSelectedProductId(null);
              load();
            }}
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

      {showCategories && (
        <CategoriesModal
          onClose={() => setShowCategories(false)}
          onChanged={() => listCategories().then(setCategories)}
        />
      )}

      {showImport && (
        <ImportModal onClose={() => setShowImport(false)} onImported={load} />
      )}
    </Layout>
  );
}
