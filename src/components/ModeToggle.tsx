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
  const seg = (value: TxnMode, label: string, activeCls: string) => (
    <button
      type="button"
      onClick={() => onChange(value)}
      className={cn(
        "label flex-1 rounded-sm py-2.5",
        mode === value ? `${activeCls} text-white` : "bg-border/40 text-muted",
      )}
    >
      {label}
    </button>
  );
  return (
    <div className="flex gap-2">
      {seg("cash", "Cash", "bg-cash")}
      {seg("bank", "Bank", "bg-bank")}
    </div>
  );
}
