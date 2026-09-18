import { useState } from "react";
import Layout from "../components/Layout";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import RequiredMark from "../components/RequiredMark";

function PasswordField({ label, value, onChange, id }) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-text">
        {label}
        <RequiredMark />
      </label>
      <div className="relative mt-1">
        <input
          id={id}
          type={show ? "text" : "password"}
          maxLength={15}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 pr-10 text-sm text-text focus:border-primary focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? "Hide password" : "Show password"}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-muted"
        >
          {show ? "🙈" : "👁"}
        </button>
      </div>
    </div>
  );
}

export default function Profile() {
  const { user, updateUser } = useAuth();
  const [username, setUsername] = useState(user.username);
  const [savingUsername, setSavingUsername] = useState(false);
  const [usernameMsg, setUsernameMsg] = useState("");

  const [showPwForm, setShowPwForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwSuccess, setPwSuccess] = useState("");

  const usernameChanged = username.trim().length > 0 && username !== user.username;

  const handleSaveUsername = async (e) => {
    e.preventDefault();
    if (!usernameChanged) return;
    setSavingUsername(true);
    setUsernameMsg("");
    try {
      const { data } = await api.patch("/profile", { username: username.trim() });
      updateUser({ username: data.username });
      setUsernameMsg("Username updated.");
    } catch (err) {
      setUsernameMsg(err.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setSavingUsername(false);
    }
  };

  const pwValid =
    currentPassword.length > 0 &&
    newPassword.length >= 6 &&
    newPassword.length <= 15 &&
    confirmPassword.length > 0;

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPwError("");
    setPwSuccess("");

    if (newPassword !== confirmPassword) {
      setPwError("Passwords do not match.");
      return;
    }

    setPwSaving(true);
    try {
      await api.post("/profile/change-password", { currentPassword, newPassword });
      setPwSuccess("Password updated.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setShowPwForm(false);
    } catch (err) {
      setPwError(err.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setPwSaving(false);
    }
  };

  return (
    <Layout>
      <h1 className="font-display text-2xl font-semibold text-text">My Profile</h1>

      <form onSubmit={handleSaveUsername} className="mt-6 max-w-sm space-y-4 rounded-2xl bg-surface p-5 shadow-sm">
        <div>
          <label className="block text-sm font-medium text-text">Email</label>
          <input
            type="text"
            value={user.email}
            disabled
            className="mt-1 w-full cursor-not-allowed rounded-lg border border-border bg-bg px-3 py-2 text-sm text-muted"
          />
        </div>

        <div>
          <label htmlFor="username" className="block text-sm font-medium text-text">
            Username<RequiredMark />
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id="username"
              type="text"
              maxLength={50}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
            />
            <button
              type="submit"
              disabled={!usernameChanged || savingUsername}
              className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-primary-dark"
            >
              Save
            </button>
          </div>
          {usernameMsg && <p className="mt-1 text-sm text-muted">{usernameMsg}</p>}
        </div>
      </form>

      <div className="mt-6 max-w-sm rounded-2xl bg-surface p-5 shadow-sm">
        {!showPwForm ? (
          <button
            onClick={() => setShowPwForm(true)}
            className="text-sm font-semibold text-primary hover:underline"
          >
            Change Password
          </button>
        ) : (
          <form onSubmit={handleChangePassword} className="space-y-4">
            <PasswordField
              id="currentPassword"
              label="Current Password"
              value={currentPassword}
              onChange={setCurrentPassword}
            />
            <PasswordField
              id="newPassword"
              label="New Password"
              value={newPassword}
              onChange={setNewPassword}
            />
            <PasswordField
              id="confirmPassword"
              label="Confirm New Password"
              value={confirmPassword}
              onChange={setConfirmPassword}
            />
            {pwError && <p className="text-sm text-danger">{pwError}</p>}
            {pwSuccess && <p className="text-sm text-success">{pwSuccess}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={!pwValid || pwSaving}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-primary-dark"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setShowPwForm(false)}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-muted hover:bg-bg"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </Layout>
  );
}
