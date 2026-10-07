import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import Layout from "../components/Layout";
import Icon from "../components/Icon";
import ProductFormModal from "../components/ProductFormModal";
import ManageRacksModal from "../components/ManageRacksModal";
import RackInput from "../components/RackInput";
import { StatTile } from "../components/dashboard/DashboardWidgets";
import { listProducts, updateProduct, deactivateProduct } from "../api/products";
import { listRacks } from "../api/racks";
import { useAuth } from "../context/AuthContext";
import { stockDisplay } from "../utils/stock";
import { RACK_LETTERS, POSITION_PATTERN, NO_RACK, positionsOf, rackLetter } from "../utils/rack";
import { can } from "../utils/permissions";

// An older backend without the rack field accepts the save but silently
// drops it - check the echoed product so that never looks like success.
const RACK_NOT_SAVED = "The rack position was not saved. Please try again.";
const MAX_RESULTS = 50;

// Ignores case, spaces and dashes, so "dolo650" finds "Dolo 650" and
// "a001" finds position A-001.
const normalize = (s) => String(s || "").toUpperCase().replace(/[\s-]+/g, "");

// Lower is better; null means no match. Exact serial / name / position hits
// rank first so the one product you meant is always the big card at the top.
function matchScore(product, q) {
  const name = normalize(product.name);
  const code = normalize(product.productCode);
  const rack = normalize(product.rack);
  if (code === q || name === q) return 0;
  if (rack && rack === q) return 1;
  if (rack && rack.startsWith(q)) return 2; // "A" -> everything on Rack A
  if (name.startsWith(q) || code.startsWith(q)) return 2;
  if (name.includes(q) || code.includes(q)) return 3;
  return null;
}

// The RACK tile with its "—" symbol, and the product's rack position shown
// underneath. Admins click the position to move the product.
function RackBadge({ rack, size = "md", onEdit }) {
  const sizes = {
    lg: "h-28 w-28 sm:h-32 sm:w-32 rounded-3xl text-[44px] sm:text-[52px]",
    md: "h-16 w-16 rounded-2xl text-2xl",
  };
  const assigned = Boolean(rack);
  const idText = size === "lg" ? "text-base" : "text-xs";

  return (
    <div className={`flex shrink-0 flex-col items-center gap-1.5 ${size === "lg" ? "w-32 sm:w-36" : "w-[84px]"}`}>
      <div
        className={`flex flex-col items-center justify-center font-display font-extrabold leading-none tracking-tight ${sizes[size]} ${
          assigned
            ? "bg-gradient-to-br from-[#2FC1B0] via-primary to-[#0A5F59] text-white shadow-[0_12px_28px_-12px_rgba(14,124,116,0.9)]"
            : "border-2 border-dashed border-border bg-bg text-muted"
        }`}
      >
        <span className={`font-sans font-semibold uppercase tracking-[0.16em] ${size === "lg" ? "mb-1.5 text-[11px]" : "mb-1 text-[9px]"} ${assigned ? "text-white/75" : ""}`}>
          Rack
        </span>
        <span className="max-w-full truncate px-1">—</span>
      </div>
      <button
        type="button"
        onClick={onEdit}
        disabled={!onEdit}
        title={onEdit ? "Change rack position" : undefined}
        className={`max-w-full truncate rounded-md px-1 font-bold ${idText} ${assigned ? "text-primary" : "text-muted"} ${
          onEdit ? "hover:bg-primary-soft" : "cursor-default"
        }`}
      >
        {assigned ? `Rack ID: ${rack}` : onEdit ? "No Rack · Set" : "No Rack"}
      </button>
    </div>
  );
}

// Either button is left out when its handler is null (no permission).
function RowActions({ product, onEdit, onDelete }) {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {onEdit && (
        <button onClick={() => onEdit(product)} className="rounded-lg p-2 text-muted transition hover:bg-bg hover:text-primary" aria-label={`Edit ${product.name}`} title="Edit">
          <Icon name="edit" size={16} />
        </button>
      )}
      {onDelete && (
        <button
          onClick={() => onDelete(product)}
          className="rounded-lg p-2 text-muted transition hover:bg-danger/10 hover:text-danger"
          aria-label={`Delete ${product.name}`}
          title="Delete"
        >
          <Icon name="trash" size={16} />
        </button>
      )}
    </div>
  );
}

