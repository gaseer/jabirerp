import {
  db,
  type TransactionRow,
  type TxnMode,
  type TxnType,
} from "@/lib/db";
import { inRange, type DateRange } from "@/lib/dates";
import { transactionRepo } from "@/repo/repos";

export type TxnDirection = "in" | "out";

export const EXPENSE_CATEGORIES = [
  "Materials",
  "Tea/Snacks",
  "Travel",
  "Room Rent",
  "Misc",
] as const;

/** Direction is derived from type, never stored. */
export function txnDirection(type: TxnType): TxnDirection {
  return type === "customer_advance" || type === "shop_in" ? "in" : "out";
}

export interface TxnFilter extends DateRange {
  types?: TxnType[];
  siteId?: string;
  employeeId?: string;
  shopId?: string;
  mode?: TxnMode;
}

/**
 * All non-deleted transactions matching the filter, newest first
 * (txn_date desc, created_at desc tie-breaker for stable same-day order).
 * Queries the best Dexie index available, then filters the rest in JS —
 * deleted_at is unindexable (null), so it is always a JS filter.
 */
export async function listTxns(filter: TxnFilter = {}): Promise<TransactionRow[]> {
  let rows: TransactionRow[];
  if (filter.siteId) {
    rows = await db.transactions.where("site_id").equals(filter.siteId).toArray();
  } else if (filter.employeeId) {
    rows = await db.transactions.where("employee_id").equals(filter.employeeId).toArray();
  } else if (filter.shopId) {
    rows = await db.transactions.where("shop_id").equals(filter.shopId).toArray();
  } else {
    rows = await db.transactions.toArray();
  }
  return rows
    .filter(
      (t) =>
        t.deleted_at === null &&
        (!filter.types || filter.types.includes(t.txn_type)) &&
        (!filter.mode || t.mode === filter.mode) &&
        inRange(t.txn_date, filter),
    )
    .sort(
      (a, b) =>
        b.txn_date.localeCompare(a.txn_date) ||
        b.created_at.localeCompare(a.created_at),
    );
}

export function sumPaise(txns: { amount_paise: number }[]): number {
  return txns.reduce((s, t) => s + t.amount_paise, 0);
}

type NewTxn = Pick<
  TransactionRow,
  | "txn_type"
  | "amount_paise"
  | "mode"
  | "txn_date"
  | "site_id"
  | "employee_id"
  | "shop_id"
  | "category"
  | "note"
>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Mirrors the server CHECK constraints exactly. MUST pass before a row is
 * enqueued: push halts on the first server error and never skips, so one
 * CHECK-rejected row would wedge the whole outbox (poison pill).
 */
export function assertValidTxn(t: NewTxn): void {
  if (!Number.isInteger(t.amount_paise) || t.amount_paise <= 0)
    throw new Error("Amount must be a positive whole number of paise");
  if (t.mode !== "cash" && t.mode !== "bank") throw new Error("Invalid mode");
  if (!DATE_RE.test(t.txn_date)) throw new Error("Invalid date");

  const shape: Record<TxnType, boolean> = {
    customer_advance:
      t.site_id !== null && t.employee_id === null && t.shop_id === null && t.category === null,
    site_expense:
      t.site_id !== null && t.category !== null && t.employee_id === null && t.shop_id === null,
    worker_payment:
      t.employee_id !== null && t.site_id === null && t.shop_id === null && t.category === null,
    shop_in:
      t.shop_id !== null && t.employee_id === null && t.site_id === null && t.category === null,
    shop_out:
      t.shop_id !== null && t.employee_id === null && t.site_id === null && t.category === null,
  };
  if (!shape[t.txn_type]) throw new Error(`Invalid ${t.txn_type} transaction shape`);
}

async function addTxn(t: NewTxn): Promise<TransactionRow> {
  assertValidTxn(t);
  return transactionRepo.put(t);
}

export interface MoneyInput {
  amountPaise: number;
  mode: TxnMode;
  txnDate: string;
  note?: string;
}

/** Money received from the customer against a site's bill. Reduces receivable. */
export function addCustomerAdvance(siteId: string, m: MoneyInput) {
  return addTxn({
    txn_type: "customer_advance",
    amount_paise: m.amountPaise,
    mode: m.mode,
    txn_date: m.txnDate,
    site_id: siteId,
    employee_id: null,
    shop_id: null,
    category: null,
    note: m.note?.trim() || null,
  });
}

/** Money spent on a site (materials, travel…). Hits site + overall P&L. */
export function addSiteExpense(siteId: string, category: string, m: MoneyInput) {
  if (!EXPENSE_CATEGORIES.includes(category as (typeof EXPENSE_CATEGORIES)[number]))
    throw new Error("Invalid expense category");
  return addTxn({
    txn_type: "site_expense",
    amount_paise: m.amountPaise,
    mode: m.mode,
    txn_date: m.txnDate,
    site_id: siteId,
    employee_id: null,
    shop_id: null,
    category,
    note: m.note?.trim() || null,
  });
}

/**
 * Cash/bank paid to a worker — advance and settlement are the SAME type, the
 * label differs only in the UI. Carries no site: wages attribute to sites via
 * attendance; a payment is person-level. Never counted in P&L (wages are).
 */
export function addWorkerPayment(employeeId: string, m: MoneyInput) {
  return addTxn({
    txn_type: "worker_payment",
    amount_paise: m.amountPaise,
    mode: m.mode,
    txn_date: m.txnDate,
    site_id: null,
    employee_id: employeeId,
    shop_id: null,
    category: null,
    note: m.note?.trim() || null,
  });
}

/**
 * Pass-through shop money. shop_in = received from customer to hold,
 * shop_out = paid onward to the shop. In cash/bank balances, NEVER in P&L.
 * Carries no site: the site association is resolved via shops.site_id.
 */
export function addShopTxn(
  shopId: string,
  type: "shop_in" | "shop_out",
  m: MoneyInput,
) {
  return addTxn({
    txn_type: type,
    amount_paise: m.amountPaise,
    mode: m.mode,
    txn_date: m.txnDate,
    site_id: null,
    employee_id: null,
    shop_id: shopId,
    category: null,
    note: m.note?.trim() || null,
  });
}
