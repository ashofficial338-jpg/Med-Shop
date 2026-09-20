import axios from "axios";

// Same-origin "/api" works when the client is served by the same Express
// process (dev proxy or single combined deploy). When the frontend is
// hosted separately from the backend (e.g. two Render services), set
// VITE_API_URL to the backend's full URL, such as
// "https://med-shop-api.onrender.com/api".
const API_URL = import.meta.env.VITE_API_URL || "/api";
// Same origin as the API, without the "/api" suffix - product images fall
// back to a server-relative "/uploads/xxx.jpg" path (see server/src/middleware/upload.js)
// when Cloudinary isn't configured, and that path needs to resolve against
// the API's host, not the frontend's, once the two are on separate origins.
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

// Resolves an image path returned by the API (a full Cloudinary URL, or a
// server-relative "/uploads/..." path) into something an <img> tag can load
// regardless of whether the frontend and API share an origin.
export function resolveAssetUrl(pathOrUrl) {
  if (!pathOrUrl) return pathOrUrl;
  // Already absolute (Cloudinary URL, or a local blob:/data: preview URL from
  // a freshly picked file that hasn't been uploaded yet) - use as-is.
  if (/^[a-z][a-z0-9+.-]*:/i.test(pathOrUrl)) return pathOrUrl;
  return `${API_ORIGIN}${pathOrUrl}`;
}

export default api;
