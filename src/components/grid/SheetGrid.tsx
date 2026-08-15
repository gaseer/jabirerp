import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
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
 * Long text (a work description) has two escapes from its narrow cell:
 *  - **Drag** the divider on a column header to widen it. Widths are per-grid
 *    and remembered in localStorage under `storageKey`; double-tap (or Esc-free
 *    keyboard: ←/→ on the focused divider) adjusts it too, double-click resets.
 *    Live drags write a CSS variable straight to the DOM, so dragging never
 *    re-renders the rows.
 *  - **Expand** a row (⤢ inside the cell, or the header ⤢ for all rows) to open
 *    a full-width panel under it with an auto-growing textarea. The panel is
 *    `sticky left-0` at the container's width, so on a phone it stays fully
 *    visible no matter how far the sheet is scrolled sideways.
 *
 * Mobile: the sheet scrolls inside its own container (both axes) so the page
 * body never scrolls sideways; cells stay tap-sized (h-9) and inputs keep 16px
 * text to avoid iOS focus-zoom.
 *
 * Pasting a block copied from Excel/Sheets (tab-separated, newline-delimited)
 * into any cell spills it across the columns and rows to the right/below,
 * creating rows as needed — the fastest way in for a spreadsheet user.
 */

export type CellType =
  | "text"
  | "decimal"
  | "rupee"
  | "date"
  | "time"
  | "select"
  /** Free text with a dropdown of suggestions (native <datalist>). */
  | "combo";

export interface GridColumn {
  key: string;
  label: string;
  type: CellType;
  /** CSS grid track, e.g. "72px" or "minmax(120px,1fr)". Defaults per type. */
  width?: string;
  placeholder?: string;
  /** Options for a `select` or `combo` column. */
  options?: { value: string; label: string }[];
  align?: "left" | "right";
  /** Long free text: gets the in-cell ⤢ and a row expansion panel. */
  expandable?: boolean;
  /** Drag-to-resize the column. Defaults to true. */
  resizable?: boolean;
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
  combo: "minmax(130px,1fr)",
};

/** A dragged column never gets unreadably thin or wider than a laptop screen. */
export const MIN_COL_PX = 64;
export const MAX_COL_PX = 720;

export function clampColumnWidth(px: number): number {
  return Math.round(Math.min(MAX_COL_PX, Math.max(MIN_COL_PX, px)));
}

const WIDTH_STORE_PREFIX = "powerplus-grid-widths:";

/**
 * Read persisted column widths ({key: px}). Anything malformed — old shape,
 * corrupt JSON, a width from a previous layout — degrades to "no override"
 * rather than breaking the sheet.
 */
export function parseStoredWidths(raw: string | null): Record<string, number> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const px = Number(value);
    if (Number.isFinite(px) && px > 0) out[key] = clampColumnWidth(px);
  }
  return out;
}

