import { db, type AttendanceRow, type AttendanceStatus } from "@/lib/db";
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
  /** Omit for all statuses — the overlap/duplicate-day guard relies on that
   * (a pending shift still occupies its time slot). */
  status?: AttendanceStatus | AttendanceStatus[];
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
  const statuses = filter.status
    ? Array.isArray(filter.status)
      ? filter.status
      : [filter.status]
    : null;
  return rows
    .filter(
      (a) =>
        a.deleted_at === null &&
        (!filter.employeeId || a.employee_id === filter.employeeId) &&
        (!filter.siteId || a.site_id === filter.siteId) &&
        (!statuses || statuses.includes(a.status)) &&
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
 * Validate + build the stored shape of a shift. `ignoreId` is the row being
 * edited: it must not clash with itself, but every OTHER live shift for that
 * worker on that date still blocks (regardless of status — a pending shift
 * still occupies its time slot). Everything else (time validity, positive
 * length, wage snapshot) is identical for create and edit.
 */
/**
 * `wagePaiseOverride` lets the contractor round the computed wage (e.g. 922 →
 * 900) instead of storing the raw hours × rate figure. Only exposed through
 * markAttendance/editAttendance — markSelfAttendance never accepts it, so a
 * worker's self-marked shift always gets the plain computed wage.
 */
async function buildShift(
  input: MarkAttendanceInput,
  ignoreId?: string,
  status: AttendanceStatus = "approved",
  wagePaiseOverride?: number,
) {
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
    (r) =>
      r.id !== ignoreId && input.startTime < r.end_time && r.start_time < input.endTime,
  );
  if (clash)
    throw new Error(
      `Already marked ${timeRangeLabel(clash.start_time, clash.end_time)} on this date`,
    );
  return {
    employee_id: input.employeeId,
    site_id: input.siteId,
    work_date: input.workDate,
    start_time: input.startTime,
    end_time: input.endTime,
    hours,
    wage_paise: wagePaiseOverride ?? attendanceWagePaise(employee.hourly_wage_paise, hours),
    status,
  };
}

/**
 * Record a worked shift (admin/trusted entry — lands "approved" immediately,
 * no self-approval loop). Snapshots the wage: computes wage_paise from the
 * employee's CURRENT hourly wage and the shift length, and stores both —
 * future wage edits only affect future attendance. Multiple shifts per day
 * are allowed (two sites in one day is legitimate), but a shift may not
 * OVERLAP an existing one — a worker can't be in two places at once, and this
 * is what blocks accidental duplicate marking. Overnight shifts (end time
 * before start time) are allowed and stored under the start date.
 * `wagePaiseOverride` lets the contractor round the wage off at entry time
 * instead of storing the raw hours × rate figure.
 */
export async function markAttendance(
  input: MarkAttendanceInput,
  wagePaiseOverride?: number,
): Promise<AttendanceRow> {
  return attendanceRepo.put(await buildShift(input, undefined, "approved", wagePaiseOverride));
}

/**
 * Worker self-service entry point: the only difference from markAttendance is
 * the row lands "pending" and stays invisible to wages/settlement/P&L until
 * an admin approves it (see approveAttendance/rejectAttendance below).
 */
export async function markSelfAttendance(
  input: MarkAttendanceInput,
): Promise<AttendanceRow> {
  return attendanceRepo.put(await buildShift(input, undefined, "pending"));
}

/**
 * Correct an existing shift (wrong times / date / site picked). Runs the same
 * overlap guard as marking, minus this row itself, so a mis-typed shift can be
 * fixed in place without the "Already marked" error firing on its own entry.
 * The wage is re-snapshotted at the worker's current hourly rate, since the
 * hours may have changed — an edit is a write, not a recompute of history.
 * Status is preserved (an edit doesn't reset a pending/approved/rejected row).
 * `wagePaiseOverride` lets the contractor round the re-snapshotted wage off
 * instead of storing the raw hours × rate figure.
 */
export async function editAttendance(
  id: string,
  input: MarkAttendanceInput,
  wagePaiseOverride?: number,
): Promise<AttendanceRow> {
  const existing = await attendanceRepo.getById(id);
  if (!existing || existing.deleted_at !== null)
    throw new Error("Attendance entry not found");
  return attendanceRepo.put({
    ...existing,
    ...(await buildShift(input, id, existing.status, wagePaiseOverride)),
  });
}

/**
 * Admin review of a worker-submitted shift. Only flips status — hours/times/
 * wage_paise stay exactly as submitted, so approving never silently changes
 * what was recorded. `wagePaiseOverride` lets the contractor round the wage
 * off at the moment of approval (the one point a worker-submitted shift can
 * have its wage adjusted).
 */
export async function approveAttendance(
  id: string,
  wagePaiseOverride?: number,
): Promise<AttendanceRow> {
  const existing = await attendanceRepo.getById(id);
  if (!existing || existing.deleted_at !== null)
    throw new Error("Attendance entry not found");
  return attendanceRepo.put({
    ...existing,
    status: "approved",
    wage_paise: wagePaiseOverride ?? existing.wage_paise,
  });
}

/** Rejects a worker-submitted shift — excluded from wages permanently. */
export async function rejectAttendance(id: string): Promise<AttendanceRow> {
  const existing = await attendanceRepo.getById(id);
  if (!existing || existing.deleted_at !== null)
    throw new Error("Attendance entry not found");
  return attendanceRepo.put({ ...existing, status: "rejected" });
}
