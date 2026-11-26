import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import AvatarMenu from "./AvatarMenu";
import Icon from "./Icon";
import NotificationsMenu from "./NotificationsMenu";
import { useAuth } from "../context/AuthContext";
import { useCart } from "../context/CartContext";
import { can } from "../utils/permissions";
import BrandLogo, { BrandMark } from "./BrandLogo";
import { BRAND } from "../config/brand";

export const STORE_NAME = BRAND.name;

// The two daily entries - New Bill (sales) and New Purchase - are the buttons
// at the top of the menu. Everything below them is kept up to date by those
// two; pages needed only now and then are folded under "More".
const ADMIN_NAV = [
  {
    section: "Overview",
    items: [{ to: "/dashboard", label: "Dashboard", icon: "dashboard" }],
  },
  {
    section: "Records",
    items: [
      { to: "/bills", label: "Bills (Sales)", icon: "receipt" },
      { to: "/purchase-orders", label: "Purchase Orders", icon: "clipboard" },
      { to: "/purchases", label: "Purchase Invoices", icon: "truck" },
      { to: "/purchase-returns", label: "Purchase Returns", icon: "arrowRight" },
      { to: "/products", label: "Products", icon: "pill" },
      { to: "/stock", label: "Stock", icon: "boxes" },
    ],
  },
  {
    section: "Accounts",
    items: [
      { to: "/customers", label: "Customers", icon: "users" },
      { to: "/vendors", label: "Vendors", icon: "building" },
      { to: "/expenses", label: "Expenses", icon: "wallet" },
      { to: "/day-book", label: "Day Book", icon: "book" },
    ],
  },
  {
    section: "Reports",
    items: [
      { to: "/reports/management", label: "Management Reports", icon: "clipboard" },
      { to: "/reports", label: "Reports & Analytics", icon: "chart", end: true },
      { to: "/reports/profitability", label: "Profitability", icon: "trendUp" },
    ],
  },
  {
    section: "More",
    folds: true,
    items: [
      { to: "/racks", label: "Rack Finder", icon: "rack" },
      { to: "/rack-center", label: "Rack Center", icon: "boxes" },
      { action: "notifications", label: "Notifications", icon: "bell", badge: "alerts" },
      { to: "/users", label: "Users", icon: "user" },
      { to: "/roles", label: "Roles & Permissions", icon: "check" },
      { to: "/clear-records", label: "Clear Records", icon: "trash" },
      { to: "/profile", label: "Settings", icon: "settings" },
    ],
  },
];

