import { describe, expect, it } from "vitest";
import { interfaceCapabilitySnapshotSchema, performanceCapabilitySchema, hideRssIrqNavigation } from "@/services/interfaceCapabilities";
import { interfaceCapabilitySnapshot } from "../diagnosticsFixtures";

describe("interface capability snapshot contract", () => {
  it("hides RSS/IRQ when every displayed state is unknown or not supported", () => {
    const snapshot = interfaceCapabilitySnapshot();
    const rss = snapshot.inventory.interfaces[0]!.capabilities.find(feature => feature.name === "rss")!;
    expect(hideRssIrqNavigation(snapshot)).toBe(true);
    rss.support = "unsupported";
    expect(hideRssIrqNavigation(snapshot)).toBe(true);
    rss.support = "unknown";
    expect(hideRssIrqNavigation(snapshot)).toBe(true);
    for (const row of snapshot.inventory.interfaces) {
      const feature = row.capabilities.find(item => item.name === "rss")!;
      feature.support = "unknown"; feature.enabled = null;
    }
    expect(hideRssIrqNavigation(snapshot)).toBe(true);
    rss.support = "supported"; rss.enabled = true;
    expect(hideRssIrqNavigation(snapshot)).toBe(false);
    rss.enabled = false;
    expect(hideRssIrqNavigation(snapshot)).toBe(false);
    rss.enabled = null;
    expect(hideRssIrqNavigation(snapshot)).toBe(true);
    rss.support = "unsupported";
    snapshot.inventory.status = "partial";
    expect(hideRssIrqNavigation(snapshot)).toBe(true);
    snapshot.inventory.status = "simulated";
    expect(hideRssIrqNavigation(snapshot)).toBe(true);
    snapshot.inventory.interfaces[0]!.capabilities = snapshot.inventory.interfaces[0]!.capabilities.filter(feature => feature.name !== "rss");
    expect(hideRssIrqNavigation(snapshot)).toBe(true);
    snapshot.inventory.status = "observed"; snapshot.inventory.interfaces = [];
    expect(hideRssIrqNavigation(snapshot)).toBe(false);
    expect(hideRssIrqNavigation(null)).toBe(false);
  });
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
  it("preserves inherited RPS, nullable RSS observations and exact sparse IRQ counters", () => {
    const snapshot = interfaceCapabilitySnapshot(), row = snapshot.inventory.interfaces[0]!;
    row.capabilities.find(feature => feature.name === "rps")!.inherited_from = "eno2";
    row.rss = { context: 0, indirection_table: [0, 1], hash_function: null, input_transformation: 0 };
    row.interrupts = [{ irq: 135, description: null, effective_cpus: [], counts: [{ cpu_id: 7, interrupts: "18446744073709551615" }], errors: [] }];
    row.queues[0]!.irqs = null; row.queues[0]!.irq_mapping_reason = "Shared driver action";
    expect(interfaceCapabilitySnapshotSchema.parse(snapshot)).toEqual(snapshot);
  });
});
