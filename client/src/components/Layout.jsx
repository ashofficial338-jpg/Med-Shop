import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import AvatarMenu from "./AvatarMenu";
import Icon from "./Icon";
import NotificationsMenu from "./NotificationsMenu";
import { useAuth } from "../context/AuthContext";
import { useCart } from "../context/CartContext";

export const STORE_NAME = "GHM Medical Shop";

// "Orders" is the live order being built (the cart/checkout); completed orders
// are bills, which live under Sales. "Reports" is the Day Book.
const ADMIN_NAV = [
  {
    section: "Overview",
    items: [{ to: "/dashboard", label: "Dashboard", icon: "dashboard" }],
  },
  {
    section: "Pharmacy",
    items: [
      { to: "/products", label: "Products", icon: "pill" },
      { to: "/stock", label: "Inventory", icon: "boxes" },
      { to: "/bills", label: "Sales", icon: "receipt" },
      { to: "/purchases", label: "Purchases", icon: "truck" },
      { to: "/checkout", label: "Orders", icon: "cart", badge: "cart" },
    ],
  },
  {
    section: "People",
    items: [
      { to: "/customers", label: "Customers", icon: "users" },
      { to: "/vendors", label: "Suppliers", icon: "building" },
    ],
  },
  {
    section: "Finance",
    items: [
      { to: "/day-book", label: "Reports", icon: "chart" },
      { to: "/expenses", label: "Expenses", icon: "wallet" },
    ],
  },
  {
    section: "System",
    items: [
      { action: "notifications", label: "Notifications", icon: "bell", badge: "alerts" },
      { to: "/users", label: "Users", icon: "user" },
      { to: "/profile", label: "Settings", icon: "settings" },
    ],
  },
];

const STAFF_NAV = [
  {
    section: "Pharmacy",
    items: [
      { to: "/products", label: "Products", icon: "pill" },
      { to: "/checkout", label: "Orders", icon: "cart", badge: "cart" },
      { to: "/bills", label: "My Bills", icon: "receipt" },
    ],
  },
  {
    section: "System",
    items: [
      { action: "notifications", label: "Notifications", icon: "bell", badge: "alerts" },
      { to: "/profile", label: "Settings", icon: "settings" },
    ],
  },
];

function Badge({ children, tone = "primary" }) {
  const cls = tone === "danger" ? "bg-danger/10 text-danger" : "bg-primary-soft text-primary";
  return <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold tnum ${cls}`}>{children}</span>;
}

function Sidebar({ nav, onNavigate, onOpenNotifications, badges }) {
  const itemCls = (active) =>
    `group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
      active ? "bg-primary-soft text-primary" : "text-muted hover:bg-bg hover:text-text"
    }`;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 pb-5 pt-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-[#1B9C8F] text-white shadow-sm">
          <Icon name="cross" size={18} strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <p className="font-display text-[15px] font-bold leading-tight text-text">GHM Pharmacy</p>
          <p className="text-xs text-muted">Management Suite</p>
        </div>
      </div>

      <nav className="thin-scroll flex-1 space-y-5 overflow-y-auto px-3 pb-4" aria-label="Main">
        {nav.map((group) => (
          <div key={group.section}>
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted/70">
              {group.section}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const badge = item.badge ? badges[item.badge] : null;
                const content = (active) => (
                  <>
                    <span className={active ? "text-primary" : "text-muted/80 group-hover:text-text"}>
                      <Icon name={item.icon} />
                    </span>
                    {item.label}
                    {badge ? <Badge tone={item.badge === "alerts" ? "danger" : "primary"}>{badge}</Badge> : null}
                  </>
                );
                if (item.action === "notifications") {
                  return (
                    <button key={item.label} onClick={onOpenNotifications} className={itemCls(false)}>
                      {content(false)}
                    </button>
                  );
                }
                return (
                  <NavLink key={item.to} to={item.to} onClick={onNavigate} className={({ isActive }) => itemCls(isActive)}>
                    {({ isActive }) => content(isActive)}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="m-3 rounded-2xl border border-border bg-gradient-to-br from-primary-soft to-info-soft p-4">
        <div className="flex items-center gap-2 text-primary">
          <Icon name="pill" size={16} />
          <p className="text-xs font-semibold">Dispense with care</p>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Batches are sold first-expiry-first-out automatically at checkout.
        </p>
      </div>
    </div>
  );
}

function SearchBox() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");

  useEffect(() => {
    function onKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        document.getElementById("global-search")?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = (e) => {
    e.preventDefault();
    const term = q.trim();
    navigate(term ? `/products?q=${encodeURIComponent(term)}` : "/products");
  };

  return (
    <form onSubmit={submit} role="search" className="relative hidden w-full max-w-md md:block">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
        <Icon name="search" size={17} />
      </span>
      <input
        id="global-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search medicines by name or code…"
        className="h-10 w-full rounded-xl border border-border bg-bg pl-10 pr-16 text-sm text-text placeholder:text-muted/70 transition focus:border-primary/50 focus:bg-surface focus:outline-none focus:ring-4 focus:ring-primary/10"
      />
      <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-border bg-surface px-1.5 py-0.5 text-[10px] font-medium text-muted">
        Ctrl K
      </kbd>
    </form>
  );
}

// `toolbar` lets a page put its own controls (e.g. the dashboard date filter)
// into the top bar.
export default function Layout({ children, toolbar }) {
  const { user } = useAuth();
  const { cartCount } = useCart();
  const location = useLocation();
  const nav = user.role === "admin" ? ADMIN_NAV : STAFF_NAV;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [alertCount, setAlertCount] = useState(0);

  useEffect(() => setDrawerOpen(false), [location.pathname]);

  const badges = { cart: cartCount || null, alerts: alertCount || null };
  const openNotifications = () => {
    setDrawerOpen(false);
    setNotifOpen(true);
  };

  return (
    <div className="min-h-screen bg-bg">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-border bg-surface lg:block">
        <Sidebar nav={nav} badges={badges} onOpenNotifications={openNotifications} />
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-text/30 backdrop-blur-[2px]" onClick={() => setDrawerOpen(false)} />
          <aside className="fade-up absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-surface shadow-xl">
            <button
              onClick={() => setDrawerOpen(false)}
              aria-label="Close menu"
              className="absolute right-3 top-5 rounded-lg p-1.5 text-muted hover:bg-bg"
            >
              <Icon name="close" />
            </button>
            <Sidebar
              nav={nav}
              badges={badges}
              onNavigate={() => setDrawerOpen(false)}
              onOpenNotifications={openNotifications}
            />
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-border bg-surface/85 backdrop-blur-md">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
            <button
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              className="-ml-1 rounded-lg p-2 text-muted hover:bg-bg lg:hidden"
            >
              <Icon name="menu" />
            </button>

            <div className="hidden min-w-0 items-center gap-2.5 xl:flex">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/50" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </span>
              <div className="leading-tight">
                <p className="whitespace-nowrap text-sm font-semibold text-text">{STORE_NAME}</p>
                <p className="text-[11px] text-muted">Main counter · Open</p>
              </div>
              <span className="mx-3 h-8 w-px bg-border" />
            </div>

            <SearchBox />

            <div className="ml-auto flex items-center gap-2 sm:gap-3">
              {toolbar}
              <NotificationsMenu
                open={notifOpen}
                onOpenChange={setNotifOpen}
                onCountChange={setAlertCount}
                isAdmin={user.role === "admin"}
              />
              <AvatarMenu />
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
