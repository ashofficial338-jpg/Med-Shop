import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import Layout from "../components/Layout";
import RequiredMark from "../components/RequiredMark";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Users() {
  const { user: me } = useAuth();
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
    if (u.isActive && !window.confirm(`Deactivate ${u.username}? They will no longer be able to log in. You can reactivate them later.`)) return;
    try {
      await api.patch(`/users/${u._id}`, { isActive: !u.isActive });
      toast.success(`${u.username} ${u.isActive ? "deactivated" : "reactivated"}.`);
      loadUsers(query);
    } catch (err) {
      toast.error(err.response?.data?.message || "Something went wrong. Please try again.");
    }
  };

  // Admin-only page; the server also refuses self-deletion, the last Admin,
  // and anyone with recorded bills/purchases etc. (deactivate them instead).
  const deleteUser = async (u) => {
    if (!window.confirm(`Permanently delete ${u.username} (${u.email})? This cannot be undone.`)) return;
    try {
      await api.delete(`/users/${u._id}`);
      toast.success(`${u.username} deleted.`);
      loadUsers(query);
    } catch (err) {
      toast.error(err.response?.data?.message || "Something went wrong. Please try again.");
    }
  };

  const changeRole = async (u, newRole) => {
    try {
      await api.patch(`/users/${u._id}`, { role: newRole });
      toast.success(`${u.username} is now ${newRole === "admin" ? "an Admin" : "Staff"}.`);
    } catch (err) {
      toast.error(err.response?.data?.message || "Something went wrong. Please try again.");
    }
    // Reload either way so the dropdown shows the saved role, not the attempted one.
    loadUsers(query);
  };

  // Edit name / email / role. Admin-only page; the server re-checks the email
  // is unique and that the last active Admin keeps the Admin role.
  const [editing, setEditing] = useState(null); // { _id, username, email, role }
  const [editError, setEditError] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const editValid =
    editing && EMAIL_RE.test(editing.email) && editing.email.length <= 50 && editing.username.trim().length > 0;

  const openEdit = (u) => {
    setEditing({ _id: u._id, username: u.username, email: u.email, role: u.role });
    setEditError("");
  };

  const submitEdit = async (e) => {
    e.preventDefault();
    if (!editValid || savingEdit) return;
    setSavingEdit(true);
    setEditError("");
    try {
      const { username: name, email: mail, role: newRole } = editing;
      await api.patch(`/users/${editing._id}`, { username: name.trim(), email: mail.trim(), role: newRole });
      toast.success(`${name.trim()} updated.`);
      setEditing(null);
      loadUsers(query);
    } catch (err) {
      setEditError(err.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setSavingEdit(false);
    }
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
        <h1 className="font-display text-2xl font-bold tracking-tight text-text sm:text-[28px]">Users</h1>
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
              <button
                onClick={() => openEdit(u)}
                className="rounded-lg px-3 py-1 text-sm font-semibold text-primary hover:bg-bg"
              >
                Edit
              </button>
              {String(u._id) !== String(me?.id) && (
                <button
                  onClick={() => deleteUser(u)}
                  className="rounded-lg px-3 py-1 text-sm font-semibold text-danger hover:bg-danger/10"
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <form onSubmit={submitEdit} className="w-full max-w-sm space-y-3 rounded-2xl bg-surface p-6 shadow-xl">
            <h2 className="font-display text-lg font-semibold text-text">Edit User</h2>
            <label className="block text-sm font-medium text-text">
              Username <RequiredMark />
              <input
                type="text"
                maxLength={50}
                value={editing.username}
                onChange={(e) => setEditing({ ...editing, username: e.target.value })}
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
              />
            </label>
            <label className="block text-sm font-medium text-text">
              Email <RequiredMark />
              <input
                type="email"
                maxLength={50}
                value={editing.email}
                onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
              />
            </label>
            <label className="block text-sm font-medium text-text">
              Role
              <select
                value={editing.role}
                onChange={(e) => setEditing({ ...editing, role: e.target.value })}
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
              >
                <option value="staff">Staff</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            {editError && <p className="text-sm text-danger">{editError}</p>}
            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={!editValid || savingEdit}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-primary-dark"
              >
                {savingEdit ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-muted hover:bg-bg"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

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
