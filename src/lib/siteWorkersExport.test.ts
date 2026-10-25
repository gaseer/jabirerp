import { beforeEach, describe, expect, it, vi } from "vitest";
import { read, utils } from "xlsx";
import type { AttendanceRow, SiteRow } from "@/lib/db";
import { buildSiteWorkersReport } from "@/domain/siteWorkers";
import { shareOrDownloadBlob } from "./pdf";
import { shareSiteWorkersPdf } from "./statementPdf";
import { shareSiteWorkersXlsx } from "./xlsx";

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
const shift: AttendanceRow = {
  id: "shift-1", owner_id: "owner", created_at: "", updated_at: "", deleted_at: null, _dirty: 0,
  site_id: site.id, employee_id: "worker-1", work_date: "2026-10-25",
  start_time: "09:00", end_time: "13:30", hours: 4.5, wage_paise: 45000, status: "approved",
};
const report = buildSiteWorkersReport(site.id, [shift], [{ id: "worker-1", name: "Suresh" }]);

beforeEach(() => vi.clearAllMocks());

describe("site workers exports", () => {
  it("generates a site-named PDF with worker totals and shift details", async () => {
    await shareSiteWorkersPdf(site, report);
    const [blob, filename] = vi.mocked(shareOrDownloadBlob).mock.calls[0];
    expect(filename).toBe("site-workers-villa.pdf");
    const pdf = await blob.text();
    expect(pdf).toMatch(/^%PDF-/);
    for (const text of ["Villa", "Suresh", "Workers on this site", "Approved shifts", "4.5h", "Rs 450"])
      expect(pdf).toContain(text);
  });

  it("exports numeric Excel hours and wages with the matching summary", async () => {
    await shareSiteWorkersXlsx(site, report);
    const [blob, filename] = vi.mocked(shareOrDownloadBlob).mock.calls[0];
    expect(filename).toBe("site-workers-villa.xlsx");
    const workbook = read(await blob.arrayBuffer(), { type: "array" });
    const rows = utils.sheet_to_json<(string | number)[]>(workbook.Sheets["Site workers"], { header: 1 });
    expect(rows).toContainEqual(["Suresh", 4.5, 450]);
    expect(rows).toContainEqual(["Total", 4.5, 450]);
    expect(rows.find((row) => row[1] === "Suresh")).toEqual([
      expect.any(String), "Suresh", expect.any(String), 4.5, 450,
    ]);
    expect(rows.slice(rows.findIndex((row) => row[0] === "Summary") + 1)).toEqual([
      ["Workers", 1], ["Total hours", 4.5], ["Total wages (site)", 450],
    ]);
  });
});
