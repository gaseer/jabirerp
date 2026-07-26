import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  SheetGrid,
  type ComputedCol,
  type GridColumn,
  type GridRow,
} from "./SheetGrid";

/**
 * Live, spreadsheet-style CRUD grid for EDITABLE entities (workers, line
 * items…). Seeds from the saved rows once the data is ready, then owns its
 * local state and writes every change straight back through `persistRow`
 * (debounced ~0.5s, plus an immediate flush on cell blur). `deleteRow` may
 * return `false` to abort (e.g. a cancelled confirm) and keep the row.
 *
 * Each seed row must carry a stable `_id`; new rows get one the moment they're
 * typed, so later edits update the same record instead of inserting duplicates.
 */
export function CrudGrid({
  columns,
  seed,
  ready,
  reseedKey = "",
  blankRow,
  isRowBlank,
  snapshotKeys,
  computed,
  footer,
  persistRow,
  deleteRow,
  onChanged,
}: {
  columns: GridColumn[];
  /** Rows built from the saved entities (each with `_id`). */
  seed: GridRow[];
  ready: boolean;
  /** Reseed when this changes (kept stable during editing). */
  reseedKey?: string;
  blankRow: GridRow;
  isRowBlank: (row: GridRow) => boolean;
  /** Row fields whose change means the record needs re-saving. */
  snapshotKeys: string[];
  computed?: ComputedCol | ComputedCol[];
  footer?: (rows: GridRow[]) => ReactNode;
  /** Upsert the entity from a row (row carries `_id`). */
  persistRow: (row: GridRow) => Promise<void>;
  /** Delete by id; return false to abort and keep the row. */
  deleteRow: (id: string) => Promise<boolean>;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<GridRow[]>([]);
  const saved = useRef(new Map<string, string>());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const snapshot = (r: GridRow) => snapshotKeys.map((k) => r[k] ?? "").join("|");

  useEffect(() => {
    if (!ready) return;
    setRows(seed);
    saved.current = new Map(seed.map((r) => [r._id, snapshot(r)]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, reseedKey]);

  function handleChange(next: GridRow[]) {
    const withIds = next.map((r) => (r._id ? r : { ...r, _id: crypto.randomUUID() }));
    setRows(withIds);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(withIds), 500);
  }

  async function persist(current: GridRow[]) {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const toWrite = current.filter(
      (r) => r._id && !isRowBlank(r) && saved.current.get(r._id) !== snapshot(r),
    );
    if (toWrite.length === 0) return;
    for (const r of toWrite) {
      await persistRow(r);
      saved.current.set(r._id, snapshot(r));
    }
    onChanged();
  }

  async function onDelete(index: number) {
    const row = rows[index];
    const persisted = row?._id && saved.current.has(row._id);
    if (persisted) {
      const ok = await deleteRow(row._id);
      if (!ok) return; // aborted (e.g. cancelled confirm) — keep the row
      saved.current.delete(row._id);
    }
    setRows(rows.filter((_, i) => i !== index));
    if (persisted) onChanged();
  }

  return (
    <div className="space-y-2">
      <SheetGrid
        columns={columns}
        rows={rows}
        onChange={handleChange}
        blankRow={blankRow}
        onBlur={() => persist(rows)}
        onDeleteRow={onDelete}
        computed={computed}
      />
      {footer && (
        <div className="flex items-center justify-between border-t border-border pt-2 font-semibold">
          {footer(rows.filter((r) => !isRowBlank(r)))}
        </div>
      )}
      <p className="text-xs text-muted">
        Edits save automatically · type in the ＋ row to add · ✕ deletes.
      </p>
    </div>
  );
}
