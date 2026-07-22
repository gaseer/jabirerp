import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { attendanceRepo, employeeRepo } from "@/repo/repos";
import { useAuth } from "@/store/auth";
import { editAttendance, markAttendance } from "./attendance";

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

describe("editAttendance", () => {
  const edit = (
    id: string,
    startTime: string,
    endTime: string,
    workDate = "2026-07-18",
    siteId = "site-1",
  ) => editAttendance(id, { employeeId: EMP, siteId, workDate, startTime, endTime });

  it("updates times in place and re-snapshots hours + wage", async () => {
    const a = await mark("09:00", "17:00");
    const updated = await edit(a.id, "09:00", "13:00");
    expect(updated.id).toBe(a.id);
    expect(updated.hours).toBe(4);
    expect(updated.wage_paise).toBe(40000);
    expect(await db.attendance.count()).toBe(1);
  });

  it("does not clash with itself", async () => {
    const a = await mark("09:00", "17:00");
    await expect(edit(a.id, "09:00", "17:30")).resolves.toBeTruthy(); // same window, widened
    await expect(edit(a.id, "09:00", "17:00")).resolves.toBeTruthy(); // unchanged
  });

  it("still blocks overlap with another shift that day", async () => {
    await mark("09:00", "13:00");
    const b = await mark("14:00", "18:00");
    await expect(edit(b.id, "12:00", "18:00")).rejects.toThrow("Already marked");
    // untouched on failure
    expect((await db.attendance.get(b.id))?.start_time).toBe("14:00");
  });

  it("can move a shift to another date and site", async () => {
    const a = await mark("09:00", "17:00");
    const moved = await edit(a.id, "09:00", "17:00", "2026-07-19", "site-2");
    expect(moved.work_date).toBe("2026-07-19");
    expect(moved.site_id).toBe("site-2");
  });

  it("rejects an end time before the start", async () => {
    const a = await mark("09:00", "17:00");
    await expect(edit(a.id, "17:00", "09:00")).rejects.toThrow(
      "End time must be after start time",
    );
  });

  it("refuses to edit a soft-deleted entry", async () => {
    const a = await mark("09:00", "17:00");
    await attendanceRepo.softDelete(a.id);
    await expect(edit(a.id, "09:00", "13:00")).rejects.toThrow(
      "Attendance entry not found",
    );
  });
});
