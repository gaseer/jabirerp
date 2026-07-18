import { db, type AttendanceRow } from "@/lib/db";
import { inRange, type DateRange } from "@/lib/dates";
import { attendanceRepo, employeeRepo } from "@/repo/repos";
import {
  attendanceWagePaise,
  hoursBetween,
  isValidTime,
  timeRangeLabel,
} from "./wages";

export interface AttendanceFilter extends DateRange {
  employeeId?: string;
  siteId?: string;
}

/** Non-deleted attendance matching the filter, newest first. */
export async function listAttendance(
  filter: AttendanceFilter = {},
): Promise<AttendanceRow[]> {
  let rows: AttendanceRow[];
  if (filter.employeeId) {
    rows = await db.attendance.where("employee_id").equals(filter.employeeId).toArray();
  } else if (filter.siteId) {
    rows = await db.attendance.where("site_id").equals(filter.siteId).toArray();
  } else {
    rows = await db.attendance.toArray();
  }
  return rows
    .filter(
      (a) =>
        a.deleted_at === null &&
        (!filter.employeeId || a.employee_id === filter.employeeId) &&
        (!filter.siteId || a.site_id === filter.siteId) &&
        inRange(a.work_date, filter),
    )
    .sort(
      (a, b) =>
        b.work_date.localeCompare(a.work_date) ||
        b.created_at.localeCompare(a.created_at),
    );
}

export interface MarkAttendanceInput {
  employeeId: string;
  siteId: string;
  workDate: string;
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM", after startTime
}

/**
 * Record a worked shift. Snapshots the wage: computes wage_paise from the
 * employee's CURRENT hourly wage and the shift length, and stores both —
 * future wage edits only affect future attendance. Multiple shifts per day
 * are allowed (two sites in one day is legitimate), but a shift may not
 * OVERLAP an existing one — a worker can't be in two places at once, and this
 * is what blocks accidental duplicate marking. Overnight shifts are not allowed.
 */
export async function markAttendance(input: MarkAttendanceInput): Promise<AttendanceRow> {
  const employee = await employeeRepo.getById(input.employeeId);
  if (!employee) throw new Error("Worker not found");
  if (!isValidTime(input.startTime) || !isValidTime(input.endTime))
    throw new Error("Invalid time");
  const hours = hoursBetween(input.startTime, input.endTime);
  if (hours <= 0) throw new Error("End time must be after start time");
  const sameDay = await listAttendance({
    employeeId: input.employeeId,
    from: input.workDate,
    to: input.workDate,
  });
  const clash = sameDay.find(
    (r) => input.startTime < r.end_time && r.start_time < input.endTime,
  );
  if (clash)
    throw new Error(
      `Already marked ${timeRangeLabel(clash.start_time, clash.end_time)} on this date`,
    );
  return attendanceRepo.put({
    employee_id: input.employeeId,
    site_id: input.siteId,
    work_date: input.workDate,
    start_time: input.startTime,
    end_time: input.endTime,
    hours,
    wage_paise: attendanceWagePaise(employee.hourly_wage_paise, hours),
  });
}
