import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "@/store/auth";
import { BrandMark } from "@/components/BrandMark";
import { Icon, type IconName } from "@/components/Icon";
import { SyncPill } from "@/components/SyncPill";
import { cn } from "@/lib/utils";

/**
 * The chrome is the enclosure: navy on every edge (sidebar on desktop, header
 * + bottom bar on mobile), with the work itself on the pale board inside it.
 * Content pops, navigation recedes — which is the right hierarchy for a tool
 * used one-handed in the sun.
 */
const NAV: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: "/", label: "Home", icon: "home", end: true },
  { to: "/sites", label: "Sites", icon: "sites" },
  { to: "/workers", label: "Workers", icon: "workers" },
  { to: "/ledger", label: "Ledger", icon: "ledger" },
  { to: "/shops", label: "Shops", icon: "shops" },
  { to: "/reports", label: "P&L", icon: "pnl" },
];

const SETTINGS: (typeof NAV)[number] = {
  to: "/settings",
  label: "Settings",
  icon: "settings",
};

export function AppShell() {
  const signOut = useAuth((s) => s.signOut);
  const email = useAuth((s) => s.user?.email);

  return (
    <div className="flex min-h-full">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-[232px] shrink-0 flex-col bg-bus px-3 py-4 md:flex">
        <BrandMark tone="light" className="mb-7 px-2" />
        <nav className="flex flex-col gap-0.5">
          {[...NAV, SETTINGS].map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cn(
                  // The active item taps off the chrome edge with a live-blue
                  // stub — the same busbar language as the content column.
                  "label relative flex items-center gap-3 rounded-sm py-2.5 pl-4 pr-3 text-[12px] transition-colors",
                  "before:absolute before:left-0 before:top-1/2 before:h-4 before:w-[3px] before:-translate-y-1/2 before:bg-primary before:opacity-0",
                  isActive
                    ? "bg-white/[0.07] text-white before:opacity-100"
                    : "text-bus-ink hover:bg-white/[0.05] hover:text-white",
                )
              }
            >
              <Icon name={n.icon} />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto space-y-2 border-t border-white/10 pt-4">
          <div className="truncate px-1 text-xs text-bus-ink">{email}</div>
          <button
            onClick={signOut}
            className="label px-1 text-bus-ink transition-colors hover:text-white"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col pb-[calc(66px+env(safe-area-inset-bottom))] md:pb-0">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 bg-bus px-4 py-2.5 md:bg-bg/90 md:py-3 md:backdrop-blur">
          <BrandMark size="sm" tone="light" className="md:hidden" />
          <div className="hidden md:block" />
          <div className="flex items-center gap-2">
            <NavLink
              to="/settings"
              aria-label="Settings"
              className={({ isActive }) =>
                cn(
                  "grid h-9 w-9 place-items-center rounded-sm md:hidden",
                  isActive ? "bg-white/15 text-white" : "text-bus-ink hover:bg-white/10",
                )
              }
            >
              <Icon name="settings" />
            </NavLink>
            {/* On the light desktop header the chip needs the navy ground it
                was drawn for, so it keeps its own dark plate there. */}
            <SyncPill className="md:rounded-sm md:bg-bus md:px-3 md:py-2" />
          </div>
        </header>

        <main className="mx-auto w-full max-w-[920px] flex-1 p-4 md:px-6 md:py-6">
          <Outlet />
        </main>
      </div>

      {/* Bottom nav (mobile) */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 bg-bus pb-[env(safe-area-inset-bottom)] md:hidden">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              cn(
                "label relative flex flex-col items-center gap-1 py-2.5 text-[9.5px]",
                "before:absolute before:inset-x-3 before:top-0 before:h-[3px] before:bg-primary before:opacity-0",
                isActive ? "text-white before:opacity-100" : "text-bus-ink",
              )
            }
          >
            <Icon name={n.icon} />
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
