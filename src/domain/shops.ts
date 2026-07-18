import { db } from "@/lib/db";
import { listTxns, sumPaise } from "./transactions";

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
