import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DocumentRow, LineItemRow, SiteRow } from "@/lib/db";
import { shareInvoicePdf, shareDocumentPdf } from "./pdf";

const OUT = process.env.PDF_PREVIEW_DIR ?? "/tmp";

function stubBrowser(sink: (blob: Blob, name: string) => void) {
  const g = globalThis as Record<string, unknown>;
  // Node has no FileReader; loadBrandLogo needs one to build the data URL.
  g.FileReader = class {
    result: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    error: unknown = null;
    readAsDataURL(blob: Blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = `data:image/png;base64,${Buffer.from(buf).toString("base64")}`;
        this.onload?.();
      });
    }
  };
  g.fetch = async () =>
    new Response(readFileSync("src/assets/logo-mark.png"), {
      headers: { "content-type": "image/png" },
    });
  Object.defineProperty(g, "navigator", { value: {}, configurable: true });
  let pending: Blob | null = null;
  const realUrl = g.URL as typeof URL;
  Object.defineProperty(g, "URL", { configurable: true, value: Object.assign(Object.create(realUrl), {
    createObjectURL: (b: Blob) => {
      pending = b;
      return "blob:test";
    },
    revokeObjectURL: () => {},
  })});
  Object.defineProperty(g, "document", { configurable: true, value: {
    createElement: () => ({
      set href(_v: string) {},
      set download(name: string) {
        if (pending) sink(pending, name);
      },
      click() {},
    }),
  }});
}

const site: SiteRow = {
  id: "s1",
  owner_id: "u1",
  created_at: "",
  updated_at: "",
  deleted_at: null,
  _dirty: 0,
  name: "Sajeev Kumar — Villa, Kakkanad",
  phone: "+91 98470 12345",
  location: "Kakkanad, Ernakulam",
  work_type: "Mixed",
  status: "Active",
};

const invoice: DocumentRow = {
  id: "d1",
  owner_id: "u1",
  created_at: "",
  updated_at: "",
  deleted_at: null,
  _dirty: 0,
  site_id: "s1",
  kind: "invoice",
  doc_number: "INV-0007",
  status: "final",
  doc_date: "2026-07-28",
  title: "Ground floor wiring + bathroom plumbing",
  notes: "Payment within 15 days. Warranty: 1 year on workmanship, materials as per brand warranty.",
  discount_paise: 250000,
};

const line = (
  i: number,
  description: string,
  section: string,
  unit: string,
  qty: number,
  ratePaise: number,
): LineItemRow => ({
  id: `l${i}`,
  owner_id: "u1",
  created_at: "",
  updated_at: "",
  deleted_at: null,
  _dirty: 0,
  document_id: "d1",
  description,
  qty,
  rate_paise: ratePaise,
  amount_paise: Math.round(qty * ratePaise),
  position: i,
  section,
  unit,
});

const items = [
  line(0, "Light / fan point wiring with 1.5 sq mm FR cable", "Works", "pt", 42, 45000),
  line(1, "Power plug point 6A with modular socket", "Works", "pt", 18, 65000),
  line(2, "AC point 20A with dedicated MCB", "Works", "pt", 3, 185000),
  line(3, "Main earthing pit with copper plate", "Works", "nos", 1, 750000),
  line(4, "Modular switch plate — 8 module", "Materials", "nos", 12, 42000),
  line(5, "PVC conduit pipe 25mm heavy duty", "Materials", "mtr", 220, 4800),
  line(6, "Distribution board 12 way, double door", "Materials", "nos", 2, 385000),
  line(7, "CPVC pipe 3/4 inch with fittings", "Plumbing", "mtr", 96, 9500),
  line(8, "Bathroom fitting set — shower, tap, health faucet", "Plumbing", "set", 3, 620000),
  line(9, "Water tank connection with ball valve", "Plumbing", "nos", 1, 145000),
];

/**
 * Not an assertion test — it renders the real customer-facing PDFs so the
 * layout can be eyeballed after a design change. Skipped by default; run it
 * with:
 *
 *   PDF_PREVIEW_DIR=/tmp npx vitest run src/lib/pdfPreview.test.ts
 *
 * (drop the `.skip` first), then open the PDFs or `qlmanage -t` them.
 */
describe("pdf preview", () => {
  it.skip("writes an invoice + bill PDF to the scratchpad", async () => {
    const written: string[] = [];
    stubBrowser((blob, name) => {
      written.push(name);
      blob.arrayBuffer().then((buf) => {
        writeFileSync(`${OUT}/${name}`, Buffer.from(buf));
      });
    });
    await shareInvoicePdf(site, invoice, items);
    await shareDocumentPdf(site, "quotation", items.slice(0, 4));
    await new Promise((r) => setTimeout(r, 200));
    expect(written.length).toBe(2);
  });
});
