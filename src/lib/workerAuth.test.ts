import { describe, expect, it } from "vitest";
import { normalizePhoneDigits, normalizeWorkerName, workerCredential } from "./workerAuth";

describe("normalizePhoneDigits", () => {
  it("strips spaces/dashes and drops a leading country code, keeping the last 10 digits", () => {
    expect(normalizePhoneDigits("+91 98470 12345")).toBe("9847012345");
  });

  it("strips parentheses and dots", () => {
    expect(normalizePhoneDigits("(984) 701.2345")).toBe("9847012345");
  });
});

describe("normalizeWorkerName", () => {
  it("trims, lowercases and collapses inner whitespace", () => {
    expect(normalizeWorkerName("  Nihale   Sajid ")).toBe("nihale sajid");
  });
});

describe("workerCredential", () => {
  it("is deterministic — same name+phone in different formats yields the same credential", () => {
    const a = workerCredential("Nihale Sajid", "+91 98470 12345");
    const b = workerCredential("  nihale   sajid ", "9847012345");
    expect(a).toEqual(b);
  });

  it("uses a non-routable synthetic domain, phone digits readable in the local part", () => {
    const { email } = workerCredential("Nihale Sajid", "9847012345");
    expect(email).toMatch(/^w-9847012345-[0-9a-f]{16}@workers\.powerplus\.local$/);
  });

  it("differs across different phone numbers", () => {
    const a = workerCredential("Nihale Sajid", "9847012345");
    const b = workerCredential("Nihale Sajid", "9847099999");
    expect(a).not.toEqual(b);
  });

  // The bug this scheme exists to fix: workers sharing one handset used to
  // collapse into a single auth account, so the second worker to sign in
  // landed inside the first one's session.
  it("differs across different names on the SAME phone", () => {
    const a = workerCredential("Nihale Sajid", "9847012345");
    const b = workerCredential("Rashid K", "9847012345");
    expect(a.email).not.toBe(b.email);
    expect(a.password).not.toBe(b.password);
  });

  it("gives near-identical names distinct credentials", () => {
    const a = workerCredential("Anil Kumar", "9847012345");
    const b = workerCredential("Anil Kumas", "9847012345");
    expect(a.email).not.toBe(b.email);
  });
});
