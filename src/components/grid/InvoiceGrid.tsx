import { useEffect, useMemo, useRef, useState } from "react";
import type { LineItemRow } from "@/lib/db";
import { lineItemRepo } from "@/repo/repos";
import { lineAmountPaise } from "@/domain/quotation";
import {
  SECTION_PRESETS,
  UNIT_OPTIONS,
  UNSECTIONED,
  type LibraryItem,
} from "@/domain/invoice";
import { formatPaise, toPaise } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/Icon";
import { SheetGrid, type GridColumn, type GridRow } from "./SheetGrid";

/**
 * The direct-invoice line editor — a fatter LineItemGrid built for typing a
 * whole bill in one sitting:
 *
 *  - Section + Unit columns (each toggleable, so a phone can show just the
 *    money columns); a new row inherits the previous row's section.
 *  - Description autocompletes from everything billed before and fills in that
 *    item's last rate/unit, so a repeat line is one keystroke.
 *  - Paste a block straight out of Excel (SheetGrid handles the spill).
 *  - Copy / reorder a row; live per-section subtotals under the sheet.
 *
 * Rows are written back to Dexie debounced (0.5s) plus an immediate flush on
 * cell blur, exactly like LineItemGrid — `position` is always the row's index,
 * so reordering persists.
 *
 * Reserved row fields: `_id` (LineItemRow id) and `_pos` (its position).
 */

const SNAPSHOT_KEYS = ["_pos", "section", "description", "unit", "qty", "rate"];

const rowAmountPaise = (r: GridRow) =>
  lineAmountPaise(Number(r.qty) || 0, toPaise(r.rate));

/** Non-blank = has a description (matches the quotation grid's save guard). */
const hasContent = (r: GridRow) => (r.description ?? "").trim() !== "";

const snapshot = (r: GridRow) => SNAPSHOT_KEYS.map((k) => r[k] ?? "").join("|");

function toRow(it: LineItemRow, index: number): GridRow {
  return {
    _id: it.id,
    _pos: String(index),
    section: it.section ?? "",
    description: it.description,
    unit: it.unit ?? "",
    qty: String(it.qty),
    rate: String(it.rate_paise / 100),
  };
}

