import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { documentRepo, lineItemRepo } from "@/repo/repos";
import { useAuth } from "@/store/auth";
import {
  convertToBill,
  ensureDocument,
  getDocByKind,
  listItems,
} from "./documents";
import { documentTotalPaise } from "./quotation";
import { invoiceTotals } from "./invoice";
import { siteBillTotalPaise } from "./pnl";

const SITE = "site-1";

beforeEach(async () => {
  await db.sites.clear();
  await db.documents.clear();
  await db.line_items.clear();
  await db.outbox.clear();
  // @ts-expect-error minimal user for currentOwnerId
  useAuth.setState({ user: { id: "u1" } });
});

async function seedQuotation() {
  const q = await ensureDocument(SITE, "quotation");
  await lineItemRepo.put({
    document_id: q.id,
    description: "Wiring",
    qty: 1,
    rate_paise: 500000,
    amount_paise: 500000,
    section: null,
    unit: null,
    position: 0,
  });
  await lineItemRepo.put({
    document_id: q.id,
    description: "Points",
    qty: 10,
    rate_paise: 25000,
    amount_paise: 250000,
    section: null,
    unit: null,
    position: 1,
  });
  return q;
}

describe("convertToBill", () => {
  it("carries the single document price and discount into the bill without changing item prices", async () => {
    const quotation = await seedQuotation();
    await documentRepo.put({ ...quotation, lump_sum_paise: 600000, discount_paise: 50000 });
    expect(await siteBillTotalPaise(SITE)).toBe(0);
    const bill = await convertToBill(SITE);
    expect(bill.lump_sum_paise).toBe(600000);
    expect(bill.discount_paise).toBe(50000);
    expect(documentTotalPaise(await listItems(bill.id))).toBe(750000);
    expect(await siteBillTotalPaise(SITE)).toBe(550000);
  });
  it("preserves a quotation discount in the bill and billed income", async () => {
    const quotation = await seedQuotation();
    await documentRepo.put({ ...quotation, discount_paise: 50000 });
    expect(await siteBillTotalPaise(SITE)).toBe(0);

    const bill = await convertToBill(SITE);
    expect((await documentRepo.getById(bill.id))?.discount_paise).toBe(50000);
    expect(invoiceTotals(await listItems(bill.id), bill.discount_paise)).toEqual({
      subtotalPaise: 750000,
      discountPaise: 50000,
      totalPaise: 700000,
    });
    expect(await siteBillTotalPaise(SITE)).toBe(700000);
  });

  it("clamps a converted quotation discount so billed income cannot be negative", async () => {
    const quotation = await seedQuotation();
    await documentRepo.put({ ...quotation, discount_paise: 900000 });
    await convertToBill(SITE);
    expect(await siteBillTotalPaise(SITE)).toBe(0);
  });

  it("copies quotation items into a new bill and marks quotation converted", async () => {
    await seedQuotation();
    const bill = await convertToBill(SITE);

    const billItems = await listItems(bill.id);
    expect(billItems.map((i) => i.description)).toEqual(["Wiring", "Points"]);
    expect(documentTotalPaise(billItems)).toBe(750000); // ₹7,500

    const quotation = await getDocByKind(SITE, "quotation");
    expect(quotation?.status).toBe("converted");
    expect(bill.kind).toBe("bill");
  });

  it("bill items are independent copies (editing the bill leaves the quotation intact)", async () => {
    const q = await seedQuotation();
    const bill = await convertToBill(SITE);

    const billItems = await listItems(bill.id);
    await lineItemRepo.softDelete(billItems[0].id);

    expect((await listItems(bill.id)).length).toBe(1);
    expect((await listItems(q.id)).length).toBe(2); // quotation untouched
  });

  it("throws when there is no quotation", async () => {
    await expect(convertToBill("no-such-site")).rejects.toThrow("No quotation");
  });
});
