import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { lineItemRepo } from "@/repo/repos";
import { useAuth } from "@/store/auth";
import {
  convertToBill,
  ensureDocument,
  getDocByKind,
  listItems,
} from "./documents";
import { documentTotalPaise } from "./quotation";

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
    position: 0,
  });
  await lineItemRepo.put({
    document_id: q.id,
    description: "Points",
    qty: 10,
    rate_paise: 25000,
    amount_paise: 250000,
    position: 1,
  });
  return q;
}

describe("convertToBill", () => {
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
