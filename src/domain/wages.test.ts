import { describe, expect, it } from "vitest";
import {
  attendanceWagePaise,
  formatTime12,
  hoursBetween,
  hoursLabel,
  isValidTime,
  roundWageCandidates,
  timeRangeLabel,
  wagesEarnedPaise,
} from "./wages";

describe("hoursBetween", () => {
  it("whole and fractional shifts", () => {
    expect(hoursBetween("13:00", "15:00")).toBe(2); // 1pm–3pm
    expect(hoursBetween("12:30", "17:30")).toBe(5); // 12:30pm–5:30pm
    expect(hoursBetween("09:00", "09:45")).toBe(0.75);
  });

  it("wraps past midnight for overnight shifts", () => {
    expect(hoursBetween("15:00", "13:00")).toBe(22);
    expect(hoursBetween("17:00", "03:00")).toBe(10);
    expect(hoursBetween("10:00", "10:00")).toBe(0); // equal times: zero-length, not 24h
  });
});

describe("isValidTime", () => {
  it("accepts zero-padded HH:MM only", () => {
    expect(isValidTime("09:00")).toBe(true);
    expect(isValidTime("23:59")).toBe(true);
    expect(isValidTime("24:00")).toBe(false);
    expect(isValidTime("9:00")).toBe(false);
    expect(isValidTime("09:60")).toBe(false);
    expect(isValidTime("")).toBe(false);
  });
});

describe("attendanceWagePaise", () => {
  it("hourly wage × hours, rounded ONCE at write time", () => {
    expect(attendanceWagePaise(10000, 8)).toBe(80000); // ₹100/hr × 8h
    expect(attendanceWagePaise(10000, 4.5)).toBe(45000);
    expect(attendanceWagePaise(10000, 2)).toBe(20000);
  });

  it("odd wage × fractional hours rounds to integer paise", () => {
    // 7777 * 0.75 = 5832.75 → 5833
    expect(attendanceWagePaise(7777, 0.75)).toBe(5833);
    expect(Number.isInteger(attendanceWagePaise(7777, 5.25))).toBe(true);
  });

  it("sums stored wages exactly — no re-rounding", () => {
    const rows = [{ wage_paise: 5833 }, { wage_paise: 45000 }, { wage_paise: 1 }];
    expect(wagesEarnedPaise(rows)).toBe(50834);
  });
});

describe("roundWageCandidates", () => {
  it("offers nearest ₹50/₹100 in both directions, as rupee amounts", () => {
    expect(roundWageCandidates(92200)).toEqual([900, 950, 1000]); // ₹922
    expect(roundWageCandidates(91200)).toEqual([900, 950, 1000]); // ₹912
    expect(roundWageCandidates(102300)).toEqual([1000, 1050, 1100]); // ₹1023
  });

  it("drops a candidate equal to the exact computed value", () => {
    expect(roundWageCandidates(90000)).not.toContain(900); // exactly ₹900 already
  });

  it("returns nothing for a zero/negative wage", () => {
    expect(roundWageCandidates(0)).toEqual([]);
    expect(roundWageCandidates(-100)).toEqual([]);
  });
});

describe("labels", () => {
  it("12-hour clock rendering", () => {
    expect(formatTime12("13:00")).toBe("1:00 PM");
    expect(formatTime12("12:30")).toBe("12:30 PM");
    expect(formatTime12("00:15")).toBe("12:15 AM");
    expect(formatTime12("09:05")).toBe("9:05 AM");
  });

  it("range and hour labels for lists and PDFs", () => {
    expect(timeRangeLabel("13:00", "15:00")).toBe("1:00 PM – 3:00 PM");
    expect(hoursLabel(5)).toBe("5h");
    expect(hoursLabel(4.5)).toBe("4.5h");
    expect(hoursLabel(0.75)).toBe("0.75h");
  });
});
