import axios from "axios";

// The backend is deployed separately; VITE_API_URL is its public URL + "/api"
// and is baked in at build time. If a production build is made without it,
// fall back to the live Render backend (as before). In local dev, "/api" is
// always used and Vite's proxy forwards it to VITE_API_URL (or localhost:5000),
// so the app also works when opened via the LAN IP without any CORS setup.
export const API_URL = import.meta.env.DEV
  ? "/api"
  : import.meta.env.VITE_API_URL || "https://med-shop-3.onrender.com/api";

const API_ORIGIN = API_URL.replace(/\/api\/?$/, "");

const api = axios.create({
  baseURL: API_URL,
});

// The signed-in user's JWT. It lives here, in the module, and is attached by
// a request interceptor at the moment each request is sent - so it's on the
// very first request after login or a page refresh, no matter which
// component's effects run first. AuthContext is the only writer.
let authToken = null;

export function setAuthToken(token) {
  authToken = token || null;
}

// AuthContext registers this to hear about a rejected session (401).
let unauthorizedHandler = null;
export function onUnauthorized(fn) {
  unauthorizedHandler = fn;
  return () => {
    if (unauthorizedHandler === fn) unauthorizedHandler = null;
  };
}

api.interceptors.request.use((config) => {
  // Retries reuse their config, so keep the token they were first sent with.
  if (authToken && !config.headers.has("Authorization")) {
    config.headers.set("Authorization", `Bearer ${authToken}`);
    config.__authToken = authToken;
  }
  return config;
});

// A 401 only ends the session when the request carried the token that is
// current right now. A request sent before login, or one from a session
// that has since been replaced or signed out, can't log the user out - so
// there are no logout loops from stale in-flight requests.
function handleUnauthorized(error) {
  const config = error.config;
  if (error.response?.status !== 401 || !config?.__authToken) return;
  if (config.__authToken !== authToken) return;
  unauthorizedHandler?.(error.response.data?.code === "TOKEN_EXPIRED" ? "expired" : "invalid");
}

// One readable message for any failed request, for toasts and inline errors.
export function getErrorMessage(error, fallback = "Something went wrong. Please try again.") {
  if (axios.isCancel(error)) return "";
  const status = error?.response?.status;
  const serverMessage = error?.response?.data?.message;
  if (serverMessage && typeof serverMessage === "string") return serverMessage;
  if (!error?.response) return "Can't reach the server. Check your connection and try again.";
  if (status === 401) return "Your session has ended. Please sign in again.";
  if (status === 403) return "You do not have permission to perform this action.";
  if (status === 404) return "No records found.";
  if (status >= 500) return "The server ran into a problem. Please try again.";
  return fallback;
}

// Render restarts the backend on every deploy and sleeps it when idle; waking
// it takes 30-60 seconds, during which requests fail (ECONNRESET / 502-504).
// Reads are safe to repeat, so GETs keep retrying for about 90 seconds - long
// enough to outlast a cold start - and the page that asked simply fills in
// when the server answers, with no browser refresh needed.
const RETRY_DELAYS = [1000, 2000, 3000, 4000, ...Array(16).fill(5000)];

// Connection status for the banner in components/ConnectionStatus.jsx:
//   "ok"     - requests are getting through
//   "waking" - a read is being retried while the server comes up
//   "failed" - a read gave up, so the page on screen is missing data
let connection = "ok";
let retrying = 0;
const listeners = new Set();

function setConnection(next) {
  if (connection === next) return;
  connection = next;
  listeners.forEach((fn) => fn());
}

export const getConnection = () => connection;
export function subscribeConnection(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
// Called when the page data is reloaded (by the user or by auto-recovery).
export function resetConnection() {
  setConnection("ok");
}

// A retried request is over (it succeeded or gave up).
function settleRetry(config) {
  if (!config?.__retrying) return;
  config.__retrying = false;
  retrying = Math.max(0, retrying - 1);
}

// Successful saves (any non-GET request), for live updates in this browser -
// see context/LiveSync.jsx. Called with the request's URL, e.g. "/purchases".
const mutationListeners = new Set();
export function onMutation(fn) {
  mutationListeners.add(fn);
  return () => mutationListeners.delete(fn);
}

api.interceptors.response.use(
  (response) => {
    settleRetry(response.config);
    const method = (response.config?.method || "get").toLowerCase();
    if (method !== "get" && method !== "head") {
      for (const fn of mutationListeners) {
        try {
          fn(response.config.url);
        } catch {
          /* a listener's problem never breaks the request */
        }
      }
    }
    // "failed" is cleared by reloading the page data, not by an unrelated
    // request getting through - see ConnectionStatus.
    if (connection === "waking" && retrying === 0) setConnection("ok");
    return response;
  },
  async (error) => {
    handleUnauthorized(error);
    const config = error.config;
    const status = error.response?.status;
    // `silent` requests (health pings) never retry or touch the banner.
    if (!config || config.method !== "get" || config.silent || axios.isCancel(error)) throw error;

    const transient = !error.response || [502, 503, 504].includes(status);
    const attempt = config.__retryCount || 0;
    if (transient && attempt < RETRY_DELAYS.length) {
      config.__retryCount = attempt + 1;
      if (!config.__retrying) {
        config.__retrying = true;
        retrying += 1;
      }
      // One quick retry is invisible; after that, tell the user what's going on.
      if (attempt >= 1 && connection === "ok") setConnection("waking");
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt]));
      return api(config);
    }

    settleRetry(config);
    // Gave up, or the server itself errored: the page is left without its data.
    if (transient || status >= 500) setConnection("failed");
    else if (connection === "waking" && retrying === 0) setConnection("ok");
    throw error;
  }
);

// Cheap unauthenticated request. Used to wake the server early, keep it from
// going back to sleep while the app is open, and detect when it's back.
export function pingServer() {
  return api.get("/health", { silent: true, timeout: 20_000 });
}

export function resolveAssetUrl(pathOrUrl) {
  if (!pathOrUrl) return pathOrUrl;

  if (/^[a-z][a-z0-9+.-]*:/i.test(pathOrUrl)) {
    return pathOrUrl;
  }

  return `${API_ORIGIN}${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;
}

export default api;