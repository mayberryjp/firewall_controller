import { describe, expect, it } from "vitest";
import { configSchema, interfaceSchema, runtimeSchema, transactionSchema, revisionDetailSchema, objectMetadataSchema } from "@/types/domain";
import { differences, equalConfig, importConfig, normalize, requiredPermissions, selectedRelayPrefix, serviceRepairPermissions, validateConfig } from "@/services/configuration";
import { preset, resourceFields } from "@/services/resourceForms";
import { interfaceChoice } from "@/services/resourceCollections";
import { decodeJson, encodeJson } from "@/services/json";
import { config, runtime, transaction } from "../fixtures";

describe("interface dropdown labels", () => {
  it("uses display names without changing interface identities", () => {
    expect(interfaceChoice({ name: "eno1", metadata: { display_name: "WAN", description: "" } }))
      .toEqual({ title: "WAN (eno1)", value: "eno1" });
    expect(interfaceChoice({ name: "eno1" })).toEqual({ title: "eno1", value: "eno1" });
    expect(interfaceChoice({ name: "eno1", metadata: { display_name: "", description: "Notes" } }))
      .toEqual({ title: "eno1", value: "eno1" });
  });
  it("keeps unmanaged parent names and named managed parents as separate choices", () => {
    const managed = interfaceChoice({ name: "eno1", metadata: { display_name: "WAN", description: "" } });
    const parent = interfaceChoice({ name: "eno2" });
    const fields = resourceFields("interfaces", [managed], [parent], false, "vlan", undefined, []);
    expect(fields.find(field => field.key === "vlan")?.fields?.find(field => field.key === "parent")?.choices)
      .toEqual([managed, parent]);
  });
});

describe("native runtime parent diagnostics", () => {
  const parent = { name: "eth0", kind: "ethernet", index: 2, mac: "02:00:00:00:00:01", mtu: 1500, up: true, available: true };
  it.each([[], [parent], null])("accepts the native parents field %j", parents => {
    const { parent_interfaces: omitted, ...data } = runtime();
    expect(omitted).toEqual([]);
    expect(runtimeSchema.parse({ ...data, parents }).parent_interfaces).toEqual(parents ?? []);
  });
  it("keeps the documented parent_interfaces field authoritative", () => {
    expect(runtimeSchema.parse({ ...runtime(), parents: [parent] }).parent_interfaces).toEqual([]);
    expect(runtimeSchema.safeParse({ ...runtime(), parent_interfaces: "invalid", parents: [] }).success).toBe(false);
  });
  it("retains sparse disappeared parents without inventing link details", () => {
    const { parent_interfaces: omitted, ...data } = runtime();
    expect(omitted).toEqual([]);
    const disappeared = { name: "eth0", available: false, error: "adopted parent disappeared" };
    expect(runtimeSchema.parse({ ...data, parents: [disappeared] }).parent_interfaces).toEqual([disappeared]);
    expect(runtimeSchema.safeParse({ ...data, parents: [{ ...disappeared, available: true }] }).success).toBe(false);
  });
  it("rejects missing or malformed parent diagnostics instead of hiding failures", () => {
    const { parent_interfaces: omitted, ...data } = runtime();
    expect(omitted).toEqual([]);
    expect(runtimeSchema.safeParse(data).success).toBe(false);
    expect(runtimeSchema.safeParse({ ...data, parents: {} }).success).toBe(false);
    expect(runtimeSchema.safeParse({ ...data, parents: [{ ...parent, index: "2" }] }).success).toBe(false);
  });
});

