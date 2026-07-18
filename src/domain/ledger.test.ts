import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { employeeRepo, shopRepo, siteRepo, transactionRepo } from "@/repo/repos";
import { useAuth } from "@/store/auth";
import {
  addCustomerAdvance,
  addShopTxn,
  addSiteExpense,
  addWorkerPayment,
} from "./transactions";
import { balances, buildLedger } from "./ledger";

let SITE = "";

beforeEach(async () => {
  for (const t of [db.sites, db.employees, db.shops, db.transactions, db.outbox])
    await t.clear();
  // @ts-expect-error minimal user for currentOwnerId
  useAuth.setState({ user: { id: "u1" } });
  const site = await siteRepo.put({
    name: "Villa",
    phone: null,
    location: null,
    work_type: "Mixed",
    status: "Active",
  });
  SITE = site.id;
});

describe("balances", () => {
  it("splits by mode; in adds, out subtracts", async () => {
    await addCustomerAdvance(SITE, { amountPaise: 100000, mode: "cash", txnDate: "2026-07-01" });
    await addCustomerAdvance(SITE, { amountPaise: 50000, mode: "bank", txnDate: "2026-07-01" });
    await addSiteExpense(SITE, "Materials", { amountPaise: 30000, mode: "cash", txnDate: "2026-07-02" });

    const bal = await balances();
    expect(bal.cashPaise).toBe(70000);
    expect(bal.bankPaise).toBe(50000);
  });

  it("shop pass-through IS in balances (real money held)", async () => {
    const shop = await shopRepo.put({ name: "Hardware", phone: null, site_id: null });
    await addShopTxn(shop.id, "shop_in", { amountPaise: 40000, mode: "cash", txnDate: "2026-07-01" });
    await addShopTxn(shop.id, "shop_out", { amountPaise: 15000, mode: "cash", txnDate: "2026-07-02" });

    expect((await balances()).cashPaise).toBe(25000);
  });

  it("filtered ledger never changes balances; deleted txns drop out", async () => {
    const a = await addCustomerAdvance(SITE, { amountPaise: 100000, mode: "cash", txnDate: "2026-07-01" });
    await addCustomerAdvance(SITE, { amountPaise: 60000, mode: "cash", txnDate: "2026-07-02" });
    await transactionRepo.softDelete(a.id);

    expect((await balances()).cashPaise).toBe(60000);
    // a heavy filter on buildLedger must not affect balances()
    await buildLedger({ siteId: "nope", mode: "bank", from: "2030-01-01" });
    expect((await balances()).cashPaise).toBe(60000);
  });

  it("soft-deleted PARENT keeps its money in balances", async () => {
    await addCustomerAdvance(SITE, { amountPaise: 100000, mode: "cash", txnDate: "2026-07-01" });
    await siteRepo.softDelete(SITE);
    expect((await balances()).cashPaise).toBe(100000);
  });
});

describe("buildLedger", () => {
  it("resolves party labels, including soft-deleted parents", async () => {
    const emp = await employeeRepo.put({ name: "Ravi", phone: null, role: "Helper", hourly_wage_paise: 6250 });
    await addWorkerPayment(emp.id, { amountPaise: 20000, mode: "cash", txnDate: "2026-07-01" });
    await addSiteExpense(SITE, "Travel", { amountPaise: 5000, mode: "cash", txnDate: "2026-07-02" });
    await employeeRepo.softDelete(emp.id);

    const rows = await buildLedger();
    const payment = rows.find((r) => r.txn.txn_type === "worker_payment")!;
    const expense = rows.find((r) => r.txn.txn_type === "site_expense")!;
    expect(payment.refLabel).toBe("Ravi"); // name survives soft-delete
    expect(expense.refLabel).toBe("Villa · Travel");
  });

  it("site filter matches shop txns THROUGH shops.site_id", async () => {
    const shop = await shopRepo.put({ name: "Hardware", phone: null, site_id: SITE });
    await addShopTxn(shop.id, "shop_in", { amountPaise: 10000, mode: "cash", txnDate: "2026-07-01" });
    await addCustomerAdvance(SITE, { amountPaise: 50000, mode: "cash", txnDate: "2026-07-01" });

    const rows = await buildLedger({ siteId: SITE });
    expect(rows).toHaveLength(2);
    const shopRow = rows.find((r) => r.txn.txn_type === "shop_in")!;
    expect(shopRow.refLabel).toBe("Hardware");
    expect(shopRow.siteId).toBe(SITE);
  });

  it("type/mode/date filters narrow the list", async () => {
    await addCustomerAdvance(SITE, { amountPaise: 1000, mode: "cash", txnDate: "2026-07-01" });
    await addCustomerAdvance(SITE, { amountPaise: 2000, mode: "bank", txnDate: "2026-07-05" });
    await addSiteExpense(SITE, "Misc", { amountPaise: 500, mode: "cash", txnDate: "2026-07-06" });

    expect(await buildLedger({ type: "customer_advance" })).toHaveLength(2);
    expect(await buildLedger({ mode: "bank" })).toHaveLength(1);
    expect(await buildLedger({ from: "2026-07-05", to: "2026-07-06" })).toHaveLength(2);
  });

  it("directions match type map", async () => {
    await addCustomerAdvance(SITE, { amountPaise: 1000, mode: "cash", txnDate: "2026-07-01" });
    await addSiteExpense(SITE, "Misc", { amountPaise: 500, mode: "cash", txnDate: "2026-07-01" });
    const rows = await buildLedger();
    expect(rows.find((r) => r.txn.txn_type === "customer_advance")!.direction).toBe("in");
    expect(rows.find((r) => r.txn.txn_type === "site_expense")!.direction).toBe("out");
  });
});
