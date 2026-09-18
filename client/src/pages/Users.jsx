import { useEffect, useState } from "react";
import Layout from "../components/Layout";
import RequiredMark from "../components/RequiredMark";
import api from "../api/client";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Users() {
  const [users, setUsers] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState("");
  const [resetTargetId, setResetTargetId] = useState(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetError, setResetError] = useState("");

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState("staff");
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);

  const loadUsers = async (q = "") => {
    setLoading(true);
    const { data } = await api.get("/users", { params: q ? { q } : {} });
    setUsers(data);
    setLoading(false);
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleSearch = (e) => {
    const q = e.target.value;
    setQuery(q);
    loadUsers(q);
  };

  const isFormValid =
    EMAIL_RE.test(email) &&
    email.length <= 50 &&
    username.trim().length > 0 &&
    password.length >= 6 &&
    password.length <= 15;

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!isFormValid) return;
    setCreating(true);
    setFormError("");
    try {
      await api.post("/users", { email, username, role, password });
      setEmail("");
      setUsername("");
      setRole("staff");
      setPassword("");
      setShowForm(false);
      loadUsers(query);
    } catch (err) {
      setFormError(err.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (u) => {
    try {
      await api.patch(`/users/${u._id}`, { isActive: !u.isActive });
      loadUsers(query);
    } catch (err) {
      alert(err.response?.data?.message || "Something went wrong. Please try again.");
    }
  };

  const changeRole = async (u, newRole) => {
    await api.patch(`/users/${u._id}`, { role: newRole });
    loadUsers(query);
  };

  const submitReset = async (e) => {
    e.preventDefault();
    if (resetPassword.length < 6 || resetPassword.length > 15) return;
    setResetError("");
    try {
      await api.post(`/users/${resetTargetId}/reset-password`, { newPassword: resetPassword });
      setResetTargetId(null);
      setResetPassword("");
    } catch (err) {
      setResetError(err.response?.data?.message || "Something went wrong. Please try again.");
    }
  };

  return (
    <Layout>
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold text-text">Users</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-95"
        >
          Add User
        </button>
      </div>

      <input
        type="text"
        placeholder="Search by email or username"
        value={query}
        onChange={handleSearch}
        className="mt-4 w-full max-w-sm rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
      />

      {showForm && (
        <form onSubmit={handleCreate} className="mt-4 max-w-sm space-y-3 rounded-2xl bg-surface p-5 shadow-sm">
          <div>
            <label className="block text-sm font-medium text-text">Email<RequiredMark /></label>
            <input
              type="email"
              maxLength={50}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text">Username<RequiredMark /></label>
            <input
              type="text"
              maxLength={50}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
            >
              <option value="staff">Staff</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text">Password<RequiredMark /></label>
            <input
              type="password"
              maxLength={15}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
            />
          </div>
          {formError && <p className="text-sm text-danger">{formError}</p>}
          <button
            type="submit"
            disabled={!isFormValid || creating}
            className="w-full rounded-lg bg-primary py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-primary-dark"
          >
            Save
          </button>
        </form>
      )}

      <div className="mt-6 space-y-2">
        {loading && <p className="text-sm text-muted">Loading…</p>}
        {!loading && users.length === 0 && <p className="text-sm text-muted">No records found.</p>}

        {users.map((u) => (
          <div key={u._id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface p-4 shadow-sm">
            <div>
              <p className="font-medium text-text">{u.username}</p>
              <p className="text-sm text-muted">{u.email}</p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={u.role}
                onChange={(e) => changeRole(u, e.target.value)}
                className="rounded-lg border border-border bg-surface px-2 py-1 text-sm text-text"
              >
                <option value="staff">Staff</option>
                <option value="admin">Admin</option>
              </select>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  u.isActive ? "bg-success/15 text-success" : "bg-danger/15 text-danger"
                }`}
              >
                {u.isActive ? "Active" : "Inactive"}
              </span>
              <button
                onClick={() => toggleActive(u)}
                className="rounded-lg px-3 py-1 text-sm font-semibold text-muted hover:bg-bg"
              >
                {u.isActive ? "Deactivate" : "Reactivate"}
              </button>
              <button
                onClick={() => {
                  setResetTargetId(u._id);
                  setResetPassword("");
                  setResetError("");
                }}
                className="rounded-lg px-3 py-1 text-sm font-semibold text-primary hover:bg-bg"
              >
                Reset Password
              </button>
            </div>
          </div>
        ))}
      </div>

      {resetTargetId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <form onSubmit={submitReset} className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-xl">
            <h2 className="font-display text-lg font-semibold text-text">Reset Password</h2>
            <input
              type="password"
              maxLength={15}
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              placeholder="New password"
              className="mt-4 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
            />
            {resetError && <p className="mt-2 text-sm text-danger">{resetError}</p>}
            <div className="mt-4 flex gap-2">
              <button
                type="submit"
                disabled={resetPassword.length < 6 || resetPassword.length > 15}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-primary-dark"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setResetTargetId(null)}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-muted hover:bg-bg"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </Layout>
  );
}
