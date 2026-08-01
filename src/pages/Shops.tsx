import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ShopRow, TxnMode } from "@/lib/db";
import { shopRepo, siteRepo, transactionRepo } from "@/repo/repos";
import { sync } from "@/repo/SupabaseSync";
import { addShopTxn } from "@/domain/transactions";
import {
  buildShopLedger,
  shopFigures,
  shopDuesTotalPaise,
  type ShopFigures,
} from "@/domain/shops";
import { shareShopStatementPdf } from "@/lib/statementPdf";
import { shareShopStatementXlsx } from "@/lib/xlsx";
import { formatPaise, toPaise } from "@/lib/money";
import { formatDate, todayIso, type DateRange } from "@/lib/dates";
import { matchesQuery } from "@/lib/search";
import { useEntryMode } from "@/store/settings";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ModeTag } from "@/components/ModeTag";
import { ModeToggle } from "@/components/ModeToggle";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { SearchInput } from "@/components/SearchInput";
import { EntryGrid } from "@/components/grid/EntryGrid";
import type { GridColumn } from "@/components/grid/SheetGrid";
import { cn } from "@/lib/utils";

const pushSoon = () => sync.sync().catch(() => {});

type ShopSort = "recent" | "name" | "holding";
const SORT_LABELS: Record<ShopSort, string> = {
  recent: "Recently updated",
  name: "Name A–Z",
  holding: "Holding high→low",
};

/**
 * Shop money is pass-through: customer hands cash to settle a shop bill,
 * contractor holds it until paid onward. Holding = received − paid.
 * It lives in cash/bank balances but NEVER in P&L.
 */
