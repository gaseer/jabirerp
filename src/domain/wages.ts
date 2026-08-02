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

/**
 * Hours between two times on a shift starting at `start`; fractional
 * (12:30→17:30 = 5). If `end` is earlier than `start` the shift crossed
 * midnight (e.g. 17:00→03:00 = 10) — equal times stay 0, not 24.
 */
export function hoursBetween(start: string, end: string): number {
  const diff = toMinutes(end) - toMinutes(start);
  return (diff < 0 ? diff + 1440 : diff) / 60;
}

/**
 * Wage for one shift, rounded ONCE here. The result is stored on the row at
 * write time (wage_paise) so later wage edits never rewrite history and sums
 * stay exact integer additions.
 */
export function attendanceWagePaise(hourlyWagePaise: number, hours: number): number {
  return Math.round(hourlyWagePaise * hours);
}

/**
 * Nearby round-number suggestions (nearest ₹50 and ₹100, both directions) for
 * the contractor to round a computed wage to instead of typing it out — e.g.
 * ₹922 -> [900, 950, 1000].
 */
export function roundWageCandidates(computedPaise: number): number[] {
  if (computedPaise <= 0) return [];
  const rupees = computedPaise / 100;
  const set = new Set<number>();
  for (const step of [50, 100]) {
    set.add(Math.floor(rupees / step) * step);
    set.add(Math.ceil(rupees / step) * step);
  }
  set.delete(rupees);
  return [...set].filter((v) => v > 0).sort((a, b) => a - b);
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
