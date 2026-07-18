import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { TxnMode, TxnType } from "@/lib/db";
import { siteRepo } from "@/repo/repos";
import { TXN_TYPE_LABELS, balances, buildLedger, type LedgerRow } from "@/domain/ledger";
import { formatPaise } from "@/lib/money";
import { formatDate, type DateRange } from "@/lib/dates";
import { matchesQuery } from "@/lib/search";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { ModeTag } from "@/components/ModeTag";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { SearchInput } from "@/components/SearchInput";
import { cn } from "@/lib/utils";

/** One ledger row — shared with the Dashboard's recent-activity list. */
export function LedgerRowView({ row }: { row: LedgerRow }) {
  const isIn = row.direction === "in";
  return (
    <div className="flex items-center gap-2 py-2">
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold",
          isIn ? "bg-green-soft text-green" : "bg-red-soft text-red",
        )}
      >
        {isIn ? "IN" : "OUT"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{row.refLabel}</div>
        <div className="flex items-center gap-2 text-xs text-muted">
          <span>{row.typeLabel}</span>
          <span>·</span>
          <span>{formatDate(row.txn.txn_date)}</span>
          <ModeTag mode={row.txn.mode} />
        </div>
      </div>
      <div className={cn("font-semibold", isIn ? "text-green" : "text-red")}>
        {isIn ? "+" : "−"}
        {formatPaise(row.txn.amount_paise)}
      </div>
    </div>
  );
}

export function Ledger() {
  const [range, setRange] = useState<DateRange>({});
  const [siteId, setSiteId] = useState("");
  const [type, setType] = useState("");
  const [mode, setMode] = useState("");
  const [q, setQ] = useState("");

  const { data: sites = [] } = useQuery({
    queryKey: ["sites"],
    queryFn: () => siteRepo.getAll(),
  });

  // Balances are ALWAYS unfiltered — filters change the list, never the money held.
  const { data: bal } = useQuery({
    queryKey: ["balances"],
    queryFn: balances,
  });

  const { data: rows = [] } = useQuery({
    queryKey: ["ledger", siteId, type, mode, range],
    queryFn: () =>
      buildLedger({
        siteId: siteId || undefined,
        type: (type || undefined) as TxnType | undefined,
        mode: (mode || undefined) as TxnMode | undefined,
        ...range,
      }),
  });

  // Text search stays client-side on the already-filtered rows: name, note, type.
  const visible = rows.filter((r) =>
    matchesQuery(q, r.refLabel, r.typeLabel, r.txn.note),
  );

  const filtersActive = Boolean(q || siteId || type || mode || range.from || range.to);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Ledger</h2>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <div className="text-sm text-muted">💵 Cash in hand</div>
          <div
            className={cn(
              "text-xl font-bold",
              (bal?.cashPaise ?? 0) < 0 && "text-red",
            )}
          >
            {formatPaise(bal?.cashPaise ?? 0)}
          </div>
        </Card>
        <Card>
          <div className="text-sm text-muted">🏦 Bank balance</div>
          <div
            className={cn(
              "text-xl font-bold",
              (bal?.bankPaise ?? 0) < 0 && "text-red",
            )}
          >
            {formatPaise(bal?.bankPaise ?? 0)}
          </div>
        </Card>
      </div>

      <Card className="space-y-2">
        <SearchInput value={q} onChange={setQ} placeholder="Search name, note…" />
        <div className="grid grid-cols-3 gap-2">
          <Select value={siteId} onChange={(e) => setSiteId(e.target.value)} className="h-9 text-sm">
            <option value="">All sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Select value={type} onChange={(e) => setType(e.target.value)} className="h-9 text-sm">
            <option value="">All types</option>
            {Object.entries(TXN_TYPE_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </Select>
          <Select value={mode} onChange={(e) => setMode(e.target.value)} className="h-9 text-sm">
            <option value="">Cash + Bank</option>
            <option value="cash">Cash only</option>
            <option value="bank">Bank only</option>
          </Select>
        </div>
        <DateRangeFilter range={range} onChange={setRange} />
        {filtersActive && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setQ("");
              setSiteId("");
              setType("");
              setMode("");
              setRange({});
            }}
          >
            ✕ Clear all filters
          </Button>
        )}
      </Card>

      <Card>
        {visible.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">
            {filtersActive ? "No transactions match the filters." : "No transactions yet."}
          </p>
        ) : (
          <div className="divide-y divide-border">
            {visible.map((r) => (
              <LedgerRowView key={r.txn.id} row={r} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
