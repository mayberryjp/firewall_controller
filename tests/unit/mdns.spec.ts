import { describe, expect, it } from "vitest";
import { configSchema, mdnsSchema, mdnsStatusPageSchema, runtimeSchema, revisionDetailSchema, transactionSchema } from "@/types/domain";
import { differenceContext, differences, equalConfig, importConfig, normalize, requiredPermissions, serviceRepairPermissions, validateConfig } from "@/services/configuration";
import { mdnsInterfaces } from "@/services/mdns";
import { decodeJson, encodeJson } from "@/services/json";
import { config, mdnsStatus, runtime, transaction } from "../fixtures";

function candidate() {
  const result = config();
  result.interfaces = ["lan0", "lan1"].map((name, index) => ({
    name, kind: "ethernet", role: "lan", up: true, mtu: 1500,
    addresses: [`192.0.${index + 2}.1/24`], dhcp_relay: { enabled: false, servers: [] },
  }));
  result.routes = []; result.softflowd = []; result.firewall.nat.masquerade = [];
  result.mdns = mdnsSchema.parse({ enabled: true, interfaces: ["lan0", "lan1"], reflection: { enabled: true } });
  return result;
}
const issues = (value: ReturnType<typeof candidate>) => validateConfig(value).filter(issue => issue.path.startsWith("mdns."));

