import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SiteRow, TxnMode } from "@/lib/db";
import { transactionRepo } from "@/repo/repos";
import { sync } from "@/repo/SupabaseSync";
import { addCustomerAdvance, listTxns, sumPaise } from "@/domain/transactions";
import { siteBillTotalPaise } from "@/domain/pnl";
import { shareAdvanceStatementPdf } from "@/lib/statementPdf";
import { shareAdvanceStatementXlsx } from "@/lib/xlsx";
import { formatPaise, toPaise } from "@/lib/money";
import { formatDate, todayIso, type DateRange } from "@/lib/dates";
import { useEntryMode } from "@/store/settings";
import { Card, SectionHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/Icon";
import { ModeTag } from "@/components/ModeTag";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { ModeToggle } from "@/components/ModeToggle";
import { EntryGrid } from "@/components/grid/EntryGrid";
import { MODE_OPTIONS, sumRupeeColumn } from "@/components/grid/gridHelpers";
import type { GridColumn } from "@/components/grid/SheetGrid";

const pushSoon = () => sync.sync().catch(() => {});

const ADVANCE_COLUMNS: GridColumn[] = [
  { key: "amount", label: "Amount ₹", type: "rupee", align: "right" },
  { key: "date", label: "Date", type: "date" },
  { key: "mode", label: "Mode", type: "select", width: "96px", options: MODE_OPTIONS },
  { key: "note", label: "Note", type: "text" },
];

/**
 * Customer advances for a site. Money rows are append-only: no edit —
 * a correction is soft-delete + re-add.
 */
export function AdvancesTab({ site }: { site: SiteRow }) {
  const qc = useQueryClient();
  const excel = useEntryMode() === "excel";
  const [range, setRange] = useState<DateRange>({});
  const [form, setForm] = useState({ amount: "", mode: "cash" as TxnMode, date: todayIso(), note: "" });
  const [err, setErr] = useState<string | null>(null);

  const key = ["advances", site.id, range];
  const { data: txns = [] } = useQuery({
    queryKey: key,
    queryFn: () => listTxns({ siteId: site.id, types: ["customer_advance"], ...range }),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["advances", site.id] });
    qc.invalidateQueries({ queryKey: ["site-pnl", site.id] });
  };

  const add = useMutation({
    mutationFn: async () => {
      await addCustomerAdvance(site.id, {
        amountPaise: toPaise(form.amount),
        mode: form.mode,
        txnDate: form.date,
        note: form.note,
      });
      pushSoon();
    },
    onSuccess: () => {
      setForm({ amount: "", mode: "cash", date: todayIso(), note: "" });
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

  // Table = period-filtered; summary = LIFETIME as of today.
  async function lifetime() {
    const [billTotalPaise, allAdvances] = await Promise.all([
      siteBillTotalPaise(site.id),
      listTxns({ siteId: site.id, types: ["customer_advance"] }),
    ]);
    return { billTotalPaise, advancesToDatePaise: sumPaise(allAdvances) };
  }

  async function shareStatement() {
    await shareAdvanceStatementPdf(site, txns, range, await lifetime());
  }

  async function shareStatementExcel() {
    await shareAdvanceStatementXlsx(site, txns, range, await lifetime());
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    add.mutate();
  }

  return (
    <div className="space-y-3">
      <Card className="space-y-3">
        <SectionHead title={`Record advance${excel ? "s" : ""} received`} />
        {excel ? (
          <EntryGrid
            columns={ADVANCE_COLUMNS}
            blankRow={{ amount: "", date: todayIso(), mode: "cash", note: "" }}
            isRowBlank={(r) => (r.amount ?? "").trim() === ""}
            footer={(rows) => <>Total: {sumRupeeColumn(rows, "amount")}</>}
            saveLabel="Save advances"
            commit={async (rows) => {
              // Validate up-front so a zero/blank amount can't half-save the batch.
              if (rows.some((r) => toPaise(r.amount) <= 0))
                throw new Error("Every row needs an amount greater than ₹0");
              for (const r of rows) {
                await addCustomerAdvance(site.id, {
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
          <form onSubmit={submit} className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="Amount ₹ *"
                inputMode="decimal"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                required
              />
              <Input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </div>
            <ModeToggle mode={form.mode} onChange={(mode) => setForm({ ...form, mode })} />
            <Input
              placeholder="Note (optional)"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
            {err && <p className="text-sm text-red">{err}</p>}
            <Button type="submit" size="sm" disabled={add.isPending}>
              Add advance
            </Button>
          </form>
        )}
      </Card>

      <Card className="space-y-3">
        <SectionHead
          title="Advance history"
          action={
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" disabled={txns.length === 0} onClick={shareStatement}>
                PDF
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={txns.length === 0}
                onClick={shareStatementExcel}
              >
                Excel
              </Button>
            </div>
          }
        />
        <DateRangeFilter range={range} onChange={setRange} />

        {txns.length === 0 ? (
          <p className="text-sm text-muted">No advances in this period.</p>
        ) : (
          <div className="busbar">
            {txns.map((t) => (
              <div key={t.id} className="tap tap-in flex items-center gap-2 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{formatDate(t.txn_date)}</span>
                    <ModeTag mode={t.mode} />
                  </div>
                  {t.note && <div className="truncate text-xs text-muted">{t.note}</div>}
                </div>
                <div className="figure text-sm text-green">{formatPaise(t.amount_paise)}</div>
                <button
                  className="text-muted transition-colors hover:text-red"
                  aria-label="Delete advance"
                  onClick={() => {
                    if (confirm("Delete this advance? It will vanish from all totals."))
                      remove.mutate(t.id);
                  }}
                >
                  <Icon name="trash" className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between border-t border-border pt-2 font-semibold">
          <span>Total (period)</span>
          <span className="figure text-green">{formatPaise(sumPaise(txns))}</span>
        </div>
      </Card>
    </div>
  );
}
