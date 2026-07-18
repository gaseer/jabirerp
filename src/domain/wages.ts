/**
 * Wages are HOURLY: an attendance entry is a from/to shift on a date, and
 * wage = hourly rate × hours between the times. All time strings are "HH:MM"
 * 24-hour, zero-padded — lexical compare works and round-trips sync cleanly.
 */

const TIME_RE = /^\d{2}:\d{2}$/;

export function isValidTime(t: string): boolean {
  if (!TIME_RE.test(t)) return false;
  const [h, m] = t.split(":").map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** Hours between two times on the same day; fractional (12:30→17:30 = 5). */
export function hoursBetween(start: string, end: string): number {
  return (toMinutes(end) - toMinutes(start)) / 60;
}

/**
 * Wage for one shift, rounded ONCE here. The result is stored on the row at
 * write time (wage_paise) so later wage edits never rewrite history and sums
 * stay exact integer additions.
 */
export function attendanceWagePaise(hourlyWagePaise: number, hours: number): number {
  return Math.round(hourlyWagePaise * hours);
}

/** Sum of stored per-entry wages. Rows must already be non-deleted. */
export function wagesEarnedPaise(rows: { wage_paise: number }[]): number {
  return rows.reduce((s, r) => s + r.wage_paise, 0);
}

/** "13:00" -> "1:00 PM". */
export function formatTime12(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** "13:00","15:00" -> "1:00 PM – 3:00 PM". */
export function timeRangeLabel(start: string, end: string): string {
  return `${formatTime12(start)} – ${formatTime12(end)}`;
}

/** 5 -> "5h", 4.5 -> "4.5h" — how a shift's length renders in lists and PDFs. */
export function hoursLabel(hours: number): string {
  return `${Number(hours.toFixed(2))}h`;
}
