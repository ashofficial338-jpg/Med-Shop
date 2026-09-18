import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function SessionExpiredModal() {
  const { sessionExpired, acknowledgeSessionExpired } = useAuth();
  const navigate = useNavigate();

  if (!sessionExpired) return null;

  const handleGoToLogin = () => {
    acknowledgeSessionExpired();
    navigate("/login", { replace: true });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-xl">
        <h2 className="font-display text-xl font-semibold text-text">Session Expired</h2>
        <p className="mt-2 text-sm text-muted">
          Your session has expired due to inactivity. Please log in again.
        </p>
        <button
          onClick={handleGoToLogin}
          className="mt-5 w-full rounded-lg bg-primary py-2.5 font-semibold text-white transition hover:bg-primary-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Go to Login
        </button>
      </div>
    </div>
  );
}