function QtyText({ product }) {
  return <span className={product.qty > 0 ? "text-text" : "text-danger"}>{product.qty > 0 ? stockDisplay(product) : "Out of stock"}</span>;
}

function ProductRow({ product, actions, onEditRack }) {
  return (
    <div className="card flex items-center gap-3 p-3 sm:gap-4">
      <RackBadge rack={product.rack} onEdit={onEditRack} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-display font-semibold text-text">{product.name}</p>
        <p className="mt-0.5 font-mono text-xs text-muted">Serial No: {product.productCode}</p>
        <p className="mt-0.5 text-xs font-medium">
          Qty: <QtyText product={product} />
        </p>
      </div>
      {actions}
    </div>
  );
}

function BestMatch({ product, actions, onEditRack }) {
  return (
    <div className="card fade-up flex flex-col gap-5 border-primary/30 p-5 sm:flex-row sm:items-center sm:p-6">
      <RackBadge rack={product.rack} size="lg" onEdit={onEditRack} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">Best match</p>
        <p className="mt-1 font-display text-2xl font-bold leading-tight tracking-tight text-text sm:text-[28px]">{product.name}</p>
        <p className="mt-2 text-base text-text">
          {product.rack ? (
            <>
              Go to <span className="font-bold text-primary">Rack {rackLetter(product.rack)} → {product.rack}</span>
            </>
          ) : (
            <span className="text-muted">No Rack — not assigned to any rack yet</span>
          )}
        </p>
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <div>
            <dt className="inline text-muted">Serial No: </dt>
            <dd className="inline font-mono font-semibold text-text">{product.productCode}</dd>
          </div>
          <div>
            <dt className="inline text-muted">Quantity: </dt>
            <dd className="inline font-semibold">
              <QtyText product={product} />
            </dd>
          </div>
        </dl>
      </div>
      {actions && <div className="self-end sm:self-center">{actions}</div>}
    </div>
  );
}

function SetRackModal({ product, onClose, onSaved }) {
  const [rack, setRack] = useState(POSITION_PATTERN.test(product.rack || "") ? product.rack : "");
  const [saving, setSaving] = useState(false);

  const save = async (value) => {
    if (saving) return;
    setSaving(true);
    const fd = new FormData();
    fd.append("rack", value);
    try {
      const saved = await updateProduct(product._id, fd);
      if ((saved.rack ?? null) !== value) throw new Error(RACK_NOT_SAVED);
      toast.success(value ? `${product.name} → ${value}` : `Rack position removed for ${product.name}`);
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || "Something went wrong. Please try again.");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (rack) save(rack);
        }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm space-y-4 rounded-2xl bg-surface p-6 shadow-xl"
      >
        <div>
          <h2 className="font-display text-xl font-semibold text-text">Change Rack Position</h2>
          <p className="mt-0.5 text-sm text-muted">{product.name}</p>
        </div>
        <RackInput id="set-rack" value={rack} onChange={setRack} labelClassName="block text-sm font-medium text-text" />
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={saving || !rack}
            className="flex-1 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {product.rack && (
            <button type="button" disabled={saving} onClick={() => save("")} className="rounded-lg px-4 py-2.5 text-sm font-semibold text-danger hover:bg-danger/10">
              Remove
            </button>
          )}
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2.5 text-sm font-semibold text-muted hover:bg-bg">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

