import { useEffect, useRef, useState } from "react";
import type { DocKind, LineItemRow } from "@/lib/db";
import { lineItemRepo } from "@/repo/repos";
import { ensureDocument } from "@/domain/documents";
import { documentTotalPaise, lineAmountPaise } from "@/domain/quotation";
import { formatPaise, toPaise } from "@/lib/money";
import { SheetGrid, type GridColumn, type GridRow } from "./SheetGrid";

/**
 * Live, spreadsheet-style editor for a document's line items. Unlike the
 * append-only money grids, line items ARE editable, so this seeds from the
 * saved items and writes changes straight back to Dexie (debounced, plus an
 * immediate flush whenever a cell loses focus so a Share/Convert tap right
 * after typing sees the latest rows).
 *
 * Reserved row fields: `_id` (the LineItemRow id) and `_pos` (its position).
 */

const COLUMNS: GridColumn[] = [
  { key: "description", label: "Description", type: "text" },
  { key: "qty", label: "Qty", type: "decimal", width: "64px", align: "right" },
  { key: "rate", label: "Rate ₹", type: "rupee", width: "96px", align: "right" },
];

const blankRow: GridRow = { description: "", qty: "1", rate: "" };

const rowAmountPaise = (r: GridRow) =>
  lineAmountPaise(Number(r.qty) || 0, toPaise(r.rate));

/** Non-blank = has a description (matches the form UI's save guard). */
const hasContent = (r: GridRow) => (r.description ?? "").trim() !== "";

function toRow(it: LineItemRow): GridRow {
  return {
    _id: it.id,
    _pos: String(it.position),
    description: it.description,
    qty: String(it.qty),
    rate: String(it.rate_paise / 100),
  };
}

export function LineItemGrid({
  siteId,
  kind,
  items,
  ready,
  onChanged,
}: {
  siteId: string;
  kind: DocKind;
  items: LineItemRow[];
  ready: boolean;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<GridRow[]>([]);
  // Snapshot of what is persisted, keyed by row id — lets us skip unchanged
  // rows so we don't needlessly re-dirty & re-sync them.
  const saved = useRef(new Map<string, string>());
  const nextPos = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Seed once the query has resolved, and again if the document kind flips
  // (quotation → bill on convert). Our own writes don't reseed: `ready`/`kind`
  // stay put, so in-progress typing is never clobbered.
  useEffect(() => {
    if (!ready) return;
    const seeded = items.map(toRow);
    setRows(seeded);
    saved.current = new Map(seeded.map((r) => [r._id, snapshot(r)]));
    nextPos.current = items.reduce((m, it) => Math.max(m, it.position + 1), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, kind]);

  function snapshot(r: GridRow): string {
    return `${r.description}|${r.qty}|${r.rate}`;
  }

  // Give every row a stable id + position as soon as it exists, so later edits
  // update the same Dexie row instead of inserting duplicates.
  function handleChange(next: GridRow[]) {
    const withIds = next.map((r) =>
      r._id ? r : { ...r, _id: crypto.randomUUID(), _pos: String(nextPos.current++) },
    );
    setRows(withIds);
    scheduleSave(withIds);
  }

  function scheduleSave(current: GridRow[]) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(current), 500);
  }

  async function persist(current: GridRow[]) {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    // Skip id-less rows: a stale blur closure can fire before handleChange's
    // id assignment lands in state — the debounced save (which has the id) will
    // pick them up, so writing them here would insert a duplicate.
    const toWrite = current.filter(
      (r) => r._id && hasContent(r) && saved.current.get(r._id) !== snapshot(r),
    );
    if (toWrite.length === 0) return;

    const doc = await ensureDocument(siteId, kind);
    for (const r of toWrite) {
      const qty = Number(r.qty) || 0;
      const ratePaise = toPaise(r.rate);
      await lineItemRepo.put({
        id: r._id,
        document_id: doc.id,
        description: r.description.trim(),
        qty,
        rate_paise: ratePaise,
        amount_paise: lineAmountPaise(qty, ratePaise),
        position: Number(r._pos) || 0,
        // Sections/units are an invoice feature; quotation & bill lines stay flat.
        section: null,
        unit: null,
      });
      saved.current.set(r._id, snapshot(r));
    }
    onChanged();
  }

  async function deleteRow(index: number) {
    const row = rows[index];
    setRows(rows.filter((_, i) => i !== index));
    if (row?._id && saved.current.has(row._id)) {
      saved.current.delete(row._id);
      await lineItemRepo.softDelete(row._id);
      onChanged();
    }
  }

  // Live total from the grid itself so it updates as you type (the persisted
  // query total lags by the save debounce).
  const total = documentTotalPaise(
    rows.filter(hasContent).map((r) => ({ amount_paise: rowAmountPaise(r) })),
  );

  return (
    <div className="space-y-2">
      <SheetGrid
        columns={COLUMNS}
        rows={rows}
        onChange={handleChange}
        blankRow={blankRow}
        onBlur={() => persist(rows)}
        onDeleteRow={deleteRow}
        computed={{
          label: "Amount",
          render: (r) => formatPaise(rowAmountPaise(r)),
        }}
      />
      <div className="flex items-center justify-between border-t border-border pt-2 font-semibold">
        <span>Total</span>
        <span>{formatPaise(total)}</span>
      </div>
    </div>
  );
}
