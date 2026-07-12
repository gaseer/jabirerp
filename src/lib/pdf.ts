import type { DocKind, LineItemRow, SiteRow } from "@/lib/db";
import { formatPaise } from "@/lib/money";
import { documentTotalPaise } from "@/domain/quotation";

const BRAND = "Power Plus";

/**
 * Build + share a quotation/bill PDF for a site. Customer-facing: shows the
 * customer's details, priced line items, and the total. No internal data
 * (expenses/wages/profit). jsPDF is dynamically imported so it stays out of the
 * initial bundle — it only loads when the user actually shares.
 */
export async function shareDocumentPdf(
  site: SiteRow,
  kind: DocKind,
  items: LineItemRow[],
): Promise<void> {
  const [{ default: jsPDF }, autoTableMod] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const autoTable = autoTableMod.default;

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const title = kind === "quotation" ? "QUOTATION" : "BILL";
  const marginX = 40;

  doc.setFontSize(20);
  doc.setTextColor("#2563eb");
  doc.text(BRAND, marginX, 50);
  doc.setFontSize(14);
  doc.setTextColor("#1c2430");
  doc.text(title, doc.internal.pageSize.getWidth() - marginX, 50, { align: "right" });

  doc.setFontSize(10);
  doc.setTextColor("#7b8494");
  doc.text(`Date: ${new Date().toLocaleDateString("en-IN")}`, marginX, 78);
  doc.setTextColor("#1c2430");
  doc.setFontSize(12);
  doc.text(site.name, marginX, 100);
  doc.setFontSize(10);
  doc.setTextColor("#7b8494");
  const meta = [site.location, site.phone, site.work_type].filter(Boolean).join("  ·  ");
  if (meta) doc.text(meta, marginX, 116);

  const total = documentTotalPaise(items);

  // The Total is a table FOOTER row so autotable lays it out and page-breaks it
  // correctly under the Amount column — no manual positioning to overflow.
  autoTable(doc, {
    startY: 140,
    head: [["#", "Description", "Qty", "Rate", "Amount"]],
    body: items.map((it, i) => [
      String(i + 1),
      it.description,
      String(it.qty),
      formatPaise(it.rate_paise),
      formatPaise(it.amount_paise),
    ]),
    foot: [["", "", "", "Total", formatPaise(total)]],
    styles: { fontSize: 10, cellPadding: 6, overflow: "linebreak" },
    headStyles: { fillColor: [37, 99, 235], textColor: 255 },
    footStyles: {
      fillColor: [232, 240, 255],
      textColor: [28, 36, 48],
      fontStyle: "bold",
      fontSize: 12,
    },
    columnStyles: {
      0: { cellWidth: 30, halign: "right" },
      1: { cellWidth: "auto" },
      2: { cellWidth: 50, halign: "right" },
      3: { cellWidth: 80, halign: "right" },
      4: { cellWidth: 90, halign: "right" },
    },
    margin: { left: marginX, right: marginX },
  });

  await shareOrDownloadBlob(doc.output("blob"), slugFilename(kind, site.name));
}

async function shareOrDownloadBlob(blob: Blob, filename: string): Promise<void> {
  const file = new File([blob], filename, { type: "application/pdf" });
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

export function slugFilename(prefix: string, name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${prefix}-${slug || "document"}.pdf`;
}
