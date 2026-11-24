import { createContext, useContext, useEffect, useRef, useState } from "react";
import { API_URL, onMutation } from "../api/client";
import { useAuth } from "./AuthContext";

// Live updates. Screens subscribe with
//
//   useLiveRefresh(["sales"], () => reloadMyData());
//
// and reload whenever that kind of data changes. Changes arrive four ways,
// so a screen is never left stale:
//  1. The server's change stream (GET /api/events - server/src/utils/
//     liveEvents.js): saves by anyone, on any device.
//  2. Saves made in this browser: announced at once to this tab and every
//     other open tab (BroadcastChannel), without waiting for the server.
//  3. Coming back to the tab / window: every screen reloads.
//  4. While the change stream is down (server asleep or restarting on Render,
//     network blip): every screen reloads every 30 seconds until it's back.
// fetch() is used rather than EventSource so the login token travels in a
// header, never in the URL.
//
// Topics: products, categories, racks, stock, sales, purchases, customers, vendors, expenses, daybook, users.

// What a change to /api/<resource> affects - same as the server's list.
const TOPICS = {
  products: ["products"],
  categories: ["categories", "products"],
  racks: ["racks", "products"],
  "stock-ledger": ["stock", "products"],
  sales: ["sales", "products", "stock", "customers", "daybook"],
  purchases: ["purchases", "products", "stock", "vendors", "daybook"],
  customers: ["customers", "sales", "daybook"],
  vendors: ["vendors", "products", "purchases", "daybook"],
  expenses: ["expenses", "daybook"],
  "day-book": ["daybook"],
  users: ["users"],
};

const LiveSyncContext = createContext(null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const POLL_MS = 30_000;

export function LiveSyncProvider({ children }) {
  const { token } = useAuth();
  const listeners = useRef(new Set());
  const [connected, setConnected] = useState(false);

  // Hands an event to every screen listening for one of its topics
  // (topics: null = everything).
  const emitRef = useRef((evt) => {
    for (const l of listeners.current) {
      if (!evt.topics || l.topics.some((t) => evt.topics.includes(t))) l.fire(evt);
    }
  });

  // 2. Saves made in this browser (this tab + other tabs).
  useEffect(() => {
    const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("ghm-live") : null;
    if (channel) channel.onmessage = (m) => emitRef.current(m.data);
    const off = onMutation((url) => {
      const [resource, id] = String(url || "").split("?")[0].replace(/^\/+/, "").split("/");
      const topics = TOPICS[resource];
      if (!topics) return;
      const evt = { topics, resource, id: /^[0-9a-f]{24}$/i.test(id || "") ? id : null, local: true };
      emitRef.current(evt);
      channel?.postMessage(evt);
    });
    return () => {
      off();
      channel?.close();
    };
  }, []);

  // 1. The server's change stream.
  useEffect(() => {
    if (!token) return undefined;
    const ctrl = new AbortController();
    let stopped = false;
    let connectedBefore = false;

    const handle = (raw) => {
      const data = raw
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data) return;
      let evt;
      try {
        evt = JSON.parse(data);
      } catch {
        return;
      }
      if (evt.hello) {
        setConnected(true);
        // (Re)connected: after a gap, everything may be out of date.
        if (connectedBefore) emitRef.current({ topics: null, catchUp: true });
        connectedBefore = true;
        return;
      }
      emitRef.current(evt);
    };

    (async () => {
      let attempt = 0;
      while (!stopped) {
        try {
          const res = await fetch(`${API_URL}/events`, {
            headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
            cache: "no-store",
            signal: ctrl.signal,
          });
          if (res.status === 401) return; // session over - AuthContext handles it
          if (!res.ok || !res.body) throw new Error(`events ${res.status}`);
          attempt = 0;
          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
          let buf = "";
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += value.replace(/\r\n/g, "\n");
            let i;
            while ((i = buf.indexOf("\n\n")) >= 0) {
              handle(buf.slice(0, i));
              buf = buf.slice(i + 2);
            }
          }
        } catch {
          if (stopped) return;
        }
        setConnected(false);
        // Server restarting/asleep (Render) or network blip: try again soon.
        attempt += 1;
        await sleep(Math.min(30_000, 2_000 * attempt));
      }
    })();

    return () => {
      stopped = true;
      ctrl.abort();
      setConnected(false);
    };
  }, [token]);

  // 3. Back to this tab/window: reload (at most every 5 seconds).
  useEffect(() => {
    if (!token) return undefined;
    let last = Date.now();
    const catchUp = () => {
      if (document.hidden || Date.now() - last < 5_000) return;
      last = Date.now();
      emitRef.current({ topics: null, catchUp: true });
    };
    document.addEventListener("visibilitychange", catchUp);
    window.addEventListener("focus", catchUp);
    return () => {
      document.removeEventListener("visibilitychange", catchUp);
      window.removeEventListener("focus", catchUp);
    };
  }, [token]);

  // 4. Change stream down: reload every 30 seconds while the tab is visible.
  useEffect(() => {
    if (!token || connected) return undefined;
    const t = setInterval(() => {
      if (!document.hidden) emitRef.current({ topics: null, catchUp: true });
    }, POLL_MS);
    return () => clearInterval(t);
  }, [token, connected]);

  return <LiveSyncContext.Provider value={{ listeners, connected }}>{children}</LiveSyncContext.Provider>;
}

// Calls `onChange(event)` when data of one of `topics` changes anywhere.
// Bursts (e.g. a purchase touching many products) are merged into one call.
export function useLiveRefresh(topics, onChange) {
  const ctx = useContext(LiveSyncContext);
  const listeners = ctx?.listeners;
  const fn = useRef(onChange);
  useEffect(() => {
    fn.current = onChange;
  });
  const key = topics.join(",");

  useEffect(() => {
    if (!listeners) return undefined;
    let timer = null;
    let last = null;
    const listener = {
      topics: key.split(","),
      fire: (evt) => {
        last = evt;
        clearTimeout(timer);
        timer = setTimeout(() => fn.current?.(last), 300);
      },
    };
    listeners.current.add(listener);
    return () => {
      clearTimeout(timer);
      listeners.current.delete(listener);
    };
  }, [listeners, key]);
}

// true while the server's change stream is connected.
export function useLiveConnected() {
  return Boolean(useContext(LiveSyncContext)?.connected);
}
