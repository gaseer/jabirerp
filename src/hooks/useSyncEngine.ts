import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { sync } from "@/repo/SupabaseSync";
import { useAuth } from "@/store/auth";

/**
 * Drives background sync for the session:
 *  - runs once on mount (catch up on login),
 *  - flushes on reconnect (the `online` event),
 *  - exposes syncNow() for manual/after-write triggers.
 * After any sync it invalidates queries so pulled rows show immediately.
 */
export function useSyncEngine() {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const [syncing, setSyncing] = useState(false);
  const [last, setLast] = useState<{ pushed: number; pulled: number } | null>(null);

  const syncNow = useCallback(async () => {
    if (!user) return;
    setSyncing(true);
    try {
      const res = await sync.sync();
      setLast(res);
      if (res.pushed || res.pulled) {
        qc.invalidateQueries();
      }
      return res;
    } finally {
      setSyncing(false);
    }
  }, [qc, user]);

  useEffect(() => {
    if (!user) return;
    syncNow();
    const onOnline = () => syncNow();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [user, syncNow]);

  return { syncNow, syncing, last };
}
