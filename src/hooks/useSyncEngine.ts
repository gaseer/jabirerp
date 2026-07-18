import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SYNC_DONE_EVENT, sync } from "@/repo/SupabaseSync";
import { useAuth } from "@/store/auth";

/** Background sync every minute while the app is open and online. */
const SYNC_INTERVAL_MS = 60_000;

/**
 * Drives background sync for the session:
 *  - runs once on mount (catch up on login),
 *  - flushes on reconnect (the `online` event),
 *  - re-syncs when the PWA returns to the foreground (visibilitychange),
 *  - polls every minute while online (multi-device catch-up),
 *  - exposes syncNow() for manual triggers.
 * Query invalidation listens to SYNC_DONE_EVENT, so even fire-and-forget
 * sync.sync() calls after writes refresh every open page.
 */
export function useSyncEngine() {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const [syncing, setSyncing] = useState(false);
  const [last, setLast] = useState<{ pushed: number; pulled: number } | null>(null);

  const syncNow = useCallback(async () => {
    if (!user || !navigator.onLine) return;
    setSyncing(true);
    try {
      const res = await sync.sync();
      setLast(res);
      return res;
    } finally {
      setSyncing(false);
    }
  }, [user]);

  // Any completed sync (from anywhere) that moved rows refreshes all queries.
  useEffect(() => {
    const onSynced = (e: Event) => {
      const detail = (e as CustomEvent<{ pushed: number; pulled: number }>).detail;
      if (detail?.pushed || detail?.pulled) qc.invalidateQueries();
    };
    window.addEventListener(SYNC_DONE_EVENT, onSynced);
    return () => window.removeEventListener(SYNC_DONE_EVENT, onSynced);
  }, [qc]);

  useEffect(() => {
    if (!user) return;
    syncNow();

    const onOnline = () => syncNow();
    const onVisible = () => {
      if (document.visibilityState === "visible") syncNow();
    };
    const interval = setInterval(() => syncNow(), SYNC_INTERVAL_MS);

    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(interval);
    };
  }, [user, syncNow]);

  return { syncNow, syncing, last };
}
