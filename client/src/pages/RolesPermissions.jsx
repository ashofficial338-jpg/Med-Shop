import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import Layout from "../components/Layout";
import Icon from "../components/Icon";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import { PERMISSIONS } from "../utils/permissions";

const ADMIN_CAN = [
  "Everything in the app, including Users and Roles & Permissions",
  "Full dashboard: click any figure for details, apply filters and date ranges",
  "Download dashboard and profitability reports (Excel / PDF)",
];
const STAFF_CAN = [
  "Products, orders/checkout and their own bills",
  "A view-only dashboard, if granted below - only the sections ticked",
  "No click-through, filters, date ranges, reports or downloads on the dashboard",
];

function RoleCard({ title, icon, items, tone }) {
  return (
    <div className="card p-5">
      <p className={`flex items-center gap-2 font-display text-base font-semibold ${tone}`}>
        <Icon name={icon} size={17} />
        {title}
      </p>
      <ul className="mt-3 space-y-1.5 text-sm text-text">
        {items.map((t) => (
          <li key={t} className="flex gap-2">
            <span className="mt-0.5 text-muted">•</span>
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Admin-only: change each user's role and grant non-admins view-only
// dashboard access per section. Saved immediately; the server enforces them.
export default function RolesPermissions() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);

  const load = () =>
    api.get("/users").then(({ data }) => {
      setUsers(data);
      setLoading(false);
    });

  useEffect(() => {
    load();
  }, []);

  const save = async (u, patch, message) => {
    setSavingId(u._id);
    try {
      const { data } = await api.patch(`/users/${u._id}`, patch);
      setUsers((list) => list.map((x) => (x._id === u._id ? { ...x, ...data, _id: x._id } : x)));
      toast.success(message);
    } catch (err) {
      toast.error(err.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setSavingId(null);
    }
  };

  const changeRole = (u, role) => {
    if (role === u.role) return;
    if (String(u._id) === String(me.id) && role !== "admin") {
      if (!window.confirm("Remove the Admin role from your own account? You will lose access to this page.")) return;
    }
    save(u, { role }, `${u.username} is now ${role === "admin" ? "an Admin" : "Staff"}.`);
  };

  const togglePermission = (u, key) => {
    const current = u.permissions || [];
    let next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    // Without "View dashboard" the section permissions mean nothing - clear them too.
    if (key === "dashboard.view" && !next.includes("dashboard.view")) next = [];
    save(u, { permissions: next }, "Permissions updated.");
  };

  const grantAll = (u, all) =>
    save(u, { permissions: all ? PERMISSIONS.map((p) => p.key) : [] }, all ? "Full view-only dashboard granted." : "Dashboard access removed.");

  return (
    <Layout>
      <h1 className="font-display text-2xl font-bold tracking-tight text-text sm:text-[28px]">Roles &amp; Permissions</h1>
      <p className="mt-1 text-sm text-muted">
        Choose each user's role and what non-admin users can see on the dashboard. Changes save immediately and apply on the
        user's next page load.
      </p>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <RoleCard title="Admin" icon="settings" tone="text-primary" items={ADMIN_CAN} />
        <RoleCard title="Staff" icon="user" tone="text-text" items={STAFF_CAN} />
      </div>

      <div className="mt-6 space-y-3">
        {loading && <p className="text-sm text-muted">Loading…</p>}
        {!loading && users.length === 0 && <p className="text-sm text-muted">No records found.</p>}

        {users.map((u) => {
          const perms = u.permissions || [];
          const canView = perms.includes("dashboard.view");
          const busy = savingId === u._id;
          return (
            <div key={u._id} className={`card p-5 transition-opacity ${busy ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-text">
                    {u.username}
                    {String(u._id) === String(me.id) && <span className="ml-2 text-xs text-muted">(you)</span>}
                    {!u.isActive && (
                      <span className="ml-2 rounded-full bg-danger/15 px-2 py-0.5 text-xs font-semibold text-danger">Inactive</span>
                    )}
                  </p>
                  <p className="text-sm text-muted">{u.email}</p>
                </div>
                <label className="flex items-center gap-2 text-sm text-muted">
                  Role
                  <select
                    value={u.role}
                    disabled={busy}
                    onChange={(e) => changeRole(u, e.target.value)}
                    className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm font-medium text-text focus:border-primary focus:outline-none"
                  >
                    <option value="admin">Admin</option>
                    <option value="staff">Staff</option>
                  </select>
                </label>
              </div>

              {u.role === "admin" ? (
                <p className="mt-3 flex items-center gap-2 rounded-xl bg-primary-soft px-3 py-2 text-sm text-primary">
                  <Icon name="check" size={16} />
                  Full access, including dashboard details, filters, reports and downloads.
                </p>
              ) : (
                <div className="mt-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">Dashboard access (view only)</p>
                    <div className="flex gap-1">
                      <button
                        disabled={busy}
                        onClick={() => grantAll(u, true)}
                        className="rounded-lg px-2 py-1 text-xs font-semibold text-primary hover:bg-primary-soft"
                      >
                        Grant all
                      </button>
                      <button
                        disabled={busy || perms.length === 0}
                        onClick={() => grantAll(u, false)}
                        className="rounded-lg px-2 py-1 text-xs font-semibold text-muted hover:bg-bg disabled:opacity-40"
                      >
                        Remove all
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {PERMISSIONS.map((p) => {
                      const isMaster = p.key === "dashboard.view";
                      const disabled = busy || (!isMaster && !canView);
                      return (
                        <label
                          key={p.key}
                          className={`flex items-start gap-2.5 rounded-xl border p-3 text-sm transition ${
                            perms.includes(p.key) ? "border-primary/40 bg-primary-soft/50" : "border-border"
                          } ${disabled && !busy ? "opacity-50" : "cursor-pointer hover:border-primary/30"}`}
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={perms.includes(p.key)}
                            disabled={disabled}
                            onChange={() => togglePermission(u, p.key)}
                          />
                          <span>
                            <span className="block font-medium text-text">{p.label}</span>
                            <span className="block text-xs text-muted">
                              {!isMaster && !canView ? "Needs “View dashboard” first. " : ""}
                              {p.description}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Layout>
  );
}
