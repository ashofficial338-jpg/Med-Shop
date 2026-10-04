import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import Icon from "../components/Icon";
import { STORE_NAME } from "../components/Layout";
import api from "../api/client";

// Remembered sign-in name (email or username), prefilled when "Remember me"
// was ticked last time. The session itself is kept by AuthContext.
const REMEMBER_KEY = "ghm_remember_login";
const readRemembered = () => {
  try {
    return localStorage.getItem(REMEMBER_KEY) || "";
  } catch {
    return "";
  }
};

// Polls the health endpoint until the backend answers (a cold start on
// Render can take up to ~a minute). Resolves either way after ~90s.
async function waitForServer() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      await api.get("/health", { timeout: 15_000 });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

const FEATURES = [
  { icon: "shield", title: "Secure, role-based access", text: "Admins and staff each see only what they need." },
  { icon: "boxes", title: "Live stock & expiry tracking", text: "Batches, low stock and expiry alerts in one place." },
  { icon: "chart", title: "Billing, GST & profit insights", text: "From the counter to the P&L, always up to date." },
];

function BrandMark({ light }) {
  return (
    <span
      className={`flex h-11 w-11 items-center justify-center rounded-2xl ${
        light ? "bg-white/15 text-white ring-1 ring-white/25" : "bg-primary text-white shadow-[0_6px_16px_-6px_rgba(14,124,116,0.6)]"
      }`}
    >
      <Icon name="cross" size={22} strokeWidth={2} />
    </span>
  );
}

