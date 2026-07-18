import { db, type TransactionRow, type TxnMode, type TxnType } from "@/lib/db";
import type { DateRange } from "@/lib/dates";
import { listTxns, sumPaise, txnDirection, type TxnDirection } from "./transactions";

export const TXN_TYPE_LABELS: Record<TxnType, string> = {
  customer_advance: "Customer Advance",
  site_expense: "Site Expense",
  worker_payment: "Worker Payment",
  shop_in: "Shop Money In",
  shop_out: "Shop Paid",
};

export interface LedgerRow {
  txn: TransactionRow;
  direction: TxnDirection;
  typeLabel: string;
  refLabel: string; // resolved party name (site/worker/shop), survives soft-deleted parents
  siteId: string | null; // effective site: direct, or via the shop's linked site
}

export interface LedgerFilter extends DateRange {
  siteId?: string;
  type?: TxnType;
  mode?: TxnMode;
}

/**
 * The unified money ledger — every cash/bank movement, auto-derived from
 * transactions. Labels resolve from the RAW Dexie tables (including
 * soft-deleted parents) so history never loses its names; a parent that
 * hasn't pulled yet degrades to "Unknown". The site filter matches shop txns
 * THROUGH shops.site_id (shop txns store no site_id).
 */
export async function buildLedger(filter: LedgerFilter = {}): Promise<LedgerRow[]> {
  const txns = await listTxns({
    types: filter.type ? [filter.type] : undefined,
    mode: filter.mode,
    from: filter.from,
    to: filter.to,
  });

  const [sites, employees, shops] = await Promise.all([
    db.sites.toArray(),
    db.employees.toArray(),
    db.shops.toArray(),
  ]);
  const siteName = new Map(sites.map((s) => [s.id, s.name]));
  const empName = new Map(employees.map((e) => [e.id, e.name]));
  const shopById = new Map(shops.map((s) => [s.id, s]));

  const rows = txns.map((t): LedgerRow => {
    let refLabel = "Unknown";
    let siteId = t.site_id;
    if (t.site_id) {
      refLabel = siteName.get(t.site_id) ?? "Unknown";
      if (t.category) refLabel += ` · ${t.category}`;
    } else if (t.employee_id) {
      refLabel = empName.get(t.employee_id) ?? "Unknown";
    } else if (t.shop_id) {
      const shop = shopById.get(t.shop_id);
      refLabel = shop?.name ?? "Shop";
      siteId = shop?.site_id ?? null;
    }
    return {
      txn: t,
      direction: txnDirection(t.txn_type),
      typeLabel: TXN_TYPE_LABELS[t.txn_type],
      refLabel,
      siteId,
    };
  });

  return filter.siteId ? rows.filter((r) => r.siteId === filter.siteId) : rows;
}

export interface Balances {
  cashPaise: number;
  bankPaise: number;
}

/**
 * Cash-in-hand and bank balance over ALL non-deleted transactions — including
 * shop pass-through (it is real money held) and txns of soft-deleted parents
 * (money that moved, moved). Independent of any ledger filter.
 */
export async function balances(): Promise<Balances> {
  const txns = await listTxns();
  let cashPaise = 0;
  let bankPaise = 0;
  for (const t of txns) {
    const v = txnDirection(t.txn_type) === "in" ? t.amount_paise : -t.amount_paise;
    if (t.mode === "bank") bankPaise += v;
    else cashPaise += v;
  }
  return { cashPaise, bankPaise };
}

export { sumPaise };
