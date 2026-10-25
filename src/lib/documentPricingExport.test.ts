import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { read, utils } from "xlsx";
import type { DocKind, DocumentRow, LineItemRow, SiteRow } from "@/lib/db";
import { shareDocumentPdf, shareInvoicePdf, shareOrDownloadBlob } from "./pdf";
import { shareDocumentXlsx, shareInvoiceXlsx } from "./xlsx";

vi.mock("./pdf", async (importOriginal) => ({
  ...await importOriginal<typeof import("./pdf")>(),
  shareOrDownloadBlob: vi.fn(),
}));
vi.mock("./brand", async (importOriginal) => ({
  ...await importOriginal<typeof import("./brand")>(),
  loadBrandLogo: vi.fn().mockResolvedValue(null),
}));

const base = { owner_id: "owner", created_at: "", updated_at: "", deleted_at: null, _dirty: 0 as const };
const site: SiteRow = {
  ...base, id: "site", name: "Villa", location: null, phone: null, work_type: "Electrical", status: "Active",
};
const invoice: DocumentRow = {
  ...base, id: "doc", site_id: site.id, kind: "invoice", doc_number: "INV-0001", status: "draft",
  doc_date: "2026-10-25", title: null, notes: null, discount_paise: 25000, lump_sum_paise: 500000,
};
const items: LineItemRow[] = [
  { ...base, id: "line-1", document_id: invoice.id, description: "Wiring", qty: 2, rate_paise: 123456, amount_paise: 246912, position: 0, section: "Works", unit: "pt" },
  { ...base, id: "line-2", document_id: invoice.id, description: "Pipes", qty: 3, rate_paise: 98765, amount_paise: 296295, position: 1, section: "Materials", unit: "nos" },
];

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each(["quotation", "bill", "invoice"] as DocKind[])("%s One Rate for all exports", (kind) => {
  it.each([500000, 0])("exports only item descriptions/quantities and the single price %i in Excel", async (price) => {
    if (kind === "invoice") await shareInvoiceXlsx(site, { ...invoice, lump_sum_paise: price }, items);
    else await shareDocumentXlsx(site, kind, items, invoice.discount_paise, price);

    const [blob] = vi.mocked(shareOrDownloadBlob).mock.calls[0];
    const workbook = read(await blob.arrayBuffer(), { type: "array" });
    const rows = utils.sheet_to_json<(string | number)[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });
    expect(rows).toContainEqual(kind === "invoice" ? ["1", "Wiring", "pt", 2] : ["1", "Wiring", 2]);
    expect(rows.flat()).not.toContain("Rate");
    expect(rows.flat()).not.toContain("Amount");
    for (const hidden of [1234.56, 2469.12, 987.65, 2962.95]) expect(rows.flat()).not.toContain(hidden);
    expect(rows).toContainEqual(["One Rate for all", price / 100]);
    expect(rows[rows.length - 1]).toEqual(["Total", Math.max(0, price - invoice.discount_paise) / 100]);
    if (price > 0) expect(rows).toContainEqual(["Discount", -250]);
  });

  it("omits item prices and section subtotals in PDF and prints the discounted document price", async () => {
    let downloaded: Blob | undefined;
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", { createElement: () => ({ click() {}, href: "", download: "" }) });
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      downloaded = blob as Blob;
      return "blob:test";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    if (kind === "invoice") await shareInvoicePdf(site, invoice, items);
    else await shareDocumentPdf(site, kind, items, invoice.discount_paise, invoice.lump_sum_paise);

    expect(downloaded).toBeDefined();
    const pdf = await downloaded!.text();
    expect(pdf).toMatch(/^%PDF-/);
    for (const text of ["Wiring", "Pipes", "Rs 5,000", "Rs 250", "Rs 4,750"]) expect(pdf).toContain(text);
    for (const hidden of ["(Rate)", "(Amount)", "Rs 1,234.56", "Rs 2,469.12", "Works subtotal", "Materials subtotal"]) expect(pdf).not.toContain(hidden);
  });
});
