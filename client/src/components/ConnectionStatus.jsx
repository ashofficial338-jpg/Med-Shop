import { useEffect, useRef, useSyncExternalStore } from "react";
import { getConnection, pingServer, resetConnection, subscribeConnection } from "../api/client";

const KEEP_AWAKE_MS = 10 * 60 * 1000; // Render sleeps the backend after 15 idle minutes
const RECHECK_MS = 5000;

// Tells the user when data is slow or failed to load, and recovers by itself:
// `onReload` re-mounts the current page so it fetches its data again - no
// browser refresh. Also keeps the backend awake while the app is open.
export default function ConnectionStatus({ onReload }) {
  const status = useSyncExternalStore(subscribeConnection, getConnection);
  const reload = useRef(onReload);
  useEffect(() => {
    reload.current = onReload;
  }, [onReload]);

  // Wake the server as soon as the app opens (even on the login page), then
  // ping it every 10 minutes while this tab is visible so it stays awake.
  useEffect(() => {
    const ping = () => {
      if (document.visibilityState === "visible") pingServer().catch(() => {});
    };
    ping();
    const id = setInterval(ping, KEEP_AWAKE_MS);
    document.addEventListener("visibilitychange", ping);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", ping);
    };
  }, []);

  // After a load gave up, keep checking; reload the page data once the server
  // answers again.
  useEffect(() => {
    if (status !== "failed") return undefined;
    let stopped = false;
    const id = setInterval(() => {
      pingServer()
        .then(() => {
          if (stopped) return;
          resetConnection();
          reload.current();
        })
        .catch(() => {});
    }, RECHECK_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [status]);

  if (status === "ok") return null;

  const retry = () => {
    resetConnection();
    onReload();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="slide-up fixed inset-x-0 bottom-4 z-[70] mx-auto flex w-fit max-w-[calc(100vw-2rem)] items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-text shadow-xl"
    >
      {status === "waking" ? (
        <>
          <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span>Connecting to the server… this page will load by itself in a moment.</span>
        </>
      ) : (
        <>
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-danger" />
          <span>Couldn&apos;t load data from the server. Retrying automatically…</span>
          <button
            onClick={retry}
            className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark"
          >
            Retry now
          </button>
        </>
      )}
    </div>
  );
}
