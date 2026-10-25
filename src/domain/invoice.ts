import { db, type DocumentRow, type LineItemRow } from "@/lib/db";
import { documentRepo, lineItemRepo } from "@/repo/repos";
import { todayIso } from "@/lib/dates";
import { documentTotalPaise, lineAmountPaise } from "./quotation";
import { listDocuments, listItems } from "./documents";

/**
 * Direct invoices — the contractor bills works + items straight, with no
 * quotation to convert from. A site may hold many invoices (unlike the single
 * quotation/bill pair), each with its own number, date and discount.
 *
 * Everything here is pure derivation over Dexie rows plus thin repo writes;
 * no total is ever stored.
 */

/** Billing units offered in the grid (free text is still allowed). */
export const UNIT_OPTIONS = [
  "nos",
  "pt",
  "mtr",
  "ft",
  "sqft",
  "kg",
  "ltr",
  "hr",
  "day",
  "job",
  "set",
  "lot",
];

/** Starter section names. The contractor can type any other. */
export const SECTION_PRESETS = ["Works", "Materials", "Labour", "Extra work"];

/** Heading used when a line has no section of its own. */
export const UNSECTIONED = "Other";

const INVOICE_PREFIX = "INV-";

/** Non-deleted invoices for a site, newest date first (then newest created). */
export async function listInvoices(siteId: string): Promise<DocumentRow[]> {
  return (await listDocuments(siteId))
    .filter((d) => d.kind === "invoice")
    .sort(
      (a, b) =>
        (b.doc_date ?? "").localeCompare(a.doc_date ?? "") ||
        b.created_at.localeCompare(a.created_at),
    );
}

/** Every non-deleted invoice across all sites, newest first. */
export async function listAllInvoices(): Promise<DocumentRow[]> {
  const rows = await db.documents.where("kind").equals("invoice").toArray();
  return rows
    .filter((d) => d.deleted_at === null)
    .sort(
      (a, b) =>
        (b.doc_date ?? "").localeCompare(a.doc_date ?? "") ||
        b.created_at.localeCompare(a.created_at),
    );
}

/**
 * Next invoice number, sequential across ALL sites: one running book, the way a
 * paper invoice book works. Only `INV-<digits>` numbers count towards the max,
 * so a hand-typed number ("JOB/12") never breaks the sequence.
 */
export async function nextInvoiceNumber(): Promise<string> {
  const invoices = await listAllInvoices();
  const max = invoices.reduce((m, d) => {
    const match = /^INV-(\d+)$/.exec(d.doc_number ?? "");
    return match ? Math.max(m, Number(match[1])) : m;
  }, 0);
  return `${INVOICE_PREFIX}${String(max + 1).padStart(4, "0")}`;
}

/** Create an empty draft invoice for a site, numbered and dated today. */
export async function createInvoice(
  siteId: string,
  opts: { title?: string | null; docDate?: string } = {},
): Promise<DocumentRow> {
  return documentRepo.put({
    site_id: siteId,
    kind: "invoice",
    doc_number: await nextInvoiceNumber(),
    status: "draft",
    doc_date: opts.docDate ?? todayIso(),
    title: opts.title ?? null,
    notes: null,
    discount_paise: 0,
    lump_sum_paise: null,
  });
}

export interface InvoiceTotals {
  subtotalPaise: number;
  /** Discount actually applied — clamped to [0, subtotal] so a total is never negative. */
  discountPaise: number;
  totalPaise: number;
}

/** Item subtotal or one document price, minus the clamped discount. */
export function invoiceTotals(
  items: { amount_paise: number }[],
  discountPaise = 0,
  lumpSumPaise: number | null = null,
): InvoiceTotals {
  const subtotalPaise = lumpSumPaise == null
    ? documentTotalPaise(items)
    : Math.max(0, Math.round(lumpSumPaise) || 0);
  const clamped = Math.min(Math.max(Math.round(discountPaise) || 0, 0), subtotalPaise);
  return {
    subtotalPaise,
    discountPaise: clamped,
    totalPaise: subtotalPaise - clamped,
  };
}

