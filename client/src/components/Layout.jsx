import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import AvatarMenu from "./AvatarMenu";
import Icon from "./Icon";
import NotificationsMenu from "./NotificationsMenu";
import { useAuth } from "../context/AuthContext";
import { useCart } from "../context/CartContext";
import { can } from "../utils/permissions";

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
      { to: "/racks", label: "Rack Finder", icon: "rack" },
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
      { to: "/reports/profitability", label: "Profitability", icon: "trendUp" },
      { to: "/expenses", label: "Expenses", icon: "wallet" },
    ],
  },
  {
    section: "System",
    items: [
      { action: "notifications", label: "Notifications", icon: "bell", badge: "alerts" },
      { to: "/users", label: "Users", icon: "user" },
      { to: "/roles", label: "Roles & Permissions", icon: "check" },
      { to: "/profile", label: "Settings", icon: "settings" },
    ],
  },
];

const STAFF_NAV = [
  {
    section: "Overview",
    // Only shown when an Admin has granted the view-only dashboard.
    items: [{ to: "/dashboard", label: "Dashboard", icon: "dashboard", permission: "dashboard.view" }],
  },
  {
    section: "Pharmacy",
    items: [
      { to: "/products", label: "Products", icon: "pill" },
      { to: "/racks", label: "Rack Finder", icon: "rack" },
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
  const cls =
    tone === "danger"
      ? "bg-gradient-to-br from-[#E2574F] to-danger text-white shadow-[0_4px_12px_-4px_rgba(196,61,54,0.8)]"
      : "bg-gradient-to-br from-[#2FC1B0] to-primary text-white shadow-[0_4px_12px_-4px_rgba(47,193,176,0.8)]";
  return <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold tnum ${cls}`}>{children}</span>;
}

function Sidebar({ nav, onNavigate, onOpenNotifications, badges }) {
  const itemCls = (active) =>
    `group relative flex w-full items-center gap-3 rounded-xl px-3 py-[7px] text-sm font-medium transition-all duration-300 ${
      active ? "nav-active text-white" : "text-white/60 hover:translate-x-0.5 hover:bg-white/[0.06] hover:text-white"
    }`;

  return (
    <div className="sidebar-surface relative flex h-full flex-col overflow-hidden">
      {/* Fine grid texture, faded toward the bottom. */}
      <div className="login-grid pointer-events-none absolute inset-0 opacity-[0.035]" />

      <div className="relative flex items-center gap-3 px-5 pb-6 pt-6">
        <div className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#2FC1B0] via-primary to-[#0A5F59] text-white shadow-[0_8px_24px_-8px_rgba(47,193,176,0.9)] ring-1 ring-white/20">
          <Icon name="cross" size={19} strokeWidth={2} />
          <span className="absolute inset-0 rounded-2xl bg-gradient-to-b from-white/25 to-transparent" />
        </div>
        <div className="min-w-0">
          <p className="font-display text-[15px] font-bold leading-tight tracking-tight text-white">GHM Pharmacy</p>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#7FE6D6]/70">Management Suite</p>
        </div>
      </div>

      <nav className="dark-scroll relative flex-1 space-y-5 overflow-y-auto px-3 pb-4" aria-label="Main">
        {nav.map((group) => (
          <div key={group.section}>
            <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/30">
              {group.section}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const badge = item.badge ? badges[item.badge] : null;
                const content = (active) => (
                  <>
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-lg transition-all duration-300 ${
                        active
                          ? "bg-gradient-to-br from-[#2FC1B0] to-primary text-white shadow-[0_6px_16px_-6px_rgba(47,193,176,0.9)]"
                          : "text-white/50 group-hover:bg-white/[0.06] group-hover:text-[#7FE6D6]"
                      }`}
                    >
                      <Icon name={item.icon} size={17} />
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

      <div className="relative m-3 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
        <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-[#2FC1B0]/20 blur-2xl" />
        <div className="relative flex items-center gap-2 text-[#7FE6D6]">
          <Icon name="pill" size={16} />
          <p className="text-xs font-semibold">Dispense with care</p>
        </div>
        <p className="relative mt-1 text-xs leading-relaxed text-white/55">
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
    <form onSubmit={submit} role="search" className="group relative hidden w-full max-w-md md:block">
      <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted transition-colors group-focus-within:text-primary">
        <Icon name="search" size={17} />
      </span>
      <input
        id="global-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search medicines by name or code…"
        className="h-11 w-full rounded-2xl border border-border bg-white/70 pl-11 pr-16 text-sm text-text shadow-[inset_0_1px_2px_rgba(16,36,48,0.04)] placeholder:text-muted/70 focus:bg-surface focus:outline-none"
      />
      <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-lg border border-border bg-surface px-1.5 py-0.5 font-sans text-[10px] font-semibold text-muted shadow-[0_1px_0_rgba(16,36,48,0.08)]">
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
  const nav = (user.role === "admin" ? ADMIN_NAV : STAFF_NAV)
    .map((group) => ({ ...group, items: group.items.filter((item) => !item.permission || can(user, item.permission)) }))
    .filter((group) => group.items.length > 0);
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
    <div className="min-h-screen">
      <div key={location.pathname} className="route-progress" aria-hidden="true" />

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 shadow-[8px_0_40px_-20px_rgba(7,26,34,0.5)] lg:block">
        <Sidebar nav={nav} badges={badges} onOpenNotifications={openNotifications} />
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="fade-in absolute inset-0 bg-[#07181E]/45 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
          <aside className="slide-in-left absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-xl">
            <button
              onClick={() => setDrawerOpen(false)}
              aria-label="Close menu"
              className="absolute right-3 top-6 z-10 rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white"
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
        <header className="glass sticky top-0 z-20 border-b border-white/60 shadow-[0_1px_0_rgba(16,36,48,0.06),0_8px_24px_-18px_rgba(16,36,48,0.25)]">
          <div className="flex h-[68px] items-center gap-3 px-4 sm:px-6 lg:px-8">
            <button
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              className="-ml-1 rounded-xl p-2 text-muted hover:bg-bg hover:text-primary lg:hidden"
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
                <p className="text-[11px] font-medium text-success">Main counter · Open</p>
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

        <main key={location.pathname} className="page-enter mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
