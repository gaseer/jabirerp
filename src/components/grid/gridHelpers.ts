import { formatPaise, toPaise } from "@/lib/money";
import type { GridRow } from "./SheetGrid";

/** Cash/Bank options for a `select` grid column. */
export const MODE_OPTIONS = [
  { value: "cash", label: "Cash" },
  { value: "bank", label: "Bank" },
];

/** Running total (formatted ₹) of a rupee-typed column across rows. */
export function sumRupeeColumn(rows: GridRow[], key: string): string {
  const paise = rows.reduce((sum, r) => sum + toPaise(r[key] ?? ""), 0);
  return formatPaise(paise);
}
