import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { SheetGrid, type ComputedCol, type GridColumn, type GridRow } from "./SheetGrid";

/**
 * Batch-entry spreadsheet: fill several rows, then commit them all at once.
 * Used by the append-only money screens (expenses, advances, shop txns) and by
 * setup screens (workers, shops) — anywhere the user enters many records in a
 * sitting. Existing records keep living in their own list/history below; this
 * grid only creates NEW ones, which preserves the "financial rows are
 * append-only, corrections are new rows" invariant.
 */
export function EntryGrid({
  columns,
  blankRow,
  isRowBlank,
  computed,
  footer,
  commit,
  onCommitted,
  saveLabel = "Save rows",
}: {
  columns: GridColumn[];
  blankRow: GridRow;
  /** A row with nothing worth saving (skipped on commit, e.g. amount empty). */
  isRowBlank: (row: GridRow) => boolean;
  computed?: ComputedCol | ComputedCol[];
  /** Footer summary rendered from the currently-valid rows (e.g. running total). */
  footer?: (validRows: GridRow[]) => ReactNode;
  commit: (validRows: GridRow[]) => Promise<void>;
  onCommitted?: () => void;
  /** Label prefix for the save button; the count is appended automatically. */
  saveLabel?: string;
}) {
  const [rows, setRows] = useState<GridRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const valid = rows.filter((r) => !isRowBlank(r));

  async function save() {
    if (valid.length === 0 || saving) return;
    setSaving(true);
    setErr(null);
    try {
      await commit(valid);
      setRows([]);
      onCommitted?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <SheetGrid
        columns={columns}
        rows={rows}
        onChange={setRows}
        blankRow={blankRow}
        computed={computed}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          Type in the ＋ row to add more · Enter jumps to the next row.
        </p>
        {footer && valid.length > 0 && (
          <div className="text-sm font-semibold">{footer(valid)}</div>
        )}
      </div>
      {err && <p className="text-sm text-red">{err}</p>}
      <Button size="sm" onClick={save} disabled={valid.length === 0 || saving}>
        {saving
          ? "Saving…"
          : valid.length > 0
            ? `${saveLabel} (${valid.length})`
            : saveLabel}
      </Button>
    </div>
  );
}
