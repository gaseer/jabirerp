import { useOnline } from "@/hooks/useOnline";
import { useSyncEngine } from "@/hooks/useSyncEngine";
import { cn } from "@/lib/utils";

/**
 * Connection + sync control, shared by both shells. It sits on the navy chrome,
 * so it is an outlined chip rather than a soft-tinted pill — a filled pastel
 * pill disappears against navy.
 *
 * The label names the state, and the button names what tapping does: online it
 * says "Sync", because that is what happens.
 */
export function SyncPill({ className }: { className?: string }) {
  const online = useOnline();
  const { syncNow, syncing } = useSyncEngine();

  const state = syncing ? "Syncing" : online ? "Sync" : "Offline";

  return (
    <button
      type="button"
      onClick={() => online && syncNow()}
      disabled={!online || syncing}
      title={online ? "Push local changes and pull updates" : "Changes are saved locally"}
      className={cn(
        "label flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 transition-colors",
        "border-white/25 text-white hover:bg-white/10 disabled:hover:bg-transparent",
        !online && "border-amber-on/40 text-amber-on",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          syncing ? "bg-white" : online ? "bg-green-on" : "bg-amber-on",
        )}
      />
      {state}
    </button>
  );
}
