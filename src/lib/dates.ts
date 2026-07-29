/**
 * All business dates (txn_date, work_date) are LOCAL calendar dates as
 * "YYYY-MM-DD" strings. Range filters compare lexically (safe for ISO dates)
 * and are inclusive on both ends.
 */

/** Today as a local YYYY-MM-DD. Never toISOString() — that is UTC and returns
 * yesterday in IST before 05:30. */
export function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** "2026-07-12" -> "12 Jul". Parses as a local date (no TZ shift). */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
  });
}

/** "2026-07-12" -> "12 Jul 2026". Documents carry the year; lists don't need it. */
export function formatDateLong(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export interface DateRange {
  from?: string; // inclusive YYYY-MM-DD
  to?: string; // inclusive YYYY-MM-DD
}

/** Inclusive-on-both-ends range test; missing bound = open end. */
export function inRange(date: string, range: DateRange): boolean {
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;
  return true;
}

/** Human label for a range, e.g. "12 Jun – 12 Jul" / "All time". */
export function rangeLabel(range: DateRange): string {
  if (!range.from && !range.to) return "All time";
  if (range.from && range.to) return `${formatDate(range.from)} – ${formatDate(range.to)}`;
  if (range.from) return `From ${formatDate(range.from)}`;
  return `Until ${formatDate(range.to as string)}`;
}
