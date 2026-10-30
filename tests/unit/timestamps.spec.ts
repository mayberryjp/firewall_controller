import { describe, expect, it } from "vitest";
import { formatTimestamp, isTimestamp, parseTimestamp } from "@/services/timestamps";

describe("system timezone timestamp formatting", () => {
  it.each([
    ["2026-01-02T03:04:05.987+02:00", "America/Los_Angeles", "2026-01-01 17:04:05"],
    ["2026-07-02T01:04:05.999Z", "America/Los_Angeles", "2026-07-01 18:04:05"],
    ["2026-01-02T01:04:05.123456789Z", "Asia/Kolkata", "2026-01-02 06:34:05"],
    ["2026-11-01T08:30:00Z", "America/Los_Angeles", "2026-11-01 01:30:00"],
    ["2026-11-01T09:30:00Z", "America/Los_Angeles", "2026-11-01 01:30:00"],
    ["2026-01-02T00:00:00Z", "UTC", "2026-01-02 00:00:00"],
  ])("formats %s in %s", (input, zone, expected) => {
    expect(formatTimestamp(input, "Unavailable", zone)).toBe(expected);
  });

  it("reports invalid configured zones without silently using the browser timezone", () => {
    expect(formatTimestamp(0, "Unavailable", "Not/AZone")).toBe("Invalid time zone");
    expect(() => parseTimestamp("2026-01-01 00:00:00", "Not/AZone")).toThrow();
  });

  it.each([
    ["2026-01-01 17:04:05", "America/Los_Angeles", "2026-01-02T01:04:05Z"],
    ["2026-07-01 18:04:05", "America/Los_Angeles", "2026-07-02T01:04:05Z"],
    ["2026-01-02 06:34:05", "Asia/Kolkata", "2026-01-02T01:04:05Z"],
    ["1970-01-01 05:30:00", "Asia/Kolkata", "1970-01-01T00:00:00Z"],
  ])("parses %s in %s into an absolute query bound", (input, zone, expected) => {
    expect(parseTimestamp(input, zone)).toBe(Date.parse(expected));
  });

  it("rejects nonexistent and ambiguous local filter times", () => {
    expect(() => parseTimestamp("2026-03-08 02:30:00", "America/Los_Angeles")).toThrow("nonexistent");
    expect(() => parseTimestamp("2026-11-01 01:30:00", "America/Los_Angeles")).toThrow("ambiguous");
    expect(() => parseTimestamp("2026-02-30 12:00:00", "Asia/Kolkata")).toThrow("valid");
  });

  it.each([
    ["2026-01-02T03:04:05Z", "2026-01-02 03:04:05"],
    ["0001-01-02T03:04:05Z", "0001-01-02 03:04:05"],
    ["2026-10-24T14:05:53.894-07:00", "2026-10-24 21:05:53"],
    ["2026-01-01T00:15:00+05:30", "2025-12-31 18:45:00"],
    ["2024-02-29T23:59:59.999999999Z", "2024-02-29 23:59:59"],
    ["2026-11-01T01:30:00-07:00", "2026-11-01 08:30:00"],
    ["2026-11-01T01:30:00-08:00", "2026-11-01 09:30:00"],
    [0, "1970-01-01 00:00:00"],
    [Date.UTC(2026, 0, 2, 3, 4, 5, 999), "2026-01-02 03:04:05"],
  ])("formats %s with exact second precision", (input, expected) => {
    expect(formatTimestamp(input)).toBe(expected);
    expect(formatTimestamp(input)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it.each([null, undefined, ""])("preserves explicit missing values: %s", input => {
    expect(formatTimestamp(input)).toBe("Unavailable");
    expect(formatTimestamp(input, "Unknown")).toBe("Unknown");
  });

  it.each(["not a date", "2026-01-02 03:04:05", "2026-01-02T03:04:05", "2026-13-02T03:04:05Z", NaN, Infinity])(
    "visibly identifies invalid or timezone-ambiguous input: %s", input => {
      expect(formatTimestamp(input)).toBe("Invalid timestamp");
    },
  );

  it("only recognizes complete machine-readable timestamps, not counters or ordinary text", () => {
    expect(isTimestamp("2026-01-02T03:04:05.123Z")).toBe(true);
    for (const value of ["2026-01-02", "text", "18446744073709551615", 123, null]) {
      expect(isTimestamp(value)).toBe(false);
    }
  });
});
