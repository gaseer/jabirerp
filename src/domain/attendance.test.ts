import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { attendanceRepo, employeeRepo } from "@/repo/repos";
import { useAuth } from "@/store/auth";
import { markAttendance } from "./attendance";

let EMP = "";

beforeEach(async () => {
  await db.employees.clear();
  await db.attendance.clear();
  await db.outbox.clear();
  // @ts-expect-error minimal user for currentOwnerId
  useAuth.setState({ user: { id: "u1" } });
  const emp = await employeeRepo.put({
    name: "Suresh",
    phone: null,
    role: "Electrician",
    hourly_wage_paise: 10000,
  });
  EMP = emp.id;
});

const mark = (startTime: string, endTime: string, workDate = "2026-07-18", siteId = "site-1") =>
  markAttendance({ employeeId: EMP, siteId, workDate, startTime, endTime });

describe("markAttendance overlap guard", () => {
  it("rejects an exact duplicate shift", async () => {
    await mark("09:00", "17:00");
    await expect(mark("09:00", "17:00")).rejects.toThrow(
      "Already marked 9:00 AM – 5:00 PM on this date",
    );
    expect(await db.attendance.count()).toBe(1);
  });

  it("rejects a partially overlapping shift, even at another site", async () => {
    await mark("09:00", "13:00");
    await expect(mark("12:00", "17:00", "2026-07-18", "site-2")).rejects.toThrow(
      "Already marked",
    );
    await expect(mark("08:00", "10:00")).rejects.toThrow("Already marked");
    await expect(mark("10:00", "11:00")).rejects.toThrow("Already marked"); // inside
    await expect(mark("08:00", "18:00")).rejects.toThrow("Already marked"); // engulfs
  });

  it("allows a second non-overlapping shift the same day (two sites)", async () => {
    await mark("09:00", "13:00", "2026-07-18", "site-1");
    await mark("13:00", "17:00", "2026-07-18", "site-2"); // back-to-back is fine
    expect(await db.attendance.count()).toBe(2);
  });

  it("same times on a different date are fine", async () => {
    await mark("09:00", "17:00", "2026-07-18");
    await mark("09:00", "17:00", "2026-07-19");
    expect(await db.attendance.count()).toBe(2);
  });

  it("soft-deleted shift no longer blocks re-marking", async () => {
    const a = await mark("09:00", "17:00");
    await attendanceRepo.softDelete(a.id);
    await mark("09:00", "17:00");
    // old soft-deleted row + new live row
    expect(await db.attendance.count()).toBe(2);
  });

  it("other workers' shifts don't block", async () => {
    const other = await employeeRepo.put({
      name: "Babu",
      phone: null,
      role: "Helper",
      hourly_wage_paise: 8000,
    });
    await mark("09:00", "17:00");
    await markAttendance({
      employeeId: other.id,
      siteId: "site-1",
      workDate: "2026-07-18",
      startTime: "09:00",
      endTime: "17:00",
    });
    expect(await db.attendance.count()).toBe(2);
  });

  it("rejected duplicate leaves no outbox row", async () => {
    await mark("09:00", "17:00");
    await expect(mark("09:00", "17:00")).rejects.toThrow();
    const queued = await db.outbox.toArray();
    expect(queued.filter((o) => o.table === "attendance")).toHaveLength(1);
  });
});
