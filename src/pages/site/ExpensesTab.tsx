import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SiteRow, TxnMode } from "@/lib/db";
import { transactionRepo } from "@/repo/repos";
import { sync } from "@/repo/SupabaseSync";
import {
  EXPENSE_CATEGORIES,
  addSiteExpense,
  listTxns,
  sumPaise,
} from "@/domain/transactions";
import { formatPaise, toPaise } from "@/lib/money";
import { formatDate, todayIso, type DateRange } from "@/lib/dates";
import { useEntryMode } from "@/store/settings";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ModeTag } from "@/components/ModeTag";
import { ModeToggle } from "@/components/ModeToggle";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { EntryGrid } from "@/components/grid/EntryGrid";
import { MODE_OPTIONS, sumRupeeColumn } from "@/components/grid/gridHelpers";
import type { GridColumn } from "@/components/grid/SheetGrid";

const pushSoon = () => sync.sync().catch(() => {});

const EXPENSE_COLUMNS: GridColumn[] = [
  {
    key: "category",
    label: "Category",
    type: "select",
    options: EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c })),
  },
  { key: "amount", label: "Amount ₹", type: "rupee", align: "right" },
  { key: "date", label: "Date", type: "date" },
  { key: "mode", label: "Mode", type: "select", width: "96px", options: MODE_OPTIONS },
  { key: "note", label: "Note", type: "text" },
];

/** Site expenses (materials, travel…). Append-only: soft-delete + re-add to fix. */
export function ExpensesTab({ site }: { site: SiteRow }) {
  const qc = useQueryClient();
  const excel = useEntryMode() === "excel";
  const [range, setRange] = useState<DateRange>({});
  const [catFilter, setCatFilter] = useState("");
  const [form, setForm] = useState({
    category: EXPENSE_CATEGORIES[0] as string,
    amount: "",
    mode: "cash" as TxnMode,
    date: todayIso(),
    note: "",
  });
  const [err, setErr] = useState<string | null>(null);

  const { data: txns = [] } = useQuery({
    queryKey: ["expenses", site.id, range],
    queryFn: () => listTxns({ siteId: site.id, types: ["site_expense"], ...range }),
  });

  // Category filter is client-side; period total follows it.
  const visible = catFilter ? txns.filter((t) => t.category === catFilter) : txns;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["expenses", site.id] });
    qc.invalidateQueries({ queryKey: ["site-pnl", site.id] });
  };

  const add = useMutation({
    mutationFn: async () => {
      await addSiteExpense(site.id, form.category, {
        amountPaise: toPaise(form.amount),
        mode: form.mode,
        txnDate: form.date,
        note: form.note,
      });
      pushSoon();
    },
    onSuccess: () => {
      setForm({ ...form, amount: "", note: "", date: todayIso() });
      setErr(null);
      refresh();
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Could not save"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await transactionRepo.softDelete(id);
      pushSoon();
    },
    onSuccess: refresh,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    add.mutate();
  }

  return (
    <div className="space-y-3">
      <Card className="space-y-3">
        <div className="font-semibold">Record expense{excel ? "s" : ""}</div>
        {excel ? (
          <EntryGrid
            columns={EXPENSE_COLUMNS}
            blankRow={{
              category: EXPENSE_CATEGORIES[0],
              amount: "",
              date: todayIso(),
              mode: "cash",
              note: "",
            }}
            isRowBlank={(r) => (r.amount ?? "").trim() === ""}
            footer={(rows) => <>Total: {sumRupeeColumn(rows, "amount")}</>}
            saveLabel="Save expenses"
            commit={async (rows) => {
              // Validate up-front so a zero/blank amount can't half-save the batch.
              if (rows.some((r) => toPaise(r.amount) <= 0))
                throw new Error("Every row needs an amount greater than ₹0");
              for (const r of rows) {
                await addSiteExpense(site.id, r.category || EXPENSE_CATEGORIES[0], {
                  amountPaise: toPaise(r.amount),
                  mode: (r.mode || "cash") as TxnMode,
                  txnDate: r.date || todayIso(),
                  note: r.note,
                });
              }
              pushSoon();
            }}
            onCommitted={refresh}
          />
        ) : (
          FormBody()
        )}
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="font-semibold">Expenses</div>
          <Select
            value={catFilter}
            onChange={(e) => setCatFilter(e.target.value)}
            className="h-9 w-auto text-sm"
          >
            <option value="">All categories</option>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
        <DateRangeFilter range={range} onChange={setRange} />

        {visible.length === 0 ? (
          <p className="text-sm text-muted">No expenses in this period.</p>
        ) : (
          <div className="divide-y divide-border">
            {visible.map((t) => (
              <div key={t.id} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{t.category}</span>
                    <ModeTag mode={t.mode} />
                  </div>
                  <div className="truncate text-xs text-muted">
                    {formatDate(t.txn_date)}
                    {t.note ? ` · ${t.note}` : ""}
                  </div>
                </div>
                <div className="font-semibold text-red">{formatPaise(t.amount_paise)}</div>
                <button
                  className="text-red"
                  aria-label="Delete expense"
                  onClick={() => {
                    if (confirm("Delete this expense? It will vanish from all totals."))
                      remove.mutate(t.id);
                  }}
                >
                  🗑
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between border-t border-border pt-2 font-semibold">
          <span>Total (period{catFilter ? ` · ${catFilter}` : ""})</span>
          <span className="text-red">{formatPaise(sumPaise(visible))}</span>
        </div>
      </Card>
    </div>
  );

  function FormBody() {
    return (
      <form onSubmit={submit} className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            >
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            <Input
              placeholder="Amount ₹ *"
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
            <Input
              placeholder="Note (optional)"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </div>
          <ModeToggle mode={form.mode} onChange={(mode) => setForm({ ...form, mode })} />
          {err && <p className="text-sm text-red">{err}</p>}
          <Button type="submit" size="sm" disabled={add.isPending}>
            ＋ Add expense
          </Button>
        </form>
    );
  }
}
