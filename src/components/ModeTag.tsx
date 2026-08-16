import type { TxnMode } from "@/lib/db";
import { cn } from "@/lib/utils";

/** Small Cash/Bank pill shown next to money rows. */
export function ModeTag({ mode }: { mode: TxnMode }) {
  return (
    <span
      className={cn(
        "label rounded-sm px-1.5 py-0.5 text-[9.5px]",
        mode === "bank" ? "bg-bank-soft text-bank" : "bg-cash-soft text-cash",
      )}
    >
      {mode === "bank" ? "Bank" : "Cash"}
    </span>
  );
}
