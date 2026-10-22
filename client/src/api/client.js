import axios from "axios";

// The backend is deployed separately; VITE_API_URL is its public URL + "/api"
// and is baked in at build time. If a production build is made without it,
// fall back to the live Render backend (as before). In local dev, "/api" is
// always used and Vite's proxy forwards it to VITE_API_URL (or localhost:5000),
// so the app also works when opened via the LAN IP without any CORS setup.
const API_URL = import.meta.env.DEV
  ? "/api"
  : import.meta.env.VITE_API_URL || "https://med-shop-1-p6h5.onrender.com/api";

const API_ORIGIN = API_URL.replace(/\/api\/?$/, "");

const api = axios.create({
  baseURL: API_URL,
});

// Render restarts the backend on every deploy and sleeps it when idle, which
// drops in-flight requests (ECONNRESET / 502-504). Reads are safe to repeat,
// so retry GETs a few times with backoff before surfacing an error.
const RETRY_DELAYS = [1000, 3000, 6000];

api.interceptors.response.use(undefined, async (error) => {
  const config = error.config;
  const status = error.response?.status;
  const transient = !error.response || [502, 503, 504].includes(status);
  if (!config || config.method !== "get" || !transient) throw error;

  const attempt = config.__retryCount || 0;
  if (attempt >= RETRY_DELAYS.length) throw error;
  config.__retryCount = attempt + 1;
  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt]));
  return api(config);
});

export function setAuthToken(token) {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common.Authorization;
  }
}

export function resolveAssetUrl(pathOrUrl) {
  if (!pathOrUrl) return pathOrUrl;

  if (/^[a-z][a-z0-9+.-]*:/i.test(pathOrUrl)) {
    return pathOrUrl;
  }

  return `${API_ORIGIN}${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;
}

export default api;