const STAFF_NAV = [
  {
    section: "Overview",
    // Only shown when an Admin has granted the view-only dashboard.
    items: [
      { to: "/dashboard", label: "Dashboard", icon: "dashboard", permission: "dashboard.view" },
      { to: "/reports/management", label: "Management Reports", icon: "clipboard", permission: "reports.view" },
      { to: "/reports", label: "Reports & Analytics", icon: "chart", end: true, permission: "reports.view" },
    ],
  },
  {
    section: "Pharmacy",
    items: [
      { to: "/bills", label: "My Bills", icon: "receipt" },
      { to: "/products", label: "Products", icon: "pill" },
      { to: "/racks", label: "Rack Finder", icon: "rack" },
      { to: "/rack-center", label: "Rack Center", icon: "boxes" },
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

const MORE_KEY = "ghm_nav_more";

function Badge({ children, tone = "primary" }) {
  const cls =
    tone === "danger"
      ? "bg-gradient-to-br from-[#E2574F] to-danger text-white shadow-[0_4px_12px_-4px_rgba(196,61,54,0.8)]"
      : "bg-gradient-to-br from-[#22B8CF] to-primary text-white shadow-[0_4px_12px_-4px_rgba(34,184,207,0.8)]";
  return <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold tnum ${cls}`}>{children}</span>;
}

function Sidebar({ nav, isAdmin, onNavigate, onOpenNotifications, badges }) {
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(() => {
    try {
      return localStorage.getItem(MORE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggleMore = () => {
    setMoreOpen(!moreOpen);
    try {
      localStorage.setItem(MORE_KEY, moreOpen ? "0" : "1");
    } catch {
      /* per-browser preference only */
    }
  };
  // "More" opens by itself while one of its pages is on screen.
  const isOpen = (group) => !group.folds || moreOpen || group.items.some((i) => i.to && pathname.startsWith(i.to));

  const itemCls = (active) =>
    `group relative flex w-full items-center gap-3 rounded-xl px-3 py-[7px] text-sm font-medium transition-all duration-300 ${
      active ? "nav-active text-white" : "text-white/60 hover:translate-x-0.5 hover:bg-white/[0.06] hover:text-white"
    }`;

  return (
    <div className="sidebar-surface relative flex h-full flex-col overflow-hidden">
      {/* Fine grid texture, faded toward the bottom. */}
      <div className="login-grid pointer-events-none absolute inset-0 opacity-[0.035]" />

      <div className="relative px-5 pb-5 pt-6">
        <BrandLogo tone="light" size={42} subtitle="Management Suite" />
      </div>

      {/* The two daily entries, one click from anywhere. */}
      <div className="relative space-y-2 px-4 pb-5">
        <NavLink
          to="/billing"
          onClick={onNavigate}
          className={({ isActive }) =>
            `group flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#12A06A] to-[#0E9C8A] py-2.5 text-sm font-semibold text-white shadow-[0_10px_24px_-10px_rgba(18,160,106,0.85)] hover:-translate-y-0.5 hover:brightness-110 ${isActive ? "ring-2 ring-white/70" : "ring-1 ring-white/15"}`
          }
        >
          <Icon name="receipt" size={16} strokeWidth={2} />
          New Bill
          {badges.cart ? <span className="rounded-full bg-white/25 px-2 py-0.5 text-[11px] tnum">{badges.cart}</span> : null}
        </NavLink>
        {isAdmin && (
          <NavLink
            to="/purchases/new"
            onClick={onNavigate}
            className={({ isActive }) =>
              `group flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#22B8CF] to-primary py-2.5 text-sm font-semibold text-white shadow-[0_10px_24px_-10px_rgba(34,184,207,0.7)] hover:-translate-y-0.5 hover:brightness-110 ${isActive ? "ring-2 ring-white/70" : "ring-1 ring-white/15"}`
            }
          >
            <Icon name="truck" size={16} strokeWidth={2} />
            New Purchase
          </NavLink>
        )}
      </div>

      <nav className="dark-scroll relative flex-1 space-y-5 overflow-y-auto px-3 pb-4" aria-label="Main">
        {nav.map((group) => (
          <div key={group.section}>
            {group.folds ? (
              <button
                type="button"
                onClick={toggleMore}
                aria-expanded={isOpen(group)}
                className="flex w-full items-center justify-between rounded-lg px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45 hover:text-white"
              >
                {group.section}
                <span className="flex items-center gap-2">
                  {!isOpen(group) && badges.alerts ? <span className="rounded-full bg-danger px-1.5 py-0.5 text-[10px] tracking-normal text-white tnum">{badges.alerts}</span> : null}
                  <Icon name="chevronDown" size={14} className={`transition-transform ${isOpen(group) ? "rotate-180" : ""}`} />
                </span>
              </button>
            ) : (
              <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/30">{group.section}</p>
            )}
            <div className={`space-y-0.5 ${isOpen(group) ? "" : "hidden"}`}>
              {group.items.map((item) => {
                const badge = item.badge ? badges[item.badge] : null;
                const content = (active) => (
                  <>
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-lg transition-all duration-300 ${
                        active
                          ? "bg-gradient-to-br from-[#22B8CF] to-primary text-white shadow-[0_6px_16px_-6px_rgba(34,184,207,0.9)]"
                          : "text-white/50 group-hover:bg-white/[0.06] group-hover:text-[#9BE7F2]"
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
                  <NavLink key={item.to} to={item.to} end={item.end} onClick={onNavigate} className={({ isActive }) => itemCls(isActive && pathname !== "/purchases/new")}>
                    {({ isActive }) => content(isActive && pathname !== "/purchases/new")}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="glass-dark relative m-3 hidden overflow-hidden rounded-2xl p-4 [@media(min-height:960px)]:block">
        <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-[#22B8CF]/25 blur-2xl" />
        <div className="relative flex items-center gap-2 text-[#9BE7F2]">
          <Icon name="pill" size={16} />
          <p className="text-xs font-semibold">Dispense with care</p>
        </div>
        <p className="relative mt-1 text-xs leading-relaxed text-white/55">
          Batches are sold first-expiry-first-out automatically.
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

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 shadow-[8px_0_40px_-20px_rgba(6,18,44,0.5)] lg:block">
        <Sidebar nav={nav} isAdmin={user.role === "admin"} badges={badges} onOpenNotifications={openNotifications} />
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="fade-in absolute inset-0 bg-[#061229]/45 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
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
              isAdmin={user.role === "admin"}
              badges={badges}
              onNavigate={() => setDrawerOpen(false)}
              onOpenNotifications={openNotifications}
            />
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="glass sticky top-0 z-20 border-b border-white/70 shadow-[0_1px_0_rgba(16,36,48,0.06),0_8px_24px_-18px_rgba(16,36,48,0.25)]">
          <div className="flex h-[68px] items-center gap-3 px-4 sm:px-6 lg:px-8">
            <button
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              className="-ml-1 rounded-xl p-2 text-muted hover:bg-bg hover:text-primary lg:hidden"
            >
              <Icon name="menu" />
            </button>
            <NavLink to="/" aria-label={`${STORE_NAME} home`} className="shrink-0 xl:hidden">
              <BrandMark size={34} />
            </NavLink>

            <div className="hidden min-w-0 items-center gap-2.5 xl:flex">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/50" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </span>
              <div className="leading-tight">
                <p className="whitespace-nowrap font-display text-sm font-bold text-text">{STORE_NAME}</p>
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
