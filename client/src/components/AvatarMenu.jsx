import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import Icon from "./Icon";

export default function AvatarMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const initial = user?.username?.[0]?.toUpperCase() || "?";

  const handleLogout = () => {
    setOpen(false);
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Account menu"
        aria-expanded={open}
        className="flex items-center gap-2.5 rounded-xl border border-transparent py-1 pl-1 pr-2 transition hover:border-border hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#2FC1B0] via-primary to-info font-semibold text-white shadow-[0_6px_16px_-6px_rgba(14,124,116,0.8)] ring-2 ring-white">
          {initial}
        </span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block max-w-[9rem] truncate text-sm font-semibold text-text">{user?.username}</span>
          <span className="block text-[11px] capitalize text-muted">{user?.role === "admin" ? "Pharmacist · Admin" : "Staff"}</span>
        </span>
        <Icon name="chevronDown" size={16} className="hidden text-muted sm:block" />
      </button>

      {open && (
        <div className="pop-in absolute right-0 z-50 mt-2 w-48 overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-[var(--shadow-lift)]">
          <Link
            to="/profile"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-text hover:bg-bg"
          >
            <Icon name="settings" size={16} className="text-muted" />
            Profile &amp; settings
          </Link>
          {user?.role === "admin" && (
            <Link
              to="/users"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-text hover:bg-bg"
            >
              <Icon name="users" size={16} className="text-muted" />
              Users
            </Link>
          )}
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-danger hover:bg-danger/5"
          >
            <Icon name="logout" size={16} />
            Logout
          </button>
        </div>
      )}
    </div>
  );
}
