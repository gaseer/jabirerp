import type {
  SiteRow,
  EmployeeRow,
  TransactionRow,
  LineItemRow,
  DocKind,
} from "@/lib/db";
import { paiseToRupees } from "@/lib/money";
import { formatDate, rangeLabel, todayIso, type DateRange } from "@/lib/dates";
import { BRAND, shareOrDownloadBlob, slugFilename } from "@/lib/pdf";
import type { Settlement } from "@/domain/settlement";
import { sumPaise } from "@/domain/transactions";
import { documentTotalPaise } from "@/domain/quotation";
import { hoursLabel, timeRangeLabel } from "@/domain/wages";

/**
 * Excel (.xlsx) sibling of the customer/worker statement PDFs. Same content and
 * headings as statementPdf, but money lands in real NUMBER cells (rupees) so the
 * recipient's =SUM works — see paiseToRupees. SheetJS is dynamically imported so
 * it stays out of the initial bundle, exactly like jsPDF.
 */
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
// Optional-decimal grouping: whole rupees show as "12,500", fractions as
// "125.5" — mirrors on-screen formatPaise (which also drops a .00). Qty prints
// clean too; the "#" index column is text so it never gets a number format.
const MONEY_FMT = "#,##0.##";

type Cell = string | number;

interface XlsxSection {
  heading: string;
  head: string[];
  rows: Cell[][];
  foot?: Cell[];
}

interface XlsxSpec {
  sheetName: string;
  title: string;
  partyName: string;
  partySub?: string;
  periodLabel: string;
  sections: XlsxSection[];
  summary: { k: string; v: number }[];
  filename: string;
}

async function renderStatementXlsx(spec: XlsxSpec): Promise<void> {
  const XLSX = await import("xlsx");

  const aoa: Cell[][] = [];
  aoa.push([BRAND]);
  aoa.push([spec.title]);
  aoa.push([spec.partyName]);
  if (spec.partySub) aoa.push([spec.partySub]);
  aoa.push(["Period", spec.periodLabel]);
  aoa.push([]);

  for (const section of spec.sections) {
    aoa.push([section.heading]);
    aoa.push(section.head);
    if (section.rows.length) aoa.push(...section.rows);
    else aoa.push(["—"]);
    if (section.foot) aoa.push(section.foot);
    aoa.push([]);
  }

  aoa.push(["Summary"]);
  for (const s of spec.summary) aoa.push([s.k, s.v]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Currency format on every numeric cell (money + hours read fine as 0.00).
  const range = XLSX.utils.decode_range(ws["!ref"] as string);
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.t === "n") cell.z = MONEY_FMT;
    }
  }
  ws["!cols"] = colWidths(aoa);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, spec.sheetName);
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  await shareOrDownloadBlob(
    new Blob([out], { type: XLSX_MIME }),
    spec.filename,
    XLSX_MIME,
  );
}

/** Column widths from the longest cell in each column (chars, clamped). */
function colWidths(aoa: Cell[][]): { wch: number }[] {
  const widths: number[] = [];
  for (const row of aoa) {
    row.forEach((cell, c) => {
      const len = String(cell ?? "").length;
      if (len > (widths[c] ?? 0)) widths[c] = len;
    });
  }
  return widths.map((w) => ({ wch: Math.min(Math.max(w + 2, 10), 40) }));
}

/** Quotation/Bill workbook — numeric Qty/Rate/Amount, matches shareDocumentPdf. */
export async function shareDocumentXlsx(
  site: SiteRow,
  kind: DocKind,
  items: LineItemRow[],
): Promise<void> {
  const title = kind === "quotation" ? "QUOTATION" : "BILL";
  const total = documentTotalPaise(items);
  await renderStatementXlsx({
    sheetName: title.charAt(0) + title.slice(1).toLowerCase(),
    title,
    partyName: site.name,
    partySub:
      [site.location, site.phone, site.work_type].filter(Boolean).join("  ·  ") ||
      undefined,
    periodLabel: new Date().toLocaleDateString("en-IN"),
    sections: [
      {
        heading: "Line items",
        head: ["#", "Description", "Qty", "Rate", "Amount"],
        rows: items.map((it, i) => [
          String(i + 1),
          it.description,
          it.qty,
          paiseToRupees(it.rate_paise),
          paiseToRupees(it.amount_paise),
        ]),
        foot: ["", "", "", "Total", paiseToRupees(total)],
      },
    ],
    summary: [{ k: "Total", v: paiseToRupees(total) }],
    filename: slugFilename(kind, site.name, "xlsx"),
  });
}

