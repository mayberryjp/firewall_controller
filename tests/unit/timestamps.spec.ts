import { describe, expect, it } from "vitest";
import { formatTimestamp, isTimestamp } from "@/services/timestamps";

describe("container UTC timestamp formatting", () => {
  it.each([
    ["2026-01-02T03:04:05Z", "2026-01-02 03:04:05"],
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
