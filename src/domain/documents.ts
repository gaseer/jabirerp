import { db, type DocKind, type DocumentRow, type LineItemRow } from "@/lib/db";
import { documentRepo, lineItemRepo } from "@/repo/repos";

/** Non-deleted documents for a site. */
export async function listDocuments(siteId: string): Promise<DocumentRow[]> {
  const rows = await db.documents.where("site_id").equals(siteId).toArray();
  return rows.filter((d) => d.deleted_at === null);
}

export async function getDocByKind(
  siteId: string,
  kind: DocKind,
): Promise<DocumentRow | undefined> {
  return (await listDocuments(siteId)).find((d) => d.kind === kind);
}

/** Non-deleted line items for a document, ordered by position. */
export async function listItems(documentId: string): Promise<LineItemRow[]> {
  const rows = await db.line_items.where("document_id").equals(documentId).toArray();
  return rows
    .filter((i) => i.deleted_at === null)
    .sort((a, b) => a.position - b.position);
}

/** Get the site's document of this kind, creating an empty draft if none exists. */
export async function ensureDocument(
  siteId: string,
  kind: DocKind,
): Promise<DocumentRow> {
  const existing = await getDocByKind(siteId, kind);
  if (existing) return existing;
  return documentRepo.put({
    site_id: siteId,
    kind,
    doc_number: null,
    status: "draft",
    // Invoice-only fields — a quotation/bill never uses them.
    doc_date: null,
    title: null,
    notes: null,
    discount_paise: 0,
  });
}

/**
 * Convert a site's quotation into a bill: create (or reuse) the bill document,
 * copy every quotation line item into it, and mark the quotation converted.
 * The bill stays editable. Idempotent-ish: reuses an existing bill doc but
 * appends fresh copies of items (caller guards against double-convert in UI).
 */
export async function convertToBill(siteId: string): Promise<DocumentRow> {
  const quotation = await getDocByKind(siteId, "quotation");
  if (!quotation) throw new Error("No quotation to convert");

  const bill = await ensureDocument(siteId, "bill");
  const items = await listItems(quotation.id);
  for (const it of items) {
    await lineItemRepo.put({
      document_id: bill.id,
      description: it.description,
      qty: it.qty,
      rate_paise: it.rate_paise,
      amount_paise: it.amount_paise,
      position: it.position,
      section: it.section,
      unit: it.unit,
    });
  }

  await documentRepo.put({ ...quotation, status: "converted" });

  return bill;
}