// Every position on one rack, in order, with whatever stock sits on each.
function RackPositions({ rack, products, canAdd, canEdit, onAddAt, rowProps }) {
  const byPosition = new Map(positionsOf(rack).map((code) => [code, []]));
  const elsewhere = [];
  for (const p of products) (byPosition.get(p.rack) || elsewhere).push(p);
  const used = [...byPosition.values()].filter((list) => list.length > 0).length;

  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-display text-lg font-bold tracking-tight text-text">Rack {rack.letter}</h2>
        <p className="text-sm text-muted">
          {rack.positions} positions · {used} in use · {products.length} product{products.length === 1 ? "" : "s"}
        </p>
      </div>
      <ul className="mt-3 space-y-2">
        {[...byPosition.entries()].map(([code, list]) => (
          <li key={code} className={`card flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:gap-4 ${list.length === 0 ? "bg-bg/60 shadow-none" : ""}`}>
            <span
              className={`inline-flex w-fit shrink-0 items-center rounded-lg px-2.5 py-1 font-mono text-sm font-bold sm:w-24 sm:justify-center ${
                list.length ? "bg-primary text-white" : "bg-surface text-muted ring-1 ring-border"
              }`}
            >
              {code}
            </span>
            {list.length === 0 ? (
              <div className="flex flex-1 items-center justify-between gap-2">
                <span className="text-sm text-muted">Empty</span>
                {canAdd && (
                  <button onClick={() => onAddAt(code)} className="rounded-lg px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary-soft">
                    + Add product here
                  </button>
                )}
              </div>
            ) : (
              <div className="min-w-0 flex-1 space-y-2">
                {list.map((p) => (
                  <div key={p._id} className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-display font-semibold text-text">{p.name}</p>
                      <p className="text-xs text-muted">
                        <span className="font-mono">Serial No: {p.productCode}</span> · Qty: <QtyText product={p} />
                      </p>
                    </div>
                    {rowProps(p).actions}
                    {canEdit && (
                      <button onClick={rowProps(p).onEditRack} className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-primary hover:bg-primary-soft">
                        Move
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      {elsewhere.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-warning">Needs a valid position on Rack {rack.letter}</p>
          <div className="mt-2 grid gap-2 lg:grid-cols-2">
            {elsewhere.map((p) => (
              <ProductRow key={p._id} product={p} {...rowProps(p)} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function NoRackList({ products, canAdd, onAdd, rowProps }) {
  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="font-display text-lg font-bold tracking-tight text-text">No Rack</h2>
          <p className="text-sm text-muted">
            {products.length} product{products.length === 1 ? "" : "s"} not on any rack
          </p>
        </div>
        {canAdd && (
          <button onClick={onAdd} className="rounded-lg px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary-soft">
            + Add product here
          </button>
        )}
      </div>
      {products.length === 0 ? (
        <p className="card mt-3 px-4 py-5 text-sm text-muted">Every product is on a rack.</p>
      ) : (
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {products.map((p) => (
            <ProductRow key={p._id} product={p} {...rowProps(p)} />
          ))}
        </div>
      )}
    </section>
  );
}

export default function RackFinder() {
  const { user } = useAuth();
  // Managing racks is admin-only unless an Admin granted it on Roles & Permissions.
  const allowed = { add: can(user, "racks.add"), edit: can(user, "racks.edit"), delete: can(user, "racks.delete") };
  const canManageRacks = allowed.add || allowed.edit || allowed.delete;
  const canAdd = can(user, "products.add");
  const canEdit = can(user, "products.edit");
  const canDelete = can(user, "products.delete");
  const searchRef = useRef(null);

  const [products, setProducts] = useState([]);
  const [racks, setRacks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null); // a rack letter, NO_RACK, or null for all racks

  const [addAt, setAddAt] = useState(null); // position code or NO_RACK to pre-fill, "" for none, null = closed
  const [editing, setEditing] = useState(null);
  const [settingRack, setSettingRack] = useState(null);
  const [managing, setManaging] = useState(null); // letter to preselect, "" for none, null = closed

  // Everything is loaded once and filtered in the browser, so results
  // update on every keystroke with no round trip.
  // Each request settles on its own, so one failing (e.g. a backend that
  // predates /racks) never leaves the page stuck on the loading skeleton.
  const load = useCallback(async () => {
    const [productRes, rackRes] = await Promise.allSettled([listProducts(), listRacks()]);
    if (productRes.status === "fulfilled") setProducts(productRes.value);
    if (rackRes.status === "fulfilled") setRacks(rackRes.value);
    setLoadError([productRes, rackRes].some((r) => r.status === "rejected") ? "Could not load rack data. Retrying…" : "");
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // A failed load (e.g. the server restarting during a deploy) retries on its
  // own every few seconds, and the notice clears itself once it succeeds.
  useEffect(() => {
    if (!loadError) return;
    const timer = setTimeout(load, 5000);
    return () => clearTimeout(timer);
  }, [loadError, load]);

  // "/" jumps to the search box from anywhere on the page.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Products on each rack letter, ordered by position then name.
  // Products on each rack letter, ordered by position then name. Anything
  // not on an existing rack falls back to NO_RACK, which always exists.
  const byLetter = useMemo(() => {
    const existing = new Set(racks.map((r) => r.letter));
    const map = new Map([...RACK_LETTERS, NO_RACK].map((l) => [l, []]));
    for (const p of products) {
      const letter = rackLetter(p.rack);
      map.get(existing.has(letter) ? letter : NO_RACK).push(p);
    }
    const order = (a, b) => (a.rack || "").localeCompare(b.rack || "", undefined, { numeric: true }) || a.name.localeCompare(b.name);
    for (const list of map.values()) list.sort(order);
    return map;
  }, [products, racks]);

  const rackByLetter = useMemo(() => new Map(racks.map((r) => [r.letter, r])), [racks]);
  const productCounts = Object.fromEntries(racks.map((r) => [r.letter, byLetter.get(r.letter).length]));
  const totalPositions = racks.reduce((sum, r) => sum + r.positions, 0);
  const positionsInUse = new Set(products.map((p) => p.rack).filter((code) => POSITION_PATTERN.test(code || ""))).size;

  const q = normalize(query);
  const results = useMemo(() => {
    if (!q) return [];
    return products
      .map((p) => ({ p, score: matchScore(p, q) }))
      .filter((r) => r.score !== null)
      .sort((a, b) => a.score - b.score || a.p.name.localeCompare(b.p.name))
      .slice(0, MAX_RESULTS)
      .map((r) => r.p);
  }, [products, q]);

  const handleDelete = async (product) => {
    if (!window.confirm(`Delete "${product.name}"? It will no longer appear in Products or at checkout. Past bills and purchases keep their records.`)) return;
    try {
      await deactivateProduct(product._id);
      toast.success(`${product.name} deleted`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || "Something went wrong. Please try again.");
    }
  };

  const handleSaved = () => {
    setAddAt(null);
    setEditing(null);
    setSettingRack(null);
    load();
  };

  const rowProps = (p) => ({
    actions:
      canEdit || canDelete ? (
        <RowActions product={p} onEdit={canEdit ? setEditing : null} onDelete={canDelete ? handleDelete : null} />
      ) : null,
    onEditRack: canEdit ? () => setSettingRack(p) : undefined,
  });

  const selectedRack = selected && selected !== NO_RACK ? rackByLetter.get(selected) : null;
  const noRackList = byLetter.get(NO_RACK);

  return (
    <Layout>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-text sm:text-[28px]">Rack Finder</h1>
          <p className="mt-0.5 text-sm text-muted">Type a product name, serial number or rack position to find it.</p>
        </div>
        {(canManageRacks || canAdd) && (
          <div className="flex flex-wrap gap-2">
            {canManageRacks && (
              <button
                onClick={() => setManaging("")}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-primary hover:bg-surface"
              >
                <Icon name="rack" size={16} />
                Manage Racks
              </button>
            )}
            {canAdd && (
              <button
                onClick={() => setAddAt("")}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-95"
              >
                <Icon name="plus" size={16} strokeWidth={2} />
                Add Product
              </button>
            )}
          </div>
        )}
      </div>

      <div className="relative mt-5">
        <Icon name="search" size={22} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
        <input
          ref={searchRef}
          autoFocus
          type="search"
          inputMode="search"
          autoComplete="off"
          placeholder="Search name, serial no., rack or position — e.g. Dolo 650 or A-001"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setQuery("")}
          aria-label="Search products"
          className="h-14 w-full rounded-2xl border border-border bg-surface pl-12 pr-12 text-base text-text shadow-[var(--shadow-card)] focus:border-primary focus:outline-none sm:h-16 sm:text-lg"
        />
        {query && (
          <button
            onClick={() => {
              setQuery("");
              searchRef.current?.focus();
            }}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2 text-muted hover:bg-bg hover:text-text"
          >
            <Icon name="close" size={18} />
          </button>
        )}
      </div>

      {!loading && loadError && (
        <div role="status" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/20 bg-warning/10 px-4 py-2.5 text-sm text-warning">
          <span className="flex items-center gap-2">
            <Icon name="clock" size={16} />
            {loadError}
          </span>
          <button onClick={load} className="rounded-lg bg-surface px-3 py-1 text-xs font-semibold text-warning ring-1 ring-warning/20 hover:bg-warning/5">
            Retry now
          </button>
        </div>
      )}

      {loading && (
        <div className="mt-6 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-20 w-full rounded-2xl" />
          ))}
        </div>
      )}

      {/* Search results */}
      {!loading && q && (
        <section className="mt-6" aria-live="polite">
          {results.length === 0 ? (
            <div className="card flex flex-col items-center gap-2 py-14 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
                <Icon name="search" size={22} />
              </span>
              <p className="font-display font-semibold text-text">No product matches "{query}"</p>
              <p className="text-sm text-muted">Check the spelling, or try the serial number or a position like A-001.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <BestMatch key={results[0]._id} product={results[0]} {...rowProps(results[0])} />
              {results.length > 1 && (
                <>
                  <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted">
                    Other matches ({results.length - 1}
                    {results.length === MAX_RESULTS ? "+" : ""})
                  </p>
                  {results.slice(1).map((p) => (
                    <ProductRow key={p._id} product={p} {...rowProps(p)} />
                  ))}
                </>
              )}
            </div>
          )}
        </section>
      )}

      {/* Dashboard, racks A-Z and rack contents (shown when not searching) */}
      {!loading && !q && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatTile label="Total Products" value={products.length} icon="pill" isCount />
            <StatTile label="Total Racks" value={racks.length} icon="rack" tone="blue" isCount note={`out of ${RACK_LETTERS.length} (A–Z)`} />
            <StatTile label="Positions in Use" value={positionsInUse} icon="boxes" tone="violet" isCount note={`out of ${totalPositions} positions`} />
          </div>

          <section className="mt-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-lg font-bold tracking-tight text-text">Racks A–Z</h2>
              <p className="text-xs text-muted">Tap a rack to see its positions</p>
            </div>
            <div className="mt-3 grid grid-cols-6 gap-2 sm:grid-cols-9 lg:grid-cols-[repeat(13,minmax(0,1fr))]">
              {RACK_LETTERS.map((l) => {
                const rack = rackByLetter.get(l);
                const count = byLetter.get(l).length;
                const active = selected === l;
                if (!rack) {
                  return (
                    <button
                      key={l}
                      onClick={allowed.add ? () => setManaging(l) : undefined}
                      disabled={!allowed.add}
                      title={allowed.add ? `Add Rack ${l}` : `Rack ${l} has not been set up`}
                      aria-label={allowed.add ? `Add Rack ${l}` : `Rack ${l}, not set up`}
                      className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-2 text-muted/60 transition enabled:hover:border-primary/50 enabled:hover:text-primary"
                    >
                      <span className="font-display text-xl font-extrabold leading-none">{l}</span>
                      <span className="mt-1 text-[11px] font-semibold">{allowed.add ? "+ Add" : "—"}</span>
                    </button>
                  );
                }
                return (
                  <button
                    key={l}
                    onClick={() => setSelected(active ? null : l)}
                    aria-pressed={active}
                    aria-label={`Rack ${l}, ${count} product${count === 1 ? "" : "s"}`}
                    className={`flex flex-col items-center justify-center rounded-xl py-2 ring-1 transition ${
                      active
                        ? "bg-primary text-white shadow-[0_8px_20px_-10px_rgba(14,124,116,0.9)] ring-2 ring-primary ring-offset-2 ring-offset-bg"
                        : "bg-surface text-text ring-border hover:ring-primary/50"
                    }`}
                  >
                    <span className="font-display text-xl font-extrabold leading-none">{l}</span>
                    <span className={`mt-1 text-[11px] font-semibold tnum ${active ? "text-white/80" : count > 0 ? "text-primary" : "text-muted"}`}>{count}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                onClick={() => setSelected(selected === NO_RACK ? null : NO_RACK)}
                aria-pressed={selected === NO_RACK}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold ring-1 transition ${
                  selected === NO_RACK
                    ? "bg-primary text-white ring-2 ring-primary ring-offset-2 ring-offset-bg"
                    : "bg-surface text-text ring-border hover:ring-primary/40"
                }`}
              >
                No Rack
                <span className={`rounded-lg px-2 py-0.5 text-xs tnum ${selected === NO_RACK ? "bg-white/20" : "bg-bg text-muted"}`}>{noRackList.length}</span>
              </button>
              {selected && (
                <button
                  onClick={() => setSelected(null)}
                  className="rounded-xl bg-surface px-4 py-2 text-sm font-semibold text-text ring-1 ring-border hover:ring-primary/40"
                >
                  Show all racks
                </button>
              )}
            </div>
          </section>

          {racks.length === 0 && !loadError && !selected && (
            <div className="card mt-6 flex flex-col items-center gap-2 py-14 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
                <Icon name="rack" size={22} />
              </span>
              <p className="font-display font-semibold text-text">No racks set up yet</p>
              <p className="text-sm text-muted">
                {allowed.add
                  ? "Add your racks (A to Z) and their positions. Until then, stock can be saved under No Rack."
                  : "Stock is kept under No Rack until racks are set up."}
              </p>
              {allowed.add && (
                <button onClick={() => setManaging("")} className="mt-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark">
                  Add Rack
                </button>
              )}
            </div>
          )}

          {selected === NO_RACK ? (
            <NoRackList products={noRackList} canAdd={canAdd} onAdd={() => setAddAt(NO_RACK)} rowProps={rowProps} />
          ) : selectedRack ? (
            <RackPositions rack={selectedRack} products={byLetter.get(selected)} canAdd={canAdd} canEdit={canEdit} onAddAt={setAddAt} rowProps={rowProps} />
          ) : (
            <section className="mt-6 space-y-6">
              {racks.map((rack) => {
                const list = byLetter.get(rack.letter);
                return (
                  <div key={rack.letter}>
                    <button onClick={() => setSelected(rack.letter)} className="group flex items-center gap-2 font-display text-base font-bold text-text">
                      <span className="rounded-lg bg-primary px-2.5 py-0.5 text-white">Rack {rack.letter}</span>
                      <span className="text-sm font-medium text-muted">
                        {list.length} product{list.length === 1 ? "" : "s"} · {rack.positions} positions
                      </span>
                      <Icon name="arrowRight" size={14} className="text-muted transition group-hover:translate-x-0.5 group-hover:text-primary" />
                    </button>
                    {list.length === 0 ? (
                      <p className="card mt-2 px-4 py-5 text-sm text-muted">Rack {rack.letter} is empty.</p>
                    ) : (
                      <div className="mt-2 grid gap-2 lg:grid-cols-2">
                        {list.map((p) => (
                          <ProductRow key={p._id} product={p} {...rowProps(p)} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {noRackList.length > 0 && (
                <div>
                  <button onClick={() => setSelected(NO_RACK)} className="group flex items-center gap-2 font-display text-base font-bold text-text">
                    <span className="rounded-lg bg-bg px-2.5 py-0.5 text-text ring-1 ring-border">No Rack</span>
                    <span className="text-sm font-medium text-muted">
                      {noRackList.length} product{noRackList.length === 1 ? "" : "s"}
                    </span>
                    <Icon name="arrowRight" size={14} className="text-muted transition group-hover:translate-x-0.5 group-hover:text-primary" />
                  </button>
                  <div className="mt-2 grid gap-2 lg:grid-cols-2">
                    {noRackList.map((p) => (
                      <ProductRow key={p._id} product={p} {...rowProps(p)} />
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}
        </>
      )}

      {(addAt !== null || editing) && (
        <ProductFormModal
          product={editing}
          defaultRack={addAt || ""}
          onClose={() => {
            setAddAt(null);
            setEditing(null);
          }}
          onSaved={handleSaved}
        />
      )}

      {settingRack && <SetRackModal product={settingRack} onClose={() => setSettingRack(null)} onSaved={handleSaved} />}

      {managing !== null && (
        <ManageRacksModal racks={racks} productCounts={productCounts} initialLetter={managing} allowed={allowed} onClose={() => setManaging(null)} onChanged={load} />
      )}
    </Layout>
  );
}