/** CSS custom property carrying one column's dragged width. */
export function widthVar(key: string): string {
  return `--w-${key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

/**
 * Split a clipboard payload into a cell matrix. Tabs separate columns (what
 * Excel/Sheets put on the clipboard); a trailing newline is dropped so a
 * one-row copy doesn't append a blank row.
 */
export function parseClipboardMatrix(text: string): string[][] {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\n$/, "")
    .split("\n")
    .map((line) => line.split("\t"));
}

function trackFor(col: GridColumn): string {
  return col.width ?? DEFAULT_WIDTH[col.type];
}

/** Descriptions are one line in the DB — paste/typing newlines collapse away. */
const oneLine = (v: string) => v.replace(/\s*[\r\n]+\s*/g, " ");

const BLANK_KEY = "__blank";

export function SheetGrid({
  columns,
  rows,
  onChange,
  blankRow,
  computed,
  onBlur,
  onDeleteRow,
  onDuplicateRow,
  onMoveRow,
  onCellCommit,
  maxBodyHeight = "52vh",
  storageKey,
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
  /** Show a "copy row" action. Omit to hide it. */
  onDuplicateRow?: (index: number) => void;
  /** Show ↑/↓ reorder actions. Omit to hide them. */
  onMoveRow?: (index: number, direction: -1 | 1) => void;
  /**
   * Lets a parent post-process one finished cell edit — e.g. autofill the rate
   * once a known description is picked. Returns the row to store, or void to
   * keep the plain edit. Called on change (not blur) so picking from a
   * datalist fills instantly.
   */
  onCellCommit?: (row: GridRow, key: string) => GridRow | void;
  maxBodyHeight?: string;
  /** Remembers dragged column widths for this grid across sessions. */
  storageKey?: string;
}) {
  const computedCols = computed ? (Array.isArray(computed) ? computed : [computed]) : [];
  // Namespaces this grid's <datalist> ids so two grids on one page never clash.
  const gridId = useId().replace(/:/g, "");
  // Always render one extra blank row after the real ones.
  const display = [...rows, blankRow];
  const expandableCols = columns.filter((c) => c.expandable);

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

  // ---- Column widths (drag to resize) -------------------------------------
  const scrollRef = useRef<HTMLDivElement>(null);
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    if (!storageKey) return {};
    try {
      return parseStoredWidths(localStorage.getItem(WIDTH_STORE_PREFIX + storageKey));
    } catch {
      return {}; // storage blocked (private mode) — defaults are fine
    }
  });
  const drag = useRef<{ key: string; startX: number; startW: number; id: number } | null>(
    null,
  );
  const [dragging, setDragging] = useState(false);

  function saveWidths(next: Record<string, number>) {
    setWidths(next);
    if (!storageKey) return;
    try {
      localStorage.setItem(WIDTH_STORE_PREFIX + storageKey, JSON.stringify(next));
    } catch {
      // storage blocked — the drag still applies for this session
    }
  }

  /** Paint a live width without re-rendering every row mid-drag. */
  function paintWidth(key: string, px: number | null) {
    const el = scrollRef.current;
    if (!el) return;
    if (px === null) el.style.removeProperty(widthVar(key));
    else el.style.setProperty(widthVar(key), `${px}px`);
  }

  function beginResize(e: React.PointerEvent<HTMLSpanElement>, key: string) {
    const cell = e.currentTarget.parentElement;
    if (!cell) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      key,
      startX: e.clientX,
      startW: cell.getBoundingClientRect().width,
      id: e.pointerId,
    };
    setDragging(true);
  }

  function moveResize(e: React.PointerEvent<HTMLSpanElement>) {
    const state = drag.current;
    if (!state || state.id !== e.pointerId) return;
    paintWidth(state.key, clampColumnWidth(state.startW + (e.clientX - state.startX)));
  }

  function endResize(e: React.PointerEvent<HTMLSpanElement>) {
    const state = drag.current;
    if (!state || state.id !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
    saveWidths({
      ...widths,
      [state.key]: clampColumnWidth(state.startW + (e.clientX - state.startX)),
    });
  }

  function resetWidth(key: string) {
    paintWidth(key, null);
    const next = { ...widths };
    delete next[key];
    saveWidths(next);
  }

  /** Keyboard resizing, so the divider isn't mouse-only. */
  function nudgeWidth(e: React.KeyboardEvent<HTMLSpanElement>, key: string) {
    const step = e.key === "ArrowLeft" ? -16 : e.key === "ArrowRight" ? 16 : 0;
    if (step === 0) return;
    e.preventDefault();
    const cell = e.currentTarget.parentElement;
    const current = widths[key] ?? cell?.getBoundingClientRect().width ?? MIN_COL_PX;
    saveWidths({ ...widths, [key]: clampColumnWidth(current + step) });
  }

  // ---- Row expansion (full-width long-text panel) --------------------------
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  // Panel width = the visible container, so it never runs off a phone screen.
  const [viewWidth, setViewWidth] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setViewWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rowKeyOf = (row: GridRow, index: number) =>
    index === rows.length ? BLANK_KEY : row._id || `#${index}`;

  // Typing in the expanded blank row promotes it to a real row (new key) —
  // carry the open panel over so the textarea doesn't vanish mid-sentence.
  const rowCount = useRef(rows.length);
  useEffect(() => {
    if (rows.length > rowCount.current && expanded.has(BLANK_KEY)) {
      const last = rows.length - 1;
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(BLANK_KEY);
        next.add(rowKeyOf(rows[last], last));
        return next;
      });
      setFocusKey(null); // keep focus in the cell the user is typing in
    }
    rowCount.current = rows.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length]);

  function toggleExpand(key: string) {
    const open = !expanded.has(key);
    const next = new Set(expanded);
    if (open) next.add(key);
    else next.delete(key);
    setExpanded(next);
    // Opening one row jumps the cursor into its textarea; expand-all doesn't.
    setFocusKey(open ? key : null);
  }

  const allOpen = rows.length > 0 && rows.every((r, i) => expanded.has(rowKeyOf(r, i)));

  function toggleExpandAll() {
    setFocusKey(null);
    setExpanded(allOpen ? new Set() : new Set(rows.map(rowKeyOf)));
  }

  function setCell(rowIndex: number, key: string, value: string) {
    const apply = (r: GridRow) => {
      const edited = { ...r, [key]: value };
      return onCellCommit?.(edited, key) ?? edited;
    };
    if (rowIndex < rows.length) {
      onChange(rows.map((r, i) => (i === rowIndex ? apply(r) : r)));
    } else {
      // Typing into the trailing blank promotes it to a real row.
      onChange([...rows, apply({ ...blankRow })]);
    }
  }

  /**
   * Spill a copied spreadsheet block from the focused cell: columns to the
   * right, rows down, appending rows when the block runs past the end. Values
   * land verbatim — the parent's normal parsing (toPaise, Number) handles
   * "1,200" or "₹80" exactly as it does typed text.
   */
  function handlePaste(e: React.ClipboardEvent, rowIndex: number, colIndex: number) {
    const text = e.clipboardData.getData("text/plain");
    if (!text || !/[\t\n\r]/.test(text)) return; // plain single value → let the browser paste it
    e.preventDefault();

    const matrix = parseClipboardMatrix(text);
    const next = [...rows];
    matrix.forEach((line, dr) => {
      const target = rowIndex + dr;
      const base = next[target] ?? { ...blankRow };
      const patched = { ...base };
      line.forEach((value, dc) => {
        const col = columns[colIndex + dc];
        if (col) patched[col.key] = value.trim();
      });
      // Run the same commit hook typing would, so autofill still applies.
      const committed = onCellCommit?.(patched, columns[colIndex]?.key ?? "") ?? patched;
      if (target < next.length) next[target] = committed;
      else next.push(committed);
    });
    onChange(next);
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

  const extraActions = Boolean(onDuplicateRow) || Boolean(onMoveRow);
  const template = [
    expandableCols.length ? "40px" : "34px", // row number (+ expand-all toggle)
    ...columns.map((c) => `var(${widthVar(c.key)}, ${trackFor(c)})`),
    ...computedCols.map((c) => c.width ?? "94px"),
    extraActions ? "108px" : "38px", // row actions
  ].join(" ");

  // Dragged widths live as CSS vars on the scroll container so a live drag can
  // repaint them without React.
  const widthVars: CSSProperties = Object.fromEntries(
    Object.entries(widths).map(([key, px]) => [widthVar(key), `${px}px`]),
  ) as CSSProperties;

  const cellBase =
    "h-9 w-full min-w-0 rounded-sm border border-transparent bg-transparent px-2 text-text " +
    "placeholder:text-muted/70 focus:border-primary/50 focus:bg-primary-soft/40 " +
    "focus-visible:outline-none";

  const actionBtn =
    "grid h-7 w-7 shrink-0 place-items-center rounded-sm text-muted " +
    "hover:bg-primary-soft hover:text-primary disabled:opacity-30 disabled:pointer-events-none";

  return (
    <div
      ref={scrollRef}
      className={cn(
        "overflow-auto rounded-sm border border-border",
        dragging && "select-none",
      )}
      style={{ ...widthVars, maxHeight: maxBodyHeight }}
    >
      {/* One datalist per combo column, shared by every row's input. */}
      {columns
        .filter((c) => c.type === "combo" && c.options?.length)
        .map((c) => (
          <datalist key={c.key} id={`sheet-${gridId}-${c.key}`}>
            {c.options?.map((o) => (
              <option key={o.value} value={o.value} label={o.label} />
            ))}
          </datalist>
        ))}
      <div style={{ minWidth: "min-content" }}>
        {/* Header */}
        <div
          className="sticky top-0 z-10 grid items-center border-b border-border bg-bg/95 text-[11px] font-semibold uppercase tracking-wide text-muted backdrop-blur"
          style={{ gridTemplateColumns: template }}
        >
          <div className="flex items-center justify-center px-1 py-1.5">
            {expandableCols.length ? (
              <button
                type="button"
                aria-pressed={allOpen}
                aria-label={allOpen ? "Collapse all rows" : "Expand all rows"}
                title={allOpen ? "Collapse all rows" : "Expand all rows"}
                onClick={toggleExpandAll}
                disabled={rows.length === 0}
                className={cn(
                  "grid h-6 w-6 place-items-center rounded-sm text-[13px]",
                  "hover:bg-primary-soft hover:text-primary disabled:opacity-30",
                  allOpen && "bg-primary-soft text-primary",
                )}
              >
                {allOpen ? "⤡" : "⤢"}
              </button>
            ) : (
              <span>#</span>
            )}
          </div>
          {columns.map((c) => (
            <div
              key={c.key}
              className={cn("relative px-2 py-2", c.align === "right" && "text-right")}
            >
              {c.label}
              {c.resizable !== false && (
                <span
                  role="separator"
                  tabIndex={0}
                  aria-orientation="vertical"
                  aria-label={`Resize ${c.label} column`}
                  title="Drag to resize · double-click to reset"
                  onPointerDown={(e) => beginResize(e, c.key)}
                  onPointerMove={moveResize}
                  onPointerUp={endResize}
                  onPointerCancel={endResize}
                  onDoubleClick={() => resetWidth(c.key)}
                  onKeyDown={(e) => nudgeWidth(e, c.key)}
                  className="group absolute -right-1.5 top-0 z-20 flex h-full w-3 cursor-col-resize touch-none items-center justify-center focus-visible:outline-none"
                >
                  <span className="h-4 w-px bg-border group-hover:h-full group-hover:w-0.5 group-hover:bg-primary/60 group-focus-visible:h-full group-focus-visible:w-0.5 group-focus-visible:bg-primary" />
                </span>
              )}
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
        <div>
          {display.map((row, r) => {
            const isBlank = r === rows.length;
            const rowKey = rowKeyOf(row, r);
            const isOpen = expanded.has(rowKey);
            return (
              <Fragment key={r}>
                <div
                  className={cn(
                    "grid items-center border-b border-border/70",
                    isBlank && "bg-primary-soft/20",
                    isOpen && "border-b-0 bg-primary-soft/10",
                  )}
                  style={{ gridTemplateColumns: template }}
                >
                  <div className="px-1 text-center text-xs tabular-nums text-muted">
                    {isBlank ? "＋" : r + 1}
                  </div>

                  {columns.map((c, ci) => {
                    const key = `${r}:${ci}`;
                    const value = row[c.key] ?? "";
                    const common = {
                      ref: (el: HTMLInputElement | HTMLSelectElement | null) => {
                        if (el) cellRefs.current.set(key, el);
                        else cellRefs.current.delete(key);
                      },
                      value,
                      onBlur,
                      onKeyDown: (e: React.KeyboardEvent) =>
                        onKeyDown(e, r, ci, c.type === "select"),
                      onPaste: (e: React.ClipboardEvent) => handlePaste(e, r, ci),
                      className: cn(
                        cellBase,
                        c.align === "right" && "text-right",
                        c.expandable && "pr-7",
                      ),
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
                    const listId =
                      c.type === "combo" && c.options?.length
                        ? `sheet-${gridId}-${c.key}`
                        : undefined;
                    const input = (
                      <input
                        {...common}
                        key={c.key}
                        type={
                          c.type === "date" ? "date" : c.type === "time" ? "time" : "text"
                        }
                        inputMode={
                          c.type === "decimal" || c.type === "rupee" ? "decimal" : undefined
                        }
                        list={listId}
                        autoComplete={listId ? "off" : undefined}
                        placeholder={c.placeholder}
                        // Hover shows the whole line even while the cell clips it.
                        title={c.expandable && value ? value : undefined}
                        onChange={(e) => setCell(r, c.key, e.target.value)}
                      />
                    );
                    if (!c.expandable) return input;
                    return (
                      <div key={c.key} className="relative flex min-w-0 items-center">
                        {input}
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          aria-label={
                            isOpen ? `Collapse ${c.label}` : `Expand ${c.label} to full width`
                          }
                          title={isOpen ? "Collapse" : "Open full text"}
                          // Keep the cell's blur→save from racing the toggle.
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => toggleExpand(rowKey)}
                          className={cn(
                            "absolute right-0.5 grid h-6 w-6 place-items-center rounded-sm text-[13px] text-muted",
                            "hover:bg-primary-soft hover:text-primary",
                            isOpen && "bg-primary-soft text-primary",
                          )}
                        >
                          {isOpen ? "⤡" : "⤢"}
                        </button>
                      </div>
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

                  <div className="flex items-center justify-center gap-0.5">
                    {!isBlank && (
                      <>
                        {onMoveRow && (
                          <>
                            <button
                              type="button"
                              aria-label="Move row up"
                              disabled={r === 0}
                              className={actionBtn}
                              onClick={() => onMoveRow(r, -1)}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              aria-label="Move row down"
                              disabled={r === rows.length - 1}
                              className={actionBtn}
                              onClick={() => onMoveRow(r, 1)}
                            >
                              ↓
                            </button>
                          </>
                        )}
                        {onDuplicateRow && (
                          <button
                            type="button"
                            aria-label="Duplicate row"
                            className={actionBtn}
                            onClick={() => onDuplicateRow(r)}
                          >
                            ⧉
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label="Delete row"
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-sm text-muted hover:bg-red-soft hover:text-red"
                          onClick={() => {
                            if (onDeleteRow) onDeleteRow(r);
                            else onChange(rows.filter((_, i) => i !== r));
                          }}
                        >
                          ✕
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {isOpen && (
                  <div
                    className="sticky left-0 border-b border-border bg-primary-soft/10 px-2 pb-2 pt-1"
                    style={{ width: viewWidth || "100%" }}
                  >
                    {expandableCols.map((c) => (
                      <ExpandedField
                        key={c.key}
                        label={c.label}
                        rowLabel={isBlank ? "New row" : `Row ${r + 1}`}
                        value={row[c.key] ?? ""}
                        autoFocus={focusKey === rowKey && c === expandableCols[0]}
                        onChange={(v) => setCell(r, c.key, oneLine(v))}
                        onBlur={onBlur}
                        onClose={() => toggleExpand(rowKey)}
                      />
                    ))}
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * The full-width editor for one long cell. Grows with its content (no inner
 * scrollbar), commits on every keystroke like a normal cell, and treats Enter
 * as "done" so the stored description stays a single line.
 */
function ExpandedField({
  label,
  rowLabel,
  value,
  autoFocus,
  onChange,
  onBlur,
  onClose,
}: {
  label: string;
  rowLabel: string;
  value: string;
  autoFocus: boolean;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  useEffect(() => {
    if (!autoFocus) return;
    const el = ref.current;
    el?.focus();
    try {
      el?.setSelectionRange(el.value.length, el.value.length);
    } catch {
      // ignore — focus alone is enough
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-muted">
        <span>
          {rowLabel} · {label}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded-sm px-2 py-0.5 text-primary hover:bg-primary-soft"
        >
          Done
        </button>
      </div>
      <textarea
        ref={ref}
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={(e) => {
          // Single-line data: Enter/Escape close instead of inserting a break.
          if (e.key === "Enter" || e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        className="block w-full resize-none overflow-hidden rounded-sm border border-border bg-surface px-2 py-1.5 leading-snug text-text focus:border-primary/60 focus-visible:outline-none"
      />
    </div>
  );
}
