import type { ReactNode } from "react";
import { useAuth } from "@/store/auth";
import { BrandMark } from "@/components/BrandMark";
import { SyncPill } from "@/components/SyncPill";

/**
 * Minimal shell for a worker session — no site/ledger/shop/report nav, just
 * enough chrome to show who's signed in, sync status, and Logout. WorkerHome
 * is a single page with its own internal tabs, so there's no router here.
 */
export function WorkerShell({ children }: { children: ReactNode }) {
  const signOut = useAuth((s) => s.signOut);
  const name =
    (useAuth((s) => s.user?.user_metadata?.display_name) as string | undefined) ?? "Worker";

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 bg-bus px-4 py-2.5">
        <BrandMark size="sm" tone="light" />
        <div className="flex items-center gap-2">
          <SyncPill />
          <button
            onClick={signOut}
            className="label rounded-sm px-2.5 py-1.5 text-bus-ink transition-colors hover:bg-white/10 hover:text-white"
          >
            Log out
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[920px] flex-1 p-4 md:px-6 md:py-6">
        <div className="busbar mb-5">
          <div className="tap">
            <div className="label">Signed in</div>
            <h2 className="mt-1 font-cond text-2xl font-bold uppercase tracking-tight text-bus">
              {name}
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              Attendance, payments and settlement
            </p>
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
