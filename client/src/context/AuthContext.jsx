import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import api, { onUnauthorized, setAuthToken } from "../api/client";

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
const removeSaved = () => {
  try {
    for (const store of [localStorage, sessionStorage]) {
      store.removeItem("ghm_token");
      store.removeItem("ghm_user");
    }
  } catch {
    // storage unavailable (private mode) - nothing saved to remove
  }
};

// When the JWT stops being accepted, in ms since the epoch (from its `exp`
// claim). null when the token can't be read - such a token is unusable.
function tokenExpiresAt(token) {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const { exp } = JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), "=")));
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

// A saved session is restored only if its token is still valid. "Remember
// me" keeps it across browser restarts, but the token itself expires
// (JWT_EXPIRES_IN on the server); restoring an expired one made every page
// fire requests that came back 401. It's dropped here instead, so the user
// simply lands on the login page.
function restoreSession() {
  const token = read("ghm_token");
  let user = null;
  try {
    user = JSON.parse(read("ghm_user") || "null");
  } catch {
    user = null;
  }
  const expiresAt = token ? tokenExpiresAt(token) : null;
  if (!token || !user || !expiresAt || expiresAt <= Date.now()) {
    if (token || user) removeSaved();
    return { token: null, user: null };
  }
  return { token, user };
}

// Longest delay setTimeout supports (~24.8 days).
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

const storeFor = () => {
  try {
    return localStorage.getItem("ghm_token") ? localStorage : sessionStorage;
  } catch {
    return sessionStorage;
  }
};

export function AuthProvider({ children }) {
  const [initial] = useState(() => {
    const session = restoreSession();
    // Hand the token to the API client before the first render, so the
    // first requests pages send after a refresh carry it.
    setAuthToken(session.token);
    return session;
  });
  const [user, setUser] = useState(initial.user);
  const [token, setToken] = useState(initial.token);
  // null, or why the session ended: "inactivity", "expired" or "invalid".
  const [sessionExpiredReason, setSessionExpiredReason] = useState(null);
  const idleTimer = useRef(null);

  // The API client is updated synchronously wherever the token changes
  // (restore above, login, clearSession) - never in an effect. Page effects
  // run before this provider's effects, so setting it in an effect sent the
  // first requests after login without a token: 401 on /products,
  // /categories and /products/filter-options, then "Session Expired".
  const clearSession = useCallback(() => {
    removeSaved();
    setToken(null);
    setUser(null);
    setAuthToken(null);
  }, []);

  // `identifier` is an email address or a username.
  const login = useCallback(async (identifier, password, remember = true) => {
    const { data } = await api.post("/auth/login", { email: identifier, password });
    setAuthToken(data.token);
    setSessionExpiredReason(null);
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
    setSessionExpiredReason(null);
  }, [clearSession]);

  // The first reason wins: once the modal is up, later 401s don't change it.
  const expireSession = useCallback((reason) => {
    setSessionExpiredReason((current) => current || reason);
  }, []);

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

  // The server rejected the current token (expired, signed with another
  // JWT_SECRET, or the account was deactivated) -> session-expired modal.
  // 403 is a permission problem, not a session problem, and never signs out.
  useEffect(() => onUnauthorized(expireSession), [expireSession]);

  // Show the modal the moment the token expires, rather than waiting for the
  // next request to fail.
  useEffect(() => {
    if (!token) return undefined;
    const expiresAt = tokenExpiresAt(token);
    if (!expiresAt) return undefined;
    const id = setTimeout(() => expireSession("expired"), Math.min(Math.max(expiresAt - Date.now(), 0), MAX_TIMEOUT_MS));
    return () => clearTimeout(id);
  }, [token, expireSession]);

  // inactivity timeout
  useEffect(() => {
    if (!token) return undefined;

    const resetTimer = () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => expireSession("inactivity"), INACTIVITY_LIMIT_MS);
    };

    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, resetTimer));
    resetTimer();

    return () => {
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, resetTimer));
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [token, expireSession]);

  const value = {
    user,
    token,
    isAuthenticated: Boolean(token && user),
    login,
    logout,
    updateUser,
    sessionExpired: Boolean(sessionExpiredReason),
    sessionExpiredReason,
    acknowledgeSessionExpired,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