export function Shops() {
  const qc = useQueryClient();
  const excel = useEntryMode() === "excel";
  const [newShop, setNewShop] = useState<{ name: string; phone: string; siteId: string } | null>(null);
  // Excel mode: batch "add shops" grid, toggled by the header button.
  const [batch, setBatch] = useState(false);

  const { data: shops = [] } = useQuery({
    queryKey: ["shops"],
    queryFn: () => shopRepo.getAll(),
  });

  const { data: sites = [] } = useQuery({
    queryKey: ["sites"],
    queryFn: () => siteRepo.getAll(),
  });

  const { data: duesTotal = 0 } = useQuery({
    queryKey: ["shop-dues-total"],
    queryFn: shopDuesTotalPaise,
  });

  const { data: figures = {} } = useQuery({
    queryKey: ["shop-figures", shops.map((s) => s.id)],
    queryFn: async () => {
      const entries = await Promise.all(
        shops.map(async (s) => [s.id, await shopFigures(s.id)] as const),
      );
      return Object.fromEntries(entries) as Record<string, ShopFigures>;
    },
    enabled: shops.length > 0,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["shops"] });
    qc.invalidateQueries({ queryKey: ["shop-figures"] });
    qc.invalidateQueries({ queryKey: ["shop-dues-total"] });
    // Shop money is pass-through but it IS real cash/bank — the Ledger and
    // Dashboard balance tiles go stale on every shop txn.
    qc.invalidateQueries({ queryKey: ["balances"] });
    qc.invalidateQueries({ queryKey: ["ledger"] });
    qc.invalidateQueries({ queryKey: ["recent-activity"] });
  };

  const saveShop = useMutation({
    mutationFn: async (f: { name: string; phone: string; siteId: string }) => {
      await shopRepo.put({
        name: f.name.trim(),
        phone: f.phone.trim() || null,
        site_id: f.siteId || null,
      });
      pushSoon();
    },
    onSuccess: () => {
      setNewShop(null);
      refresh();
    },
  });

  const removeShop = useMutation({
    mutationFn: async (id: string) => {
      await shopRepo.softDelete(id);
      pushSoon();
    },
    onSuccess: refresh,
  });

  function confirmDelete(shop: ShopRow) {
    const pending = figures[shop.id]?.pendingPaise ?? 0;
    const warning =
      pending !== 0
        ? `You still hold ${formatPaise(pending)} for ${shop.name}. History is kept, but the shop disappears from lists. Delete anyway?`
        : `Delete "${shop.name}"?`;
    if (confirm(warning)) removeShop.mutate(shop.id);
  }

  function submitNew(e: FormEvent) {
    e.preventDefault();
    if (!newShop || !newShop.name.trim()) return;
    saveShop.mutate(newShop);
  }

  const siteName = new Map(sites.map((s) => [s.id, s.name]));

  const [q, setQ] = useState("");
  const [dueFilter, setDueFilter] = useState<"" | "pending" | "cleared">("");
  const [sort, setSort] = useState<ShopSort>("recent");

  // getAll returns updated_at desc — "recent" keeps that order.
  const visible = shops
    .filter((s) => {
      const pending = figures[s.id]?.pendingPaise ?? 0;
      return (
        (!dueFilter || (dueFilter === "pending" ? pending > 0 : pending <= 0)) &&
        matchesQuery(q, s.name, s.phone, s.site_id ? siteName.get(s.site_id) : null)
      );
    })
    .sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "holding")
        return (figures[b.id]?.pendingPaise ?? 0) - (figures[a.id]?.pendingPaise ?? 0);
      return 0;
    });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Shops</h2>
        <Button
          size="sm"
          onClick={() =>
            excel ? setBatch((v) => !v) : setNewShop({ name: "", phone: "", siteId: "" })
          }
        >
          ＋ Add shop{excel ? "s" : ""}
        </Button>
      </div>

      {excel && batch && !newShop && (
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold">Add shops</div>
            <button
              className="text-sm text-muted hover:text-text"
              onClick={() => setBatch(false)}
            >
              Close
            </button>
          </div>
          <EntryGrid
            columns={[
              { key: "name", label: "Shop name", type: "text" },
              { key: "phone", label: "Phone", type: "text", width: "120px" },
              {
                key: "siteId",
                label: "Linked site",
                type: "select",
                placeholder: "No site",
                options: sites.map((s) => ({ value: s.id, label: s.name })),
              },
            ] satisfies GridColumn[]}
            blankRow={{ name: "", phone: "", siteId: "" }}
            isRowBlank={(r) => (r.name ?? "").trim() === ""}
            saveLabel="Save shops"
            commit={async (rows) => {
              for (const r of rows) {
                await shopRepo.put({
                  name: r.name.trim(),
                  phone: r.phone.trim() || null,
                  site_id: r.siteId || null,
                });
              }
              pushSoon();
            }}
            onCommitted={() => {
              setBatch(false);
              refresh();
            }}
          />
        </Card>
      )}

      <Card>
        <div className="text-sm text-muted">Total shop money you hold</div>
        <div className={cn("text-xl font-bold", duesTotal > 0 && "text-amber")}>
          {formatPaise(duesTotal)}
        </div>
        <div className="text-xs text-muted">Pass-through — excluded from profit.</div>
      </Card>

      {newShop && (
        <Card>
          <form onSubmit={submitNew} className="space-y-3">
            <div className="font-semibold">New shop</div>
            <Input
              placeholder="Shop name *"
              value={newShop.name}
              onChange={(e) => setNewShop({ ...newShop, name: e.target.value })}
              autoFocus
              required
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                placeholder="Phone"
                inputMode="tel"
                value={newShop.phone}
                onChange={(e) => setNewShop({ ...newShop, phone: e.target.value })}
              />
              <Select
                value={newShop.siteId}
                onChange={(e) => setNewShop({ ...newShop, siteId: e.target.value })}
              >
                <option value="">No site link</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={saveShop.isPending}>
                Save
              </Button>
              <Button type="button" variant="ghost" onClick={() => setNewShop(null)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {shops.length === 0 && !newShop ? (
        <Card className="flex flex-col items-center gap-2 py-10 text-center text-muted">
          <span className="text-4xl">🏪</span>
          <p>No shops yet. Track material-shop dues you hold for customers.</p>
        </Card>
      ) : (
        <>
          <div className="space-y-2">
            <SearchInput value={q} onChange={setQ} placeholder="Search shop, phone, site…" />
            <div className="grid grid-cols-2 gap-2">
              <Select
                value={dueFilter}
                onChange={(e) => setDueFilter(e.target.value as "" | "pending" | "cleared")}
                className="h-9 text-sm"
              >
                <option value="">All shops</option>
                <option value="pending">Pending only</option>
                <option value="cleared">Cleared only</option>
              </Select>
              <Select
                value={sort}
                onChange={(e) => setSort(e.target.value as ShopSort)}
                className="h-9 text-sm"
              >
                {Object.entries(SORT_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    ↕ {label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {visible.length === 0 ? (
            <Card className="py-6 text-center text-sm text-muted">
              No shops match the search/filter.
            </Card>
          ) : (
            <div className="space-y-2">
              {visible.map((shop) => (
                <ShopCard
                  key={shop.id}
                  shop={shop}
                  figures={figures[shop.id]}
                  siteName={shop.site_id ? siteName.get(shop.site_id) : undefined}
                  onDelete={() => confirmDelete(shop)}
                  onChanged={refresh}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * One shop as an accordion: collapsed shows the summary line, expanded shows
 * every shop_in/shop_out with the running holding. The ledger query is lazy
 * (`enabled: open`) so a long shop list does no per-shop IndexedDB work.
 */
function ShopCard({
  shop,
  figures,
  siteName,
  onDelete,
  onChanged,
}: {
  shop: ShopRow;
  figures?: ShopFigures;
  siteName?: string;
  onDelete: () => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<DateRange>({});
  const [form, setForm] = useState<{
    type: "shop_in" | "shop_out";
    amount: string;
    mode: TxnMode;
    date: string;
    note: string;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const pending = figures?.pendingPaise ?? 0;

  const { data: ledger } = useQuery({
    queryKey: ["shop-ledger", shop.id, range],
    queryFn: () => buildShopLedger(shop.id, range),
    enabled: open,
  });
  const entries = ledger?.entries ?? [];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["shop-ledger", shop.id] });
    onChanged();
  };

  const add = useMutation({
    mutationFn: async () => {
      if (!form) return;
      await addShopTxn(shop.id, form.type, {
        amountPaise: toPaise(form.amount),
        mode: form.mode,
        txnDate: form.date,
        note: form.note,
      });
      pushSoon();
    },
    onSuccess: () => {
      setForm(null);
      setErr(null);
      refresh();
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Could not save"),
  });

  const removeTxn = useMutation({
    mutationFn: async (id: string) => {
      await transactionRepo.softDelete(id);
      pushSoon();
    },
    onSuccess: refresh,
  });

  function openForm(type: "shop_in" | "shop_out") {
    setForm({
      type,
      // Paying the shop usually clears what is held — prefill it.
      amount: type === "shop_out" && pending > 0 ? String(pending / 100) : "",
      mode: "cash",
      date: todayIso(),
      note: "",
    });
  }

  async function sharePdf() {
    if (ledger) await shareShopStatementPdf(shop, ledger, range, siteName);
  }

  async function shareExcel() {
    if (ledger) await shareShopStatementXlsx(shop, ledger, range, siteName);
  }

  return (
    <Card className="space-y-3">
      <div className="flex items-start gap-2">
        {/* Toggle covers the name block only — the site link and the delete
            button are siblings, never nested inside a button. */}
        <button
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span
            className={cn(
              "mt-0.5 shrink-0 text-muted transition-transform",
              open && "rotate-90",
            )}
            aria-hidden
          >
            ▶
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{shop.name}</span>
            <span className={cn("block text-sm", pending > 0 ? "text-amber" : "text-muted")}>
              Holding {formatPaise(pending)}
            </span>
          </span>
        </button>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold",
            pending > 0 ? "bg-amber-soft text-amber" : "bg-green-soft text-green",
          )}
        >
          {pending > 0 ? "Pending" : "Cleared"}
        </span>
        <button className="text-red" aria-label="Delete shop" onClick={onDelete}>
          🗑
        </button>
      </div>

      {open && (
        <div className="space-y-3 border-t border-border pt-3">
          <div className="truncate text-sm text-muted">
            {siteName ? (
              <Link to={`/sites/${shop.site_id}`} className="text-primary">
                📍 {siteName}
              </Link>
            ) : (
              "No site linked"
            )}
            {shop.phone ? ` · ${shop.phone}` : ""}
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-xs text-muted">Received</div>
              <div className="font-semibold text-green">
                {formatPaise(figures?.receivedPaise ?? 0)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted">Paid</div>
              <div className="font-semibold text-red">
                {formatPaise(figures?.paidPaise ?? 0)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted">Holding</div>
              <div className={cn("font-semibold", pending > 0 && "text-amber")}>
                {formatPaise(pending)}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">Transactions</div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="soft"
                disabled={entries.length === 0}
                onClick={sharePdf}
              >
                📄 PDF
              </Button>
              <Button
                size="sm"
                variant="soft"
                disabled={entries.length === 0}
                onClick={shareExcel}
              >
                📊 Excel
              </Button>
            </div>
          </div>
          <DateRangeFilter range={range} onChange={setRange} />

          {entries.length === 0 ? (
            <p className="text-sm text-muted">No transactions in this period.</p>
          ) : (
            <div className="divide-y divide-border">
              {entries.map((e) => (
                <div key={e.txn.id} className="flex items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{formatDate(e.txn.txn_date)}</span>
                      <ModeTag mode={e.txn.mode} />
                    </div>
                    {e.txn.note && (
                      <div className="truncate text-xs text-muted">{e.txn.note}</div>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <div
                      className={cn(
                        "font-semibold tabular-nums",
                        e.direction === "in" ? "text-green" : "text-red",
                      )}
                    >
                      {e.direction === "in" ? "+" : "−"} {formatPaise(e.txn.amount_paise)}
                    </div>
                    <div className="text-xs text-muted tabular-nums">
                      {formatPaise(e.holdingAfterPaise)}
                    </div>
                  </div>
                  <button
                    className="text-red"
                    aria-label="Delete transaction"
                    onClick={() => {
                      if (confirm("Delete this transaction? It will vanish from all totals."))
                        removeTxn.mutate(e.txn.id);
                    }}
                  >
                    🗑
                  </button>
                </div>
              ))}
            </div>
          )}

          {ledger && (
            <div className="space-y-1 border-t border-border pt-2 text-sm">
              {range.from && (
                <div className="flex items-center justify-between text-muted">
                  <span>Opening holding</span>
                  <span className="tabular-nums">
                    {formatPaise(ledger.openingHoldingPaise)}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between text-muted">
                <span>Received / paid this period</span>
                <span className="tabular-nums">
                  <span className="text-green">
                    {formatPaise(ledger.periodReceivedPaise)}
                  </span>{" "}
                  /{" "}
                  <span className="text-red">{formatPaise(ledger.periodPaidPaise)}</span>
                </span>
              </div>
              <div className="flex items-center justify-between font-semibold">
                <span>Holding</span>
                <span className={cn("tabular-nums", pending > 0 && "text-amber")}>
                  {formatPaise(ledger.closingHoldingPaise)}
                </span>
              </div>
            </div>
          )}

          {form ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                add.mutate();
              }}
              className="space-y-2 border-t border-border pt-3"
            >
              <div className="text-sm font-semibold">
                {form.type === "shop_in" ? "Money received (to hold)" : "Pay shop"}
              </div>
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
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={add.isPending}>
                  Save
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setForm(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex gap-2 border-t border-border pt-3">
              <Button size="sm" variant="soft" onClick={() => openForm("shop_in")}>
                ＋ Received
              </Button>
              <Button size="sm" variant="soft" onClick={() => openForm("shop_out")}>
                → Pay shop
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
