import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveRefresh } from "../context/LiveSync";
import { toast } from "react-toastify";
import { useSearchParams } from "react-router-dom";
import Layout from "../components/Layout";
import ProductTile from "../components/ProductTile";
import ProductFormModal from "../components/ProductFormModal";
import ProductDetailPanel from "../components/ProductDetailPanel";
import ImportModal from "../components/ImportModal";
import CategoriesModal from "../components/CategoriesModal";
import FloatingCartBar from "../components/FloatingCartBar";
import CompositionReportModal from "../components/CompositionReportModal";
import { combinedStockLabel } from "../utils/medicine";
import { listProducts, listCategories, getProductFilterOptions } from "../api/products";
import { getErrorMessage } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useCart } from "../context/CartContext";
import { can } from "../utils/permissions";

const GROUP_PREF_KEY = "ghm_group_by_composition";

function readGroupPref() {
  try {
    return localStorage.getItem(GROUP_PREF_KEY) !== "0";
  } catch {
    return true;
  }
}

// Brands sharing a Composition Group, in result order. Products with no
// composition entered stay in a flat "other" list.
function groupByComposition(products) {
  const groups = new Map();
  const other = [];
  for (const p of products) {
    if (!p.compositionKey) {
      other.push(p);
      continue;
    }
    if (!groups.has(p.compositionKey)) groups.set(p.compositionKey, { key: p.compositionKey, label: p.compositionLabel, brands: [] });
    groups.get(p.compositionKey).brands.push(p);
  }
  return { groups: [...groups.values()], other };
}

