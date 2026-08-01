import { describe, expect, it } from "vitest";
import { normalizePhoneDigits, workerCredential } from "./workerAuth";

describe("normalizePhoneDigits", () => {
  it("strips spaces/dashes and drops a leading country code, keeping the last 10 digits", () => {
    expect(normalizePhoneDigits("+91 98470 12345")).toBe("9847012345");
  });

  it("strips parentheses and dots", () => {
    expect(normalizePhoneDigits("(984) 701.2345")).toBe("9847012345");
  });
});

describe("workerCredential", () => {
  it("is deterministic — same phone in different formats yields the same credential", () => {
    const a = workerCredential("+91 98470 12345");
    const b = workerCredential("9847012345");
    expect(a).toEqual(b);
  });

  it("uses a non-routable synthetic domain", () => {
    const { email } = workerCredential("9847012345");
    expect(email).toBe("w-9847012345@workers.powerplus.local");
  });

  it("differs across different phone numbers", () => {
    const a = workerCredential("9847012345");
    const b = workerCredential("9847099999");
    expect(a).not.toEqual(b);
  });
});
