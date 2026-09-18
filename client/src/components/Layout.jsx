import { NavLink } from "react-router-dom";
import AvatarMenu from "./AvatarMenu";
import { useAuth } from "../context/AuthContext";

const navLinkCls = ({ isActive }) =>
  `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
    isActive ? "bg-white/20 text-white" : "text-white/80 hover:bg-white/10 hover:text-white"
  }`;

const ADMIN_NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/products", label: "Products" },
  { to: "/vendors", label: "Vendors" },
  { to: "/stock", label: "Stock" },
  { to: "/customers", label: "Customers" },
  { to: "/bills", label: "Bill History" },
];

const STAFF_NAV_ITEMS = [
  { to: "/products", label: "Products" },
  { to: "/bills", label: "My Bills" },
];

function NavLinks({ items }) {
  return (
    <>
      {items.map((item) => (
        <NavLink key={item.to} to={item.to} className={navLinkCls}>
          {item.label}
        </NavLink>
      ))}
    </>
  );
}

export default function Layout({ children }) {
  const { user } = useAuth();
  const items = user.role === "admin" ? ADMIN_NAV_ITEMS : STAFF_NAV_ITEMS;

  return (
    <div className="min-h-screen bg-bg">
      <header className="flex items-center justify-between gap-4 bg-primary px-4 py-3 text-white sm:px-6">
        <div className="flex items-center gap-4">
          <span className="font-display text-lg font-semibold tracking-wide">GHM</span>
          <nav className="hidden gap-1 sm:flex">
            <NavLinks items={items} />
          </nav>
        </div>
        <AvatarMenu />
      </header>

      <nav className="flex flex-wrap gap-1 bg-primary-dark px-4 py-2 sm:hidden">
        <NavLinks items={items} />
      </nav>

      <main className="mx-auto w-full max-w-[1800px] px-4 py-6 sm:px-6 lg:px-10">{children}</main>
    </div>
  );
}
