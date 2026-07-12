import { describe, expect, it } from "vitest";
import { formatPaise, toPaise } from "./money";

describe("formatPaise", () => {
  it("formats whole rupees with ₹ and no decimals", () => {
    expect(formatPaise(1250000)).toBe("₹12,500");
  });

  it("uses a true minus for negatives", () => {
    expect(formatPaise(-85000)).toBe("−₹850");
  });

  it("renders zero", () => {
    expect(formatPaise(0)).toBe("₹0");
  });

  it("shows paise when not a whole rupee", () => {
    expect(formatPaise(1099)).toBe("₹10.99");
  });

  it("groups with the Indian numbering system (lakh/crore)", () => {
    expect(formatPaise(1000000000)).toBe("₹1,00,00,000"); // 1 crore rupees
  });
});

describe("toPaise", () => {
  it("parses a decimal rupee string", () => {
    expect(toPaise("125.00")).toBe(12500);
  });

  it("parses an integer rupee string", () => {
    expect(toPaise("125")).toBe(12500);
  });

  it("round-trips through formatPaise", () => {
    expect(formatPaise(toPaise("12500"))).toBe("₹12,500");
  });

  it("returns 0 for garbage input", () => {
    expect(toPaise("abc")).toBe(0);
  });
});
