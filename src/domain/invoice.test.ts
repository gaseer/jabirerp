import { beforeEach, describe, expect, it } from "vitest";
import { db, type LineItemRow } from "@/lib/db";
import { documentRepo, lineItemRepo, siteRepo } from "@/repo/repos";
import { useAuth } from "@/store/auth";
import { listItems } from "./documents";
import {
  createInvoice,
  deleteInvoice,
  groupSections,
  importItemsFrom,
  invoiceTotalPaise,
  invoiceTotals,
  isUnsectioned,
  listInvoices,
  listItemLibrary,
  nextInvoiceNumber,
  UNSECTIONED,
} from "./invoice";
import { sitePnl } from "./pnl";

let SITE = "";

beforeEach(async () => {
  await Promise.all([
    db.sites.clear(),
    db.documents.clear(),
    db.line_items.clear(),
    db.transactions.clear(),
    db.attendance.clear(),
    db.outbox.clear(),
  ]);
  // @ts-expect-error minimal user for currentOwnerId
  useAuth.setState({ user: { id: "u1" } });
  const site = await siteRepo.put({
    name: "Villa",
    phone: null,
    location: null,
    work_type: "Electrical",
    status: "Active",
  });
  SITE = site.id;
});

/** Append a line to a document; returns the stored row. */
async function addLine(
  documentId: string,
  fields: Partial<LineItemRow> & { amount_paise: number },
): Promise<LineItemRow> {
  const existing = await listItems(documentId);
  return lineItemRepo.put({
    document_id: documentId,
    description: fields.description ?? "Line",
    qty: fields.qty ?? 1,
    rate_paise: fields.rate_paise ?? fields.amount_paise,
    amount_paise: fields.amount_paise,
    position: fields.position ?? existing.length,
    section: fields.section ?? null,
    unit: fields.unit ?? null,
  });
}

describe("invoiceTotals", () => {
  const items = [{ amount_paise: 500000 }, { amount_paise: 250000 }];

  it("uses one document price once, independent of line amounts, then applies discount", () => {
    expect(invoiceTotals(items, 50000, 600000)).toEqual({
      subtotalPaise: 600000, discountPaise: 50000, totalPaise: 550000,
    });
    expect(invoiceTotalPaise([...items, ...items], 50000, 600000)).toBe(550000);
  });

  it("treats a zero document price as enabled and clamps the discount to that price", () => {
    expect(invoiceTotalPaise(items, 50000, 0)).toBe(0);
    expect(invoiceTotalPaise(items, 900000, 600000)).toBe(0);
  });

  it("keeps item pricing for documents with no document-wide price", () => {
    expect(invoiceTotalPaise(items, 50000, null)).toBe(700000);
    expect(invoiceTotalPaise(items, 50000, undefined)).toBe(700000);
  });

  it("subtracts the discount from the subtotal", () => {
    expect(invoiceTotals(items, 50000)).toEqual({
      subtotalPaise: 750000,
      discountPaise: 50000,
      totalPaise: 700000,
    });
  });

  it("defaults to no discount", () => {
    expect(invoiceTotals(items).totalPaise).toBe(750000);
  });

  it("clamps a discount larger than the subtotal (total never negative)", () => {
    expect(invoiceTotals(items, 900000)).toEqual({
      subtotalPaise: 750000,
      discountPaise: 750000,
      totalPaise: 0,
    });
  });

  it("ignores a negative or non-numeric discount", () => {
    expect(invoiceTotals(items, -5000).totalPaise).toBe(750000);
    expect(invoiceTotals(items, NaN).totalPaise).toBe(750000);
  });

  it("is zero for an empty invoice", () => {
    expect(invoiceTotalPaise([], 10000)).toBe(0);
  });
});

describe("groupSections", () => {
  const line = (section: string | null, amount: number) =>
    ({ section, amount_paise: amount, description: "x" }) as LineItemRow;

  it("groups by section in first-appearance order with subtotals", () => {
    const sections = groupSections([
      line("Works", 100000),
      line("Materials", 30000),
      line("Works", 50000),
    ]);
    expect(sections.map((s) => s.name)).toEqual(["Works", "Materials"]);
    expect(sections[0].subtotalPaise).toBe(150000);
    expect(sections[1].subtotalPaise).toBe(30000);
    expect(isUnsectioned(sections)).toBe(false);
  });

  it("collects blank sections under one unnamed group", () => {
    const sections = groupSections([line(null, 100000), line("  ", 20000)]);
    expect(sections).toHaveLength(1);
    expect(sections[0].name).toBe(UNSECTIONED);
    expect(isUnsectioned(sections)).toBe(true);
  });
});

describe("nextInvoiceNumber", () => {
  it("starts at INV-0001 and increments", async () => {
    expect(await nextInvoiceNumber()).toBe("INV-0001");
    await createInvoice(SITE);
    expect(await nextInvoiceNumber()).toBe("INV-0002");
  });

  it("runs across sites, not per site", async () => {
    const other = await siteRepo.put({
      name: "Shop",
      phone: null,
      location: null,
      work_type: "Plumbing",
      status: "Active",
    });
    await createInvoice(SITE);
    const second = await createInvoice(other.id);
    expect(second.doc_number).toBe("INV-0002");
  });

  it("ignores hand-typed numbers that aren't INV-<digits>", async () => {
    const inv = await createInvoice(SITE);
    await documentRepo.put({ ...inv, doc_number: "JOB/2026/12" });
    expect(await nextInvoiceNumber()).toBe("INV-0001");
  });
});