export function InvoiceGrid({
  documentId,
  items,
  ready,
  library,
  onChanged,
  onSubtotalChange,
}: {
  documentId: string;
  items: LineItemRow[];
  ready: boolean;
  /** Previously billed descriptions, for autocomplete + rate autofill. */
  library: LibraryItem[];
  onChanged: () => void;
  /** Live subtotal (paise) as typed — the page shows discount + grand total. */
  onSubtotalChange: (subtotalPaise: number) => void;
}) {
  const [rows, setRows] = useState<GridRow[]>([]);
  const [showSection, setShowSection] = useState(true);
  const [showUnit, setShowUnit] = useState(true);
  // What is persisted, keyed by row id — lets us skip unchanged rows so they
  // aren't needlessly re-dirtied and re-synced.
  const saved = useRef(new Map<string, string>());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Seed once the query resolves, and again only if the invoice changes — our
  // own writes never reseed, so in-progress typing is never clobbered.
  useEffect(() => {
    if (!ready) return;
    const seeded = items.map(toRow);
    setRows(seeded);
    saved.current = new Map(seeded.map((r) => [r._id, snapshot(r)]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, documentId]);

  const byDescription = useMemo(
    () => new Map(library.map((l) => [l.description.toLowerCase(), l])),
    [library],
  );

  const subtotal = rows
    .filter(hasContent)
    .reduce((sum, r) => sum + rowAmountPaise(r), 0);

  useEffect(() => {
    onSubtotalChange(subtotal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtotal]);

  const columns: GridColumn[] = [
    ...(showSection
      ? [
          {
            key: "section",
            label: "Section",
            type: "combo" as const,
            width: "120px",
            placeholder: "—",
            options: sectionOptions(rows, library),
          },
        ]
      : []),
    {
      key: "description",
      label: "Work / Item",
      type: "combo",
      width: "minmax(160px,1fr)",
      placeholder: "What was done…",
      // Long work text: ⤢ opens a full-width box, header divider drags wider.
      expandable: true,
      options: library.map((l) => ({
        value: l.description,
        label: `${formatPaise(l.rate_paise)}${l.unit ? ` / ${l.unit}` : ""}`,
      })),
    },
    ...(showUnit
      ? [
          {
            key: "unit",
            label: "Unit",
            type: "combo" as const,
            width: "76px",
            placeholder: "nos",
            options: UNIT_OPTIONS.map((u) => ({ value: u, label: u })),
          },
        ]
      : []),
    { key: "qty", label: "Qty", type: "decimal", width: "64px", align: "right" },
    { key: "rate", label: "Rate ₹", type: "rupee", width: "96px", align: "right" },
  ];

  // A new row starts in the same section as the last one — sections come in
  // runs ("all the Works, then all the Materials"), so this is nearly always right.
  const blankRow: GridRow = {
    section: rows.length ? (rows[rows.length - 1].section ?? "") : "",
    description: "",
    unit: "",
    qty: "1",
    rate: "",
  };

  /** Picking a known description fills its last rate / unit / section. */
  function autofill(row: GridRow, key: string): GridRow | void {
    if (key !== "description") return;
    const hit = byDescription.get((row.description ?? "").trim().toLowerCase());
    if (!hit) return;
    return {
      ...row,
      // Only fill what the user hasn't typed — never overwrite a real edit.
      rate: row.rate?.trim() ? row.rate : String(hit.rate_paise / 100),
      unit: row.unit?.trim() ? row.unit : (hit.unit ?? ""),
      section: row.section?.trim() ? row.section : (hit.section ?? ""),
    };
  }

  /** Stable id + dense position for every row, so edits update, not duplicate. */
  function commit(next: GridRow[]) {
    const withIds = next.map((r, i) => ({
      ...r,
      _id: r._id || crypto.randomUUID(),
      _pos: String(i),
    }));
    setRows(withIds);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(withIds), 500);
    return withIds;
  }

  async function persist(current: GridRow[]) {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    // Skip id-less rows: a stale blur closure can fire before commit's id
    // assignment lands in state — the debounced save (which has the id) picks
    // them up, so writing them here would insert a duplicate.
    const toWrite = current.filter(
      (r) => r._id && hasContent(r) && saved.current.get(r._id) !== snapshot(r),
    );
    if (toWrite.length === 0) return;

    for (const r of toWrite) {
      const qty = Number(r.qty) || 0;
      const ratePaise = toPaise(r.rate);
      await lineItemRepo.put({
        id: r._id,
        document_id: documentId,
        description: r.description.trim(),
        qty,
        rate_paise: ratePaise,
        amount_paise: lineAmountPaise(qty, ratePaise),
        position: Number(r._pos) || 0,
        section: (r.section ?? "").trim() || null,
        unit: (r.unit ?? "").trim() || null,
      });
      saved.current.set(r._id, snapshot(r));
    }
    onChanged();
  }

  async function deleteRow(index: number) {
    const row = rows[index];
    const next = commit(rows.filter((_, i) => i !== index));
    if (row?._id && saved.current.has(row._id)) {
      saved.current.delete(row._id);
      await lineItemRepo.softDelete(row._id);
      onChanged();
    }
    // Deleting shifts every later row up — flush the new positions now.
    await persist(next);
  }

  function duplicateRow(index: number) {
    const copy = { ...rows[index], _id: "" };
    commit([...rows.slice(0, index + 1), copy, ...rows.slice(index + 1)]);
  }

  function moveRow(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    persist(commit(next));
  }

  const sections = liveSections(rows.filter(hasContent));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted">Columns:</span>
        <ColumnToggle on={showSection} onClick={() => setShowSection(!showSection)}>
          Section
        </ColumnToggle>
        <ColumnToggle on={showUnit} onClick={() => setShowUnit(!showUnit)}>
          Unit
        </ColumnToggle>
        <span className="ml-auto text-muted">
          {rows.filter(hasContent).length} lines
        </span>
      </div>

      <SheetGrid
        columns={columns}
        rows={rows}
        onChange={commit}
        blankRow={blankRow}
        onBlur={() => persist(rows)}
        onDeleteRow={deleteRow}
        onDuplicateRow={duplicateRow}
        onMoveRow={moveRow}
        onCellCommit={autofill}
        maxBodyHeight="46vh"
        storageKey="invoice"
        computed={{
          label: "Amount",
          render: (r) => formatPaise(rowAmountPaise(r)),
        }}
      />

      <p className="text-xs text-muted">
        Enter → next row · paste a block copied from Excel to fill many rows ·
        ⧉ copies a row, ↑↓ reorder.
      </p>
      <p className="text-xs text-muted">
        Long work text? Tap ⤢ in the cell for a full-width box (⤢ in the header
        opens every row), or drag a column divider to widen it — the width sticks.
      </p>

      {sections.length > 1 && (
        <div className="space-y-1 rounded-sm bg-border/25 p-2 text-sm">
          {sections.map((s) => (
            <div key={s.name} className="flex items-center justify-between">
              <span className="text-muted">{s.name}</span>
              <span className="figure text-sm">{formatPaise(s.paise)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ColumnToggle({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border px-2 py-1 font-medium",
        on
          ? "border-primary/40 bg-primary-soft text-primary"
          : "border-border text-muted",
      )}
    >
      {on && <Icon name="check" className="h-3 w-3" />}
      {children}
    </button>
  );
}

/** Preset sections + any already used in this invoice or billed before. */
function sectionOptions(rows: GridRow[], library: LibraryItem[]) {
  const seen = new Set<string>(SECTION_PRESETS);
  for (const r of rows) if (r.section?.trim()) seen.add(r.section.trim());
  for (const l of library) if (l.section?.trim()) seen.add(l.section.trim());
  return [...seen].map((s) => ({ value: s, label: s }));
}

/** Section subtotals straight off the grid rows (live, not the saved query). */
function liveSections(rows: GridRow[]): { name: string; paise: number }[] {
  const totals = new Map<string, number>();
  for (const r of rows) {
    const name = (r.section ?? "").trim() || UNSECTIONED;
    totals.set(name, (totals.get(name) ?? 0) + rowAmountPaise(r));
  }
  return [...totals.entries()].map(([name, paise]) => ({ name, paise }));
}
