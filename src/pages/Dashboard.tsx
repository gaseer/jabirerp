import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { balances, buildLedger } from "@/domain/ledger";
import {
  activeSitesCount,
  overallPnl,
  totalReceivablePaise,
  workersDueCount,
} from "@/domain/pnl";
import { shopDuesTotalPaise } from "@/domain/shops";
import { formatPaise } from "@/lib/money";
import { Card, SectionHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LedgerRowView } from "@/pages/Ledger";
import { cn } from "@/lib/utils";

/**
 * The readout plate — the one navy surface in the content area, holding the
 * only two numbers that change what the day looks like: what is owed to the
 * business, and whether the work is making money.
 */
function Readout({
  label,
  value,
  note,
  tone,
  to,
}: {
  label: string;
  value: string;
  note: string;
  tone?: "loss";
  to: string;
}) {
  return (
    <Link
      to={to}
      className="group block flex-1 px-5 py-5 transition-colors hover:bg-white/[0.06]"
    >
      <div className="label text-bus-ink">{label}</div>
      <div
        className={cn(
          "figure mt-2 truncate text-[30px] leading-none",
          tone === "loss" ? "text-red-on" : "text-white",
        )}
      >
        {value}
      </div>
      <div className="mt-2 text-xs text-bus-ink">{note}</div>
    </Link>
  );
}

/**
 * One line of the load schedule. A contractor reads these the way they read a
 * circuit directory — down the left for the name, down the right for the
 * figure — so the figures are mono and right-aligned and nothing sits between
 * the two columns.
 */
function ScheduleRow({
  name,
  detail,
  value,
  cls,
  to,
}: {
  name: string;
  detail?: string;
  value: string;
  cls?: string;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="-mx-2 flex items-baseline gap-3 rounded-sm px-2 py-2.5 transition-colors hover:bg-bg"
    >
      <span className="shrink-0 text-sm font-medium">{name}</span>
      <span className="min-w-0 flex-1 truncate text-xs text-muted">{detail}</span>
      <span className={cn("figure shrink-0 text-sm tabular-nums", cls)}>{value}</span>
    </Link>
  );
}

export function Dashboard() {
  const navigate = useNavigate();

  const { data: bal } = useQuery({ queryKey: ["balances"], queryFn: balances });
  const { data: pnl } = useQuery({ queryKey: ["overall-pnl"], queryFn: overallPnl });
  const { data: receivable = 0 } = useQuery({
    queryKey: ["total-receivable"],
    queryFn: totalReceivablePaise,
  });
  const { data: shopDues = 0 } = useQuery({
    queryKey: ["shop-dues-total"],
    queryFn: shopDuesTotalPaise,
  });
  const { data: activeSites = 0 } = useQuery({
    queryKey: ["active-sites"],
    queryFn: activeSitesCount,
  });
  const { data: workersDue = 0 } = useQuery({
    queryKey: ["workers-due"],
    queryFn: workersDueCount,
  });
  const { data: recent = [] } = useQuery({
    queryKey: ["recent-activity"],
    queryFn: async () => (await buildLedger({})).slice(0, 6),
  });

  const cash = bal?.cashPaise ?? 0;
  const bank = bal?.bankPaise ?? 0;
  const profit = pnl?.profitPaise ?? 0;
  const income = pnl?.incomePaise ?? 0;
  const margin = pnl?.marginPct ?? 0;

  return (
    <div className="space-y-7">
      <h2 className="text-xl">Home</h2>

      <div className="flex flex-col divide-y divide-white/10 rounded bg-bus sm:flex-row sm:divide-x sm:divide-y-0">
        <Readout
          label="To receive"
          value={formatPaise(receivable)}
          note={
            activeSites === 1 ? "across 1 open site" : `across ${activeSites} open sites`
          }
          to="/sites"
        />
        <Readout
          label="Net profit"
          value={formatPaise(profit)}
          note={income ? `${margin}% margin on ${formatPaise(income)} billed` : "Nothing billed yet"}
          tone={profit < 0 ? "loss" : undefined}
          to="/reports"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => navigate("/sites")}>
          New site
        </Button>
        <Button size="sm" variant="ghost" onClick={() => navigate("/workers")}>
          Add worker
        </Button>
        <Button size="sm" variant="ghost" onClick={() => navigate("/ledger")}>
          Open ledger
        </Button>
      </div>

      {/* The load schedule: everything else the board is holding, one line each. */}
      <Card className="space-y-0 p-4 pt-3">
        <SectionHead
          title="Where the money is"
          action={<span className="label text-[10px]">Balance</span>}
        />
        <div className="divide-y divide-border">
          <ScheduleRow
            name="Cash in hand"
            value={formatPaise(cash)}
            cls={cash < 0 ? "text-red" : undefined}
            to="/ledger"
          />
          <ScheduleRow
            name="Bank balance"
            value={formatPaise(bank)}
            cls={bank < 0 ? "text-red" : undefined}
            to="/ledger"
          />
          <ScheduleRow
            name="Held at shops"
            detail="Advances not yet settled"
            value={formatPaise(shopDues)}
            to="/shops"
          />
          <ScheduleRow
            name="Billed to date"
            detail="Bills and invoices, net of discount"
            value={formatPaise(income)}
            to="/reports"
          />
          <ScheduleRow
            name="Open sites"
            value={String(activeSites)}
            cls="text-primary"
            to="/sites"
          />
          <ScheduleRow
            name="Workers owed"
            detail={workersDue ? "Wages earned, not yet paid" : "Everyone settled"}
            value={String(workersDue)}
            cls={workersDue ? "text-red" : undefined}
            to="/workers"
          />
        </div>
      </Card>

      <Card className="p-4 pt-3">
        <SectionHead
          title="Recent activity"
          action={
            <Link to="/ledger" className="label text-[10px] text-primary hover:underline">
              See all
            </Link>
          }
        />
        {recent.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">
            Nothing recorded yet. Add an advance or an expense on a site to start the
            ledger.
          </p>
        ) : (
          <div className="busbar mt-3">
            {recent.map((r) => (
              <LedgerRowView key={r.txn.id} row={r} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
