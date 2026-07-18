import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { attendanceRepo, employeeRepo, transactionRepo } from "@/repo/repos";
import { useAuth } from "@/store/auth";
import { markAttendance } from "./attendance";
import { addWorkerPayment } from "./transactions";
import { buildSettlement, empBalancePaise } from "./settlement";

let EMP = "";

beforeEach(async () => {
  await db.employees.clear();
  await db.attendance.clear();
  await db.transactions.clear();
  await db.outbox.clear();
  // @ts-expect-error minimal user for currentOwnerId
  useAuth.setState({ user: { id: "u1" } });
  const emp = await employeeRepo.put({
    name: "Suresh",
    phone: null,
    role: "Electrician",
    hourly_wage_paise: 10000, // ₹100/hr — 8h shift = ₹800
  });
  EMP = emp.id;
});

// Default = 8h shift (09:00–17:00) → 80000 paise at ₹100/hr.
const day = (workDate: string, startTime = "09:00", endTime = "17:00") =>
  markAttendance({ employeeId: EMP, siteId: "site-1", workDate, startTime, endTime });

const pay = (txnDate: string, amountPaise: number) =>
  addWorkerPayment(EMP, { amountPaise, mode: "cash", txnDate });

describe("buildSettlement", () => {
  it("opening + period wages − period paid = closing", async () => {
    await day("2026-06-10"); // before range → opening
    await pay("2026-06-15", 30000); // before range → opening
    await day("2026-07-01");
    await day("2026-07-02", "09:00", "13:00"); // 4h half-shift = 40000
    await pay("2026-07-03", 50000);

    const s = await buildSettlement(EMP, { from: "2026-07-01", to: "2026-07-31" });
    expect(s.openingBalancePaise).toBe(80000 - 30000); // 50000
    expect(s.periodWagesPaise).toBe(80000 + 40000);
    expect(s.periodPaidPaise).toBe(50000);
    expect(s.closingBalancePaise).toBe(50000 + 120000 - 50000); // 120000
  });

  it("range edges inclusive: attendance ON from, payment ON to both count", async () => {
    await day("2026-07-01");
    await pay("2026-07-31", 10000);

    const s = await buildSettlement(EMP, { from: "2026-07-01", to: "2026-07-31" });
    expect(s.periodWagesPaise).toBe(80000);
    expect(s.periodPaidPaise).toBe(10000);
  });

  it("attendance filters by work_date, payments by txn_date", async () => {
    await day("2026-06-30"); // outside
    await pay("2026-07-01", 10000); // inside

    const s = await buildSettlement(EMP, { from: "2026-07-01", to: "2026-07-31" });
    expect(s.periodWagesPaise).toBe(0);
    expect(s.periodPaidPaise).toBe(10000);
    expect(s.openingBalancePaise).toBe(80000);
  });

  it("fractional shift counts via stored wage_paise", async () => {
    await day("2026-07-05", "12:30", "17:30"); // 5h × ₹100/hr = 50000
    const s = await buildSettlement(EMP, { from: "2026-07-01", to: "2026-07-31" });
    expect(s.periodWagesPaise).toBe(50000);
  });

  it("rejects inverted or malformed times", async () => {
    await expect(day("2026-07-05", "15:00", "13:00")).rejects.toThrow(
      "End time must be after start time",
    );
    await expect(day("2026-07-05", "9:00", "17:00")).rejects.toThrow("Invalid time");
    expect(await db.attendance.count()).toBe(0);
    // outbox holds only the beforeEach employee row — no attendance poison pill
    const queued = await db.outbox.toArray();
    expect(queued.filter((o) => o.table === "attendance")).toHaveLength(0);
  });

  it("soft-deleted attendance and payments drop out of the math", async () => {
    const a = await day("2026-07-01");
    await day("2026-07-02");
    const p = await pay("2026-07-03", 40000);
    await attendanceRepo.softDelete(a.id);
    await transactionRepo.softDelete(p.id);

    const s = await buildSettlement(EMP, {});
    expect(s.periodWagesPaise).toBe(80000);
    expect(s.periodPaidPaise).toBe(0);
  });

  it("wage edits never rewrite recorded attendance", async () => {
    await day("2026-07-01");
    const emp = await employeeRepo.getById(EMP);
    await employeeRepo.put({ ...emp!, hourly_wage_paise: 12500 }); // ₹125/hr
    await day("2026-07-02");

    const s = await buildSettlement(EMP, {});
    expect(s.periodWagesPaise).toBe(80000 + 100000);
  });

  it("empBalancePaise: negative = advance given", async () => {
    await day("2026-07-01");
    await pay("2026-07-02", 100000);
    expect(await empBalancePaise(EMP)).toBe(-20000);
  });
});
