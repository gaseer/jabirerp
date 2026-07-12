/**
 * Money is stored and computed as INTEGER PAISE everywhere.
 * Format to ₹ only at display. 100 paise = ₹1.
 */

const RUPEE = "₹";
const MINUS = "−"; // U+2212 true minus, per spec (not hyphen)

/** Format integer paise as a rupee string. e.g. 1250000 -> "₹12,500", -85000 -> "−₹850". */
export function formatPaise(paise: number): string {
  const neg = paise < 0;
  const abs = Math.abs(Math.trunc(paise));
  const rupees = Math.floor(abs / 100);
  const fraction = abs % 100;

  // Indian grouping (lakh/crore): last 3 digits, then groups of 2.
  const grouped = groupIndian(rupees);
  const body =
    fraction === 0
      ? grouped
      : `${grouped}.${fraction.toString().padStart(2, "0")}`;

  return `${neg ? MINUS : ""}${RUPEE}${body}`;
}

/** Parse a rupee string/number (e.g. "125.00", "125") into integer paise. */
export function toPaise(rupees: string | number): number {
  const n = typeof rupees === "number" ? rupees : parseFloat(rupees.trim());
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function groupIndian(n: number): string {
  const s = n.toString();
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3;
}
