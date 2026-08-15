import { describe, expect, it } from "vitest";
import {
  MAX_COL_PX,
  MIN_COL_PX,
  clampColumnWidth,
  parseClipboardMatrix,
  parseStoredWidths,
  widthVar,
} from "./SheetGrid";

/**
 * Pasting a block copied out of Excel/Sheets is the fastest way into the
 * invoice sheet, so the clipboard split has to survive every line ending and
 * empty cell the OS clipboard produces.
 */
describe("parseClipboardMatrix", () => {
  it("splits rows on newlines and columns on tabs", () => {
    expect(parseClipboardMatrix("Wiring\t10\t250\nPoints\t4\t500")).toEqual([
      ["Wiring", "10", "250"],
      ["Points", "4", "500"],
    ]);
  });

  it("handles Windows and old-Mac line endings", () => {
    expect(parseClipboardMatrix("a\t1\r\nb\t2")).toEqual([
      ["a", "1"],
      ["b", "2"],
    ]);
    expect(parseClipboardMatrix("a\t1\rb\t2")).toEqual([
      ["a", "1"],
      ["b", "2"],
    ]);
  });

  it("drops the trailing newline so a one-row copy adds no blank row", () => {
    expect(parseClipboardMatrix("Wiring\t10\n")).toEqual([["Wiring", "10"]]);
  });

  it("keeps empty cells so later columns stay aligned", () => {
    expect(parseClipboardMatrix("Wiring\t\t250")).toEqual([["Wiring", "", "250"]]);
  });

  it("treats a single value as one cell", () => {
    expect(parseClipboardMatrix("1200")).toEqual([["1200"]]);
  });
});

/**
 * Dragged column widths are remembered per grid. A width read back from
 * storage must never be able to make a column unusable (0px, negative, wider
 * than the screen) or crash the sheet on corrupt JSON.
 */
describe("column widths", () => {
  it("clamps a drag to a readable range and whole pixels", () => {
    expect(clampColumnWidth(10)).toBe(MIN_COL_PX);
    expect(clampColumnWidth(-500)).toBe(MIN_COL_PX);
    expect(clampColumnWidth(9999)).toBe(MAX_COL_PX);
    expect(clampColumnWidth(240.6)).toBe(241);
  });

  it("reads stored widths back as clamped pixels", () => {
    expect(parseStoredWidths('{"description":320,"qty":8}')).toEqual({
      description: 320,
      qty: MIN_COL_PX,
    });
  });

  it("ignores corrupt or non-numeric storage instead of breaking the grid", () => {
    expect(parseStoredWidths(null)).toEqual({});
    expect(parseStoredWidths("not json")).toEqual({});
    expect(parseStoredWidths("[320]")).toEqual({});
    expect(parseStoredWidths('{"description":"wide","unit":null,"rate":0}')).toEqual({});
  });

  it("makes a CSS-safe variable name from any column key", () => {
    expect(widthVar("description")).toBe("--w-description");
    expect(widthVar("rate ₹/hr")).toBe("--w-rate---hr");
  });
});
