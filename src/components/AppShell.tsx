import { NavLink, Outlet } from "react-router-dom";
import { useOnline } from "@/hooks/useOnline";
import { useSyncEngine } from "@/hooks/useSyncEngine";
import { useAuth } from "@/store/auth";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Home", icon: "🏠", end: true },
  { to: "/sites", label: "Sites", icon: "📍" },
  { to: "/workers", label: "Workers", icon: "👷" },
  { to: "/ledger", label: "Ledger", icon: "📒" },
  { to: "/shops", label: "Shops", icon: "🏪" },
];

export function AppShell() {
  const online = useOnline();
  const { syncNow, syncing } = useSyncEngine();
  const signOut = useAuth((s) => s.signOut);
  const email = useAuth((s) => s.user?.email);

  return (
    <div className="flex min-h-full">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-[220px] shrink-0 flex-col border-r border-border bg-surface p-4 md:flex">
        <div className="mb-6 flex items-center gap-2 px-1">
          <span className="text-xl">⚡</span>
          <span className="text-lg font-bold">Power Plus</span>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-sm px-3 py-2 font-medium",
                  isActive ? "bg-primary-soft text-primary" : "text-text hover:bg-border/40",
                )
              }
            >
              <span>{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto space-y-2 pt-4 text-xs text-muted">
          <div className="truncate">{email}</div>
          <button onClick={signOut} className="text-primary hover:underline">
            Sign out
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col pb-[calc(64px+env(safe-area-inset-bottom))] md:pb-0">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-bg/85 px-4 py-3 backdrop-blur">
          <div className="text-lg font-bold md:hidden">Power Plus</div>
          <div className="hidden md:block" />
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
        </header>

        <main className="mx-auto w-full max-w-[920px] flex-1 p-4">
          <Outlet />
        </main>
      </div>

      {/* Bottom nav (mobile) */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              cn(
                "flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium",
                isActive ? "text-primary" : "text-muted",
              )
            }
          >
            <span className="text-lg">{n.icon}</span>
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
