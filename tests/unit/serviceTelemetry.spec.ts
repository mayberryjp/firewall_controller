import { describe, expect, it } from "vitest";
import { LosslessNumber } from "lossless-json";
import { dhcpRelayStatisticsSchema, dhcpRelayLogPageSchema } from "@/services/dhcpDiagnostics";
import { persistentLogPageSchema } from "@/services/logs";
import { numericCounterSchema, uint64Schema } from "@/services/counters";
import { relayStatistics, relayLog, persistentLog } from "../serviceTelemetryFixtures";

describe("service telemetry contracts", () => {
  it("preserves u64 counter boundaries without rounding", () => {
    expect(uint64Schema.parse("18446744073709551615")).toBe("18446744073709551615");
    expect(numericCounterSchema.parse(new LosslessNumber("18446744073709551615"))).toBe("18446744073709551615");
    expect(numericCounterSchema.parse(0)).toBe("0");
  });
  it.each(["-1", "01", "1.2", "18446744073709551616"])("rejects invalid unsigned count %s", value => {
    expect(uint64Schema.safeParse(value).success).toBe(false);
    if (value === "01") expect(() => new LosslessNumber(value)).toThrow();
    else expect(numericCounterSchema.safeParse(new LosslessNumber(value)).success).toBe(false);
  });
  it("keeps disabled and simulated counters unavailable, without fake zero defaults", () => {
    const result = relayStatistics();
    result.worker.state = "simulated"; result.totals = null;
    result.interfaces.forEach(row => { row.counters = null; });
    expect(dhcpRelayStatisticsSchema.parse(result).totals).toBeNull();
    result.totals = relayStatistics().totals;
    expect(dhcpRelayStatisticsSchema.safeParse(result).success).toBe(false);
    expect(dhcpRelayStatisticsSchema.safeParse({ ...result, totals: undefined }).success).toBe(false);
  });
  it("rejects mismatched relay epoch/cursor and oversized persistent messages/pages", () => {
    expect(dhcpRelayLogPageSchema.safeParse({ ...relayLog(), epoch: "ffffffffffffffffffffffffffffffff" }).success).toBe(false);
    const log = persistentLog();
    log.entries[0]!.message = "x".repeat(65001);
    expect(persistentLogPageSchema.safeParse(log).success).toBe(false);
    log.entries = Array.from({ length: 9 }, (_, index) => ({ ...persistentLog().entries[0]!, sequence: String(index + 1), message: "x".repeat(65000) }));
    expect(persistentLogPageSchema.safeParse(log).success).toBe(false);
  });
});
