import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { siteRepo } from "@/repo/repos";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { OverviewTab } from "./site/OverviewTab";
import { QuotationBillTab } from "./site/QuotationBillTab";
import { InvoicesTab } from "./site/InvoicesTab";
import { AdvancesTab } from "./site/AdvancesTab";
import { ExpensesTab } from "./site/ExpensesTab";
import { WorkersTab } from "./site/WorkersTab";
import { PendingTab } from "./site/PendingTab";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "doc", label: "Quotation/Bill" },
  { key: "invoices", label: "Invoices" },
  { key: "advances", label: "Advances" },
  { key: "expenses", label: "Expenses" },
  { key: "workers", label: "Workers" },
  { key: "tasks", label: "Tasks" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function SiteDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const rawTab = params.get("tab") ?? "overview";
  const tab: TabKey = TABS.some((t) => t.key === rawTab) ? (rawTab as TabKey) : "overview";

  const { data: site } = useQuery({
    queryKey: ["site", id],
    queryFn: async () => (await siteRepo.getById(id)) ?? null,
  });

  return (
    <div className="space-y-4">
      <button className="text-primary" onClick={() => navigate("/sites")}>
        ← Sites
      </button>

      {site === null ? (
        <Card className="text-muted">Site not found.</Card>
      ) : site ? (
        <>
          <div>
            <h2 className="text-xl">{site.name}</h2>
            <p className="text-sm text-muted">
              {site.work_type}
              {site.location ? ` · ${site.location}` : ""}
              {site.phone ? ` · ${site.phone}` : ""}
            </p>
          </div>

          <div className="-mx-4 overflow-x-auto px-4">
            <div className="flex w-max gap-1 rounded-sm bg-border/40 p-1">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setParams({ tab: t.key }, { replace: true })}
                  className={cn(
                    "whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium",
                    tab === t.key ? "bg-surface text-primary shadow-card" : "text-muted",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {tab === "overview" && <OverviewTab site={site} />}
          {tab === "doc" && <QuotationBillTab site={site} />}
          {tab === "invoices" && <InvoicesTab site={site} />}
          {tab === "advances" && <AdvancesTab site={site} />}
          {tab === "expenses" && <ExpensesTab site={site} />}
          {tab === "workers" && <WorkersTab site={site} />}
          {tab === "tasks" && <PendingTab site={site} />}
        </>
      ) : (
        <Card className="text-muted">Loading…</Card>
      )}
    </div>
  );
}
