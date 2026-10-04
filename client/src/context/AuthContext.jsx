import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import api, { setAuthToken } from "../api/client";

const AuthContext = createContext(null);

const INACTIVITY_LIMIT_MS = 20 * 60 * 1000; // 20 minutes, see Read Me sheet assumption
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];

// "Remember me" keeps the session in localStorage (survives closing the
// browser); otherwise it lives in sessionStorage and ends with the browser
// session. Reads check both, so either kind of sign-in is picked up.
const read = (key) => {
  try {
    return localStorage.getItem(key) ?? sessionStorage.getItem(key);
  } catch {
    return null;
  }
};
const storeFor = () => {
  try {
    return localStorage.getItem("ghm_token") ? localStorage : sessionStorage;
  } catch {
    return sessionStorage;
  }
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const stored = read("ghm_user");
    return stored ? JSON.parse(stored) : null;
  });
  // Attach the saved token before the first render: page effects run before
  // this provider's effects, so relying only on the effect below sent the
  // first requests after a page refresh without it (401s, empty pages).
  const [token, setToken] = useState(() => {
    const saved = read("ghm_token");
    setAuthToken(saved);
    return saved;
  });
  const [sessionExpired, setSessionExpired] = useState(false);
  const idleTimer = useRef(null);

  useEffect(() => {
    setAuthToken(token);
  }, [token]);

  const clearSession = useCallback(() => {
    for (const store of [localStorage, sessionStorage]) {
      store.removeItem("ghm_token");
      store.removeItem("ghm_user");
    }
    setToken(null);
    setUser(null);
    setAuthToken(null);
  }, []);

  // `identifier` is an email address or a username.
  const login = useCallback(async (identifier, password, remember = true) => {
    const { data } = await api.post("/auth/login", { email: identifier, password });
    const store = remember ? localStorage : sessionStorage;
    (remember ? sessionStorage : localStorage).removeItem("ghm_token");
    (remember ? sessionStorage : localStorage).removeItem("ghm_user");
    store.setItem("ghm_token", data.token);
    store.setItem("ghm_user", JSON.stringify(data.user));
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
      storeFor().setItem("ghm_user", JSON.stringify(next));
      return next;
    });
  }, []);

  const acknowledgeSessionExpired = useCallback(() => {
    clearSession();
    setSessionExpired(false);
  }, [clearSession]);

  // Name, email, role and permissions can be changed by an Admin while this
  // user is signed in - re-read them from the server once per page load.
  useEffect(() => {
    if (!token) return;
    api
      .get("/auth/me")
      .then(({ data }) =>
        updateUser({ username: data.username, email: data.email, role: data.role, permissions: data.permissions || [] })
      )
      .catch(() => {});
  }, [token, updateUser]);

  // 401 from any request (deactivated account, invalid/expired token) -> session-expired modal
  useEffect(() => {
    const id = api.interceptors.response.use(
      (res) => res,
      (err) => {
        if (err.response && err.response.status === 401 && read("ghm_token")) {
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