/** Billable total of an invoice document = subtotal − discount. */
export function invoiceTotalPaise(
  items: { amount_paise: number }[],
  discountPaise = 0,
  lumpSumPaise: number | null = null,
): number {
  return invoiceTotals(items, discountPaise, lumpSumPaise).totalPaise;
}

export interface InvoiceSection {
  name: string;
  items: LineItemRow[];
  subtotalPaise: number;
}

/**
 * Group lines by section for printing, in FIRST-APPEARANCE order so the
 * document reads in the order the contractor entered it. Lines with no section
 * collect under `UNSECTIONED`. A single unnamed group means "no sections used"
 * — callers print it without a heading.
 */
export function groupSections(items: LineItemRow[]): InvoiceSection[] {
  const byName = new Map<string, LineItemRow[]>();
  for (const it of items) {
    const name = (it.section ?? "").trim() || UNSECTIONED;
    const bucket = byName.get(name);
    if (bucket) bucket.push(it);
    else byName.set(name, [it]);
  }
  return [...byName.entries()].map(([name, sectionItems]) => ({
    name,
    items: sectionItems,
    subtotalPaise: documentTotalPaise(sectionItems),
  }));
}

/** True when the lines carry no section at all (print without headings). */
export function isUnsectioned(sections: InvoiceSection[]): boolean {
  return sections.length <= 1 && sections[0]?.name === UNSECTIONED;
}

export interface LibraryItem {
  description: string;
  rate_paise: number;
  unit: string | null;
  section: string | null;
}

/**
 * Descriptions the contractor has billed before, with the MOST RECENT rate for
 * each — feeds the description autocomplete so a repeat line is one keystroke
 * and its rate fills itself in. Sorted by how often the description was used,
 * so the common lines sit at the top of the dropdown.
 */
export async function listItemLibrary(): Promise<LibraryItem[]> {
  const rows = (await db.line_items.toArray()).filter(
    (i) => i.deleted_at === null && i.description.trim() !== "",
  );
  // Oldest first so the last write of a description wins below. `position`
  // breaks ties: several lines typed in the same millisecond still resolve in
  // the order they sit on the document.
  rows.sort(
    (a, b) => a.updated_at.localeCompare(b.updated_at) || a.position - b.position,
  );

  const latest = new Map<string, LibraryItem>();
  const uses = new Map<string, number>();
  for (const r of rows) {
    const key = r.description.trim();
    // Later rows overwrite earlier ones → the newest rate wins.
    latest.set(key, {
      description: key,
      rate_paise: r.rate_paise,
      unit: r.unit,
      section: r.section,
    });
    uses.set(key, (uses.get(key) ?? 0) + 1);
  }
  return [...latest.values()].sort(
    (a, b) =>
      (uses.get(b.description) ?? 0) - (uses.get(a.description) ?? 0) ||
      a.description.localeCompare(b.description),
  );
}

/**
 * Append copies of another document's lines onto an invoice (e.g. "pull in the
 * quotation I already typed"). Copies are fresh rows — editing them never
 * touches the source document.
 */
export async function importItemsFrom(
  targetDocId: string,
  sourceDocId: string,
): Promise<number> {
  const [source, existing] = await Promise.all([
    listItems(sourceDocId),
    listItems(targetDocId),
  ]);
  let position = existing.reduce((m, i) => Math.max(m, i.position + 1), 0);
  for (const it of source) {
    await lineItemRepo.put({
      document_id: targetDocId,
      description: it.description,
      qty: it.qty,
      rate_paise: it.rate_paise,
      amount_paise: lineAmountPaise(it.qty, it.rate_paise),
      position: position++,
      section: it.section,
      unit: it.unit,
    });
  }
  return source.length;
}

/**
 * Soft-delete an invoice and every line on it. Financial history stays
 * recoverable (deleted_at, never a hard delete) and the rows still sync.
 */
export async function deleteInvoice(documentId: string): Promise<void> {
  for (const it of await listItems(documentId)) {
    await lineItemRepo.softDelete(it.id);
  }
  await documentRepo.softDelete(documentId);
}
