import axios from "axios";

// The backend is deployed separately; VITE_API_URL is its public URL + "/api"
// and is baked in at build time. If a production build is made without it,
// fall back to the live Render backend (as before). In local dev, "/api" is
// always used and Vite's proxy forwards it to VITE_API_URL (or localhost:5000),
// so the app also works when opened via the LAN IP without any CORS setup.
const API_URL = import.meta.env.DEV
  ? "/api"
  : import.meta.env.VITE_API_URL || "https://med-backend-2-fiwe.onrender.com/api";

const API_ORIGIN = API_URL.replace(/\/api\/?$/, "");

const api = axios.create({
  baseURL: API_URL,
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