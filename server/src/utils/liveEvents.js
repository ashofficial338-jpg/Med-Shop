import { requireAuth } from "../middleware/auth.js";

// Live updates: every signed-in screen keeps one connection open to
// GET /api/events (Server-Sent Events). Whenever any request changes data -
// a product added/edited, a sale, purchase or Sales Entry saved, stock moved -
// a short notice goes to everyone, e.g.
//   { topics: ["purchases", "products"], resource: "purchases", id: "...", by: "<user id>" }
// and each open screen reloads what it shows (client/src/context/LiveSync.jsx).
// Notices carry no record data, only what changed, so nothing is exposed.
//
// Runs in this process: with one backend instance (Render) every user is
// connected here. The client also reloads after reconnecting, so a notice
// missed while offline is caught up.

const clients = new Set();

// What a change to /api/<resource> can affect. Sales, purchases and stock
// changes move product stock; a Sales Entry or purchase can add products.
const TOPICS = {
  products: ["products"],
  categories: ["categories", "products"],
  racks: ["racks", "products"],
  "stock-ledger": ["stock", "products"],
  sales: ["sales", "products", "customers"],
  "sales-entries": ["sales-entries", "products"],
  purchases: ["purchases", "products", "vendors"],
  customers: ["customers"],
  vendors: ["vendors", "products"],
  expenses: ["expenses"],
  "day-book": ["daybook"],
  users: ["users"],
};

export function publish(event) {
  const line = `data: ${JSON.stringify({ ...event, at: Date.now() })}\n\n`;
  for (const c of clients) {
    try {
      c.res.write(line);
    } catch {
      clients.delete(c);
    }
  }
}

// After every successful change (POST/PUT/PATCH/DELETE answered < 400),
// tell everyone which kind of data changed. Mounted on /api before the routes.
export function announceChanges(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  res.on("finish", () => {
    if (res.statusCode >= 400) return;
    const [resource, id] = req.originalUrl.split("?")[0].replace(/^\/api\/?/, "").split("/");
    const topics = TOPICS[resource];
    if (!topics) return; // sign-in, profile, saver bookkeeping, ...
    publish({ topics, resource, id: /^[0-9a-f]{24}$/i.test(id || "") ? id : null, by: req.user?._id ? String(req.user._id) : null });
  });
  next();
}

export const eventsRoute = [
  requireAuth,
  (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // no proxy buffering
    });
    res.write(`retry: 5000\ndata: ${JSON.stringify({ hello: true })}\n\n`);
    const client = { res, user: String(req.user._id) };
    clients.add(client);
    // Comments every 25s keep proxies (Render) from closing an idle stream.
    const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
    req.on("close", () => {
      clearInterval(ping);
      clients.delete(client);
    });
  },
];
