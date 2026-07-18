import type { SiteRow, EmployeeRow, TransactionRow } from "@/lib/db";
import { formatPaisePdf } from "@/lib/money";
import { formatDate, rangeLabel, todayIso, type DateRange } from "@/lib/dates";
import { BRAND, BRAND_PHONE, shareOrDownloadBlob, slugFilename } from "@/lib/pdf";
import type { Settlement } from "@/domain/settlement";
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
  const [{ default: jsPDF }, autoTableMod] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const autoTable = autoTableMod.default;

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const marginX = 40;
  const pageW = doc.internal.pageSize.getWidth();

  doc.setFontSize(20);
  doc.setTextColor("#2563eb");
  doc.text(BRAND, marginX, 50);
  if (BRAND_PHONE) {
    doc.setFontSize(9);
    doc.setTextColor("#7b8494");
    doc.text(BRAND_PHONE, marginX, 63);
  }
  doc.setFontSize(14);
  doc.setTextColor("#1c2430");
  doc.text(spec.title, pageW - marginX, 50, { align: "right" });
  doc.setFontSize(9);
  doc.setTextColor("#7b8494");
  doc.text(`Period: ${spec.periodLabel}`, pageW - marginX, 64, { align: "right" });

  doc.setFontSize(12);
  doc.setTextColor("#1c2430");
  doc.text(spec.partyName, marginX, 92);
  if (spec.partySub) {
    doc.setFontSize(10);
    doc.setTextColor("#7b8494");
    doc.text(spec.partySub, marginX, 107);
  }

  let y = 126;
  for (const section of spec.sections) {
    doc.setFontSize(11);
    doc.setTextColor("#1c2430");
    doc.text(section.heading, marginX, y);
    autoTable(doc, {
      startY: y + 8,
      head: [section.head],
      body: section.rows.length ? section.rows : [["—", ...section.head.slice(1).map(() => "")]],
      foot: section.foot ? [section.foot] : undefined,
      styles: { fontSize: 10, cellPadding: 6, overflow: "linebreak" },
      headStyles: { fillColor: [37, 99, 235], textColor: 255 },
      footStyles: {
        fillColor: [232, 240, 255],
        textColor: [28, 36, 48],
        fontStyle: "bold",
      },
      columnStyles: {
        [section.head.length - 1]: { halign: "right", cellWidth: 90 },
      },
      margin: { left: marginX, right: marginX },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 26;
  }

  autoTable(doc, {
    startY: y,
    body: spec.summary.map((s) => [s.k, s.v]),
    theme: "plain",
    styles: { fontSize: 11, cellPadding: 5 },
    columnStyles: { 0: { fontStyle: "normal" }, 1: { halign: "right", fontStyle: "bold" } },
    didParseCell: (data) => {
      if (spec.summary[data.row.index]?.emphasis) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fontSize = 13;
      }
    },
    margin: { left: marginX, right: marginX },
  });

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
