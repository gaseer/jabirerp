import { describe, expect, it } from "vitest";
import { parseClipboardMatrix } from "./SheetGrid";

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
