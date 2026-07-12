import { describe, expect, it } from "vitest";
import { documentTotalPaise, lineAmountPaise } from "./quotation";

describe("lineAmountPaise", () => {
  it("multiplies qty by rate in paise", () => {
    expect(lineAmountPaise(3, 50000)).toBe(150000); // 3 × ₹500 = ₹1,500
  });

  it("rounds fractional qty to whole paise", () => {
    expect(lineAmountPaise(2.5, 12345)).toBe(30863); // 2.5 × 12345 = 30862.5 → 30863
  });
});

describe("documentTotalPaise", () => {
  it("sums line amounts", () => {
    expect(
      documentTotalPaise([{ amount_paise: 150000 }, { amount_paise: 30863 }]),
    ).toBe(180863);
  });

  it("is zero for no items", () => {
    expect(documentTotalPaise([])).toBe(0);
  });
});
