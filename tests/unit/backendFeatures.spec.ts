import { describe, expect, it } from "vitest";
import { configSchema, interfaceSchema, runtimeSchema, transactionSchema, revisionDetailSchema } from "@/types/domain";
import { differences, equalConfig, importConfig, normalize, requiredPermissions, selectedRelayPrefix, serviceRepairPermissions, validateConfig } from "@/services/configuration";
import { preset, resourceFields } from "@/services/resourceForms";
import { decodeJson, encodeJson } from "@/services/json";
import { config, runtime, transaction } from "../fixtures";

describe("global IPv4 ICMP exception", () => {
  it.each([undefined, null, true, false])("uses the documented nullish default for %s", value => {
    const candidate = config();
    const parsed = configSchema.parse({ ...candidate, firewall: { ...candidate.firewall, allow_all_icmp: value } });
    expect(parsed.firewall.allow_all_icmp).toBe(value ?? true);
    expect(importConfig(encodeJson(parsed)).firewall.allow_all_icmp).toBe(value ?? true);
  });
  it.each(["false", 0, 1, {}, []])("rejects a nonboolean flag %j", value => {
    const candidate = config();
    expect(configSchema.safeParse({ ...candidate, firewall: { ...candidate.firewall, allow_all_icmp: value } }).success).toBe(false);
  });
  it.each(["accept", "drop"] as const)("reviews/authorizes a flag-only edit with policy %s", policy => {
    const before = config(); before.firewall.policy = policy;
    const after = structuredClone(before); after.firewall.allow_all_icmp = false;
    expect(differences(before, after)).toEqual([{ area: "firewall-icmp", identity: "Allow all IPv4 ICMP", kind: "modified", before: true, after: false }]);
    expect(requiredPermissions(differences(before, after))).toEqual(["transactions.write", "firewall.write"]);
    after.routes[0]!.metric = 42;
    expect(importConfig(encodeJson(after)).firewall.allow_all_icmp).toBe(false);
    expect(after.firewall.rules).toEqual(before.firewall.rules);
  });
  it("preserves real host/interface policies without synthesizing exception rows", () => {
    const before = config(); before.firewall.rules = [];
    before.firewall.policies = { hosts: [{ id: "host0", name: "Test host", addresses: ["192.0.2.5"], policy: "drop", rules: [] }], interfaces: [{ interface: "lab0", rules: [] }] };
    const after = importConfig(encodeJson(before)); after.firewall.allow_all_icmp = false;
    expect(validateConfig(after, [], before)).toEqual([]);
    expect(after.firewall.policies).toEqual(before.firewall.policies);
    expect(differences(before, after).map(item => item.area)).toEqual(["firewall-icmp"]);
    after.firewall.policies!.hosts = [];
    expect(validateConfig(after, [], before).some(issue => issue.path === "firewall.policies")).toBe(true);
  });
});
describe("required explicit WAN/LAN role", () => {
  it.each([undefined, null, "", "WAN", "Lan", "dmz", 1, true])("rejects invalid or missing role %s without inferring it", role => {
    const link = { ...config().interfaces[0]!, role };
    expect(interfaceSchema.safeParse(link).success).toBe(false);
    expect(interfaceSchema.safeParse(preset("interfaces")).success).toBe(false);
  });
  it.each(["dummy", "vlan", "wireguard"] as const)("requires explicit role on %s and renders labeled choices", kind => {
    const common = { ...config().interfaces[0]!, kind };
    const link = kind === "vlan" ? { ...common, vlan: { parent: "parent0", id: 1 } } :
      kind === "wireguard" ? { ...common, wireguard: { key_ref: "key", listen_port: 51820, peers: [] } } : common;
    for (const role of ["wan", "lan"]) expect(interfaceSchema.parse({ ...link, role }).role).toBe(role);
    const field = resourceFields("interfaces", [], [], false, kind, undefined, []).find(item => item.key === "role");
    expect(field?.choices).toEqual([{ title: "WAN", value: "wan" }, { title: "LAN", value: "lan" }]);
  });
  it("changes role independently of name and only needs interface permission", () => {
    const before = config(), after = config(); after.interfaces[0]!.role = "wan";
    expect(validateConfig(after, [], before)).toEqual([]);
    expect(differences(before, after)).toHaveLength(1);
    expect(requiredPermissions(differences(before, after))).toEqual(["transactions.write", "interfaces.write"]);
    expect(after.routes).toEqual(before.routes); expect(after.firewall).toEqual(before.firewall);
  });
});
describe("DHCPv4 relay contract and validation", () => {
  it("defaults omitted relay settings to disabled but preserves disabled servers", () => {
    const link = config().interfaces[0]!;
    const withoutRelay: Record<string, unknown> = { ...link }; delete withoutRelay.dhcp_relay;
    expect(interfaceSchema.parse(withoutRelay).dhcp_relay).toEqual({ enabled: false, servers: [] });
    const candidate = config(); candidate.interfaces[0]!.dhcp_relay.servers = ["198.51.100.10", "198.51.100.20"];
    expect(validateConfig(candidate)).toEqual([]);
    expect(importConfig(encodeJson(candidate))).toEqual(candidate);
  });
  it.each(["host.example", "198.51.100.1:67", "198.51.100.0/24", "198.051.100.1", "2001:db8::1", "0.0.0.0", "127.0.0.1", "169.254.1.1", "224.0.0.1", "255.255.255.255"])("rejects server %s even when disabled", server => {
    const candidate = config(); candidate.interfaces[0]!.dhcp_relay.servers = [server];
    expect(validateConfig(candidate).some(issue => issue.path === "interfaces.0.dhcp_relay.servers.0")).toBe(true);
  });
  it.each(["10.0.0.1", "192.0.2.1", "198.51.100.20"])("accepts canonical unicast server %s", server => {
    const candidate = config(); candidate.interfaces[0]!.dhcp_relay = { enabled: true, servers: [server] };
    expect(validateConfig(candidate)).toEqual([]);
  });
  it("rejects duplicate servers and enabled relay without a server", () => {
    const candidate = config(), relay = candidate.interfaces[0]!.dhcp_relay;
    relay.servers = ["198.51.100.1", "198.51.100.1"];
    expect(validateConfig(candidate).some(issue => issue.path.endsWith("servers.1"))).toBe(true);
    relay.servers = []; relay.enabled = true;
    expect(validateConfig(candidate).some(issue => issue.path.endsWith(".servers"))).toBe(true);
  });
  it("enforces administrative up, supported link kinds and local IPv4", () => {
    const candidate = config(), link = candidate.interfaces[0]!;
    link.dhcp_relay = { enabled: true, servers: ["198.51.100.1"] }; link.up = false;
    expect(validateConfig(candidate).some(issue => issue.message.includes("administratively up"))).toBe(true);
    link.up = true; link.addresses = ["2001:db8::10/64"];
    expect(validateConfig(candidate).some(issue => issue.message.includes("configured unicast IPv4"))).toBe(true);
    candidate.interfaces[0] = { ...link, kind: "wireguard", wireguard: { key_ref: "key", listen_port: 51820, peers: [] } };
    expect(validateConfig(candidate).some(issue => issue.message.includes("dummy or VLAN"))).toBe(true);
  });
  it("selects by lexicographic canonical prefix order, never numeric or input order", () => {
    expect(selectedRelayPrefix({ addresses: ["2001:db8::1/64", "192.0.2.2/24", "192.0.2.10/24"] })).toBe("192.0.2.10/24");
    expect(selectedRelayPrefix({ addresses: ["2001:db8::1/64"] })).toBeUndefined();
    expect(() => selectedRelayPrefix({ addresses: ["192.0.02.1/24"] })).toThrow();
  });
  it("rejects duplicate selected addresses even with different prefix lengths", () => {
    const candidate = config(), link = candidate.interfaces[0]!;
    link.dhcp_relay = { enabled: true, servers: ["198.51.100.1"] };
    candidate.interfaces.push({ ...structuredClone(link), name: "other0", role: "wan", addresses: ["192.0.2.10/25"] });
    expect(validateConfig(candidate).some(issue => issue.message.includes("distinct selected IPv4"))).toBe(true);
  });
  it("normalizes unordered server lists and preserves explicit false through full packages", () => {
    const before = config(), after = config();
    before.interfaces[0]!.dhcp_relay.servers = ["198.51.100.20", "198.51.100.10"];
    after.interfaces[0]!.dhcp_relay.servers = [...before.interfaces[0]!.dhcp_relay.servers].reverse();
    expect(equalConfig(before, after)).toBe(true);
    after.firewall.allow_all_icmp = false;
    expect(normalize(after).interfaces[0]!.dhcp_relay.servers).toEqual(["198.51.100.10", "198.51.100.20"]);
    expect(requiredPermissions(differences(config(), after))).toEqual(["transactions.write", "interfaces.write", "firewall.write"]);
  });
  it("preserves new fields through transaction and revision snapshots", () => {
    const candidate = config(); candidate.interfaces[0]!.role = "wan";
    candidate.interfaces[0]!.dhcp_relay = { enabled: true, servers: ["198.51.100.20", "198.51.100.10"] };
    candidate.firewall.allow_all_icmp = false;
    const pending = transaction(); pending.candidate = candidate;
    expect(transactionSchema.parse(decodeJson(encodeJson(pending))).candidate).toEqual(candidate);
    const revision = { revision: "0", current: false, submitted_at: null, committed_at: null, config: candidate };
    expect(revisionDetailSchema.parse(decodeJson(encodeJson(revision))).config).toEqual(candidate);
  });
  it.each(["disabled", "simulated", "unavailable", "not_running", "running", "unhealthy", "exited", "future_status"])("retains runtime state %s and errors", state => {
    const data = runtime();
    data.dhcp_relay = [{ interface: "lab0", state, pid: 1234, error: "Local detail" }]; data.error = "Top-level detail";
    expect(runtimeSchema.parse(data)).toEqual(data);
  });
  it("computes repair permissions from all stored enabled services", () => {
    const candidate = config();
    expect(serviceRepairPermissions(candidate, "dhcp-relay")).toEqual(["state.read", "transactions.write", "interfaces.write"]);
    candidate.softflowd[0]!.enabled = true;
    expect(serviceRepairPermissions(candidate, "dhcp-relay")).toContain("softflowd.write");
    candidate.interfaces[0]!.dhcp_relay.enabled = true;
    expect(serviceRepairPermissions(candidate, "softflowd")).toContain("interfaces.write");
  });
});
