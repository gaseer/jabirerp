import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { shopRepo, transactionRepo } from "@/repo/repos";
import { useAuth } from "@/store/auth";
import { addShopTxn } from "./transactions";
import { buildShopLedger, shopDuesTotalPaise, shopFigures } from "./shops";
import { balances } from "./ledger";

let SHOP = "";

beforeEach(async () => {
  for (const t of [db.shops, db.transactions, db.outbox]) await t.clear();
  // @ts-expect-error minimal user for currentOwnerId
  useAuth.setState({ user: { id: "u1" } });
  const shop = await shopRepo.put({ name: "Hardware", phone: null, site_id: null });
  SHOP = shop.id;
});

const txn = (type: "shop_in" | "shop_out", amountPaise: number, txnDate = "2026-07-01") =>
  addShopTxn(SHOP, type, { amountPaise, mode: "cash", txnDate });

describe("shopFigures", () => {
  it("pending = received − paid", async () => {
    await txn("shop_in", 100000);
    await txn("shop_in", 50000);
    await txn("shop_out", 60000);

    const f = await shopFigures(SHOP);
    expect(f.receivedPaise).toBe(150000);
    expect(f.paidPaise).toBe(60000);
    expect(f.pendingPaise).toBe(90000);
  });

  it("soft-deleted txns drop out of figures", async () => {
    const t = await txn("shop_in", 100000);
    await txn("shop_in", 20000);
    await transactionRepo.softDelete(t.id);

    expect((await shopFigures(SHOP)).pendingPaise).toBe(20000);
  });
});

describe("shopDuesTotalPaise", () => {
  it("sums pending across non-deleted shops", async () => {
    await txn("shop_in", 50000);
    const other = await shopRepo.put({ name: "Paint", phone: null, site_id: null });
    await addShopTxn(other.id, "shop_in", {
      amountPaise: 30000,
      mode: "cash",
      txnDate: "2026-07-01",
    });

    expect(await shopDuesTotalPaise()).toBe(80000);
  });

  it("deleted shop leaves dues total but its money stays in balances", async () => {
    await txn("shop_in", 50000);
    await shopRepo.softDelete(SHOP);

    expect(await shopDuesTotalPaise()).toBe(0);
    expect((await balances()).cashPaise).toBe(50000); // money really moved
  });
});

describe("buildShopLedger", () => {
  it("runs the holding forward through a newest-first list", async () => {
    await txn("shop_in", 100000, "2026-06-25");
    await txn("shop_out", 60000, "2026-06-28");
    await txn("shop_in", 50000, "2026-07-01");

    const l = await buildShopLedger(SHOP);
    expect(l.entries.map((e) => e.txn.txn_date)).toEqual([
      "2026-07-01",
      "2026-06-28",
      "2026-06-25",
    ]);
    expect(l.entries.map((e) => e.holdingAfterPaise)).toEqual([90000, 40000, 100000]);
    expect(l.entries.map((e) => e.direction)).toEqual(["in", "out", "in"]);
    expect(l.openingHoldingPaise).toBe(0);
    expect(l.periodReceivedPaise).toBe(150000);
    expect(l.periodPaidPaise).toBe(60000);
    expect(l.closingHoldingPaise).toBe(90000);
  });

  it("opens with everything before `from`, and stays self-consistent", async () => {
    await txn("shop_in", 100000, "2026-06-25");
    await txn("shop_out", 60000, "2026-06-28");
    await txn("shop_in", 50000, "2026-07-01");

    const l = await buildShopLedger(SHOP, { from: "2026-07-01" });
    expect(l.entries).toHaveLength(1); // pre-period rows excluded from the list…
    expect(l.openingHoldingPaise).toBe(40000); // …but counted in the opening
    expect(l.entries[0].holdingAfterPaise).toBe(90000); // running balance continues
    expect(
      l.openingHoldingPaise + l.periodReceivedPaise - l.periodPaidPaise,
    ).toBe(l.closingHoldingPaise);
    // Closing over any range equals the lifetime holding.
    expect(l.closingHoldingPaise).toBe((await shopFigures(SHOP)).pendingPaise);
  });

  it("soft-deleted txns drop out of entries and totals", async () => {
    const t = await txn("shop_in", 100000);
    await txn("shop_in", 20000);
    await transactionRepo.softDelete(t.id);

    const l = await buildShopLedger(SHOP);
    expect(l.entries).toHaveLength(1);
    expect(l.periodReceivedPaise).toBe(20000);
    expect(l.entries[0].holdingAfterPaise).toBe(20000);
  });

  it("empty shop yields zeros", async () => {
    const l = await buildShopLedger(SHOP);
    expect(l.entries).toEqual([]);
    expect(l.closingHoldingPaise).toBe(0);
  });
});
