import { beforeEach, describe, expect, it, vi } from "vitest";
import { read, utils } from "xlsx";
import type { LineItemRow, SiteRow } from "@/lib/db";
import { shareOrDownloadBlob } from "./pdf";
import { shareDocumentXlsx } from "./xlsx";

vi.mock("./pdf", async (importOriginal) => ({
  ...await importOriginal<typeof import("./pdf")>(),
  shareOrDownloadBlob: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

describe.each(["quotation", "bill"] as const)("%s workbook discounts", (kind) => {
  it.each([
    { discount: 0, applied: 0, total: 750 },
    { discount: 5000, applied: 50, total: 700 },
    { discount: 90000, applied: 750, total: 0 },
  ])("exports numeric totals with discount $discount paise", async ({ discount, applied, total }) => {
    const site = { name: "Villa", location: null, phone: null, work_type: "Electrical" } as SiteRow;
    const items = [
      { description: "Wiring", qty: 2, rate_paise: 25000, amount_paise: 50000 },
      { description: "Points", qty: 1, rate_paise: 25000, amount_paise: 25000 },
    ] as LineItemRow[];

    await shareDocumentXlsx(site, kind, items, discount);

    const blob = vi.mocked(shareOrDownloadBlob).mock.calls[0][0];
    const workbook = read(await blob.arrayBuffer(), { type: "array" });
    const rows = utils.sheet_to_json<(string | number)[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });
    const summary = rows.slice(rows.findIndex((row) => row[0] === "Summary") + 1);
    expect(summary).toEqual(applied > 0 ? [
      ["Subtotal", 750],
      ["Discount", -applied],
      ["Total", total],
    ] : [["Total", total]]);
    expect(rows).toContainEqual(["1", "Wiring", 2, 250, 500]);
  });
});
