import type { ReactNode } from "react";
import { useOnline } from "@/hooks/useOnline";
import { useSyncEngine } from "@/hooks/useSyncEngine";
import { useAuth } from "@/store/auth";
import { BrandMark } from "@/components/BrandMark";
import { cn } from "@/lib/utils";

/**
 * Minimal shell for a worker session — no site/ledger/shop/report nav, just
 * enough chrome to show who's signed in, sync status, and Logout. WorkerHome
 * is a single page with its own internal tabs, so there's no router here.
 */
export function WorkerShell({ children }: { children: ReactNode }) {
  const online = useOnline();
  const { syncNow, syncing } = useSyncEngine();
  const signOut = useAuth((s) => s.signOut);
  const name =
    (useAuth((s) => s.user?.user_metadata?.display_name) as string | undefined) ?? "Worker";

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-bg/85 px-4 py-3 backdrop-blur">
        <BrandMark size="sm" />
        <div className="flex items-center gap-2">
          <button
            onClick={() => online && syncNow()}
            disabled={!online || syncing}
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-semibold",
              online ? "bg-green-soft text-green" : "bg-amber-soft text-amber",
            )}
          >
            {syncing ? "⟳ Syncing…" : online ? "● Online · Sync" : "● Offline"}
          </button>
          <button onClick={signOut} className="text-sm text-primary hover:underline">
            Logout
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[920px] flex-1 p-4">
        <div className="mb-3">
          <h2 className="text-xl font-bold">Hi, {name}</h2>
          <p className="text-sm text-muted">Your attendance, payments & settlement</p>
        </div>
        {children}
      </main>
    </div>
  );
}
