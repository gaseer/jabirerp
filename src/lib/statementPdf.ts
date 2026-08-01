import type { SiteRow, EmployeeRow, ShopRow, TransactionRow } from "@/lib/db";
import { formatPaisePdf } from "@/lib/money";
import { formatDate, rangeLabel, todayIso, type DateRange } from "@/lib/dates";
import {
  PAGE_MARGIN,
  drawLetterhead,
  drawPartyBlock,
  ensureSpace,
  lastTableY,
  loadPdfLibs,
  paintFooters,
  shareOrDownloadBlob,
  slugFilename,
  tableTheme,
} from "@/lib/pdf";
import { BRAND_COLORS } from "@/lib/brand";
import type { Settlement } from "@/domain/settlement";
import type { ShopLedger } from "@/domain/shops";
import { sumPaise } from "@/domain/transactions";
import { hoursLabel, timeRangeLabel } from "@/domain/wages";

/**
 * Generic customer/worker-facing statement PDF. Same lazy jsPDF import and
 * brand header as the quotation PDF; money always via formatPaisePdf (the
 * built-in PDF fonts cannot render ₹ / U+2212).
 */
export interface StatementSection {
  heading: string;
  head: string[];
  rows: string[][];
  foot?: string[];
  /** First right-aligned column index. Defaults to the last column only. */
  rightAlignFrom?: number;
}

export interface StatementSpec {
  title: string;
  partyName: string;
  partySub?: string;
  periodLabel: string;
  sections: StatementSection[];
  summary: { k: string; v: string; emphasis?: boolean }[];
  filename: string;
}

export async function renderStatementPdf(spec: StatementSpec): Promise<void> {
  const { jsPDF, autoTable } = await loadPdfLibs();
  const doc = new jsPDF({ unit: "pt", format: "a4" });

  let y = await drawLetterhead(doc, {
    title: spec.title,
    meta: [`Period: ${spec.periodLabel}`],
  });
  y = drawPartyBlock(doc, y, {
    label: "Statement for",
    name: spec.partyName,
    lines: [spec.partySub],
  });

  for (const section of spec.sections) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(BRAND_COLORS.navy);
    doc.text(section.heading, PAGE_MARGIN, y);
    autoTable(doc, {
      ...tableTheme(),
      startY: y + 8,
      head: [section.head],
      body: section.rows.length
        ? section.rows
        : [["—", ...section.head.slice(1).map(() => "")]],
      foot: section.foot ? [section.foot] : undefined,
      columnStyles: Object.fromEntries(
        section.head
          .map((_, i) => i)
          .filter((i) => i >= (section.rightAlignFrom ?? section.head.length - 1))
          .map((i) => [i, { halign: "right", cellWidth: 90 }] as const),
      ),
    });
    y = lastTableY(doc) + 28;
  }

  // Summary block: a plain two-column table so it page-breaks with the rest.
  y = ensureSpace(doc, y, 40 + spec.summary.length * 22);
  autoTable(doc, {
    startY: y,
    body: spec.summary.map((s) => [s.k, s.v]),
    theme: "plain",
    styles: { fontSize: 10.5, cellPadding: 5, textColor: BRAND_COLORS.ink },
    columnStyles: { 0: { fontStyle: "normal" }, 1: { halign: "right", fontStyle: "bold" } },
    didParseCell: (data) => {
      if (spec.summary[data.row.index]?.emphasis) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fontSize = 13;
        data.cell.styles.textColor = BRAND_COLORS.navy;
      }
    },
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN, top: 54, bottom: 62 },
  });

  paintFooters(doc);
  await shareOrDownloadBlob(doc.output("blob"), spec.filename);
}

/**
 * Customer advance statement. The table is period-filtered; the summary block
 * is LIFETIME "as of today" — a range-filtered balance would mislead.
 */
