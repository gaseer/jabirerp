import type { TxnMode } from "@/lib/db";
import { cn } from "@/lib/utils";

/** Small Cash/Bank pill shown next to money rows. */
export function ModeTag({ mode }: { mode: TxnMode }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] font-semibold",
        mode === "bank" ? "bg-primary-soft text-primary" : "bg-green-soft text-green",
      )}
    >
      {mode === "bank" ? "Bank" : "Cash"}
    </span>
  );
}
