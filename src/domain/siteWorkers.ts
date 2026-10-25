import type { AttendanceRow, EmployeeRow } from "@/lib/db";

export interface SiteWorkerSummary {
  employeeId: string;
  name: string;
  hours: number;
  wagesPaise: number;
}

export interface SiteWorkersReport {
  workers: SiteWorkerSummary[];
  shifts: { attendance: AttendanceRow; workerName: string }[];
  totalHours: number;
  totalWagesPaise: number;
}

/** Match the site's wage summary: approved, non-deleted shifts only. */
export function buildSiteWorkersReport(
  siteId: string,
  attendance: AttendanceRow[],
  employees: Pick<EmployeeRow, "id" | "name">[],
): SiteWorkersReport {
  const names = new Map(employees.map((employee) => [employee.id, employee.name]));
  const byWorker = new Map<string, SiteWorkerSummary>();
  const shifts = attendance
    .filter((row) => row.site_id === siteId && row.deleted_at === null && row.status === "approved")
    .map((row) => ({ attendance: row, workerName: names.get(row.employee_id) ?? "Unknown" }));
  let totalHours = 0;
  let totalWagesPaise = 0;
  for (const { attendance: row, workerName } of shifts) {
    const worker = byWorker.get(row.employee_id) ?? {
      employeeId: row.employee_id,
      name: workerName,
      hours: 0,
      wagesPaise: 0,
    };
    worker.hours += row.hours;
    worker.wagesPaise += row.wage_paise;
    byWorker.set(row.employee_id, worker);
    totalHours += row.hours;
    totalWagesPaise += row.wage_paise;
  }
  return { workers: [...byWorker.values()], shifts, totalHours, totalWagesPaise };
}
