import type { jsPDF } from "jspdf";
import type { UserOptions } from "jspdf-autotable";
import { documentTotalPaise } from "@/domain/quotation";
import { groupSections, invoiceTotals, isUnsectioned } from "@/domain/invoice";
import type { DocKind, DocumentRow, LineItemRow, SiteRow } from "@/lib/db";
import { formatDateLong, todayIso } from "@/lib/dates";
import { formatPaisePdf, rupeesInWords } from "@/lib/money";
import {
  BRAND_COLORS,
  BRAND_FULL,
  BRAND_NAME,
  BRAND_SUBTITLE,
  LOGO_MARK_ASPECT,
  brandContactLines,
  loadBrandLogo,
} from "@/lib/brand";

/**
 * Customer-facing PDFs. Every document shares one letterhead (logo mark +
 * uppercase trading name + accent rule), one table theme and one footer, so a
 * quotation, a bill, an invoice and a statement all read as the same business.
 *
 * jsPDF + autotable are dynamically imported so they stay out of the initial
 * bundle — they only load when the user actually shares. jsPDF's built-in font
 * cannot render `₹` or `−`, so money always goes through formatPaisePdf.
 *
 * PDFs are customer-facing: never put internal data (costs, wages, profit) here.
 */

export const PAGE_MARGIN = 40;

/** Printed under every quotation — an unpriced offer needs an expiry. */
export const QUOTATION_VALIDITY =
  "This quotation is valid for 30 days from the date above. Rates cover the work and items listed; anything extra will be quoted separately.";

type AutoTable = (doc: jsPDF, options: UserOptions) => void;

/** Lazily load jsPDF + autotable together (one dynamic chunk each). */
export async function loadPdfLibs(): Promise<{
  jsPDF: typeof import("jspdf").jsPDF;
  autoTable: AutoTable;
}> {
  const [{ default: JsPDF }, autoTableMod] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  return { jsPDF: JsPDF, autoTable: autoTableMod.default as unknown as AutoTable };
}

