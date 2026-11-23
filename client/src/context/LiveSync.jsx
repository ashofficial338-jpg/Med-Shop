import { createContext, useContext, useEffect, useRef } from "react";
import { API_URL } from "../api/client";
import { useAuth } from "./AuthContext";

// Live updates. While signed in, one connection stays open to the server's
// change stream (GET /api/events - see server/src/utils/liveEvents.js). When
// anyone saves a change, screens showing that kind of data reload it by
// themselves:
//
//   useLiveRefresh(["products"], () => reloadMyList());
//
// Topics: products, categories, racks, stock, sales, sales-entries,
// purchases, customers, vendors, expenses, daybook, users.
// After a dropped connection, or when a tab comes back after a while in the
// background, every screen reloads once, so nothing missed meanwhile is lost.
// fetch() is used rather than EventSource so the login token travels in a
// header, never in the URL.

const LiveSyncContext = createContext(null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function LiveSyncProvider({ children }) {
  const { token } = useAuth();
  const listeners = useRef(new Set());

  useEffect(() => {
    if (!token) return undefined;
    const ctrl = new AbortController();
    let stopped = false;
    let connectedBefore = false;
    let hiddenAt = null;

    const emit = (evt) => {
      for (const l of listeners.current) {
        if (!evt.topics || l.topics.some((t) => evt.topics.includes(t))) l.fire(evt);
      }
    };

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
        // (Re)connected: after a gap, everything may be out of date.
        if (connectedBefore) emit({ topics: null, catchUp: true });
        connectedBefore = true;
        return;
      }
      emit(evt);
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
        // Server restarting/asleep (Render) or network blip: try again soon.
        attempt += 1;
        await sleep(Math.min(30_000, 2_000 * attempt));
      }
    })();

    const onVisibility = () => {
      if (document.hidden) hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > 60_000) emit({ topics: null, catchUp: true });
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stopped = true;
      ctrl.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [token]);

  return <LiveSyncContext.Provider value={listeners}>{children}</LiveSyncContext.Provider>;
}

// Calls `onChange(event)` when data of one of `topics` changes anywhere.
// Bursts (e.g. a purchase touching many products) are merged into one call.
export function useLiveRefresh(topics, onChange) {
  const listeners = useContext(LiveSyncContext);
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
