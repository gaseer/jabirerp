import { useQuery } from "@tanstack/react-query";
import { overallPnl } from "@/domain/pnl";
import { formatPaise } from "@/lib/money";
import { Card, SectionHead } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Income-vs-cost gauge — a flat meter bar, not a rounded progress pill. */
function BarRow({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="figure">{formatPaise(value)}</span>
      </div>
      <div className="h-2 rounded-sm bg-border/50">
        <div className={cn("h-2 rounded-sm", color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Reports() {
  const { data: pnl } = useQuery({
    queryKey: ["overall-pnl"],
    queryFn: overallPnl,
  });

  if (!pnl) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl">Reports</h2>
        <Card className="text-muted">Loading…</Card>
      </div>
    );
  }

  const max = Math.max(pnl.incomePaise, pnl.costPaise);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl">Reports · P&L</h2>
        <p className="text-sm text-muted">
          Income = converted bills only. Shop money excluded.
        </p>
      </div>

      <Card className="space-y-3">
        <SectionHead title="Overall" />
        <BarRow label="Income (billed)" value={pnl.incomePaise} max={max} color="bg-green" />
        <BarRow label="Cost (expenses + wages)" value={pnl.costPaise} max={max} color="bg-red" />
        <div className="grid grid-cols-2 gap-2 border-t border-border pt-3 text-sm">
          <div>
            <div className="text-xs text-muted">Site expenses</div>
            <div className="figure text-sm">{formatPaise(pnl.expensesPaise)}</div>
          </div>
          <div>
            <div className="text-xs text-muted">Worker wages</div>
            <div className="figure text-sm">{formatPaise(pnl.wagesPaise)}</div>
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-border pt-2">
          <span className="font-semibold">Net profit</span>
          <span
            className={cn(
              "figure text-lg",
              pnl.profitPaise >= 0 ? "text-green" : "text-red",
            )}
          >
            {formatPaise(pnl.profitPaise)}
            <span className="ml-2 text-xs font-medium text-muted">
              {pnl.marginPct}% margin
            </span>
          </span>
        </div>
      </Card>

      <h3 className="label text-bus">Per site</h3>
      {pnl.perSite.length === 0 ? (
        <Card className="text-center text-sm text-muted">No sites yet.</Card>
      ) : (
        <div className="space-y-2">
          {pnl.perSite.map((s) => {
            const siteMax = Math.max(s.billTotalPaise, s.expensesPaise + s.wagesPaise);
            return (
              <Card key={s.siteId} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">{s.siteName}</div>
                  <div
                    className={cn(
                      "figure",
                      s.profitPaise >= 0 ? "text-green" : "text-red",
                    )}
                  >
                    {formatPaise(s.profitPaise)}
                  </div>
                </div>
                <BarRow label="Billed" value={s.billTotalPaise} max={siteMax} color="bg-green" />
                <BarRow
                  label="Cost"
                  value={s.expensesPaise + s.wagesPaise}
                  max={siteMax}
                  color="bg-red"
                />
                {s.billTotalPaise === 0 && (
                  <p className="text-xs text-muted">No converted bill yet — costs only.</p>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