describe("listInvoices", () => {
  it("returns only this site's invoices, newest date first", async () => {
    const older = await createInvoice(SITE, { docDate: "2026-07-01" });
    const newer = await createInvoice(SITE, { docDate: "2026-07-20" });
    const list = await listInvoices(SITE);
    expect(list.map((d) => d.id)).toEqual([newer.id, older.id]);
  });

  it("excludes quotations, bills and deleted invoices", async () => {
    const inv = await createInvoice(SITE);
    await documentRepo.put({
      site_id: SITE,
      kind: "bill",
      doc_number: null,
      status: "final",
      doc_date: null,
      title: null,
      notes: null,
      discount_paise: 0,
    });
    expect(await listInvoices(SITE)).toHaveLength(1);
    await deleteInvoice(inv.id);
    expect(await listInvoices(SITE)).toHaveLength(0);
  });
});

describe("deleteInvoice", () => {
  it("soft-deletes the header and every line", async () => {
    const inv = await createInvoice(SITE);
    await addLine(inv.id, { amount_paise: 100000 });
    await deleteInvoice(inv.id);
    expect(await listItems(inv.id)).toHaveLength(0);
    // History is kept, not destroyed.
    expect(await db.line_items.count()).toBe(1);
    expect((await db.documents.get(inv.id))?.deleted_at).not.toBeNull();
  });
});

describe("importItemsFrom", () => {
  it("appends independent copies after the existing lines", async () => {
    const source = await createInvoice(SITE);
    await addLine(source.id, {
      description: "Wiring",
      amount_paise: 100000,
      section: "Works",
      unit: "pt",
    });
    const target = await createInvoice(SITE);
    await addLine(target.id, { description: "Existing", amount_paise: 5000 });

    expect(await importItemsFrom(target.id, source.id)).toBe(1);
    const items = await listItems(target.id);
    expect(items.map((i) => i.description)).toEqual(["Existing", "Wiring"]);
    expect(items[1].position).toBe(1);
    expect(items[1].section).toBe("Works");
    expect(items[1].unit).toBe("pt");

    // Editing the copy leaves the source untouched.
    await lineItemRepo.put({ ...items[1], description: "Changed" });
    expect((await listItems(source.id))[0].description).toBe("Wiring");
  });
});

describe("listItemLibrary", () => {
  it("keeps the newest rate per description, most-used first", async () => {
    const inv = await createInvoice(SITE);
    await addLine(inv.id, { description: "Point", rate_paise: 20000, amount_paise: 20000 });
    await addLine(inv.id, { description: "Fan box", rate_paise: 90000, amount_paise: 90000 });
    await addLine(inv.id, {
      description: "Point",
      rate_paise: 25000,
      amount_paise: 25000,
      unit: "pt",
    });

    const library = await listItemLibrary();
    expect(library.map((l) => l.description)).toEqual(["Point", "Fan box"]);
    expect(library[0].rate_paise).toBe(25000);
    expect(library[0].unit).toBe("pt");
  });

  it("skips deleted and blank-description lines", async () => {
    const inv = await createInvoice(SITE);
    const gone = await addLine(inv.id, { description: "Old", amount_paise: 1000 });
    await addLine(inv.id, { description: "   ", amount_paise: 1000 });
    await lineItemRepo.softDelete(gone.id);
    expect(await listItemLibrary()).toHaveLength(0);
  });
});

describe("invoices in the P&L", () => {
  it("persists one price in the outbox and uses it for income, receivable, and profit", async () => {
    const inv = await createInvoice(SITE);
    const line = await addLine(inv.id, { amount_paise: 800000 });
    await documentRepo.put({ ...inv, lump_sum_paise: 500000, discount_paise: 25000 });
    const saved = await documentRepo.getById(inv.id);
    expect(saved?.lump_sum_paise).toBe(500000);
    const queued = await db.outbox.where("row_id").equals(inv.id).toArray();
    expect(queued.some((row) => (row.payload as { lump_sum_paise?: number }).lump_sum_paise === 500000)).toBe(true);
    const pnl = await sitePnl(SITE);
    expect(pnl.billTotalPaise).toBe(475000);
    expect(pnl.receivablePaise).toBe(475000);
    expect(pnl.profitPaise).toBe(475000);

    // Disabling restores the original line prices without rewriting them.
    await documentRepo.put({ ...saved!, lump_sum_paise: null });
    expect(await lineItemRepo.getById(line.id)).toMatchObject({ amount_paise: 800000 });
    expect((await sitePnl(SITE)).billTotalPaise).toBe(775000);
  });
  it("counts as income, net of discount, alongside a converted bill", async () => {
    const inv = await createInvoice(SITE);
    await addLine(inv.id, { amount_paise: 800000 });
    await documentRepo.put({ ...inv, discount_paise: 50000 });

    const pnl = await sitePnl(SITE);
    expect(pnl.billTotalPaise).toBe(750000);
    expect(pnl.receivablePaise).toBe(750000);
    expect(pnl.profitPaise).toBe(750000);
  });

  it("sums several invoices on one site", async () => {
    const a = await createInvoice(SITE);
    await addLine(a.id, { amount_paise: 100000 });
    const b = await createInvoice(SITE);
    await addLine(b.id, { amount_paise: 250000 });
    expect((await sitePnl(SITE)).billTotalPaise).toBe(350000);
  });

  it("a deleted invoice drops out of income", async () => {
    const inv = await createInvoice(SITE);
    await addLine(inv.id, { amount_paise: 100000 });
    await deleteInvoice(inv.id);
    expect((await sitePnl(SITE)).billTotalPaise).toBe(0);
  });
});
