import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Excel-style entry grid. Presentational + controlled: the parent owns the
 * `rows` array and persistence; this component only renders editable cells,
 * handles keyboard navigation, and keeps ONE trailing blank row so a new row
 * appears the moment you type in the last one (like a spreadsheet).
 *
 * Reserved row keys `_id` / `_pos` (leading underscore) are never rendered as
 * columns — parents use them to carry a stable id/position for a persisted row.
 *
 * Mobile: the whole sheet scrolls horizontally inside its own container so the
 * page body never scrolls sideways; cells stay tap-sized (h-9) and inputs keep
 * 16px text to avoid iOS focus-zoom.
 */

export type CellType = "text" | "decimal" | "rupee" | "date" | "time" | "select";

export interface GridColumn {
  key: string;
  label: string;
  type: CellType;
  /** CSS grid track, e.g. "72px" or "minmax(120px,1fr)". Defaults per type. */
  width?: string;
  placeholder?: string;
  /** Options for a `select` column. */
  options?: { value: string; label: string }[];
  align?: "left" | "right";
}

export type GridRow = Record<string, string>;

/** A trailing read-only column (e.g. line amount, wage, balance, an action). */
export interface ComputedCol {
  label: string;
  width?: string;
  render: (row: GridRow) => ReactNode;
  align?: "left" | "right";
}

const DEFAULT_WIDTH: Record<CellType, string> = {
  text: "minmax(130px,1fr)",
  decimal: "70px",
  rupee: "92px",
  date: "150px",
  time: "88px",
  select: "minmax(120px,1fr)",
};

function trackFor(col: GridColumn): string {
  return col.width ?? DEFAULT_WIDTH[col.type];
}

