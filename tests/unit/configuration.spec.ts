import { describe, expect, it } from "vitest";
import { configSchema, revisionSchema, statisticsSchema } from "@/types/domain";
import { decodeJson, encodeJson, utf8Size } from "@/services/json";
import { differences, endpoint, equalConfig, importConfig, prefix, validateConfig } from "@/services/configuration";
import { config, statistics } from "../fixtures";

describe("lossless boundary and import", () => {
  it.each(["0", "9007199254740993", "18446744073709551615"])("round trips revision %s exactly", revision => {
    const wire = encodeJson({ base_revision: revision, restored_from_revision: revision });
    expect(wire).toBe(`{"base_revision":${revision},"restored_from_revision":${revision}}`);
    expect(decodeJson(wire)).toEqual({ base_revision: revision, restored_from_revision: revision });
  });
  it.each(["-1", "18446744073709551616", "01", "1.5"])("rejects invalid uint64 %s", revision => {
    expect(revisionSchema.safeParse(revision).success).toBe(false);
  });
  it("keeps statistics decimals quoted, including gauges and > safe integers", () => {
    const data = statisticsSchema.parse(decodeJson(JSON.stringify(statistics())));
    expect(data.interfaces[0]?.counters?.rx_bytes).toBe("18446744073709551615");
    expect(data.protocols[0]?.groups?.Tcp?.MaxConn).toBe("-1");
    expect(encodeJson(data)).toContain('"rx_bytes":"18446744073709551615"');
  });
  it("rejects incomplete, unknown-field, oversized and trailing imports", () => {
    expect(() => importConfig('{"interfaces":[]}')).toThrow();
    expect(() => importConfig(JSON.stringify({ ...config(), unsupported: true }))).toThrow();
    expect(() => importConfig(`${JSON.stringify(config())} {}`)).toThrow();
    expect(() => importConfig(" ".repeat(1_048_577))).toThrow();
  });
  it("normalizes documented nil collections but never missing top-level sections", () => {
    expect(configSchema.parse({ ...config(), routes: null }).routes).toEqual([]);
    const value: Record<string, unknown> = config(); delete value.routes;
    expect(configSchema.safeParse(value).success).toBe(false);
  });
});
describe("semantic configuration comparison", () => {
  it("ignores backend-normalized ordering and JSON key order", () => {
    const before = config(), after = config();
    after.interfaces[0]!.addresses.reverse();
    after.firewall = { nat: after.firewall.nat, rules: after.firewall.rules, policy: after.firewall.policy };
    expect(equalConfig(before, after)).toBe(true);
  });
  it("preserves ordered firewall/NAT moves and counts default policy separately", () => {
    const before = config(); before.firewall.rules.push({ action: "drop" });
    const after = structuredClone(before); after.firewall.rules.reverse(); after.firewall.policy = "drop";
    const diff = differences(before, after);
    expect(diff.filter(item => item.kind === "moved")).toHaveLength(2);
    expect(diff.filter(item => item.area === "firewall-policy")).toHaveLength(1);
  });
  it("preserves every unrelated subsystem when editing a route", () => {
    const before = config(), after = config(); after.routes[0]!.metric = 42;
    const diff = differences(before, after);
    expect(diff.every(item => item.area === "routes")).toBe(true);
    expect(after.kernel).toEqual(before.kernel);
  });
});
describe("canonical addresses, networks, endpoints", () => {
  it("retains host bits for interface addresses and suggests networks explicitly", () => {
    expect(() => prefix("192.0.2.10/24", false)).not.toThrow();
    expect(() => prefix("192.0.2.10/24", true)).toThrow("192.0.2.0/24");
  });
  it.each(["2001:0db8::/64", "2001:DB8::/64", "::ffff:192.0.2.1/128", "fe80::1%eth0/64", "192.168.001.0/24", "2001:db8::/129"])("rejects noncanonical prefix %s", value => {
    expect(() => prefix(value, true)).toThrow();
  });
  it.each(["192.0.2.1:1", "192.0.2.1:65535", "[2001:db8::1]:51820", "[::1]:2055"])("accepts numeric endpoint %s", value => {
    expect(() => endpoint(value, true)).not.toThrow();
  });
  it.each(["host.example:2055", "192.0.2.1:0", "192.0.2.1:65536", "2001:db8::1:2055", "[fe80::1%eth0]:2055", "[::ffff:192.0.2.1]:1"])("rejects endpoint %s", value => {
    expect(() => endpoint(value)).toThrow();
  });
});
describe("inclusive validation limits and dependencies", () => {
  it("accepts a complete valid package including preserved kernel state", () => {
    expect(validateConfig(config(), [], config())).toEqual([]);
  });
  it.each([1279, 1280, 65535, 65536])("checks MTU %s", value => {
    const candidate = config(); candidate.interfaces[0]!.mtu = value;
    expect(validateConfig(candidate).some(issue => issue.path.endsWith(".mtu"))).toBe(value < 1280 || value > 65535);
  });
  it.each([9999, 10000, 19999, 20000])("checks route table and policy bounds %s", value => {
    const candidate = config(); candidate.routes[0]!.table = value; candidate.policy_rules[0]!.priority = value;
    const errors = validateConfig(candidate);
    expect(errors.some(issue => issue.path === "routes.0.table")).toBe(value < 10000 || value > 19999);
    expect(errors.some(issue => issue.path === "policy_rules.0.priority")).toBe(value < 10000 || value > 19999);
  });
  it.each([0, 1, 2147483647, 2147483648])("checks route metric %s", value => {
    const candidate = config(); candidate.routes[0]!.metric = value;
    expect(validateConfig(candidate).some(issue => issue.path === "routes.0.metric")).toBe(value < 1 || value > 2147483647);
  });
  it.each([0, 1, 1000000, 1000001])("validates disabled softflowd sampling/max flows %s", value => {
    const candidate = config(); candidate.softflowd[0]!.sampling_rate = value; candidate.softflowd[0]!.max_flows = value;
    expect(validateConfig(candidate).filter(issue => /sampling_rate|max_flows/.test(issue.path))).toHaveLength(value < 1 || value > 1000000 ? 2 : 0);
  });
  it.each([63, 64, 65535, 65536])("checks softflowd snap length %s", value => {
    const candidate = config(); candidate.softflowd[0]!.snaplen = value;
    expect(validateConfig(candidate).some(issue => issue.path.endsWith(".snaplen"))).toBe(value < 64 || value > 65535);
  });
  it.each([-1, 0, 604800, 604801])("checks optional timeout %s", value => {
    const candidate = config(); candidate.softflowd[0]!.timeouts = { udp: value };
    expect(validateConfig(candidate).some(issue => issue.path.endsWith("timeouts.udp"))).toBe(value < 0 || value > 604800);
  });
  it("checks filter UTF-8 byte boundary and general timeout minimum", () => {
    const candidate = config(); candidate.softflowd[0]!.capture_filter = "é".repeat(2048);
    expect(validateConfig(candidate)).toEqual([]);
    candidate.softflowd[0]!.capture_filter += "x"; candidate.softflowd[0]!.timeouts = { general: 0 };
    expect(validateConfig(candidate).filter(issue => /capture_filter|general/.test(issue.path))).toHaveLength(2);
    expect(utf8Size("é")).toBe(2);
  });
  it("reports references without silently cascading and checks NAT address family", () => {
    const candidate = config(); candidate.interfaces = [];
    const errors = validateConfig(candidate);
    expect(errors.some(issue => issue.path === "routes.0.interface")).toBe(true);
    expect(errors.some(issue => issue.path === "firewall.nat.masquerade.0")).toBe(true);
    expect(errors.some(issue => issue.path === "softflowd.0.interface")).toBe(true);
    expect(candidate.routes).toHaveLength(1);
  });
  it("checks VLAN cycles, parent identity, MTU and immutability", () => {
    const candidate = config();
    candidate.interfaces.push({ name: "vlan0", kind: "vlan", mtu: 1600, up: false, addresses: [], vlan: { parent: "vlan0", id: 0 } });
    const errors = validateConfig(candidate);
    expect(errors.some(issue => issue.message.includes("cycle"))).toBe(true);
    expect(errors.some(issue => issue.path.endsWith(".vlan.id"))).toBe(true);
    candidate.interfaces[1]!.mtu = 1500;
    if (candidate.interfaces[1]?.kind === "vlan") candidate.interfaces[1].vlan = { parent: "lab0", id: 1 };
    const baseline = structuredClone(candidate);
    if (candidate.interfaces[1]?.kind === "vlan") candidate.interfaces[1].vlan.id = 2;
    expect(validateConfig(candidate, [], baseline).some(issue => issue.message.includes("immutable"))).toBe(true);
  });
  it.each([0, 1, 4094, 4095])("checks inclusive VLAN ID %s", value => {
    const candidate = config();
    candidate.interfaces.push({ name: "vlan0", kind: "vlan", mtu: 1500, up: false, addresses: [], vlan: { parent: "lab0", id: value } });
    expect(validateConfig(candidate).some(issue => issue.path.endsWith(".vlan.id"))).toBe(value < 1 || value > 4094);
  });
  it.each([0, 1, 65535, 65536])("checks WireGuard listen port %s", value => {
    const candidate = config();
    candidate.interfaces.push({ name: "wg0", kind: "wireguard", mtu: 1420, up: false, addresses: [], wireguard: { key_ref: "lab_key", listen_port: value, peers: [] } });
    expect(validateConfig(candidate).some(issue => issue.path.endsWith(".listen_port"))).toBe(value < 1 || value > 65535);
  });
  it.each([-1, 0, 65535, 65536])("checks keepalive %s, without treating zero as missing", value => {
    const candidate = config();
    candidate.interfaces.push({ name: "wg0", kind: "wireguard", mtu: 1420, up: false, addresses: [], wireguard: {
      key_ref: "lab_key", listen_port: 51820, peers: [{ public_key: btoa("\x01".repeat(32)), allowed_ips: [], persistent_keepalive_seconds: value }],
    } });
    expect(validateConfig(candidate).some(issue => issue.path.endsWith(".persistent_keepalive_seconds"))).toBe(value < 0 || value > 65535);
  });
  it("checks peer keys and exact allowed-IP duplicates but permits overlaps", () => {
    const candidate = config();
    candidate.interfaces.push({ name: "wg0", kind: "wireguard", mtu: 1420, up: false, addresses: [], wireguard: {
      key_ref: "lab_key", listen_port: 51820, peers: [
        { public_key: btoa("\x01".repeat(32)), allowed_ips: ["10.0.0.0/8"], persistent_keepalive_seconds: 0 },
        { public_key: btoa("\x02".repeat(32)), allowed_ips: ["10.0.0.0/16"], persistent_keepalive_seconds: 0 },
      ],
    } });
    expect(validateConfig(candidate)).toEqual([]);
    const link = candidate.interfaces[1];
    if (link?.kind !== "wireguard") throw new Error("Missing WireGuard fixture");
    link.wireguard.peers[1]!.allowed_ips = ["10.0.0.0/8"];
    link.wireguard.peers[1]!.public_key = btoa("\0".repeat(32));
    expect(validateConfig(candidate).some(issue => issue.message.includes("Duplicate allowed"))).toBe(true);
    expect(validateConfig(candidate).some(issue => issue.path.endsWith(".public_key"))).toBe(true);
  });
  it.each([16, 17])("checks softflowd instance count %s, including disabled entries", count => {
    const candidate = config(), original = candidate.softflowd[0]!;
    candidate.softflowd = Array.from({ length: count }, (_, index) => ({ ...original, name: `capture${index}` }));
    expect(validateConfig(candidate).some(issue => issue.path === "softflowd")).toBe(count > 16);
  });
  it("checks protected parent collisions, duplicate identities and family-correct NAT", () => {
    const candidate = config(); candidate.routes.push({ ...candidate.routes[0]! });
    candidate.policy_rules.push({ ...candidate.policy_rules[0]! });
    candidate.interfaces[0]!.addresses = ["192.0.2.10/24"];
    candidate.firewall.nat.masquerade[0]!.family = "ipv6";
    const issues = validateConfig(candidate, [{ name: "lab0", kind: "dummy", index: 1, mac: "", mtu: 1500, up: true, available: true }]);
    expect(issues.some(issue => issue.message.includes("protected"))).toBe(true);
    expect(issues.some(issue => issue.message.includes("Duplicate table"))).toBe(true);
    expect(issues.some(issue => issue.message.includes("Priority must be unique"))).toBe(true);
    expect(issues.some(issue => issue.message.includes("selected family"))).toBe(true);
  });
  it("checks immutable existing kinds, private addresses and rejects nonglobal addresses", () => {
    const candidate = config();
    candidate.interfaces[0]!.addresses = ["10.0.0.1/8"];
    expect(validateConfig(candidate)).toEqual([]);
    candidate.interfaces[0]!.addresses = ["127.0.0.1/8", "fe80::1/64"];
    expect(validateConfig(candidate).filter(issue => issue.path.includes("addresses"))).toHaveLength(2);
    candidate.interfaces[0] = { name: "lab0", kind: "wireguard", mtu: 1420, up: true, addresses: [], wireguard: { key_ref: "ref", listen_port: 51820, peers: [] } };
    expect(validateConfig(candidate, [], config()).some(issue => issue.message.includes("kind cannot change"))).toBe(true);
  });
  it.each([0, 1, 15, 16])("checks interface name length %s", length => {
    const candidate = config(); candidate.interfaces[0]!.name = "a".repeat(length);
    expect(validateConfig(candidate).some(issue => issue.path === "interfaces.0.name")).toBe(length < 1 || length > 15);
  });
  it.each([0, 1, 32, 33])("checks softflowd name length %s", length => {
    const candidate = config(); candidate.softflowd[0]!.name = "a".repeat(length);
    expect(validateConfig(candidate).some(issue => issue.path === "softflowd.0.name")).toBe(length < 1 || length > 32);
  });
  it.each([0, 1, 64, 65])("checks key reference length %s", length => {
    const candidate = config();
    candidate.interfaces.push({ name: "wg0", kind: "wireguard", mtu: 1420, up: false, addresses: [], wireguard: { key_ref: "a".repeat(length), listen_port: 51820, peers: [] } });
    expect(validateConfig(candidate).some(issue => issue.path.endsWith(".key_ref"))).toBe(length < 1 || length > 64);
  });
  it.each([9999, 10000, 19999, 20000])("checks source-policy table %s", table => {
    const candidate = config(); candidate.policy_rules[0]!.table = table;
    expect(validateConfig(candidate).some(issue => issue.path === "policy_rules.0.table")).toBe(table < 10000 || table > 19999);
  });
  it.each([0, 1, 604800, 604801])("checks general timeout %s", value => {
    const candidate = config(); candidate.softflowd[0]!.timeouts.general = value;
    expect(validateConfig(candidate).some(issue => issue.path.endsWith("timeouts.general"))).toBe(value < 1 || value > 604800);
  });
  it.each([0, 1, 5, 9, 10, 11])("checks supported export version %s", value => {
    const candidate = config();
    const wire = JSON.parse(JSON.stringify(candidate)) as { softflowd: Array<{ export_version: number }> };
    wire.softflowd[0]!.export_version = value;
    expect(configSchema.safeParse(wire).success).toBe([1, 5, 9, 10].includes(value));
  });
  it("rejects kernel replacement instead of dropping newer backend state", () => {
    const candidate = config(); delete candidate.kernel;
    expect(validateConfig(candidate, [], config()).some(issue => issue.path === "kernel")).toBe(true);
  });
});
