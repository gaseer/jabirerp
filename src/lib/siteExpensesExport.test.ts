import { beforeEach, describe, expect, it, vi } from "vitest";
import { read, utils } from "xlsx";
import type { SiteRow, TransactionRow } from "@/lib/db";
import { shareOrDownloadBlob } from "./pdf";
import { shareSiteExpensesPdf } from "./statementPdf";
import { shareSiteExpensesXlsx } from "./xlsx";

vi.mock("./pdf", async (importOriginal) => ({
  ...await importOriginal<typeof import("./pdf")>(),
  shareOrDownloadBlob: vi.fn(),
}));
vi.mock("./brand", async (importOriginal) => ({
  ...await importOriginal<typeof import("./brand")>(),
  loadBrandLogo: vi.fn().mockResolvedValue(null),
}));

const site: SiteRow = {
  id: "site-1", owner_id: "owner", created_at: "", updated_at: "", deleted_at: null, _dirty: 0,
  name: "Villa", location: "Kochi", phone: null, work_type: "Electrical", status: "Active",
};
const expense: TransactionRow = {
  id: "expense-1", owner_id: "owner", created_at: "", updated_at: "", deleted_at: null, _dirty: 0,
  txn_type: "site_expense", site_id: site.id, employee_id: null, shop_id: null,
  txn_date: "2026-10-25", category: "Materials", mode: "bank", note: "Wiring supplies", amount_paise: 125075,
};
const range = { from: "2026-10-01", to: "2026-10-31" };

beforeEach(() => vi.clearAllMocks());

async function exportedRows() {
  const [blob, filename] = vi.mocked(shareOrDownloadBlob).mock.calls[0];
  expect(filename).toBe("site-expenses-villa.xlsx");
  const workbook = read(await blob.arrayBuffer(), { type: "array" });
  return utils.sheet_to_json<(string | number)[]>(workbook.Sheets["Site expenses"], { header: 1 });
}

describe("site expenses exports", () => {
  it("generates a PDF with the site, selected category, expense details, and total", async () => {
    await shareSiteExpensesPdf(site, [expense], range, "Materials");
    const [blob, filename] = vi.mocked(shareOrDownloadBlob).mock.calls[0];
    expect(filename).toBe("site-expenses-villa.pdf");
    const pdf = await blob.text();
    expect(pdf).toMatch(/^%PDF-/);
    for (const text of ["Villa", "Expenses - Materials", "Bank", "Wiring supplies", "Rs 1,250.75"])
      expect(pdf).toContain(text);
  });

  it("exports numeric amounts and sums cash/bank expenses without losing paise", async () => {
    await shareSiteExpensesXlsx(site, [expense, {
      ...expense, id: "expense-2", category: "Travel", mode: "cash", note: null, amount_paise: 20000,
    }], range);
    const rows = await exportedRows();
    expect(rows).toContainEqual(["Expenses - all categories"]);
    expect(rows).toContainEqual(["25 Oct", "Materials", "Bank", "Wiring supplies", 1250.75]);
    expect(rows).toContainEqual(["25 Oct", "Travel", "Cash", "", 200]);
    expect(rows).toContainEqual(["", "", "", "Total expenses", 1450.75]);
    expect(rows.at(-1)).toEqual(["Total expenses (period)", 1450.75]);
    expect(rows.find((row) => row[0] === "Period")?.[1]).toContain("Oct");
  });

  it("exports only supplied visible expenses and labels the category filter", async () => {
    await shareSiteExpensesXlsx(site, [expense], range, "Materials");
    const rows = await exportedRows();
    expect(rows).toContainEqual(["Expenses - Materials"]);
    expect(rows.filter((row) => row[2] === "Bank")).toHaveLength(1);
    expect(rows.at(-1)).toEqual(["Total expenses (period)", 1250.75]);
  });
});