describe("host Ethernet configuration", () => {
  it("preserves common metadata through imports and transactions without changing identities", () => {
    const candidate = config(), metadata = { display_name: "Office", description: "Staff devices\nPrimary network" };
    candidate.interfaces[0]!.metadata = metadata;
    candidate.interfaces[0]!.dhcp_relay.metadata = metadata;
    candidate.routes[0]!.metadata = metadata;
    candidate.firewall.rules[0]!.metadata = metadata; candidate.firewall.nat.masquerade[0]!.metadata = metadata;
    candidate.softflowd[0]!.metadata = metadata; candidate.ntp.metadata = metadata;
    candidate.syslog.metadata = metadata; candidate.syslog.servers = [{ host: "logs.example", port: 514, transport: "udp", metadata }];
    candidate.vnstat.metadata = metadata;
    candidate.dhcp_clients = { metadata: { client_id: "", hostname: "", route_metric: 0, use_mtu: false, use_domains: "no", metadata } };
    candidate.dns = { lab0: { servers: [], metadata, domains: [{ name: "example.test", route_only: false, metadata }] } };
    expect(importConfig(encodeJson(candidate))).toEqual(candidate);
    expect(transactionSchema.parse({ ...transaction(), candidate }).candidate).toEqual(candidate);
    expect(candidate.interfaces[0]!.name).toBe("lab0");
    expect(objectMetadataSchema.parse({})).toBeUndefined();
    expect(objectMetadataSchema.parse({ description: "Notes" })).toEqual({ display_name: "", description: "Notes" });
  });
  it("validates metadata scalar limits and rejects unsupported fields and controls", () => {
    expect(objectMetadataSchema.safeParse({ display_name: "\u{1F600}".repeat(128) }).success).toBe(true);
    for (const metadata of [null, { unknown: "text" }, { display_name: null }, { display_name: "   " }, { display_name: "x".repeat(129) }, { description: "x".repeat(2049) }, { description: "bad\u0000text" }, { display_name: "bad\ntext" }]) {
      expect(objectMetadataSchema.safeParse(metadata).success).toBe(false);
    }
  });
  it("round-trips inherited unassigned NICs and DHCP/DNS maps", () => {
    const candidate = config();
    candidate.interfaces[0] = { ...candidate.interfaces[0]!, kind: "ethernet", role: "unassigned", addresses: ["2001:db8::10/64"] };
    candidate.dhcp_clients = { lab0: { client_id: "01525400123456", hostname: "appliance", route_metric: 100, use_mtu: false, use_domains: "route" } };
    candidate.dns = { lab0: { servers: ["192.0.2.53"], domains: [{ name: "example.test", route_only: true }] } };
    expect(importConfig(encodeJson(candidate))).toEqual(candidate);
    expect(transactionSchema.parse({ ...transaction(), candidate }).candidate).toEqual(candidate);
    expect(configSchema.safeParse({ ...candidate, dhcp_clients: null }).success).toBe(false);
    expect(configSchema.safeParse({ ...candidate, dns: { lab0: { domains: [{ name: "example.test" }] } } }).success).toBe(false);
  });
  it("preserves Ethernet settings and supports main-table routes and relay", () => {
    const candidate = config();
    candidate.interfaces[0] = { ...candidate.interfaces[0]!, kind: "ethernet" };
    candidate.interfaces[0].dhcp_relay = { enabled: true, servers: ["198.51.100.10"] };
    candidate.routes[0]!.table = 254;
    expect(configSchema.parse(candidate)).toEqual(candidate);
    expect(importConfig(encodeJson(candidate))).toEqual(candidate);
    expect(validateConfig(candidate)).toEqual([]);
  });
  it("reviews map-only changes and rejects DHCP/static/relay conflicts", () => {
    const before = config(), candidate = config();
    candidate.interfaces[0] = { ...candidate.interfaces[0]!, kind: "ethernet" };
    candidate.dhcp_clients = { lab0: { client_id: "", hostname: "", route_metric: 0, use_mtu: false, use_domains: "no" } };
    expect(validateConfig(candidate).some(issue => issue.message.includes("static IPv4"))).toBe(true);
    candidate.interfaces[0].addresses = ["2001:db8::10/64"];
    candidate.firewall.nat.masquerade = [];
    expect(validateConfig(candidate)).toEqual([]);
    expect(requiredPermissions(differences(before, candidate))).toContain("interfaces.write");
    expect(serviceRepairPermissions(candidate, "ntp")).toContain("interfaces.write");
    expect(equalConfig(before, { ...before, dhcp_clients: {}, dns: {} })).toBe(true);
    const same = structuredClone(candidate);
    same.dns = { lab0: { servers: ["192.0.2.53"], domains: [{ name: ".", route_only: true }] } };
    expect(differences(candidate, same).map(change => change.area)).toEqual(["dns"]);
    expect(requiredPermissions(differences(candidate, same))).toEqual(["transactions.write", "interfaces.write"]);
    expect(validateConfig(same)).toEqual([]);
    same.dns.lab0!.domains[0]!.route_only = false;
    expect(validateConfig(same).some(issue => issue.path.startsWith("dns"))).toBe(true);
  });
});

describe("global IPv4 ICMP exception", () => {
  it.each([undefined, true, false])("uses the documented omission default for %s", value => {
    const candidate = config();
    const parsed = configSchema.parse({ ...candidate, firewall: { ...candidate.firewall, allow_all_icmp: value } });
    expect(parsed.firewall.allow_all_icmp).toBe(value ?? true);
    expect(importConfig(encodeJson(parsed)).firewall.allow_all_icmp).toBe(value ?? true);
  });
  it.each([null, "false", 0, 1, {}, []])("rejects a nonboolean flag %j", value => {
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
    expect(field?.choices).toEqual([{ title: "WAN", value: "wan" }, { title: "LAN", value: "lan" }, { title: "Unassigned", value: "unassigned" }]);
    if (kind === "dummy") {
      const kindField = resourceFields("interfaces", [], [], false, kind, undefined, []).find(item => item.key === "kind");
      expect(kindField?.choices).toContainEqual({ title: "Loopback", value: "dummy" });
    }
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
    expect(validateConfig(candidate).some(issue => issue.message.includes("loopback or VLAN"))).toBe(true);
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
