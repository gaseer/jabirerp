import { db, type TransactionRow } from "@/lib/db";
import type { DateRange } from "@/lib/dates";
import { listTxns, sumPaise, txnDirection, type TxnDirection } from "./transactions";

/**
 * Shop money is PASS-THROUGH: received from the customer to hold, paid onward
 * to the shop. It lives in cash/bank balances (real money held) but never in
 * P&L. pending = received − paid = what the contractor still holds.
 */
export interface ShopFigures {
  receivedPaise: number;
  paidPaise: number;
  pendingPaise: number;
}

export async function shopFigures(shopId: string): Promise<ShopFigures> {
  const txns = await listTxns({ shopId, types: ["shop_in", "shop_out"] });
  const receivedPaise = sumPaise(txns.filter((t) => t.txn_type === "shop_in"));
  const paidPaise = sumPaise(txns.filter((t) => t.txn_type === "shop_out"));
  return { receivedPaise, paidPaise, pendingPaise: receivedPaise - paidPaise };
}

/** Total still held across all non-deleted shops. */
export async function shopDuesTotalPaise(): Promise<number> {
  const shops = (await db.shops.toArray()).filter((s) => s.deleted_at === null);
  const figures = await Promise.all(shops.map((s) => shopFigures(s.id)));
  return figures.reduce((a, f) => a + f.pendingPaise, 0);
}

export interface ShopLedgerEntry {
  txn: TransactionRow;
  direction: TxnDirection;
  /** Holding AFTER this txn, running from the opening balance. */
  holdingAfterPaise: number;
}

export interface ShopLedger {
  /** Newest first — display order. */
  entries: ShopLedgerEntry[];
  openingHoldingPaise: number;
  periodReceivedPaise: number;
  periodPaidPaise: number;
  closingHoldingPaise: number;
}

/**
 * Every shop_in/shop_out for one shop over a date range, each carrying the
 * running holding after it. Opening covers everything strictly before `from`,
 * so a ranged statement is self-consistent:
 * opening + received − paid = closing.
 */
export async function buildShopLedger(
  shopId: string,
  range: DateRange = {},
): Promise<ShopLedger> {
  const types = ["shop_in", "shop_out"] as const;
  const txns = await listTxns({ shopId, types: [...types], ...range });

  let openingHoldingPaise = 0;
  if (range.from) {
    const before = await listTxns({ shopId, types: [...types], to: prevDay(range.from) });
    openingHoldingPaise =
      sumPaise(before.filter((t) => t.txn_type === "shop_in")) -
      sumPaise(before.filter((t) => t.txn_type === "shop_out"));
  }

  // listTxns is newest-first; the running balance must accumulate oldest-first.
  let holding = openingHoldingPaise;
  const entries = [...txns]
    .reverse()
    .map((txn) => {
      const direction = txnDirection(txn.txn_type);
      holding += direction === "in" ? txn.amount_paise : -txn.amount_paise;
      return { txn, direction, holdingAfterPaise: holding };
    })
    .reverse();

  const periodReceivedPaise = sumPaise(txns.filter((t) => t.txn_type === "shop_in"));
  const periodPaidPaise = sumPaise(txns.filter((t) => t.txn_type === "shop_out"));
  return {
    entries,
    openingHoldingPaise,
    periodReceivedPaise,
    periodPaidPaise,
    closingHoldingPaise: openingHoldingPaise + periodReceivedPaise - periodPaidPaise,
  };
}

/** Day before an ISO date, as a local calendar date. */
function prevDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d - 1);
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${dt.getFullYear()}-${mm}-${dd}`;
}
