import { describe, expect, it } from "vitest";
import type { AttendanceRow } from "@/lib/db";
import { buildSiteWorkersReport } from "./siteWorkers";

function shift(patch: Partial<AttendanceRow> = {}): AttendanceRow {
  return {
    id: "shift-1", owner_id: "owner", created_at: "", updated_at: "", deleted_at: null, _dirty: 0,
    site_id: "site-1", employee_id: "worker-1", work_date: "2026-10-25",
    start_time: "09:00", end_time: "17:00", hours: 8, wage_paise: 75000, status: "approved",
    ...patch,
  };
}

describe("buildSiteWorkersReport", () => {
  it("groups shifts by worker and sums stored wages, including round-off overrides", () => {
    const report = buildSiteWorkersReport("site-1", [
      shift(),
      shift({ id: "shift-2", hours: 4.5, wage_paise: 45000 }),
      shift({ id: "shift-3", employee_id: "worker-2", hours: 2, wage_paise: 12500 }),
    ], [{ id: "worker-1", name: "Suresh" }, { id: "worker-2", name: "Babu" }]);
    expect(report.workers).toEqual([
      { employeeId: "worker-1", name: "Suresh", hours: 12.5, wagesPaise: 120000 },
      { employeeId: "worker-2", name: "Babu", hours: 2, wagesPaise: 12500 },
    ]);
    expect(report.totalHours).toBe(14.5);
    expect(report.totalWagesPaise).toBe(132500);
    expect(report.shifts).toHaveLength(3);
  });

  it("excludes other sites, pending/rejected attendance, and deleted shifts", () => {
    const included = shift();
    const report = buildSiteWorkersReport("site-1", [
      included,
      shift({ site_id: "site-2" }),
      shift({ status: "pending" }),
      shift({ status: "rejected" }),
      shift({ deleted_at: "2026-10-25T12:00:00Z" }),
    ], [{ id: "worker-1", name: "Suresh" }]);
    expect(report.shifts).toEqual([{ attendance: included, workerName: "Suresh" }]);
    expect(report.totalHours).toBe(8);
    expect(report.totalWagesPaise).toBe(75000);
  });

  it("keeps historical attendance when the worker is no longer in the active list", () => {
    const report = buildSiteWorkersReport("site-1", [shift()], []);
    expect(report.workers[0].name).toBe("Unknown");
    expect(report.shifts[0].workerName).toBe("Unknown");
    expect(report.totalWagesPaise).toBe(75000);
  });

  it("returns empty summaries for a site with no attendance", () => {
    expect(buildSiteWorkersReport("site-1", [], [])).toEqual({
      workers: [], shifts: [], totalHours: 0, totalWagesPaise: 0,
    });
  });
});
