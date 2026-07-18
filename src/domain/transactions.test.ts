import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { useAuth } from "@/store/auth";
import {
  addCustomerAdvance,
  addSiteExpense,
  assertValidTxn,
  listTxns,
  sumPaise,
  txnDirection,
} from "./transactions";
import { transactionRepo } from "@/repo/repos";

beforeEach(async () => {
  await db.transactions.clear();
  await db.outbox.clear();
  // @ts-expect-error minimal user for currentOwnerId
  useAuth.setState({ user: { id: "u1" } });
});

const money = (over: Partial<Parameters<typeof addCustomerAdvance>[1]> = {}) => ({
  amountPaise: 10000,
  mode: "cash" as const,
  txnDate: "2026-07-01",
  ...over,
});

describe("txnDirection", () => {
  it("derives direction from type", () => {
    expect(txnDirection("customer_advance")).toBe("in");
    expect(txnDirection("shop_in")).toBe("in");
    expect(txnDirection("site_expense")).toBe("out");
    expect(txnDirection("worker_payment")).toBe("out");
    expect(txnDirection("shop_out")).toBe("out");
  });
});

describe("assertValidTxn (poison-pill guard)", () => {
  const base = {
    txn_type: "customer_advance" as const,
    amount_paise: 100,
    mode: "cash" as const,
    txn_date: "2026-07-01",
    site_id: "s1",
    employee_id: null,
    shop_id: null,
    category: null,
    note: null,
  };

  it("accepts a valid advance", () => {
    expect(() => assertValidTxn(base)).not.toThrow();
  });

  it("rejects zero, negative and fractional amounts", () => {
    expect(() => assertValidTxn({ ...base, amount_paise: 0 })).toThrow();
    expect(() => assertValidTxn({ ...base, amount_paise: -5 })).toThrow();
    expect(() => assertValidTxn({ ...base, amount_paise: 10.5 })).toThrow();
  });

  it("rejects a bad mode and bad date", () => {
    // @ts-expect-error deliberately wrong
    expect(() => assertValidTxn({ ...base, mode: "upi" })).toThrow();
    expect(() => assertValidTxn({ ...base, txn_date: "01/07/2026" })).toThrow();
  });

  it("rejects wrong shape per type (mirrors SQL CHECKs)", () => {
    // advance without site
    expect(() => assertValidTxn({ ...base, site_id: null })).toThrow();
    // advance with category
    expect(() => assertValidTxn({ ...base, category: "Materials" })).toThrow();
    // expense without category
    expect(() =>
      assertValidTxn({ ...base, txn_type: "site_expense", category: null }),
    ).toThrow();
    // worker payment carrying a site
    expect(() =>
      assertValidTxn({
        ...base,
        txn_type: "worker_payment",
        employee_id: "e1",
        site_id: "s1",
      }),
    ).toThrow();
    // shop txn without shop
    expect(() =>
      assertValidTxn({ ...base, txn_type: "shop_in", site_id: null, shop_id: null }),
    ).toThrow();
  });

  it("creator throws BEFORE anything reaches the outbox", async () => {
    await expect(
      addCustomerAdvance("s1", money({ amountPaise: -1 })),
    ).rejects.toThrow();
    expect(await db.transactions.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it("addSiteExpense rejects an unknown category", () => {
    expect(() => addSiteExpense("s1", "Bribes", money())).toThrow(
      "Invalid expense category",
    );
  });
});

describe("listTxns", () => {
  it("range filter is inclusive on both edges", async () => {
    await addCustomerAdvance("s1", money({ txnDate: "2026-07-01" }));
    await addCustomerAdvance("s1", money({ txnDate: "2026-07-10" }));
    await addCustomerAdvance("s1", money({ txnDate: "2026-07-11" }));

    const rows = await listTxns({ siteId: "s1", from: "2026-07-01", to: "2026-07-10" });
    expect(rows.map((r) => r.txn_date).sort()).toEqual(["2026-07-01", "2026-07-10"]);
  });

  it("excludes soft-deleted rows from lists and sums", async () => {
    const a = await addCustomerAdvance("s1", money());
    await addCustomerAdvance("s1", money({ amountPaise: 5000 }));
    await transactionRepo.softDelete(a.id);

    const rows = await listTxns({ siteId: "s1" });
    expect(rows).toHaveLength(1);
    expect(sumPaise(rows)).toBe(5000);
  });

  it("filters by type and mode", async () => {
    await addCustomerAdvance("s1", money({ mode: "bank" }));
    await addSiteExpense("s1", "Materials", money());

    expect(await listTxns({ siteId: "s1", types: ["customer_advance"] })).toHaveLength(1);
    expect(await listTxns({ siteId: "s1", mode: "bank" })).toHaveLength(1);
  });

  it("sorts newest first with created_at tie-breaker on same date", async () => {
    await addCustomerAdvance("s1", money({ txnDate: "2026-07-05", amountPaise: 1 }));
    await addCustomerAdvance("s1", money({ txnDate: "2026-07-05", amountPaise: 2 }));
    await addCustomerAdvance("s1", money({ txnDate: "2026-07-09", amountPaise: 3 }));

    const rows = await listTxns({ siteId: "s1" });
    expect(rows[0].amount_paise).toBe(3);
    // same-date rows: later created first
    expect(rows[1].created_at >= rows[2].created_at).toBe(true);
  });
});