export function SheetGrid({
  columns,
  rows,
  onChange,
  blankRow,
  computed,
  onBlur,
  onDeleteRow,
  maxBodyHeight = "52vh",
}: {
  columns: GridColumn[];
  rows: GridRow[];
  onChange: (rows: GridRow[]) => void;
  blankRow: GridRow;
  /** One or more trailing read-only columns (line amount / wage / balance…). */
  computed?: ComputedCol | ComputedCol[];
  /** Fired when focus leaves any cell — parents use it to flush a save. */
  onBlur?: () => void;
  /** Delete a persisted row (index into `rows`). Omit to just drop it locally. */
  onDeleteRow?: (index: number) => void;
  maxBodyHeight?: string;
}) {
  const computedCols = computed ? (Array.isArray(computed) ? computed : [computed]) : [];
  // Always render one extra blank row after the real ones.
  const display = [...rows, blankRow];

  // Focus map: key `${rowIndex}:${colIndex}` -> input/select element.
  const cellRefs = useRef(new Map<string, HTMLInputElement | HTMLSelectElement>());
  // Where to move focus after the next render (set by keyboard handlers).
  const pendingFocus = useRef<string | null>(null);

  useEffect(() => {
    if (pendingFocus.current) {
      const el = cellRefs.current.get(pendingFocus.current);
      pendingFocus.current = null;
      if (el) {
        el.focus();
        if (el instanceof HTMLInputElement) {
          const len = el.value.length;
          try {
            el.setSelectionRange(len, len);
          } catch {
            // number/date inputs disallow setSelectionRange — harmless
          }
        }
      }
    }
  });

  function setCell(rowIndex: number, key: string, value: string) {
    if (rowIndex < rows.length) {
      const next = rows.map((r, i) => (i === rowIndex ? { ...r, [key]: value } : r));
      onChange(next);
    } else {
      // Typing into the trailing blank promotes it to a real row.
      onChange([...rows, { ...blankRow, [key]: value }]);
    }
  }

  function moveTo(rowIndex: number, colIndex: number) {
    pendingFocus.current = `${rowIndex}:${colIndex}`;
    // If nothing re-renders (target already exists), focus right away too.
    const el = cellRefs.current.get(pendingFocus.current);
    if (el) {
      pendingFocus.current = null;
      el.focus();
    }
  }

  function onKeyDown(
    e: React.KeyboardEvent,
    rowIndex: number,
    colIndex: number,
    isSelect: boolean,
  ) {
    if (e.key === "Enter") {
      // Enter = jump to the first cell of the next row (fast row-by-row entry).
      e.preventDefault();
      moveTo(rowIndex + 1, 0);
    } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !isSelect) {
      // Vertical nav for corrections. Selects keep native arrow behaviour.
      e.preventDefault();
      const nextRow = rowIndex + (e.key === "ArrowDown" ? 1 : -1);
      if (nextRow >= 0 && nextRow <= rows.length) moveTo(nextRow, colIndex);
    }
  }

  const template = [
    "34px", // row number
    ...columns.map(trackFor),
    ...computedCols.map((c) => c.width ?? "94px"),
    "38px", // delete
  ].join(" ");

  const cellBase =
    "h-9 w-full min-w-0 rounded-sm border border-transparent bg-transparent px-2 text-text " +
    "placeholder:text-muted/70 focus:border-primary/50 focus:bg-primary-soft/40 " +
    "focus-visible:outline-none";

  return (
    <div className="overflow-x-auto rounded-sm border border-border">
      <div style={{ minWidth: "min-content" }}>
        {/* Header */}
        <div
          className="sticky top-0 z-10 grid items-center border-b border-border bg-bg/95 text-[11px] font-semibold uppercase tracking-wide text-muted backdrop-blur"
          style={{ gridTemplateColumns: template }}
        >
          <div className="px-1 py-2 text-center">#</div>
          {columns.map((c) => (
            <div
              key={c.key}
              className={cn("px-2 py-2", c.align === "right" && "text-right")}
            >
              {c.label}
            </div>
          ))}
          {computedCols.map((c) => (
            <div
              key={c.label}
              className={cn("px-2 py-2", c.align === "left" ? "text-left" : "text-right")}
            >
              {c.label}
            </div>
          ))}
          <div className="py-2" />
        </div>

        {/* Body */}
        <div className="overflow-y-auto" style={{ maxHeight: maxBodyHeight }}>
          {display.map((row, r) => {
            const isBlank = r === rows.length;
            return (
              <div
                key={r}
                className={cn(
                  "grid items-center border-b border-border/70",
                  isBlank && "bg-primary-soft/20",
                )}
                style={{ gridTemplateColumns: template }}
              >
                <div className="px-1 text-center text-xs tabular-nums text-muted">
                  {isBlank ? "＋" : r + 1}
                </div>

                {columns.map((c, ci) => {
                  const key = `${r}:${ci}`;
                  const common = {
                    ref: (el: HTMLInputElement | HTMLSelectElement | null) => {
                      if (el) cellRefs.current.set(key, el);
                      else cellRefs.current.delete(key);
                    },
                    value: row[c.key] ?? "",
                    onBlur,
                    onKeyDown: (e: React.KeyboardEvent) =>
                      onKeyDown(e, r, ci, c.type === "select"),
                    className: cn(cellBase, c.align === "right" && "text-right"),
                  };
                  if (c.type === "select") {
                    return (
                      <select
                        {...common}
                        key={c.key}
                        onChange={(e) => setCell(r, c.key, e.target.value)}
                      >
                        <option value="">{c.placeholder ?? "—"}</option>
                        {c.options?.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    );
                  }
                  return (
                    <input
                      {...common}
                      key={c.key}
                      type={c.type === "date" ? "date" : c.type === "time" ? "time" : "text"}
                      inputMode={
                        c.type === "decimal" || c.type === "rupee" ? "decimal" : undefined
                      }
                      placeholder={c.placeholder}
                      onChange={(e) => setCell(r, c.key, e.target.value)}
                    />
                  );
                })}

                {computedCols.map((c) => (
                  <div
                    key={c.label}
                    className={cn(
                      "px-2 text-sm font-medium tabular-nums",
                      c.align === "left" ? "text-left" : "text-right",
                    )}
                  >
                    {isBlank ? "" : c.render(row)}
                  </div>
                ))}

                <div className="flex justify-center">
                  {!isBlank && (
                    <button
                      type="button"
                      aria-label="Delete row"
                      className="grid h-7 w-7 place-items-center rounded-sm text-muted hover:bg-red-soft hover:text-red"
                      onClick={() => {
                        if (onDeleteRow) onDeleteRow(r);
                        else onChange(rows.filter((_, i) => i !== r));
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
