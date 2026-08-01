import type { AttendanceRow, TransactionRow } from "@/lib/db";
import type { DateRange } from "@/lib/dates";
import { listAttendance } from "./attendance";
import { listTxns, sumPaise } from "./transactions";
import { wagesEarnedPaise } from "./wages";

/**
 * A worker settlement over a date range. Payments are transactions; the
 * balance is always DERIVED (wages earned − payments made), never stored.
 * Opening balance covers everything strictly before `from`, so a ranged
 * statement is self-consistent: opening + period wages − period paid = closing.
 * Attendance filters by work_date; payments by txn_date.
 */
export interface Settlement {
  attendanceRows: AttendanceRow[];
  paymentRows: TransactionRow[];
  openingBalancePaise: number;
  periodWagesPaise: number;
  periodPaidPaise: number;
  closingBalancePaise: number;
}

/** Lifetime balance payable to the worker (wages − payments). */
export async function empBalancePaise(employeeId: string): Promise<number> {
  const s = await buildSettlement(employeeId, {});
  return s.closingBalancePaise;
}

export async function buildSettlement(
  employeeId: string,
  range: DateRange,
): Promise<Settlement> {
  // Pending/rejected shifts don't earn wages until approved — settlement
  // (balance payable, and the statement PDF built from it) must never count
  // them.
  const [attendanceRows, paymentRows] = await Promise.all([
    listAttendance({ employeeId, status: "approved", ...range }),
    listTxns({ employeeId, types: ["worker_payment"], ...range }),
  ]);

  let openingBalancePaise = 0;
  if (range.from) {
    const before = { to: prevDay(range.from) };
    const [prevAtt, prevPay] = await Promise.all([
      listAttendance({ employeeId, status: "approved", ...before }),
      listTxns({ employeeId, types: ["worker_payment"], ...before }),
    ]);
    openingBalancePaise = wagesEarnedPaise(prevAtt) - sumPaise(prevPay);
  }

  const periodWagesPaise = wagesEarnedPaise(attendanceRows);
  const periodPaidPaise = sumPaise(paymentRows);
  return {
    attendanceRows,
    paymentRows,
    openingBalancePaise,
    periodWagesPaise,
    periodPaidPaise,
    closingBalancePaise: openingBalancePaise + periodWagesPaise - periodPaidPaise,
  };
}

/** Day before an ISO date, as a local calendar date. */
function prevDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d - 1);
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${dt.getFullYear()}-${mm}-${dd}`;
}
