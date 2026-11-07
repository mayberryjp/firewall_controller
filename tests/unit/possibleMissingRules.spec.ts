import { describe, expect, it, vi } from "vitest";
import { summarizeMissingRules, readMissingRuleHistory } from "@/services/possibleMissingRules";
import { getFirewallDenyLog } from "@/services/netcontrol";
import { firewallDenyPage } from "../firewallTelemetryFixtures";

vi.mock("@/services/netcontrol", () => ({ getFirewallDenyLog: vi.fn() }));
const until = Date.parse("2026-11-08T12:34:56.789Z");
const record = (id: string, overrides = {}) => ({ ...firewallDenyPage().records[0]!, id, timestamp_ms: until, ...overrides });

describe("possible missing rule aggregation", () => {
  it("groups across ephemeral source ports and rulesets, collects contexts and deduplicates exact IDs", () => {
    const rows = summarizeMissingRules([
      record("9", { source_port: 50001, ingress: "lab0", packet_length: 60, destination_port: 443 }),
      record("8", { source_port: 50002, ingress: "vlan20", packet_length: 120, destination_port: 443, chain: "input", reason: "policy", ruleset_id: "d".repeat(64) }),
      record("8", { packet_length: 999 }),
      record("7", { protocol: 17, destination_port: 443 }),
      record("6", { destination_port: 0 }),
      record("5", { destination_port: null }),
      record("4", { source: "192.0.2.21", destination_port: 443 }),
      record("3", { destination: "198.51.100.11", destination_port: 443 }),
    ], until - 3600000, until);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({
      source: "192.0.2.20", destination: "198.51.100.10", destinationPort: 443, protocol: 6,
      packets: 2n, bytes: 180n, ingress: ["LAB0", "VLAN20"], chains: ["forward", "input"],
      reasons: ["Default policy", "Rule drop"],
    });
    expect(rows.some(row => row.destinationPort === 0)).toBe(true);
    expect(rows.some(row => row.destinationPort === null)).toBe(true);
    expect(rows[0]).not.toHaveProperty("source_port");
  });

  it.each([1, 4, 8, 24, 168])("uses inclusive exact boundaries for the last %i hours, independent of ID order", hours => {
    const since = until - hours * 3600000;
    const rows = summarizeMissingRules([
      record("9", { timestamp_ms: since - 1 }), record("8", { timestamp_ms: until + 1 }),
      record("7", { timestamp_ms: until }), record("6", { timestamp_ms: since }),
    ], since, until);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.packets).toBe(2n);
    expect(rows[0]!.bytes).toBe(120n);
    expect(rows[0]!.lastSeen).toBe(until);
  });

  it("takes last seen from the latest matching timestamp, not the highest ID or duplicate", () => {
    const rows = summarizeMissingRules([
      record("9", { timestamp_ms: until - 2000 }),
      record("8", { timestamp_ms: until - 123 }),
      record("8", { timestamp_ms: until }),
      record("7", { timestamp_ms: until + 1 }),
      record("6", { timestamp_ms: until - 3600001 }),
    ], until - 3600000, until);
    expect(rows[0]!.lastSeen).toBe(until - 123);
    expect(rows[0]!.packets).toBe(2n);
  });

  it("sums bytes exactly above Number.MAX_SAFE_INTEGER and preserves missing interfaces", () => {
    const rows = summarizeMissingRules([
      record("2", { packet_length: Number.MAX_SAFE_INTEGER }),
      record("1", { packet_length: Number.MAX_SAFE_INTEGER, ingress_index: null, egress: null }),
    ], until - 3600000, until);
    expect(rows[0]!.bytes.toString()).toBe("18014398509481982");
    expect(rows[0]!.ingress).toEqual(["Index 3", "Unavailable"]);
    expect(rows[0]!.egress).toEqual(["Unavailable", "WAN0"]);
  });
});

describe("paginated retained drop reads", () => {
  it("reads beyond 500 records using fixed time bounds and exact uint64 cursors", async () => {
    const first = firewallDenyPage(), second = firewallDenyPage();
    first.records = Array.from({ length: 500 }, (_, index) => record((18446744073709551614n - BigInt(index)).toString()));
    first.next_before_id = first.records.at(-1)!.id;
    second.records = [record((BigInt(first.next_before_id) - 1n).toString())]; second.next_before_id = null;
    vi.mocked(getFirewallDenyLog).mockReset().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const signal = new AbortController().signal;
    const result = await readMissingRuleHistory(until, signal);
    expect(result.records).toHaveLength(501);
    expect(getFirewallDenyLog).toHaveBeenNthCalledWith(2, {
      limit: 500, since_ms: until - 7 * 86400000, until_ms: until, before_id: first.next_before_id,
    }, signal);
    expect(summarizeMissingRules(result.records, until - 3600000, until)[0]!.packets).toBe(501n);
  });

  it("retains capture and retention warnings from every page", async () => {
    const first = firewallDenyPage(), second = firewallDenyPage();
    first.cursor_expired = true; first.capture.status = "error"; first.capture.error = "Capture failed";
    first.capture.sequence_gaps = "1"; second.next_before_id = null;
    vi.mocked(getFirewallDenyLog).mockReset().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const result = await readMissingRuleHistory(until, new AbortController().signal);
    expect(result.warnings).toHaveLength(3);
    expect(result.warnings.join(" ")).toContain("Capture failed");
    expect(result.warnings.join(" ")).toContain("Retention gap");
  });

  it("rejects non-advancing cursors and page failures rather than publishing partial totals", async () => {
    vi.mocked(getFirewallDenyLog).mockReset().mockResolvedValue(firewallDenyPage());
    await expect(readMissingRuleHistory(until, new AbortController().signal)).rejects.toThrow("non-advancing");
    vi.mocked(getFirewallDenyLog).mockReset().mockResolvedValueOnce(firewallDenyPage()).mockRejectedValueOnce(new Error("Read failed"));
    await expect(readMissingRuleHistory(until, new AbortController().signal)).rejects.toThrow("Read failed");
  });

  it("does not request another page after an abort", async () => {
    const controller = new AbortController();
    vi.mocked(getFirewallDenyLog).mockReset().mockImplementationOnce(async () => {
      controller.abort(); return firewallDenyPage();
    });
    await expect(readMissingRuleHistory(until, controller.signal)).rejects.toThrow("aborted");
    expect(getFirewallDenyLog).toHaveBeenCalledTimes(1);
  });
});
