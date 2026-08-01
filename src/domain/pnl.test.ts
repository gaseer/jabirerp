import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  employeeRepo,
  lineItemRepo,
  shopRepo,
  siteRepo,
  transactionRepo,
} from "@/repo/repos";
import { useAuth } from "@/store/auth";
import { convertToBill, ensureDocument } from "./documents";
import { markAttendance, markSelfAttendance } from "./attendance";
import {
  addCustomerAdvance,
  addShopTxn,
  addSiteExpense,
  addWorkerPayment,
} from "./transactions";
import {
  overallPnl,
  sitePnl,
  totalReceivablePaise,
  workersDueCount,
} from "./pnl";

let SITE = "";

beforeEach(async () => {
  for (const t of [
    db.sites,
    db.documents,
    db.line_items,
    db.transactions,
    db.employees,
    db.attendance,
    db.shops,
    db.outbox,
  ])
    await t.clear();
  // @ts-expect-error minimal user for currentOwnerId
  useAuth.setState({ user: { id: "u1" } });
  const site = await siteRepo.put({
    name: "Villa",
    phone: null,
    location: null,
    work_type: "Electrical",
    status: "Active",
  });
  SITE = site.id;
});

/** Quotation ₹10,000 → converted bill (income). */
async function seedBill(siteId: string, amountPaise = 1000000) {
  const q = await ensureDocument(siteId, "quotation");
  await lineItemRepo.put({
    document_id: q.id,
    description: "Work",
    qty: 1,
    rate_paise: amountPaise,
    amount_paise: amountPaise,
    section: null,
    unit: null,
    position: 0,
  });
  await convertToBill(siteId);
}

describe("sitePnl", () => {
  it("unconverted quotation is NOT income", async () => {
    const q = await ensureDocument(SITE, "quotation");
    await lineItemRepo.put({
      document_id: q.id,
      description: "Work",
      qty: 1,
      rate_paise: 500000,
      amount_paise: 500000,
      section: null,
      unit: null,
      position: 0,
    });
    const pnl = await sitePnl(SITE);
    expect(pnl.billTotalPaise).toBe(0);
  });

  it("profit = bill − (expenses + wages); advances change receivable only", async () => {
    await seedBill(SITE); // ₹10,000
    await addCustomerAdvance(SITE, { amountPaise: 300000, mode: "cash", txnDate: "2026-07-01" });
    await addSiteExpense(SITE, "Materials", { amountPaise: 200000, mode: "cash", txnDate: "2026-07-02" });

    const emp = await employeeRepo.put({
      name: "W",
      phone: null,
      role: "Helper",
      hourly_wage_paise: 6250, // 8h shift = 50000
    });
    await markAttendance({
      employeeId: emp.id,
      siteId: SITE,
      workDate: "2026-07-03",
      startTime: "09:00",
      endTime: "17:00",
    });
    // worker payment must NOT double-count against wages
    await addWorkerPayment(emp.id, { amountPaise: 50000, mode: "cash", txnDate: "2026-07-04" });

    const pnl = await sitePnl(SITE);
    expect(pnl.billTotalPaise).toBe(1000000);
    expect(pnl.advancesPaise).toBe(300000);
    expect(pnl.receivablePaise).toBe(700000);
    expect(pnl.expensesPaise).toBe(200000);
    expect(pnl.wagesPaise).toBe(50000);
    expect(pnl.profitPaise).toBe(1000000 - 250000);
  });

  it("shop money never enters P&L", async () => {
    await seedBill(SITE);
    const shop = await shopRepo.put({ name: "Hardware", phone: null, site_id: SITE });
    await addShopTxn(shop.id, "shop_in", { amountPaise: 999900, mode: "cash", txnDate: "2026-07-01" });

    const pnl = await sitePnl(SITE);
    expect(pnl.expensesPaise).toBe(0);
    expect(pnl.profitPaise).toBe(1000000);
  });

  it("soft-deleted expense restores profit", async () => {
    await seedBill(SITE);
    const e = await addSiteExpense(SITE, "Travel", {
      amountPaise: 100000,
      mode: "cash",
      txnDate: "2026-07-01",
    });
    expect((await sitePnl(SITE)).profitPaise).toBe(900000);
    await transactionRepo.softDelete(e.id);
    expect((await sitePnl(SITE)).profitPaise).toBe(1000000);
  });

  it("a worker-submitted pending shift doesn't count as a wage cost until approved", async () => {
    await seedBill(SITE); // ₹10,000
    const emp = await employeeRepo.put({
      name: "W",
      phone: null,
      role: "Helper",
      hourly_wage_paise: 6250, // 8h shift = 50000
    });
    await markSelfAttendance({
      employeeId: emp.id,
      siteId: SITE,
      workDate: "2026-07-03",
      startTime: "09:00",
      endTime: "17:00",
    });

    const pnl = await sitePnl(SITE);
    expect(pnl.wagesPaise).toBe(0);
    expect(pnl.profitPaise).toBe(1000000);
  });
});

describe("overallPnl / dashboard stats", () => {
  it("margin is 0 (not NaN) when income is 0", async () => {
    await addSiteExpense(SITE, "Misc", { amountPaise: 5000, mode: "cash", txnDate: "2026-07-01" });
    const pnl = await overallPnl();
    expect(pnl.incomePaise).toBe(0);
    expect(pnl.marginPct).toBe(0);
    expect(pnl.profitPaise).toBe(-5000);
  });

  it("deleted site drops out of P&L and receivable", async () => {
    await seedBill(SITE);
    expect((await overallPnl()).incomePaise).toBe(1000000);
    await siteRepo.softDelete(SITE);
    expect((await overallPnl()).incomePaise).toBe(0);
    expect(await totalReceivablePaise()).toBe(0);
  });

  it("receivable clamps per site at 0 — excess advance never offsets others", async () => {
    await seedBill(SITE); // receivable 10,000 − 12,000 = −2,000 → 0
    await addCustomerAdvance(SITE, { amountPaise: 1200000, mode: "cash", txnDate: "2026-07-01" });

    const other = await siteRepo.put({
      name: "Flat",
      phone: null,
      location: null,
      work_type: "Plumbing",
      status: "Active",
    });
    await seedBill(other.id, 500000); // receivable ₹5,000

    expect(await totalReceivablePaise()).toBe(500000);
  });

  it("workersDueCount counts only positive balances", async () => {
    const a = await employeeRepo.put({ name: "A", phone: null, role: "Helper", hourly_wage_paise: 6250 });
    const b = await employeeRepo.put({ name: "B", phone: null, role: "Helper", hourly_wage_paise: 6250 });
    const shift = { siteId: SITE, workDate: "2026-07-01", startTime: "09:00", endTime: "17:00" };
    await markAttendance({ employeeId: a.id, ...shift });
    await markAttendance({ employeeId: b.id, ...shift });
    await addWorkerPayment(b.id, { amountPaise: 50000, mode: "cash", txnDate: "2026-07-02" });

    expect(await workersDueCount()).toBe(1);
  });
});