export async function shareAdvanceStatementPdf(
  site: SiteRow,
  rangeTxns: TransactionRow[],
  range: DateRange,
  lifetime: { billTotalPaise: number; advancesToDatePaise: number },
): Promise<void> {
  const periodTotal = sumPaise(rangeTxns);
  const hasBill = lifetime.billTotalPaise > 0;
  const summary: StatementSpec["summary"] = [];
  if (hasBill) summary.push({ k: "Bill total", v: formatPaisePdf(lifetime.billTotalPaise) });
  summary.push({
    k: "Total received to date",
    v: formatPaisePdf(lifetime.advancesToDatePaise),
  });
  if (hasBill)
    summary.push({
      k: `Balance due (as of ${formatDate(todayIso())})`,
      v: formatPaisePdf(lifetime.billTotalPaise - lifetime.advancesToDatePaise),
      emphasis: true,
    });

  await renderStatementPdf({
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
          formatPaisePdf(t.amount_paise),
        ]),
        foot: ["", "", "", "Received this period", formatPaisePdf(periodTotal)],
      },
    ],
    summary,
    filename: slugFilename("advance-statement", site.name),
  });
}

/**
 * Shop statement — every received/paid txn with the running holding, so the
 * shop owner can see exactly what is still held for them. Pass-through money:
 * this is never income, and the closing holding is what remains payable.
 */
export async function shareShopStatementPdf(
  shop: ShopRow,
  ledger: ShopLedger,
  range: DateRange,
  siteName?: string,
): Promise<void> {
  const summary: StatementSpec["summary"] = [];
  if (range.from)
    summary.push({ k: "Opening holding", v: formatPaisePdf(ledger.openingHoldingPaise) });
  summary.push(
    { k: "Received this period", v: formatPaisePdf(ledger.periodReceivedPaise) },
    { k: "Paid this period", v: formatPaisePdf(ledger.periodPaidPaise) },
    {
      k: "Holding (still to pay the shop)",
      v: formatPaisePdf(ledger.closingHoldingPaise),
      emphasis: true,
    },
  );

  await renderStatementPdf({
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
          formatPaisePdf(e.txn.amount_paise),
          formatPaisePdf(e.holdingAfterPaise),
        ]),
        rightAlignFrom: 5,
        // Received/paid totals live in the summary block; the table foot
        // closes the running column it belongs to.
        foot: ["", "", "", "", "", "Closing holding", formatPaisePdf(ledger.closingHoldingPaise)],
      },
    ],
    summary,
    filename: slugFilename("shop-statement", shop.name),
  });
}

/**
 * Worker settlement statement. Attendance + payments tables are
 * period-filtered; opening + period wages − period paid = balance payable.
 */
export async function shareSettlementPdf(
  employee: EmployeeRow,
  settlement: Settlement,
  range: DateRange,
  siteNames: Map<string, string>,
): Promise<void> {
  await renderStatementPdf({
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
          formatPaisePdf(a.wage_paise),
        ]),
        foot: [
          "",
          "",
          "",
          "Wages this period",
          formatPaisePdf(settlement.periodWagesPaise),
        ],
      },
      {
        heading: "Payments",
        head: ["Date", "Mode", "Note", "Amount"],
        rows: settlement.paymentRows.map((t) => [
          formatDate(t.txn_date),
          t.mode === "bank" ? "Bank" : "Cash",
          t.note ?? "",
          formatPaisePdf(t.amount_paise),
        ]),
        foot: ["", "", "Paid this period", formatPaisePdf(settlement.periodPaidPaise)],
      },
    ],
    summary: [
      { k: "Opening balance", v: formatPaisePdf(settlement.openingBalancePaise) },
      { k: "Wages this period", v: formatPaisePdf(settlement.periodWagesPaise) },
      { k: "Paid this period", v: formatPaisePdf(settlement.periodPaidPaise) },
      {
        k: "Balance payable",
        v: formatPaisePdf(settlement.closingBalancePaise),
        emphasis: true,
      },
    ],
    filename: slugFilename("settlement", employee.name),
  });
}
