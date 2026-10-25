import type {
  SiteRow,
  EmployeeRow,
  ShopRow,
  TransactionRow,
  LineItemRow,
  DocKind,
  DocumentRow,
} from "@/lib/db";
import { paiseToRupees } from "@/lib/money";
import { formatDate, rangeLabel, todayIso, type DateRange } from "@/lib/dates";
import { shareOrDownloadBlob, slugFilename } from "@/lib/pdf";
import { BRAND_NAME, BRAND_SUBTITLE } from "@/lib/brand";
import type { Settlement } from "@/domain/settlement";
import type { ShopLedger } from "@/domain/shops";
import { sumPaise } from "@/domain/transactions";
import { groupSections, invoiceTotals, isUnsectioned } from "@/domain/invoice";
import { hoursLabel, timeRangeLabel } from "@/domain/wages";
import type { SiteWorkersReport } from "@/domain/siteWorkers";

/** Numeric hours and wages for this site's approved attendance only. */
export async function shareSiteWorkersXlsx(site: SiteRow, report: SiteWorkersReport): Promise<void> {
  await renderStatementXlsx({
    sheetName: "Site workers",
    title: "SITE WORKERS STATEMENT",
    partyName: site.name,
    partySub: [site.location, site.work_type].filter(Boolean).join("  ·  "),
    periodLabel: "All time - approved attendance only",
    sections: [
      {
        heading: "Workers on this site",
        head: ["Worker", "Hours", "Wages"],
        rows: report.workers.map((worker) => [worker.name, worker.hours, paiseToRupees(worker.wagesPaise)]),
        foot: ["Total", report.totalHours, paiseToRupees(report.totalWagesPaise)],
      },
      {
        heading: "Approved shifts",
        head: ["Date", "Worker", "Time", "Hours", "Wage"],
        rows: report.shifts.map(({ attendance: row, workerName }) => [
          formatDate(row.work_date),
          workerName,
          timeRangeLabel(row.start_time, row.end_time),
          row.hours,
          paiseToRupees(row.wage_paise),
        ]),
      },
    ],
    summary: [
      { k: "Workers", v: report.workers.length },
      { k: "Total hours", v: report.totalHours },
      { k: "Total wages (site)", v: paiseToRupees(report.totalWagesPaise) },
    ],
    filename: slugFilename("site-workers", site.name, "xlsx"),
  });
}

/** Same filtered expenses as the PDF, with real numeric amount cells. */
export async function shareSiteExpensesXlsx(
  site: SiteRow,
  expenses: TransactionRow[],
  range: DateRange,
  category = "",
): Promise<void> {
  const total = sumPaise(expenses);
  await renderStatementXlsx({
    sheetName: "Site expenses",
    title: "SITE EXPENSES STATEMENT",
    partyName: site.name,
    partySub: [site.location, site.work_type].filter(Boolean).join("  ·  "),
    periodLabel: rangeLabel(range),
    sections: [{
      heading: category ? `Expenses - ${category}` : "Expenses - all categories",
      head: ["Date", "Category", "Mode", "Note", "Amount"],
      rows: expenses.map((expense) => [
        formatDate(expense.txn_date),
        expense.category ?? "",
        expense.mode === "bank" ? "Bank" : "Cash",
        expense.note ?? "",
        paiseToRupees(expense.amount_paise),
      ]),
      foot: ["", "", "", "Total expenses", paiseToRupees(total)],
    }],
    summary: [{ k: "Total expenses (period)", v: paiseToRupees(total) }],
    filename: slugFilename("site-expenses", site.name, "xlsx"),
  });
}

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
  // Letterhead in text form — SheetJS (community build) cannot embed images,
  // so the workbook carries the same name block the PDF prints under the logo.
  aoa.push([BRAND_NAME]);
  aoa.push([BRAND_SUBTITLE]);
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
  discountPaise = 0,
  lumpSumPaise: number | null = null,
): Promise<void> {
  const title = kind === "quotation" ? "QUOTATION" : "BILL";
  const totals = invoiceTotals(items, discountPaise, lumpSumPaise);
  const oneRate = lumpSumPaise !== null;
  const total = totals.totalPaise;
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
        head: oneRate ? ["#", "Description", "Qty"] : ["#", "Description", "Qty", "Rate", "Amount"],
        rows: items.map((it, i) => [
          String(i + 1),
          it.description,
          it.qty,
          ...(!oneRate ? [paiseToRupees(it.rate_paise), paiseToRupees(it.amount_paise)] : []),
        ]),
        foot: oneRate ? undefined : ["", "", "", totals.discountPaise > 0 ? "Subtotal" : "Total", paiseToRupees(totals.subtotalPaise)],
      },
    ],
    summary: [
      ...((totals.discountPaise > 0 || oneRate) ? [
        { k: oneRate ? "One Rate for all" : "Subtotal", v: paiseToRupees(totals.subtotalPaise) },
      ] : []),
      ...(totals.discountPaise > 0 ? [{ k: "Discount", v: -paiseToRupees(totals.discountPaise) }] : []),
      { k: "Total", v: paiseToRupees(total) },
    ],
    filename: slugFilename(kind, site.name, "xlsx"),
  });
}

