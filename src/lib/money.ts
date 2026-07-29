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

/**
 * Parse a rupee string/number (e.g. "125.00", "1,200", "₹500") into integer
 * paise. Strips ₹, thousands separators and spaces first — parseFloat("1,200")
 * would silently stop at the comma and read ₹1.
 */
export function toPaise(rupees: string | number): number {
  const n =
    typeof rupees === "number"
      ? rupees
      : parseFloat(rupees.replace(/[₹,\s]/g, ""));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/**
 * PDF-safe money format: jsPDF's built-in Helvetica (WinAnsi encoding) cannot
 * render ₹ (U+20B9) or − (U+2212) — they print as garbage. Every PDF uses this
 * instead of formatPaise. On-screen formatting is unaffected.
 */
export function formatPaisePdf(paise: number): string {
  const neg = paise < 0;
  const abs = Math.abs(Math.trunc(paise));
  const rupees = Math.floor(abs / 100);
  const fraction = abs % 100;
  const grouped = groupIndian(rupees);
  const body =
    fraction === 0
      ? grouped
      : `${grouped}.${fraction.toString().padStart(2, "0")}`;
  return `${neg ? "-" : ""}Rs ${body}`;
}

/**
 * Integer paise -> a plain rupees NUMBER (e.g. 1250000 -> 12500, -85000 -> -850).
 * For real numeric spreadsheet cells so Excel =SUM works. Never used for display
 * (no grouping/symbol) — that is formatPaise's job.
 */
export function paiseToRupees(paise: number): number {
  return Math.trunc(paise) / 100;
}

const ONES = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = [
  "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
];

/** 0–99 in words. */
function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const t = TENS[Math.floor(n / 10)];
  const o = n % 10;
  return o ? `${t} ${ONES[o]}` : t;
}

/** 0–999 in words. */
function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (!h) return twoDigits(rest);
  return rest ? `${ONES[h]} Hundred ${twoDigits(rest)}` : `${ONES[h]} Hundred`;
}

/**
 * Integer paise as the amount-in-words line every Indian bill carries, in the
 * Indian system (crore / lakh / thousand):
 * 7512500 -> "Rupees Seventy Five Thousand One Hundred Twenty Five Only".
 * Paise, when non-zero, print as "… and Fifty Paise Only".
 */
export function rupeesInWords(paise: number): string {
  const neg = paise < 0;
  const abs = Math.abs(Math.trunc(paise));
  let rupees = Math.floor(abs / 100);
  const fraction = abs % 100;

  const parts: string[] = [];
  const crore = Math.floor(rupees / 10000000);
  if (crore) {
    parts.push(`${threeDigits(crore % 1000)} Crore`);
    rupees %= 10000000;
  }
  const lakh = Math.floor(rupees / 100000);
  if (lakh) {
    parts.push(`${twoDigits(lakh)} Lakh`);
    rupees %= 100000;
  }
  const thousand = Math.floor(rupees / 1000);
  if (thousand) {
    parts.push(`${twoDigits(thousand)} Thousand`);
    rupees %= 1000;
  }
  if (rupees) parts.push(threeDigits(rupees));
  if (parts.length === 0) parts.push("Zero");

  const rupeeWords = `Rupees ${neg ? "Minus " : ""}${parts.join(" ")}`;
  return fraction
    ? `${rupeeWords} and ${twoDigits(fraction)} Paise Only`
    : `${rupeeWords} Only`;
}

function groupIndian(n: number): string {
  const s = n.toString();
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3;
}
