import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

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
        className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-white/80 bg-primary font-semibold text-white shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        {initial}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-44 overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
          <Link
            to="/profile"
            onClick={() => setOpen(false)}
            className="block px-4 py-2.5 text-sm text-text hover:bg-bg"
          >
            Profile
          </Link>
          {user?.role === "admin" && (
            <Link
              to="/users"
              onClick={() => setOpen(false)}
              className="block px-4 py-2.5 text-sm text-text hover:bg-bg"
            >
              Users
            </Link>
          )}
          <button
            onClick={handleLogout}
            className="block w-full px-4 py-2.5 text-left text-sm text-danger hover:bg-bg"
          >
            Logout
          </button>
        </div>
      )}
    </div>
  );
}
