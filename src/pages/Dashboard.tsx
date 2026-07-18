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
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LedgerRowView } from "@/pages/Ledger";
import { cn } from "@/lib/utils";

function StatTile({
  label,
  value,
  cls,
  to,
}: {
  label: string;
  value: string;
  cls?: string;
  to?: string;
}) {
  const body = (
    <Card className="h-full">
      <div className="text-xs text-muted">{label}</div>
      <div className={cn("truncate text-lg font-bold", cls)}>{value}</div>
    </Card>
  );
  return to ? <Link to={to}>{body}</Link> : body;
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

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Home</h2>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          label="To receive"
          value={formatPaise(receivable)}
          cls="text-amber"
          to="/sites"
        />
        <StatTile
          label="Cash in hand"
          value={formatPaise(cash)}
          cls={cash < 0 ? "text-red" : undefined}
          to="/ledger"
        />
        <StatTile
          label="Bank balance"
          value={formatPaise(bank)}
          cls={bank < 0 ? "text-red" : undefined}
          to="/ledger"
        />
        <StatTile label="Shop money held" value={formatPaise(shopDues)} to="/shops" />
        <StatTile label="Active sites" value={String(activeSites)} cls="text-primary" to="/sites" />
        <StatTile label="Workers due" value={String(workersDue)} to="/workers" />
        <StatTile
          label="Net profit"
          value={formatPaise(profit)}
          cls={profit >= 0 ? "text-green" : "text-red"}
          to="/reports"
        />
        <StatTile
          label="Total billed"
          value={formatPaise(pnl?.incomePaise ?? 0)}
          to="/reports"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => navigate("/sites")}>
          ＋ New site
        </Button>
        <Button size="sm" variant="soft" onClick={() => navigate("/workers")}>
          ＋ Worker
        </Button>
        <Button size="sm" variant="soft" onClick={() => navigate("/ledger")}>
          📒 View ledger
        </Button>
      </div>

      <Card className="space-y-1">
        <div className="flex items-center justify-between">
          <div className="font-semibold">Recent activity</div>
          <Link to="/ledger" className="text-sm text-primary">
            See all →
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">
            No money movements yet. Record an advance or expense on a site.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {recent.map((r) => (
              <LedgerRowView key={r.txn.id} row={r} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
