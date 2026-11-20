import api from "./client";

// Homepage shop window: categories, featured products and best sellers.
// Requests are `silent` (no staff "server waking" banner on the public site)
// and retried here instead, so a sleeping backend still fills the page.
export async function getShowcase() {
  const deadline = Date.now() + 90_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const { data } = await api.get("/public/showcase", { silent: true, timeout: 30_000 });
      return data;
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      if (status && ![502, 503, 504].includes(status)) break;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw lastError;
}
