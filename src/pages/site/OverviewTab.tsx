import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SiteRow, TxnMode } from "@/lib/db";
import { sitePnl } from "@/domain/pnl";
import { addCustomerAdvance } from "@/domain/transactions";
import { siteRepo } from "@/repo/repos";
import { sync } from "@/repo/SupabaseSync";
import { formatPaise } from "@/lib/money";
import { todayIso } from "@/lib/dates";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ModeToggle } from "@/components/ModeToggle";
import { cn } from "@/lib/utils";

const pushSoon = () => sync.sync().catch(() => {});

/** Site money at a glance — every number derived live via sitePnl. */
export function OverviewTab({ site }: { site: SiteRow }) {
  const qc = useQueryClient();
  const { data: pnl } = useQuery({
    queryKey: ["site-pnl", site.id],
    queryFn: () => sitePnl(site.id),
  });

  if (!pnl) return <Card className="text-muted">Loading…</Card>;

  const rows: { k: string; v: number; cls?: string }[] = [
    // Converted bill + every direct invoice on the site (see siteBillTotalPaise).
    { k: "Billed total", v: pnl.billTotalPaise },
    { k: "Advances received", v: pnl.advancesPaise, cls: "text-green" },
    {
      k: "Balance receivable",
      v: pnl.receivablePaise,
      cls: pnl.receivablePaise > 0 ? "text-amber" : "text-green",
    },
    { k: "Site expenses", v: pnl.expensesPaise, cls: "text-red" },
    { k: "Worker wages", v: pnl.wagesPaise, cls: "text-red" },
  ];

  const fullyPaid = pnl.billTotalPaise > 0 && pnl.receivablePaise <= 0;

  return (
    <div className="space-y-3">
      <Card className="space-y-1">
        {rows.map((r) => (
          <div key={r.k} className="flex items-center justify-between py-1.5">
            <span className="text-sm text-muted">{r.k}</span>
            <span className={cn("figure text-sm", r.cls)}>{formatPaise(r.v)}</span>
          </div>
        ))}
        <div className="flex items-center justify-between border-t border-border pt-2">
          <span className="font-semibold">Site profit</span>
          <span
            className={cn(
              "figure text-lg",
              pnl.profitPaise >= 0 ? "text-green" : "text-red",
            )}
          >
            {formatPaise(pnl.profitPaise)}
          </span>
        </div>
        {pnl.billTotalPaise === 0 && (
          <p className="pt-1 text-xs text-muted">
            No bill or invoice yet — profit counts costs only.
          </p>
        )}
      </Card>

      {fullyPaid ? (
        <Card className="flex items-center justify-between border-l-[3px] border-l-green bg-green-soft">
          <span className="font-semibold text-green">Fully paid</span>
          {pnl.receivablePaise < 0 && (
            <span className="text-sm text-muted">
              Excess advance {formatPaise(-pnl.receivablePaise)}
            </span>
          )}
        </Card>
      ) : pnl.billTotalPaise > 0 ? (
        <SettleCard
          site={site}
          balancePaise={pnl.receivablePaise}
          onSettled={() => {
            qc.invalidateQueries({ queryKey: ["site-pnl", site.id] });
            qc.invalidateQueries({ queryKey: ["advances", site.id] });
            qc.invalidateQueries({ queryKey: ["site", site.id] });
            qc.invalidateQueries({ queryKey: ["sites"] });
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Final settlement: records the remaining balance (bill total − advances) as
 * one customer_advance, driving the DERIVED receivable to zero. No stored
 * "paid" flag — fully-paid is always recomputed, so a later advance edit or
 * bill change re-opens the balance automatically.
 */
function SettleCard({
  site,
  balancePaise,
  onSettled,
}: {
  site: SiteRow;
  balancePaise: number;
  onSettled: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    mode: "cash" as TxnMode,
    date: todayIso(),
    complete: site.status === "Active",
  });
  const [err, setErr] = useState<string | null>(null);

  const settle = useMutation({
    mutationFn: async () => {
      await addCustomerAdvance(site.id, {
        amountPaise: balancePaise,
        mode: form.mode,
        txnDate: form.date,
        note: "Final settlement",
      });
      if (form.complete && site.status === "Active") {
        await siteRepo.put({ ...site, status: "Completed" });
      }
      pushSoon();
    },
    onSuccess: () => {
      setOpen(false);
      setErr(null);
      onSettled();
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Could not settle"),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    settle.mutate();
  }

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold">Final settlement</div>
          <div className="text-sm text-muted">
            Balance due: <span className="figure text-amber">{formatPaise(balancePaise)}</span>
          </div>
        </div>
        {!open && (
          <Button size="sm" onClick={() => setOpen(true)}>
            Mark fully paid
          </Button>
        )}
      </div>

      {open && (
        <form onSubmit={submit} className="space-y-2">
          <p className="text-xs text-muted">
            Records a final payment of {formatPaise(balancePaise)} (bill total − advances)
            and closes the balance.
          </p>
          <div className="grid grid-cols-2 items-center gap-2">
            <ModeToggle mode={form.mode} onChange={(mode) => setForm({ ...form, mode })} />
            <Input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </div>
          {site.status === "Active" && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.complete}
                onChange={(e) => setForm({ ...form, complete: e.target.checked })}
              />
              Also mark site Completed
            </label>
          )}
          {err && <p className="text-sm text-red">{err}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={settle.isPending}>
              Confirm — {formatPaise(balancePaise)} received
            </Button>
            <Button
              type="button"
              size="sm"
              variant="soft"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
