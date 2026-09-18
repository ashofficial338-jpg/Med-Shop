import axios from "axios";

// Same-origin "/api" works when the client is served by the same Express
// process (dev proxy or single combined deploy). When the frontend is
// hosted separately from the backend (e.g. two Render services), set
// VITE_API_URL to the backend's full URL, such as
// "https://med-shop.onrender.com/api".
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api",
});

export function setAuthToken(token) {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common.Authorization;
  }
}

export default api;