/** Customer advance statement — table period-filtered, summary lifetime as of today. */
export async function shareAdvanceStatementXlsx(
  site: SiteRow,
  rangeTxns: TransactionRow[],
  range: DateRange,
  lifetime: { billTotalPaise: number; advancesToDatePaise: number },
): Promise<void> {
  const periodTotal = sumPaise(rangeTxns);
  const hasBill = lifetime.billTotalPaise > 0;
  const summary: XlsxSpec["summary"] = [];
  if (hasBill) summary.push({ k: "Bill total", v: paiseToRupees(lifetime.billTotalPaise) });
  summary.push({
    k: "Total received to date",
    v: paiseToRupees(lifetime.advancesToDatePaise),
  });
  if (hasBill)
    summary.push({
      k: `Balance due (as of ${formatDate(todayIso())})`,
      v: paiseToRupees(lifetime.billTotalPaise - lifetime.advancesToDatePaise),
    });

  await renderStatementXlsx({
    sheetName: "Advances",
    title: "ADVANCE STATEMENT",
    partyName: site.name,
    partySub: [site.location, site.phone].filter(Boolean).join("  ·  ") || undefined,
    periodLabel: rangeLabel(range),
    sections: [
      {
        heading: "Payments received",
        head: ["#", "Date", "Mode", "Note", "Amount"],
        rows: rangeTxns.map((t, i) => [
          String(i + 1),
          formatDate(t.txn_date),
          t.mode === "bank" ? "Bank" : "Cash",
          t.note ?? "",
          paiseToRupees(t.amount_paise),
        ]),
        foot: ["", "", "", "Received this period", paiseToRupees(periodTotal)],
      },
    ],
    summary,
    filename: slugFilename("advance-statement", site.name, "xlsx"),
  });
}

/** Worker settlement statement — attendance + payments period-filtered. */
export async function shareSettlementXlsx(
  employee: EmployeeRow,
  settlement: Settlement,
  range: DateRange,
  siteNames: Map<string, string>,
): Promise<void> {
  await renderStatementXlsx({
    sheetName: "Settlement",
    title: "SETTLEMENT STATEMENT",
    partyName: employee.name,
    partySub: [employee.role, employee.phone].filter(Boolean).join("  ·  ") || undefined,
    periodLabel: rangeLabel(range),
    sections: [
      {
        heading: "Attendance",
        head: ["Date", "Site", "Time", "Hours", "Wage"],
        rows: settlement.attendanceRows.map((a) => [
          formatDate(a.work_date),
          siteNames.get(a.site_id) ?? "Unknown",
          timeRangeLabel(a.start_time, a.end_time),
          hoursLabel(a.hours),
          paiseToRupees(a.wage_paise),
        ]),
        foot: ["", "", "", "Wages this period", paiseToRupees(settlement.periodWagesPaise)],
      },
      {
        heading: "Payments",
        head: ["Date", "Mode", "Note", "Amount"],
        rows: settlement.paymentRows.map((t) => [
          formatDate(t.txn_date),
          t.mode === "bank" ? "Bank" : "Cash",
          t.note ?? "",
          paiseToRupees(t.amount_paise),
        ]),
        foot: ["", "", "Paid this period", paiseToRupees(settlement.periodPaidPaise)],
      },
    ],
    summary: [
      { k: "Opening balance", v: paiseToRupees(settlement.openingBalancePaise) },
      { k: "Wages this period", v: paiseToRupees(settlement.periodWagesPaise) },
      { k: "Paid this period", v: paiseToRupees(settlement.periodPaidPaise) },
      { k: "Balance payable", v: paiseToRupees(settlement.closingBalancePaise) },
    ],
    filename: slugFilename("settlement", employee.name, "xlsx"),
  });
}