export default function Products() {
  const { user } = useAuth();
  const { cartCount, addToCart } = useCart();
  const isAdmin = user.role === "admin";
  // Add / edit / delete are admin by default, or granted per user on Roles & Permissions.
  const canAdd = can(user, "products.add");
  const canEdit = can(user, "products.edit");
  const canDelete = can(user, "products.delete");
  const canEditStock = can(user, "stock.edit");
  const canDeleteStock = can(user, "stock.delete");

  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [searchParams] = useSearchParams();
  const urlQuery = searchParams.get("q") || "";
  const [query, setQuery] = useState(urlQuery);
  // Dashboard links can preset these (?category, ?availability) and open a
  // product's detail panel directly (?product=<id>).
  const [category, setCategory] = useState(searchParams.get("category") || "");
  const [availability, setAvailability] = useState(searchParams.get("availability") || "");
  // Extra filters, each shown only when the data supports it.
  const [brand, setBrand] = useState("");
  const [dosageForm, setDosageForm] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [status, setStatus] = useState("");
  const [filterOptions, setFilterOptions] = useState(null);
  const urlProduct = searchParams.get("product");
  const [loading, setLoading] = useState(true);

  const [editingProduct, setEditingProduct] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showCategories, setShowCategories] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState(urlProduct);
  const [showCompositionReport, setShowCompositionReport] = useState(false);
  const [grouped, setGrouped] = useState(readGroupPref);
  const [openGroups, setOpenGroups] = useState({});

  const toggleGrouped = () => {
    const next = !grouped;
    setGrouped(next);
    try {
      localStorage.setItem(GROUP_PREF_KEY, next ? "1" : "0");
    } catch {
      /* per-browser preference only */
    }
  };

  const { groups, other } = useMemo(() => groupByComposition(products), [products]);

  // Barcode scanners type the code then press Enter: an exact barcode match
  // goes straight into the cart as one pack of that exact brand.
  const handleSearchKeyDown = async (e) => {
    if (e.key !== "Enter") return;
    const code = query.trim();
    if (!code) return;
    e.preventDefault();
    const matches = await listProducts({ q: code }).catch(() => []);
    const hit = matches.find((p) => p.barcode && p.barcode === code);
    if (!hit) return;
    if (hit.qty <= 0) {
      toast.error(`${hit.name} is out of stock.`);
      return;
    }
    addToCart(hit, "pack", 1);
    toast.success(`Scanned: added 1 ${hit.packUnit} of ${hit.name}`);
    setQuery("");
  };

  // Current filters as API params (also used by the live refresh below).
  const liveParams = () => {
    const params = {};
    if (query) params.q = query;
    if (category) params.category = category;
    if (availability) params.availability = availability;
    if (brand) params.brand = brand;
    if (dosageForm) params.dosageForm = dosageForm;
    if (minPrice !== "") params.minPrice = minPrice;
    if (maxPrice !== "") params.maxPrice = maxPrice;
    if (status) params.status = status;
    return params;
  };

  // Typed text (search box, price range) is sent once typing pauses, not on
  // every keystroke; only the newest request's answer is ever shown.
  const [typed, setTyped] = useState({ query, minPrice, maxPrice });
  useEffect(() => {
    const t = setTimeout(() => setTyped({ query, minPrice, maxPrice }), 250);
    return () => clearTimeout(t);
  }, [query, minPrice, maxPrice]);
  const requestSeq = useRef(0);

  const load = useCallback(() => {
    setLoading(true);
    const seq = ++requestSeq.current;
    const { query, minPrice, maxPrice } = typed;
    const params = {};
    if (query) params.q = query;
    if (category) params.category = category;
    if (availability) params.availability = availability;
    if (brand) params.brand = brand;
    if (dosageForm) params.dosageForm = dosageForm;
    if (minPrice !== "") params.minPrice = minPrice;
    if (maxPrice !== "") params.maxPrice = maxPrice;
    if (status) params.status = status;
    listProducts(params)
      .then((list) => {
        if (seq === requestSeq.current) setProducts(list);
      })
      .catch((err) => {
        // A 401 is handled centrally (session-expired modal); anything else
        // is shown here instead of leaving the page loading forever.
        if (seq === requestSeq.current && err.response?.status !== 401) toast.error(getErrorMessage(err, "Could not load products."));
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false);
      });
  }, [typed, category, availability, brand, dosageForm, status]);

  useEffect(() => {
    load();
  }, [load]);
  // Products added/edited by anyone (or stock moved) show up without a refresh.
  useLiveRefresh(["products", "categories"], () => {
    const seq = ++requestSeq.current;
    listProducts(liveParams())
      .then((list) => {
        if (seq === requestSeq.current) setProducts(list);
      })
      .catch(() => {});
  });

  useEffect(() => {
    listCategories().then(setCategories).catch(() => {});
    getProductFilterOptions().then(setFilterOptions).catch(() => {});
  }, []);

  const extraActive = [brand, dosageForm, minPrice, maxPrice, status, category, availability].some(Boolean);
  const clearFilters = () => {
    setBrand("");
    setDosageForm("");
    setMinPrice("");
    setMaxPrice("");
    setStatus("");
    setCategory("");
    setAvailability("");
  };

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
    listCategories().then(setCategories).catch(() => {});
  };

  const renderTile = (p) => (
    <ProductTile key={p._id} product={p} canEdit={canEdit} onEdit={setEditingProduct} onOpen={setSelectedProductId} />
  );

  const selectCls =
    "h-11 rounded-xl border border-border bg-surface px-3.5 text-sm text-text shadow-[0_1px_2px_rgba(16,36,48,0.04)] focus:outline-none";

  return (
    <Layout>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold tracking-tight text-text sm:text-[28px]">Products</h1>
        {(isAdmin || canAdd) && (
          <div className="flex flex-wrap gap-2">
            {isAdmin && (
              <button
                onClick={() => setShowCompositionReport(true)}
                className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-primary hover:bg-surface"
              >
                Composition Report
              </button>
            )}
            {isAdmin && (
              <button
                onClick={() => setShowCategories(true)}
                className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-primary hover:bg-surface"
              >
                Categories
              </button>
            )}
            {canAdd && (
              <>
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
              </>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <input
          type="search"
          aria-label="Search products"
          placeholder="Brand, generic, composition, strength, or scan barcode"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          className={`${selectCls} w-full max-w-sm`}
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
        {filterOptions?.brands?.length > 0 && (
          <select aria-label="Brand" value={brand} onChange={(e) => setBrand(e.target.value)} className={selectCls}>
            <option value="">All Brands</option>
            {filterOptions.brands.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        )}
        {filterOptions?.dosageForms?.length > 0 && (
          <select aria-label="Dosage form" value={dosageForm} onChange={(e) => setDosageForm(e.target.value)} className={selectCls}>
            <option value="">All Forms</option>
            {filterOptions.dosageForms.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        )}
        {filterOptions?.price && filterOptions.price.max > filterOptions.price.min && (
          <div className="flex items-center gap-1">
            <input
              type="number"
              min="0"
              aria-label="Minimum price"
              placeholder={`₹${Math.floor(filterOptions.price.min)}`}
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
              className={`${selectCls} w-24`}
            />
            <span className="text-muted">–</span>
            <input
              type="number"
              min="0"
              aria-label="Maximum price"
              placeholder={`₹${Math.ceil(filterOptions.price.max)}`}
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              className={`${selectCls} w-24`}
            />
          </div>
        )}
        {isAdmin && filterOptions?.hasInactive && (
          <select aria-label="Product status" value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls}>
            <option value="">Active products</option>
            <option value="inactive">Deleted products</option>
            <option value="all">All products</option>
          </select>
        )}
        <label className="flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-border bg-surface px-3.5 text-sm text-text">
          <input type="checkbox" checked={grouped} onChange={toggleGrouped} className="accent-primary" />
          Group by composition
        </label>
        {extraActive && (
          <button type="button" onClick={clearFilters} className="h-11 rounded-xl px-3 text-sm font-semibold text-primary hover:bg-surface">
            Clear filters
          </button>
        )}
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
          {(grouped ? [] : products).map(renderTile)}
          {grouped &&
            groups.map((g) => {
              // Searching opens every matching group so all brands show at once.
              const isOpen = openGroups[g.key] ?? (Boolean(query.trim()) || g.brands.length === 1);
              const inStock = g.brands.filter((b) => b.qty > 0).length;
              const rates = g.brands.map((b) => Number(b.packRate));
              const lo = Math.min(...rates);
              const hi = Math.max(...rates);
              return (
                <section key={g.key} className="card col-span-full overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpenGroups((o) => ({ ...o, [g.key]: !isOpen }))}
                    aria-expanded={isOpen}
                    className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left hover:bg-bg"
                  >
                    <span className="min-w-0">
                      <span className="font-display font-semibold text-text">{g.label}</span>
                      <span className="ml-2 text-xs text-muted">
                        {g.brands.length} brand{g.brands.length === 1 ? "" : "s"} · {inStock} in stock · ₹{lo.toFixed(2)}
                        {hi !== lo ? `–₹${hi.toFixed(2)}` : ""}
                      </span>
                    </span>
                    <span className="text-xs text-muted">
                      Combined stock (info only): <span className="font-semibold text-text">{combinedStockLabel(g.brands)}</span>
                      <span className="ml-2">{isOpen ? "▲" : "▼"}</span>
                    </span>
                  </button>
                  {isOpen && (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3 border-t border-border p-3 sm:grid-cols-[repeat(auto-fill,minmax(190px,1fr))]">
                      {g.brands.map(renderTile)}
                    </div>
                  )}
                </section>
              );
            })}
          {grouped && other.length > 0 && groups.length > 0 && (
            <p className="col-span-full mt-2 text-xs font-semibold uppercase tracking-wide text-muted">Other products</p>
          )}
          {grouped && other.map(renderTile)}
        </div>

        {selectedProductId && (
          <ProductDetailPanel
            productId={selectedProductId}
            isAdmin={isAdmin}
            canEdit={canEdit}
            canDelete={canDelete}
            canEditStock={canEditStock}
            canDeleteStock={canDeleteStock}
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
          onChanged={() => listCategories().then(setCategories).catch(() => {})}
        />
      )}

      {showCompositionReport && (
        <CompositionReportModal
          onClose={() => setShowCompositionReport(false)}
          onOpenProduct={(id) => {
            setShowCompositionReport(false);
            setSelectedProductId(id);
          }}
        />
      )}

      {showImport && (
        <ImportModal onClose={() => setShowImport(false)} onImported={load} />
      )}
    </Layout>
  );
}
