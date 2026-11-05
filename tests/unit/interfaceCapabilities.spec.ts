import { describe, expect, it } from "vitest";
import { interfaceCapabilitySnapshotSchema, performanceCapabilitySchema } from "@/services/interfaceCapabilities";
import { interfaceCapabilitySnapshot } from "../diagnosticsFixtures";

describe("interface capability snapshot contract", () => {
  it("preserves nulls, zero masks/counts, individual offloads, evidence and unknown feature/mode names", () => {
    const snapshot = interfaceCapabilitySnapshot();
    expect(interfaceCapabilitySnapshotSchema.parse(snapshot)).toEqual(snapshot);
  });
  it.each(["supported", "unsupported", "unknown", "not_applicable"])("keeps %s distinct from each enabled state", support => {
    for (const enabled of [true, false, null]) {
      const feature = { name: "future:feature", support, enabled, evidence: [], reason: null };
      expect(performanceCapabilitySchema.parse(feature)).toEqual(feature);
    }
  });
  it.each([
    { support: undefined }, { support: "yes" }, { enabled: "false" }, { enabled: undefined }, { evidence: null },
  ])("rejects malformed or missing capability fields without success-shaped defaults: %j", changes => {
    const feature = { name: "rss", support: "unknown", enabled: null, evidence: [], reason: null, ...changes };
    expect(performanceCapabilitySchema.safeParse(feature).success).toBe(false);
  });
  it.each([-1, 0.1, 4294967296])("rejects invalid queue counts %s", count => {
    const snapshot = interfaceCapabilitySnapshot();
    snapshot.inventory.interfaces[0]!.queues[0]!.rps_flow_count = count;
    expect(interfaceCapabilitySnapshotSchema.safeParse(snapshot).success).toBe(false);
  });
  it("rejects missing inventory rather than inventing an empty interface list", () => {
    expect(interfaceCapabilitySnapshotSchema.safeParse({ collected_at: "2026-11-04T05:10:00Z", scope: "host:test" }).success).toBe(false);
  });
});
