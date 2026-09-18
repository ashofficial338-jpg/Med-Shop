import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import RequiredMark from "../components/RequiredMark";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Login() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (isAuthenticated) return <Navigate to="/" replace />;

  const isValid = EMAIL_RE.test(email) && email.length <= 50 && password.length > 0;

  // Chrome/Edge autofill can update what's on screen without firing React's
  // onChange, leaving email/password state empty and the button stuck
  // disabled. This resyncs state when that happens (see the onAutoFill
  // keyframe in index.css) so the button reflects what's actually filled in.
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
    const liveEmail = form.elements.email.value;
    const livePassword = form.elements.password.value;

    if (!EMAIL_RE.test(liveEmail) || liveEmail.length > 50 || livePassword.length === 0 || submitting) {
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const user = await login(liveEmail, livePassword);
      navigate(user.role === "admin" ? "/dashboard" : "/products", { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-8 shadow-md">
        <h1 className="text-center font-display text-3xl font-semibold text-primary">GHM</h1>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-text">
              Email<RequiredMark />
            </label>
            <input
              id="email"
              name="email"
              type="email"
              maxLength={50}
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onAnimationStart={handleAutoFill(setEmail)}
              placeholder="you@example.com"
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-text">
              Password<RequiredMark />
            </label>
            <div className="relative mt-1">
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                maxLength={15}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onAnimationStart={handleAutoFill(setPassword)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 pr-10 text-sm text-text focus:border-primary focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-muted"
              >
                {showPassword ? "🙈" : "👁"}
              </button>
            </div>
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          <button
            type="submit"
            disabled={!isValid || submitting}
            className="w-full rounded-lg bg-accent py-2.5 font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50 hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {submitting ? "Logging in…" : "Login"}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-muted">
          Forgot your password? Contact your administrator.
        </p>
      </div>
    </div>
  );
}