// Decorative heartbeat line for the brand panel.
function PulseLine({ compact }) {
  return (
    <svg
      viewBox="0 0 600 120"
      preserveAspectRatio={compact ? "none" : undefined}
      className={compact ? "h-10 w-full" : "h-24 w-full"}
      fill="none"
      aria-hidden="true"
    >
      <path d="M0 60h600" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
      <path
        className="login-ecg"
        d="M0 60h170l18-26 22 64 26-92 24 104 18-50h26l12-14 14 14h270"
        stroke="rgba(255,255,255,0.85)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const fieldCls =
  "w-full rounded-xl border border-border bg-surface py-3 pl-11 pr-3 text-sm text-text shadow-[0_1px_2px_rgba(16,36,48,0.04)] transition placeholder:text-muted/70 hover:border-primary/30 focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10";

export default function Login() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState(readRemembered);
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(() => Boolean(readRemembered()));
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (isAuthenticated) return <Navigate to="/" replace />;

  const isValid = identifier.trim().length > 0 && identifier.length <= 50 && password.length > 0;

  // Chrome/Edge autofill can update what's on screen without firing React's
  // onChange, leaving the fields' state empty and the button stuck disabled.
  // This resyncs state when that happens (see the onAutoFill keyframe in
  // index.css) so the button reflects what's actually filled in.
  const handleAutoFill = (setter) => (e) => {
    if (e.animationName === "onAutoFill") {
      setter(e.target.value);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Belt-and-suspenders: read straight from the form in case autofill still
    // slipped past the resync above, so a filled-in form is never stuck un-submittable.
    const form = e.currentTarget;
    const liveIdentifier = form.elements.identifier.value.trim();
    const livePassword = form.elements.password.value;

    if (!liveIdentifier || liveIdentifier.length > 50 || livePassword.length === 0 || submitting) {
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      let user;
      try {
        user = await login(liveIdentifier, livePassword, remember);
      } catch (err) {
        if (err.response) throw err;
        // No response at all: on Render's free tier this is usually the
        // backend waking from sleep - its proxy answers without CORS headers,
        // so the browser reports it as a CORS error. Wait for the server to
        // come up, then try once more.
        setStatus("Waking up the server, this can take up to a minute…");
        await waitForServer();
        setStatus("");
        user = await login(liveIdentifier, livePassword, remember);
      }
      try {
        if (remember) localStorage.setItem(REMEMBER_KEY, liveIdentifier);
        else localStorage.removeItem(REMEMBER_KEY);
      } catch {
        // Storage unavailable (private mode) - remembering is a convenience only.
      }
      navigate(user.role === "admin" ? "/dashboard" : "/products", { replace: true });
    } catch (err) {
      // No err.response means the request never got an answer (wrong API URL,
      // CORS block, backend down) - the network tab/console shows which.
      console.error("Login failed:", {
        url: `${err.config?.baseURL ?? ""}${err.config?.url ?? ""}`,
        status: err.response?.status ?? "no response",
        message: err.response?.data?.message ?? err.message,
        code: err.code,
      });
      setStatus("");
      setError(err.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const year = new Date().getFullYear();

  return (
    <div className="grid min-h-screen bg-bg lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {/* Brand panel (desktop / large tablet) */}
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-[#0A5F59] via-primary to-[#139186] p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-14">
        <div className="login-blob pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-white/10 blur-2xl" />
        <div className="login-blob login-blob-delay pointer-events-none absolute -bottom-32 -left-20 h-96 w-96 rounded-full bg-[#2A78D6]/25 blur-3xl" />
        <div className="login-grid pointer-events-none absolute inset-0 opacity-[0.07]" />

        <div className="relative flex items-center gap-3">
          <BrandMark light />
          <div>
            <p className="font-display text-lg font-bold leading-tight">{STORE_NAME}</p>
            <p className="text-xs text-white/70">Pharmacy management</p>
          </div>
        </div>

        <div className="relative max-w-lg">
          <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold tracking-wide text-white/90 ring-1 ring-white/20">
            <Icon name="pulse" size={14} strokeWidth={2} />
            Care, counted precisely
          </p>
          <h2 className="mt-5 font-display text-4xl font-bold leading-[1.15] tracking-tight xl:text-[44px]">
            Your pharmacy, running smoothly every day.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-white/75">
            Billing, inventory, suppliers and accounts — one secure workspace for your whole team.
          </p>
          <div className="mt-6">
            <PulseLine />
          </div>
          <ul className="mt-6 space-y-4">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex gap-3.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
                  <Icon name={f.icon} size={18} />
                </span>
                <span>
                  <span className="block text-sm font-semibold">{f.title}</span>
                  <span className="block text-sm text-white/70">{f.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/60">
          © {year} {STORE_NAME} · For authorised staff only
        </p>
      </aside>

      {/* Sign-in */}
      <main className="relative flex items-start justify-center overflow-hidden px-4 pb-10 pt-14 sm:px-8 sm:pt-20 lg:items-center lg:py-10">
        {/* Phones / tablets: brand band with the heartbeat line behind the card. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-72 overflow-hidden bg-gradient-to-br from-[#0A5F59] via-primary to-[#139186] sm:h-80 lg:hidden">
          <div className="login-grid absolute inset-0 opacity-[0.07]" />
          <div className="login-blob absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
        </div>

        <div className="relative w-full max-w-[420px]">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <BrandMark light />
            <div className="shrink-0">
              <p className="font-display text-lg font-bold leading-tight text-white">{STORE_NAME}</p>
              <p className="text-xs text-white/75">Pharmacy management</p>
            </div>
            {/* Heartbeat fills the rest of the row, so it never runs into the text. */}
            <div className="hidden min-w-0 flex-1 opacity-70 min-[380px]:block">
              <PulseLine compact />
            </div>
          </div>

          <div className="fade-up rounded-3xl border border-border bg-surface p-7 shadow-[var(--shadow-lift)] sm:p-9">
            <h1 className="font-display text-2xl font-bold tracking-tight text-text sm:text-[28px]">Welcome back</h1>
            <p className="mt-1.5 text-sm text-muted">Sign in to continue to your workspace.</p>

            <form onSubmit={handleSubmit} className="mt-7 space-y-5" noValidate>
              <div>
                <label htmlFor="identifier" className="block text-sm font-medium text-text">
                  Email or username
                </label>
                <div className="relative mt-1.5">
                  <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-muted">
                    <Icon name={identifier.includes("@") ? "mail" : "user"} size={18} />
                  </span>
                  <input
                    id="identifier"
                    name="identifier"
                    type="text"
                    inputMode="email"
                    maxLength={50}
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    onAnimationStart={handleAutoFill(setIdentifier)}
                    placeholder="you@example.com"
                    aria-invalid={Boolean(error) || undefined}
                    className={fieldCls}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-text">
                  Password
                </label>
                <div className="relative mt-1.5">
                  <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-muted">
                    <Icon name="lock" size={18} />
                  </span>
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    maxLength={15}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyUp={(e) => setCapsLock(e.getModifierState?.("CapsLock") || false)}
                    onBlur={() => setCapsLock(false)}
                    onAnimationStart={handleAutoFill(setPassword)}
                    placeholder="Enter your password"
                    aria-invalid={Boolean(error) || undefined}
                    aria-describedby={capsLock ? "caps-hint" : undefined}
                    className={`${fieldCls} pr-12`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-muted transition hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  >
                    <Icon name={showPassword ? "eyeOff" : "eye"} size={18} />
                  </button>
                </div>
                {capsLock && (
                  <p id="caps-hint" className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-warning">
                    <Icon name="alert" size={13} />
                    Caps Lock is on
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <label className="flex cursor-pointer select-none items-center gap-2 whitespace-nowrap text-sm text-text">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    className="h-4 w-4 cursor-pointer rounded border-border accent-[#0E7C74]"
                  />
                  Remember me
                </label>
                <button
                  type="button"
                  onClick={() => setShowForgot((v) => !v)}
                  aria-expanded={showForgot}
                  aria-controls="forgot-help"
                  className="whitespace-nowrap rounded-md text-sm font-semibold text-primary transition hover:text-primary-dark hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                >
                  Forgot password?
                </button>
              </div>

              {showForgot && (
                <div id="forgot-help" role="status" className="fade-up flex gap-3 rounded-xl border border-info/20 bg-info-soft px-4 py-3 text-sm text-text">
                  <Icon name="info" size={18} className="mt-0.5 shrink-0 text-info" />
                  <p>
                    For your security, passwords are reset by your administrator. Ask an Admin to reset it from{" "}
                    <span className="font-semibold">Users → Reset Password</span>, then sign in with the new one.
                  </p>
                </div>
              )}

              <div aria-live="polite">
                {status && (
                  <p className="flex items-center gap-2 rounded-xl bg-primary-soft px-4 py-3 text-sm text-primary">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" aria-hidden="true" />
                    {status}
                  </p>
                )}
                {error && (
                  <p role="alert" className="flex items-start gap-2 rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
                    <Icon name="alert" size={17} className="mt-0.5 shrink-0" />
                    {error}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={!isValid || submitting}
                className="group flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-[#139186] py-3 text-[15px] font-semibold text-white shadow-[0_10px_24px_-12px_rgba(14,124,116,0.75)] transition hover:brightness-105 active:brightness-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/25"
              >
                {submitting ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />
                    Signing in…
                  </>
                ) : (
                  <>
                    Sign in
                    <Icon name="arrowRight" size={17} strokeWidth={2} className="transition group-hover:translate-x-0.5" />
                  </>
                )}
              </button>
            </form>

            <p className="mt-6 flex items-center justify-center gap-1.5 border-t border-border pt-5 text-xs text-muted">
              <Icon name="shield" size={14} className="text-primary" />
              Secure sign-in · Sessions end after 20 minutes of inactivity
            </p>
          </div>

          <p className="mt-6 text-center text-xs text-muted lg:hidden">
            © {year} {STORE_NAME} · For authorised staff only
          </p>
        </div>
      </main>
    </div>
  );
}
