import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import api, { setAuthToken } from "../api/client";

const AuthContext = createContext(null);

const INACTIVITY_LIMIT_MS = 20 * 60 * 1000; // 20 minutes, see Read Me sheet assumption
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem("ghm_user");
    return stored ? JSON.parse(stored) : null;
  });
  const [token, setToken] = useState(() => localStorage.getItem("ghm_token"));
  const [sessionExpired, setSessionExpired] = useState(false);
  const idleTimer = useRef(null);

  useEffect(() => {
    setAuthToken(token);
  }, [token]);

  const clearSession = useCallback(() => {
    localStorage.removeItem("ghm_token");
    localStorage.removeItem("ghm_user");
    setToken(null);
    setUser(null);
    setAuthToken(null);
  }, []);

  const login = useCallback(async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    localStorage.setItem("ghm_token", data.token);
    localStorage.setItem("ghm_user", JSON.stringify(data.user));
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(() => {
    clearSession();
  }, [clearSession]);

  const updateUser = useCallback((partial) => {
    setUser((prev) => {
      const next = { ...prev, ...partial };
      localStorage.setItem("ghm_user", JSON.stringify(next));
      return next;
    });
  }, []);

  const acknowledgeSessionExpired = useCallback(() => {
    clearSession();
    setSessionExpired(false);
  }, [clearSession]);

  // 401 from any request (deactivated account, invalid/expired token) -> session-expired modal
  useEffect(() => {
    const id = api.interceptors.response.use(
      (res) => res,
      (err) => {
        if (err.response && err.response.status === 401 && localStorage.getItem("ghm_token")) {
          setSessionExpired(true);
        }
        return Promise.reject(err);
      }
    );
    return () => api.interceptors.response.eject(id);
  }, []);

  // inactivity timeout
  useEffect(() => {
    if (!token) return undefined;

    const resetTimer = () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => setSessionExpired(true), INACTIVITY_LIMIT_MS);
    };

    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, resetTimer));
    resetTimer();

    return () => {
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, resetTimer));
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [token]);

  const value = {
    user,
    token,
    isAuthenticated: Boolean(token && user),
    login,
    logout,
    updateUser,
    sessionExpired,
    acknowledgeSessionExpired,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