describe("mDNS configuration and runtime contracts", () => {
  it("uses safe disabled defaults without inventing configuration on older backends", () => {
    expect(mdnsSchema.parse({})).toEqual({
      enabled: false, interface_mode: "allow", interfaces: [], ipv4: true, ipv6: true,
      reflection: { enabled: false, filters: [] },
      publishing: { enabled: false, hostname: "", domain: "local.", addresses: false, hinfo: false, workstation: false, browse_domain: false, aaaa_on_ipv4: false, a_on_ipv6: false },
    });
    expect(configSchema.parse(config()).mdns).toBeUndefined();
  });
  it.each([true, false])("preserves enabled=%s preferences and metadata across import, history, transactions and export", enabled => {
    const value = candidate(); value.mdns!.enabled = enabled;
    value.mdns!.metadata = { display_name: "Discovery", description: "Printers\nLAN only" };
    value.mdns!.reflection.filters = ["_ipp._tcp.local.", "_color._sub._ipp._tcp.local.", "printer.local.", "_udp._govee-lan._udp.local."];
    value.mdns!.publishing.aaaa_on_ipv4 = true; value.mdns!.publishing.addresses = true;
    const roundtrip = importConfig(encodeJson(value));
    expect(roundtrip.mdns).toEqual(value.mdns);
    expect(configSchema.parse(decodeJson(encodeJson(roundtrip)))).toEqual(value);
    const pending = transactionSchema.parse({ ...transaction(), candidate: value, previous: value });
    expect(pending.previous.mdns).toEqual(value.mdns); expect(pending.candidate.mdns).toEqual(value.mdns);
    expect(revisionDetailSchema.parse({ revision: "0", current: true, submitted_at: null, committed_at: null, config: value }).config.mdns).toEqual(value.mdns);
    expect(issues(value)).toEqual([]);
  });
  it.each(["_udp._govee-lan._udp.local.", "living-room._googlecast._tcp.local.", "printer_1._ipp._tcp.office.local."])("accepts exact instance filter %s without changing its identity", filter => {
    const value = candidate(); value.mdns!.reflection.filters = [filter];
    expect(issues(value)).toEqual([]);
    expect(normalize(value).mdns!.reflection.filters).toEqual([filter]);
  });
  it("normalizes case/order, includes mDNS in SAVE context and authorizes metadata-only edits", () => {
    const before = candidate(), after = candidate();
    before.mdns!.reflection.filters = ["printer.local.", "_ipp._tcp.local."];
    after.mdns!.reflection.filters = ["_IPP._TCP.LOCAL.", "PRINTER.LOCAL."];
    after.mdns!.interfaces.reverse(); after.mdns!.publishing.domain = "LOCAL.";
    expect(equalConfig(before, after)).toBe(true);
    after.mdns!.metadata = { display_name: "Printers", description: "" };
    const diff = differences(before, after);
    expect(diff.map(item => item.area)).toEqual(["mdns"]);
    expect(requiredPermissions(diff)).toEqual(["transactions.write", "mdns.write"]);
    expect(differenceContext(normalize(before), normalize(after), diff[0]!).after).toEqual(normalize(after));
    for (const service of ["mdns", "softflowd", "ntp", "syslog", "vnstat", "dhcp-relay", "gateway-monitoring"] as const) {
      expect(serviceRepairPermissions(after, service)).toContain("mdns.write");
    }
    after.mdns!.enabled = false;
    expect(serviceRepairPermissions(after, "ntp")).not.toContain("mdns.write");
    expect(serviceRepairPermissions(after, "mdns")).toContain("mdns.write");
  });
  it("selects only up Ethernet/VLAN LAN links and expands deny membership deterministically", () => {
    const value = candidate();
    value.interfaces.push(
      { ...value.interfaces[0]!, name: "wan0", role: "wan" },
      { ...value.interfaces[0]!, name: "down0", up: false },
      { ...value.interfaces[0]!, name: "dummy0", kind: "dummy" },
      { ...value.interfaces[0]!, name: "unused0", role: "unassigned" },
      { ...value.interfaces[0]!, name: "vlan10", kind: "vlan", role: "unassigned", vlan: { parent: "lan0", id: 10 } },
    );
    expect(mdnsInterfaces(value)).toEqual(["lan0", "lan1"]);
    value.mdns!.interfaces = ["lan0", "vlan10"];
    expect(mdnsInterfaces(value)).toEqual(["lan0", "vlan10"]);
    expect(issues(value)).toEqual([]);
    value.mdns!.interfaces = []; expect(mdnsInterfaces(value)).toEqual([]);
    value.mdns!.interface_mode = "deny"; value.mdns!.interfaces = ["lan1", "wan0"];
    expect(mdnsInterfaces(value)).toEqual(["lan0", "vlan10"]); expect(issues(value)).toEqual([]);
    value.interfaces.push({ ...value.interfaces[0]!, name: "lan2" });
    expect(mdnsInterfaces(value)).toEqual(["lan0", "lan2", "vlan10"]);
  });
  it.each(["missing", "wan0", "down0", "dummy0", "wan-vlan", "down-vlan", "missing-parent-vlan", "down-parent-vlan"])("validates interface references even when disabled (%s)", name => {
    const value = candidate();
    value.interfaces.push(
      { ...value.interfaces[0]!, name: "wan0", role: "wan" },
      { ...value.interfaces[0]!, name: "down0", up: false },
      { ...value.interfaces[0]!, name: "dummy0", kind: "dummy" },
      { ...value.interfaces[0]!, name: "wan-vlan", kind: "vlan", role: "unassigned", vlan: { parent: "wan0", id: 10 } },
      { ...value.interfaces[0]!, name: "down-vlan", kind: "vlan", role: "unassigned", up: false, vlan: { parent: "lan0", id: 20 } },
      { ...value.interfaces[0]!, name: "missing-parent-vlan", kind: "vlan", role: "unassigned", vlan: { parent: "missing", id: 30 } },
      { ...value.interfaces[0]!, name: "down-parent-vlan", kind: "vlan", role: "unassigned", vlan: { parent: "down0", id: 40 } },
    );
    value.mdns!.enabled = false; value.mdns!.interfaces = [name];
    expect(issues(value).some(issue => issue.path === "mdns.interfaces")).toBe(true);
  });
  it("enforces 2..32 reflection links, 1..32 publishing links, functions and effective families", () => {
    const value = candidate();
    value.mdns!.interfaces = ["lan0"]; expect(issues(value)[0]?.message).toContain("2..32");
    value.mdns!.reflection.enabled = false; value.mdns!.publishing = { ...value.mdns!.publishing, enabled: true, hostname: "firewall", addresses: true };
    expect(issues(value)).toEqual([]);
    value.mdns!.interfaces = []; expect(issues(value)[0]?.message).toContain("1..32");
    value.mdns!.interfaces = ["lan0"]; value.mdns!.publishing.enabled = false;
    expect(issues(value).some(issue => issue.path === "mdns.enabled")).toBe(true);
    value.mdns!.publishing.enabled = true; value.mdns!.ipv4 = false; value.ipv6_enabled = false;
    expect(issues(value).some(issue => issue.path === "mdns.ipv4")).toBe(true);
    value.mdns!.ipv4 = true; value.mdns!.publishing.aaaa_on_ipv4 = true;
    expect(issues(value)).toEqual([]); expect(value.mdns!.ipv6).toBe(true);
  });
  it("enforces exact interface/filter count limits and case-insensitive uniqueness", () => {
    const value = candidate();
    value.interfaces = Array.from({ length: 33 }, (_, index) => ({ ...value.interfaces[0]!, name: `lan${index}` }));
    value.mdns!.interfaces = value.interfaces.slice(0, 32).map(link => link.name);
    value.mdns!.reflection.filters = Array.from({ length: 64 }, (_, index) => `printer${index}.local.`);
    expect(issues(value)).toEqual([]);
    value.mdns!.interfaces.push("lan32"); value.mdns!.reflection.filters.push("printer64.local.");
    expect(issues(value).map(issue => issue.path)).toEqual(expect.arrayContaining(["mdns.interfaces", "mdns.reflection.filters"]));
    value.mdns!.interfaces = ["lan0", "lan0"]; value.mdns!.reflection.filters = ["printer.local.", "PRINTER.LOCAL."];
    expect(issues(value).map(issue => issue.path)).toEqual(expect.arrayContaining(["mdns.interfaces", "mdns.reflection.filters"]));
  });
  it.each(["*.local.", "printer.local", "printer.example.", "_http._sctp.local.", "_udp._govee-lan._sctp.local.", "_udp._govee-lan._udp.example.", "_u*._govee-lan._udp.local.", "pr inter.local.", "prínter.local.", `${"a".repeat(64)}.local.`])("rejects noncanonical filter %s", filter => {
    const value = candidate(); value.mdns!.reflection.filters = [filter];
    expect(issues(value).some(issue => issue.path === "mdns.reflection.filters")).toBe(true);
  });
  it("enforces the exact 253-byte name limit and generated publishing name limits", () => {
    const value = candidate(), name = [63, 63, 63, 54].map(size => "a".repeat(size)).join(".") + ".local.";
    expect(name.length).toBe(253); value.mdns!.reflection.filters = [name]; expect(issues(value)).toEqual([]);
    value.mdns!.reflection.filters = [`a${name}`]; expect(issues(value).length).toBeGreaterThan(0);
    value.mdns!.reflection.filters = [];
    value.mdns!.publishing = { ...value.mdns!.publishing, enabled: true, hostname: "firewall", domain: name, addresses: true };
    expect(issues(value).some(issue => issue.path === "mdns.publishing.domain")).toBe(true);
  });
  it("validates publishing disclosure choices, configured hostname fallback and cross-family requirements", () => {
    const value = candidate(); value.mdns!.publishing.enabled = true;
    expect(issues(value).map(issue => issue.path)).toEqual(expect.arrayContaining(["mdns.publishing.enabled", "mdns.publishing.hostname"]));
    value.system = { hostname: "firewall", domain: "ignored.example", timezone: "" };
    value.mdns!.publishing.hinfo = true; expect(issues(value)).toEqual([]);
    value.mdns!.publishing.hostname = "Bad-"; expect(issues(value).some(issue => issue.path === "mdns.publishing.hostname")).toBe(true);
    value.mdns!.publishing.hostname = ""; value.mdns!.publishing.domain = "_bad.local.";
    expect(issues(value).some(issue => issue.path === "mdns.publishing.domain")).toBe(true);
    value.mdns!.publishing.domain = "local."; value.mdns!.publishing.aaaa_on_ipv4 = true; value.mdns!.publishing.a_on_ipv6 = true;
    expect(issues(value).map(issue => issue.path)).toEqual(expect.arrayContaining(["mdns.publishing.aaaa_on_ipv4", "mdns.publishing.a_on_ipv6"]));
    value.mdns!.publishing.addresses = true; expect(issues(value)).toEqual([]);
  });
  it.each([undefined, null, "UDP 5353 is owned"])("decodes native mDNS error %s in dedicated and aggregate runtime responses", error => {
    const row: Record<string, unknown> = { ...mdnsStatus(), error };
    if (error === undefined) delete row.error;
    const expected = { ...row, error: error ?? null };
    expect(mdnsStatusPageSchema.parse({ instances: [row], error: "" }).instances[0]).toEqual(expected);
    expect(runtimeSchema.parse({ ...runtime(), appliance_services: [row] }).appliance_services[0]).toEqual(expected);
  });
  it("preserves heterogeneous runtime fields and exact counters, rejecting malformed mDNS instead of using an NTP-shaped fallback", () => {
    const row = mdnsStatus(), envelope = { instances: [row], error: "" };
    expect(mdnsStatusPageSchema.parse(decodeJson(encodeJson(envelope)))).toEqual(envelope);
    expect(runtimeSchema.parse({ ...runtime(), appliance_services: [...runtime().appliance_services, row] }).appliance_services.at(-1)).toEqual(row);
    for (const received_packets of [9007199254740992, "-1", "1.5", "01"]) {
      const bad = { ...row, received_packets };
      expect(mdnsStatusPageSchema.safeParse({ instances: [bad], error: "" }).success).toBe(false);
      expect(runtimeSchema.safeParse({ ...runtime(), appliance_services: [bad] }).success).toBe(false);
    }
  });
});
