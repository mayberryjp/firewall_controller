import { describe, expect, it } from "vitest";
import { cpuUsage, formatBytes, hostHealthSchema, usagePercent } from "@/services/hostHealth";

import { healthSnapshot } from "../fixtures";
describe("host-health display calculations", () => {
  it("uses exact CPU deltas above 2^53 without counting guest ticks twice", () => {
    const before = healthSnapshot(), current = healthSnapshot("9007199254741018", "9007199254741068", 103);
    expect(hostHealthSchema.parse(before)).toEqual(before);
    expect(cpuUsage(before, null)).toBeNull(); expect(cpuUsage(current, before)).toBe(25);
  });
  it.each(["boot", "scope", "reset", "time", "cpu identity", "missing"])("resets CPU rates after %s changes", change => {
    const before = healthSnapshot(), current = healthSnapshot("9007199254741018", "9007199254741068", 103);
    if (change === "boot") current.sample.boot_id = "boot-2";
    else if (change === "scope") current.sample.scope = "other";
    else if (change === "reset") current.sections.cpu.data!.cpus[0]!.ticks.user = "0";
    else if (change === "time") current.sections.uptime.data!.uptime_seconds = 99;
    else if (change === "cpu identity") current.sections.cpu.data!.cpus.push({ ...current.sections.cpu.data!.cpus[0]!, name: "cpu1" });
    else current.sections.cpu.data = null;
    expect(cpuUsage(current, before)).toBeNull();
  });
  it("keeps exact gauges and missing readings distinct from zero", () => {
    expect(formatBytes("18446744073709551615")).toBe("18.45 EB");
    expect(formatBytes("0")).toBe("0 B"); expect(formatBytes(null)).toBe("Unavailable");
    expect(usagePercent("0", "100")).toBe(0); expect(usagePercent("0", "0")).toBeNull();
    expect(usagePercent("9007199254740993", "18014398509481986")).toBe(50);
  });
  it("rejects measured data in simulator snapshots", () => {
    const value = healthSnapshot(); value.sample.status = "simulated";
    expect(hostHealthSchema.safeParse(value).success).toBe(false);
  });
});