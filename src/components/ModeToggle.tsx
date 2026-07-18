import type { TxnMode } from "@/lib/db";
import { cn } from "@/lib/utils";

/** Cash/Bank segmented control used by every money form. */
export function ModeToggle({
  mode,
  onChange,
}: {
  mode: TxnMode;
  onChange: (mode: TxnMode) => void;
}) {
  const seg = (value: TxnMode, label: string) => (
    <button
      type="button"
      onClick={() => onChange(value)}
      className={cn(
        "flex-1 rounded-sm py-2 text-sm font-semibold",
        mode === value ? "bg-primary text-white" : "bg-border/40 text-muted",
      )}
    >
      {label}
    </button>
  );
  return (
    <div className="flex gap-2">
      {seg("cash", "💵 Cash")}
      {seg("bank", "🏦 Bank")}
    </div>
  );
}