/**
 * Direct-invoice workbook — one section per group with its own subtotal row,
 * then Subtotal / Discount / Total. Money lands in real number cells so the
 * recipient can re-check the arithmetic with =SUM.
 */
export async function shareInvoiceXlsx(
  site: SiteRow,
  invoice: DocumentRow,
  items: LineItemRow[],
): Promise<void> {
  const oneRate = invoice.lump_sum_paise != null;
  const sections = groupSections(items);
  const flat = isUnsectioned(sections);
  const totals = invoiceTotals(items, invoice.discount_paise, invoice.lump_sum_paise);

  const head = oneRate ? ["#", "Work / Item", "Unit", "Qty"] : ["#", "Work / Item", "Unit", "Qty", "Rate", "Amount"];
  let lineNo = 0;
  const xlsxSections: XlsxSection[] = sections.map((section) => ({
    heading: flat ? "Line items" : section.name,
    head,
    rows: section.items.map((it) => [
      String(++lineNo),
      it.description,
      it.unit ?? "",
      it.qty,
      ...(!oneRate ? [paiseToRupees(it.rate_paise), paiseToRupees(it.amount_paise)] : []),
    ]),
    foot: oneRate ? undefined : flat
      ? ["", "", "", "", "Subtotal", paiseToRupees(section.subtotalPaise)]
      : ["", "", "", "", `${section.name} subtotal`, paiseToRupees(section.subtotalPaise)],
  }));

  const summary = [{ k: oneRate ? "One Rate for all" : "Subtotal", v: paiseToRupees(totals.subtotalPaise) }];
  if (totals.discountPaise > 0)
    summary.push({ k: "Discount", v: -paiseToRupees(totals.discountPaise) });
  summary.push({ k: "Total", v: paiseToRupees(totals.totalPaise) });

  await renderStatementXlsx({
    sheetName: "Invoice",
    title: `INVOICE ${invoice.doc_number ?? ""}`.trim(),
    partyName: site.name,
    partySub:
      [invoice.title, site.location, site.phone, site.work_type]
        .filter(Boolean)
        .join("  ·  ") || undefined,
    periodLabel: invoice.doc_date ? formatDate(invoice.doc_date) : todayIso(),
    sections: xlsxSections.length
      ? xlsxSections
      : [{ heading: "Line items", head, rows: [] }],
    summary,
    filename: slugFilename(
      invoice.doc_number?.toLowerCase() || "invoice",
      site.name,
      "xlsx",
    ),
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

/** Shop statement — every received/paid txn with the running holding. */
export async function shareShopStatementXlsx(
  shop: ShopRow,
  ledger: ShopLedger,
  range: DateRange,
  siteName?: string,
): Promise<void> {
  const summary: XlsxSpec["summary"] = [];
  if (range.from)
    summary.push({ k: "Opening holding", v: paiseToRupees(ledger.openingHoldingPaise) });
  summary.push(
    { k: "Received this period", v: paiseToRupees(ledger.periodReceivedPaise) },
    { k: "Paid this period", v: paiseToRupees(ledger.periodPaidPaise) },
    {
      k: "Holding (still to pay the shop)",
      v: paiseToRupees(ledger.closingHoldingPaise),
    },
  );

  await renderStatementXlsx({
    sheetName: "Shop",
    title: "SHOP STATEMENT",
    partyName: shop.name,
    partySub: [siteName, shop.phone].filter(Boolean).join("  ·  ") || undefined,
    periodLabel: rangeLabel(range),
    sections: [
      {
        heading: "Transactions",
        head: ["#", "Date", "Type", "Mode", "Note", "Amount", "Holding"],
        rows: ledger.entries.map((e, i) => [
          String(i + 1),
          formatDate(e.txn.txn_date),
          e.direction === "in" ? "Received" : "Paid",
          e.txn.mode === "bank" ? "Bank" : "Cash",
          e.txn.note ?? "",
          paiseToRupees(e.txn.amount_paise),
          paiseToRupees(e.holdingAfterPaise),
        ]),
        foot: ["", "", "", "", "", "Closing holding", paiseToRupees(ledger.closingHoldingPaise)],
      },
    ],
    summary,
    filename: slugFilename("shop-statement", shop.name, "xlsx"),
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