/** Where the last autotable finished (jsPDF carries it on the instance). */
export function lastTableY(doc: jsPDF): number {
  return (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 0;
}

/**
 * Letterhead: logo mark, trading name, contact lines, and the document title +
 * its meta on the right, closed by a navy rule with a red accent. Returns
 * the y to continue from.
 */
export async function drawLetterhead(
  doc: jsPDF,
  opts: { title: string; meta?: string[] },
): Promise<number> {
  const pageW = doc.internal.pageSize.getWidth();
  const right = pageW - PAGE_MARGIN;
  const logo = await loadBrandLogo();

  // Size from the height and derive the width — the mark is a tall bulb, and a
  // square box would squash it.
  const markH = 56;
  const markW = markH * LOGO_MARK_ASPECT;
  let textX = PAGE_MARGIN;
  if (logo) {
    doc.addImage(logo, "PNG", PAGE_MARGIN, 28, markW, markH);
    textX = PAGE_MARGIN + markW + 14;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.setTextColor(BRAND_COLORS.navy);
  doc.text(BRAND_NAME, textX, 52);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(BRAND_COLORS.blue);
  doc.setCharSpace(1.1);
  doc.text(BRAND_SUBTITLE, textX, 65);
  doc.setCharSpace(0);

  doc.setFontSize(8);
  doc.setTextColor(BRAND_COLORS.muted);
  let contactY = 78;
  for (const line of brandContactLines()) {
    doc.text(line, textX, contactY);
    contactY += 11;
  }

  // Document title + meta, right-aligned against the same baseline grid.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(19);
  doc.setTextColor(BRAND_COLORS.ink);
  doc.text(opts.title.toUpperCase(), right, 52, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(BRAND_COLORS.muted);
  let metaY = 67;
  for (const line of opts.meta ?? []) {
    doc.text(line, right, metaY, { align: "right" });
    metaY += 12;
  }

  const ruleY = Math.max(94, contactY, metaY) + 2;
  doc.setDrawColor(BRAND_COLORS.navy);
  doc.setLineWidth(1.4);
  doc.line(PAGE_MARGIN, ruleY, right, ruleY);
  doc.setDrawColor(BRAND_COLORS.accent);
  doc.setLineWidth(3);
  doc.line(PAGE_MARGIN, ruleY, PAGE_MARGIN + 64, ruleY);
  doc.setLineWidth(0.5);

  return ruleY + 22;
}

/** Tinted "BILL TO" card holding the customer/worker details. */
export function drawPartyBlock(
  doc: jsPDF,
  y: number,
  opts: { label: string; name: string; lines?: (string | null | undefined)[] },
): number {
  const pageW = doc.internal.pageSize.getWidth();
  const width = pageW - PAGE_MARGIN * 2;
  const lines = (opts.lines ?? []).filter((l): l is string => Boolean(l && l.trim()));
  const height = 34 + lines.length * 12;

  doc.setFillColor(BRAND_COLORS.tint);
  doc.roundedRect(PAGE_MARGIN, y, width, height, 3, 3, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(BRAND_COLORS.blue);
  doc.setCharSpace(0.8);
  doc.text(opts.label.toUpperCase(), PAGE_MARGIN + 12, y + 15);
  doc.setCharSpace(0);

  doc.setFontSize(12);
  doc.setTextColor(BRAND_COLORS.ink);
  doc.text(opts.name, PAGE_MARGIN + 12, y + 29);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(BRAND_COLORS.muted);
  lines.forEach((line, i) => doc.text(line, PAGE_MARGIN + 12, y + 42 + i * 12));

  return y + height + 18;
}

/** Shared autotable look: navy head, striped body, generous padding. */
export function tableTheme(): UserOptions {
  return {
    theme: "striped",
    styles: {
      font: "helvetica",
      fontSize: 9.5,
      cellPadding: 6,
      overflow: "linebreak",
      textColor: BRAND_COLORS.ink,
      lineColor: BRAND_COLORS.hairline,
      lineWidth: 0.4,
    },
    headStyles: {
      fillColor: BRAND_COLORS.navy,
      textColor: 255,
      fontStyle: "bold",
      fontSize: 9,
      cellPadding: 7,
    },
    alternateRowStyles: { fillColor: "#f7f9fc" },
    footStyles: {
      fillColor: BRAND_COLORS.tint,
      textColor: BRAND_COLORS.ink,
      fontStyle: "bold",
      fontSize: 10.5,
      lineColor: BRAND_COLORS.hairline,
      lineWidth: 0.4,
    },
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN, top: 54, bottom: 62 },
  };
}

/** Width reserved on the right of the closing band for the sign-off. */
const SIGN_WIDTH = 205;

/**
 * Closing band under the table: amount in words (+ optional notes) on the
 * left, the "For POWER PLUS …" sign-off on the right, sharing one horizontal
 * band. Side-by-side rather than stacked so a full-page invoice still closes on
 * its own page instead of pushing a nearly empty second one.
 */
export function drawClosing(
  doc: jsPDF,
  y: number,
  opts: { totalPaise: number; notes?: string | null },
): number {
  const pageW = doc.internal.pageSize.getWidth();
  const right = pageW - PAGE_MARGIN;
  const textWidth = pageW - PAGE_MARGIN * 2 - SIGN_WIDTH - 20;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(BRAND_COLORS.muted);
  doc.setCharSpace(0.6);
  doc.text("AMOUNT IN WORDS", PAGE_MARGIN, y);
  doc.setCharSpace(0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(BRAND_COLORS.ink);
  const words = doc.splitTextToSize(rupeesInWords(opts.totalPaise), textWidth);
  doc.text(words, PAGE_MARGIN, y + 12);
  let leftY = y + 12 + words.length * 12;

  if (opts.notes?.trim()) {
    leftY += 10;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(BRAND_COLORS.muted);
    doc.setCharSpace(0.6);
    doc.text("NOTES", PAGE_MARGIN, leftY);
    doc.setCharSpace(0);
    doc.setFontSize(8.5);
    doc.setTextColor(BRAND_COLORS.ink);
    const noteLines = doc.splitTextToSize(opts.notes.trim(), textWidth);
    doc.text(noteLines, PAGE_MARGIN, leftY + 11);
    leftY += 11 + noteLines.length * 10;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(BRAND_COLORS.navy);
  doc.text(`For ${BRAND_FULL}`, right, y + 4, { align: "right" });
  doc.setDrawColor(BRAND_COLORS.hairline);
  doc.setLineWidth(0.6);
  doc.line(right - SIGN_WIDTH, y + 42, right, y + 42);
  doc.setFontSize(8);
  doc.setTextColor(BRAND_COLORS.muted);
  doc.text("Authorised Signatory", right, y + 54, { align: "right" });

  return Math.max(leftY, y + 58);
}

/** Height the closing band needs, so a page break can be decided before drawing. */
export function closingHeight(doc: jsPDF, notes?: string | null): number {
  if (!notes?.trim()) return 62;
  const width =
    doc.internal.pageSize.getWidth() - PAGE_MARGIN * 2 - SIGN_WIDTH - 20;
  return 62 + 21 + doc.splitTextToSize(notes.trim(), width).length * 10;
}

/**
 * Brand line + "Page n of m" on every page. Called last, once the page count
 * is final.
 */
export function paintFooters(doc: jsPDF): void {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page++) {
    doc.setPage(page);
    doc.setDrawColor(BRAND_COLORS.hairline);
    doc.setLineWidth(0.5);
    doc.line(PAGE_MARGIN, pageH - 42, pageW - PAGE_MARGIN, pageH - 42);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(BRAND_COLORS.muted);
    doc.text(BRAND_FULL, PAGE_MARGIN, pageH - 29);
    doc.text(`Page ${page} of ${total}`, pageW - PAGE_MARGIN, pageH - 29, {
      align: "right",
    });
  }
}

/**
 * Start a fresh page when a block would not fit above the footer rule
 * (footer sits at pageH − 42, so content may run to pageH − 52).
 */
export function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  if (y + needed <= doc.internal.pageSize.getHeight() - 52) return y;
  doc.addPage();
  return 56;
}

/**
 * Quotation / bill PDF: line items and the total, on the shared letterhead.
 */
export async function shareDocumentPdf(
  site: SiteRow,
  kind: DocKind,
  items: LineItemRow[],
): Promise<void> {
  const { jsPDF: JsPDF, autoTable } = await loadPdfLibs();
  const doc = new JsPDF({ unit: "pt", format: "a4" });
  const title = kind === "quotation" ? "Quotation" : "Bill";
  const total = documentTotalPaise(items);

  let y = await drawLetterhead(doc, {
    title,
    meta: [`Date: ${formatDateLong(todayIso())}`],
  });
  y = drawPartyBlock(doc, y, {
    label: kind === "quotation" ? "Quotation for" : "Bill to",
    name: site.name,
    lines: [[site.location, site.phone].filter(Boolean).join("  ·  "), site.work_type],
  });

  // The Total is a table FOOTER row so autotable lays it out and page-breaks it
  // correctly under the Amount column — no manual positioning to overflow.
  autoTable(doc, {
    ...tableTheme(),
    startY: y,
    head: [["#", "Description", "Qty", "Rate", "Amount"]],
    body: items.map((it, i) => [
      String(i + 1),
      it.description,
      String(it.qty),
      formatPaisePdf(it.rate_paise),
      formatPaisePdf(it.amount_paise),
    ]),
    foot: [
      [
        {
          content: "Total",
          colSpan: 4,
          styles: { halign: "right", fillColor: BRAND_COLORS.navy, textColor: 255 },
        },
        {
          content: formatPaisePdf(total),
          styles: { halign: "right", fillColor: BRAND_COLORS.navy, textColor: 255 },
        },
      ],
    ],
    columnStyles: {
      0: { cellWidth: 28, halign: "right" },
      1: { cellWidth: "auto" },
      2: { cellWidth: 48, halign: "right" },
      3: { cellWidth: 82, halign: "right" },
      4: { cellWidth: 92, halign: "right" },
    },
  });

  // A quotation is an offer, so it carries a validity line; a bill does not.
  const notes = kind === "quotation" ? QUOTATION_VALIDITY : null;
  y = ensureSpace(doc, lastTableY(doc) + 26, closingHeight(doc, notes));
  drawClosing(doc, y, { totalPaise: total, notes });
  paintFooters(doc);

  await shareOrDownloadBlob(doc.output("blob"), slugFilename(kind, site.name));
}

/**
 * Direct-invoice PDF. Everything the invoice model adds on top of the bill: a
 * number + date block, per-section groups with their own subtotals, a Unit
 * column, a Subtotal/Discount/Total stack, notes and a sign-off.
 */
export async function shareInvoicePdf(
  site: SiteRow,
  invoice: DocumentRow,
  items: LineItemRow[],
): Promise<void> {
  const { jsPDF: JsPDF, autoTable } = await loadPdfLibs();
  const doc = new JsPDF({ unit: "pt", format: "a4" });

  const meta = [
    invoice.doc_number ? `Invoice No: ${invoice.doc_number}` : "",
    `Date: ${formatDateLong(invoice.doc_date ?? todayIso())}`,
  ].filter(Boolean);

  let y = await drawLetterhead(doc, { title: "Invoice", meta });
  y = drawPartyBlock(doc, y, {
    label: "Bill to",
    name: site.name,
    lines: [
      [site.location, site.phone].filter(Boolean).join("  ·  "),
      invoice.title ? `Work: ${invoice.title}` : null,
    ],
  });

  const sections = groupSections(items);
  const flat = isUnsectioned(sections);
  const totals = invoiceTotals(items, invoice.discount_paise);

  // Section headings and subtotals are ordinary table rows so autotable page-
  // breaks them correctly — no manual positioning that could overflow a page.
  const body: UserOptions["body"] = [];
  let lineNo = 0;
  for (const section of sections) {
    if (!flat) {
      body.push([
        {
          content: section.name,
          colSpan: 6,
          styles: {
            fillColor: BRAND_COLORS.tint,
            textColor: BRAND_COLORS.navy,
            fontStyle: "bold",
            fontSize: 9.5,
            // The span inherits column 0's right alignment otherwise.
            halign: "left",
          },
        },
      ]);
    }
    for (const it of section.items) {
      body.push([
        String(++lineNo),
        it.description,
        it.unit ?? "",
        String(it.qty),
        formatPaisePdf(it.rate_paise),
        formatPaisePdf(it.amount_paise),
      ]);
    }
    if (!flat) {
      body.push([
        {
          content: `${section.name} subtotal`,
          colSpan: 5,
          styles: { halign: "right", fontStyle: "bold", textColor: BRAND_COLORS.muted },
        },
        {
          content: formatPaisePdf(section.subtotalPaise),
          styles: { halign: "right", fontStyle: "bold" },
        },
      ]);
    }
  }

  const foot: UserOptions["foot"] = [];
  if (totals.discountPaise > 0) {
    foot.push(
      [
        { content: "Subtotal", colSpan: 5, styles: { halign: "right", fontStyle: "normal" } },
        { content: formatPaisePdf(totals.subtotalPaise), styles: { halign: "right", fontStyle: "normal" } },
      ],
      [
        { content: "Discount", colSpan: 5, styles: { halign: "right", fontStyle: "normal" } },
        {
          content: `-${formatPaisePdf(totals.discountPaise)}`,
          styles: { halign: "right", fontStyle: "normal" },
        },
      ],
    );
  }
  foot.push([
    {
      content: "Total",
      colSpan: 5,
      styles: { halign: "right", fillColor: BRAND_COLORS.navy, textColor: 255 },
    },
    {
      content: formatPaisePdf(totals.totalPaise),
      styles: { halign: "right", fillColor: BRAND_COLORS.navy, textColor: 255 },
    },
  ]);

  autoTable(doc, {
    ...tableTheme(),
    startY: y,
    head: [["#", "Work / Item", "Unit", "Qty", "Rate", "Amount"]],
    body,
    foot,
    columnStyles: {
      0: { cellWidth: 26, halign: "right" },
      1: { cellWidth: "auto" },
      2: { cellWidth: 44 },
      3: { cellWidth: 44, halign: "right" },
      4: { cellWidth: 76, halign: "right" },
      5: { cellWidth: 88, halign: "right" },
    },
  });

  y = ensureSpace(doc, lastTableY(doc) + 26, closingHeight(doc, invoice.notes));
  drawClosing(doc, y, { totalPaise: totals.totalPaise, notes: invoice.notes });
  paintFooters(doc);

  await shareOrDownloadBlob(
    doc.output("blob"),
    slugFilename(invoice.doc_number?.toLowerCase() || "invoice", site.name),
  );
}

export async function shareOrDownloadBlob(
  blob: Blob,
  filename: string,
  mime = "application/pdf",
): Promise<void> {
  const file = new File([blob], filename, { type: mime });
  const nav = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean;
  };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch {
      // user cancelled the share sheet → fall through to download
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function slugFilename(prefix: string, name: string, ext = "pdf"): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${prefix}-${slug || "document"}.${ext}`;
}
