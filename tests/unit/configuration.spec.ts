import { describe, expect, it } from "vitest";
import { configSchema, mqttSchema, blackholeSchema, revisionSchema, statisticsSchema, transactionSchema } from "@/types/domain";
import { decodeJson, encodeJson, utf8Size } from "@/services/json";
import { differenceContext, differences, endpoint, equalConfig, importConfig, normalize, prefix, requiredPermissions, validateConfig } from "@/services/configuration";
import { config, statistics, transaction } from "../fixtures";

describe("lossless boundary and import", () => {
  it.each([null, "192.0.2.10:9999", "[2001:db8::10]:9999"])("preserves vnStat collector %s across import, transactions and export with its owning permission", collector => {
    const before = config(), after = config();
    after.vnstat = { enabled: true, collector, metadata: { display_name: "Accounting", description: "Saved notes" } };
    expect(importConfig(encodeJson(after)).vnstat).toEqual(after.vnstat);
    const pending = transaction(); pending.candidate = after;
    expect(transactionSchema.parse(pending).candidate.vnstat).toEqual(after.vnstat);
    expect(validateConfig(after).filter(issue => issue.path.startsWith("vnstat."))).toEqual([]);
    expect(requiredPermissions(differences(before, after))).toEqual(["transactions.write", "vnstat.write"]);
  });
  it.each(["", "collector.example:9999", "192.0.2.10:0", "192.0.2.10:65536", "9999:192.0.2.10", "0.0.0.0:9999", "255.255.255.255:9999", "224.0.0.1:9999", "[::]:9999", "[ff02::1]:9999"])("rejects invalid vnStat collector %s even when disabled", collector => {
    const value = config(); value.vnstat = { enabled: false, collector };
    expect(validateConfig(value).some(issue => issue.path === "vnstat.collector")).toBe(true);
  });
  it("rejects retained IPv6 vnStat collectors when IPv6 is disabled globally", () => {
    const value = config(); value.ipv6_enabled = false;
    value.vnstat = { enabled: false, collector: "[2001:db8::10]:9999" };
    expect(validateConfig(value).some(issue => issue.path === "vnstat.collector" && issue.message.includes("IPv6 is disabled"))).toBe(true);
  });
  it("validates blackhole route targets and requires only routes.write", () => {
    const before = config(), after = config();
    after.blackhole = blackholeSchema.parse({ name: "blackhole0", action: "unreachable" });
    after.routes.push({ enabled: true, destination: "198.51.100.0/24", interface: "blackhole0", table: 254, metric: 50 });
    expect(importConfig(encodeJson(after)).blackhole).toEqual(after.blackhole);
    expect(validateConfig(after)).toEqual([]);
    expect(requiredPermissions(differences(before, after))).toEqual(["transactions.write", "routes.write"]);
    expect(equalConfig(before, { ...before, blackhole: blackholeSchema.parse({}) })).toBe(true);
    const gateway = structuredClone(after); gateway.routes[1]!.gateway = "192.0.2.1";
    expect(validateConfig(gateway).some(issue => issue.path === "routes.1.gateway")).toBe(true);
    const cleared = structuredClone(after); cleared.blackhole!.name = "";
    expect(validateConfig(cleared).some(issue => issue.path === "routes.1.interface")).toBe(true);
    const collision = structuredClone(after); collision.blackhole!.name = "lab0";
    expect(validateConfig(collision).some(issue => issue.path === "blackhole.name")).toBe(true);
  });
  it("applies one change to the whole configuration document for surrounding review context", () => {
    const before = config();
    before.routes = Array.from({ length: 30 }, (_, index) => ({ ...before.routes[0]!, destination: `198.51.100.${index}/32`, metric: index + 1 }));
    const after = config(); after.routes = before.routes.map(route => ({ ...route })); after.routes[15]!.enabled = false;
    const [change] = differences(before, after);
    const context = differenceContext(normalize(before), normalize(after), change!);
    expect(context.after.routes).toHaveLength(30);
    expect(context.after.interfaces).toEqual(context.before.interfaces);
    expect(context.after.routes.filter(route => !route.enabled)).toHaveLength(1);
    expect(context.before.routes.every(route => route.enabled)).toBe(true);
  });
  it("validates MQTT URLs, source interfaces, intervals and IPv6 even when settings are retained disabled", () => {
    const candidate = config(); candidate.mqtt = mqttSchema.parse({ enabled: true, endpoint: "mqtts://broker.example.test:8883", source_interface: "lab0" });
    expect(validateConfig(candidate)).toEqual([]);
    candidate.mqtt.endpoint = "mqtt://user:secret@broker.example.test/path";
    expect(validateConfig(candidate).some(issue => issue.path === "mqtt.endpoint")).toBe(true);
    candidate.mqtt.endpoint = "mqtts://[2001:db8::1]:8883"; candidate.ipv6_enabled = false;
    expect(validateConfig(candidate).some(issue => issue.path === "mqtt.endpoint")).toBe(true);
    candidate.mqtt.endpoint = ""; candidate.mqtt.source_interface = "absent0"; candidate.mqtt.interval_seconds = 9;
    for (const field of ["endpoint", "source_interface", "interval_seconds"]) expect(validateConfig(candidate).some(issue => issue.path === `mqtt.${field}`)).toBe(true);
    candidate.mqtt.enabled = false; candidate.mqtt.interval_seconds = 60;
    candidate.interfaces[0]!.addresses = ["192.0.2.10/24"];
    expect(validateConfig(candidate)).toEqual([]);
  });
  it("preserves MQTT references through imports and transactions with independent write permission", () => {
    const before = config(), after = config();
    after.mqtt = mqttSchema.parse({ enabled: true, endpoint: "mqtts://broker.example.test:8883", username: "publisher", password_ref: "a".repeat(32), source_interface: "lab0" });
    expect(importConfig(encodeJson(after)).mqtt).toEqual(after.mqtt);
    const record = transaction(); record.candidate = after;
    expect(transactionSchema.parse(record).candidate.mqtt).toEqual(after.mqtt);
    expect(requiredPermissions(differences(before, after))).toEqual(["transactions.write", "mqtt.write"]);
    expect(equalConfig(before, { ...before, mqtt: mqttSchema.parse({}) })).toBe(true);
    expect(mqttSchema.parse({})).toMatchObject({ enabled: false, interval_seconds: 60 });
    expect(mqttSchema.safeParse({ password: "not-allowed" }).success).toBe(false);
    expect(mqttSchema.safeParse({ password_ref: null }).success).toBe(false);
  });
  it("defaults omitted route enabled to true and preserves explicit false through imports and transactions", () => {
    const before = config();
    const legacy = { ...before, routes: before.routes.map(route => ({ ...route, enabled: undefined })) };
    expect(importConfig(JSON.stringify(legacy)).routes[0]!.enabled).toBe(true);
    expect(equalConfig(importConfig(JSON.stringify(legacy)), before)).toBe(true);
    const disabled = config(); disabled.routes[0]!.enabled = false;
    disabled.routes[0]!.metadata = { display_name: "Backup", description: "Retained path" };
    expect(importConfig(encodeJson(disabled))).toEqual(disabled);
    const record = transaction(); record.previous = before; record.candidate = disabled;
    const parsed = transactionSchema.parse(decodeJson(encodeJson(record)));
    expect(parsed.previous.routes[0]!.enabled).toBe(true);
    expect(parsed.candidate.routes).toEqual(disabled.routes);
    expect(differences(before, disabled)).toEqual([expect.objectContaining({ area: "routes", kind: "modified" })]);
    expect(requiredPermissions(differences(before, disabled))).toEqual(["transactions.write", "routes.write"]);
  });
  it.each([null, "false", 0, 1, [], {}])("rejects nonboolean route enabled %j", enabled => {
    const candidate = config();
    expect(configSchema.safeParse({ ...candidate, routes: [{ ...candidate.routes[0], enabled }] }).success).toBe(false);
  });
  it("continues validating disabled routes and duplicate route identities", () => {
    const candidate = config(); candidate.routes[0]!.enabled = false;
    expect(validateConfig(candidate)).toEqual([]);
    candidate.routes.push({ ...candidate.routes[0]!, enabled: true });
    expect(validateConfig(candidate).some(issue => issue.message.includes("Duplicate table/destination/metric"))).toBe(true);
    candidate.routes = [{ ...candidate.routes[0]!, interface: "absent0", metric: 0 }];
    expect(validateConfig(candidate).some(issue => issue.path === "routes.0.interface")).toBe(true);
    expect(validateConfig(candidate).some(issue => issue.path === "routes.0.metric")).toBe(true);
  });
  it("reads and preserves backend host-input policies in transaction candidates", () => {
    const record = transaction();
    record.candidate.firewall.input = { policy: "drop", interfaces: [{ interface: "lab0", rules: [
      { protocol: "udp", destination_ports: [68], action: "accept" },
      { action: "accept" },
    ] }] };
    expect(transactionSchema.parse(record).candidate.firewall.input).toEqual(record.candidate.firewall.input);
    expect(importConfig(JSON.stringify(record.candidate)).firewall.input).toEqual(record.candidate.firewall.input);
  });
  it("accepts omitted input collections but rejects null collections and unknown input fields", () => {
    const candidate = config();
    expect(configSchema.parse({ ...candidate, firewall: { ...candidate.firewall, input: { policy: "drop" } } }).firewall.input).toEqual({ policy: "drop", interfaces: [] });
    for (const input of [{ policy: "drop", interfaces: null }, { policy: "drop", unknown: true }]) {
      expect(configSchema.safeParse({ ...candidate, firewall: { ...candidate.firewall, input } }).success).toBe(false);
    }
  });
  it.each(["0001.01.01.1", "2026.10.29.10", "9999.12.31.4294967295"])("round trips revision %s as a JSON string", revision => {
    const wire = encodeJson({ base_revision: revision, restored_from_revision: revision });
    expect(wire).toBe(`{"base_revision":"${revision}","restored_from_revision":"${revision}"}`);
    expect(decodeJson(wire)).toEqual({ base_revision: revision, restored_from_revision: revision });
  });
  it.each(["-1", "18446744073709551616", "01", "1.5", "2026.02.29.1", "2026.10.29.0", "2026.10.29.4294967296"])("rejects invalid revision %s", revision => {
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
  it("preserves the global IPv6 flag and treats omitted values as enabled", () => {
    const before = config(), after = { ...config(), ipv6_enabled: false };
    expect(configSchema.parse(after).ipv6_enabled).toBe(false);
    expect(configSchema.safeParse({ ...before, ipv6_enabled: "false" }).success).toBe(false);
    expect(equalConfig(before, { ...before, ipv6_enabled: true })).toBe(true);
    expect(differences(before, after)).toContainEqual({ area: "ipv6", identity: "Enable IPv6", kind: "modified", before: true, after: false });
    expect(requiredPermissions(differences(before, after))).toEqual(["transactions.write", "kernel.namespace.write"]);
    expect(validateConfig(after).some(issue => issue.message.includes("IPv6 is disabled globally"))).toBe(true);
  });
  it("normalizes empty annotations but retains metadata changes and owning permissions", () => {
    const before = config(), after = config();
    after.interfaces[0]!.metadata = { display_name: "", description: "" };
    expect(equalConfig(before, after)).toBe(true);
    after.interfaces[0]!.metadata = { display_name: "Office", description: "Notes" };
    expect(differences(before, after)).toEqual([expect.objectContaining({ area: "interfaces", identity: "lab0", kind: "modified" })]);
    expect(requiredPermissions(differences(before, after))).toEqual(["transactions.write", "interfaces.write"]);
    expect(before.interfaces[0]!.metadata).toBeUndefined();
  });
  it("normalizes host-input entries and ports without reordering rules", () => {
    const before = config();
    before.firewall.input = { policy: "drop", interfaces: [{ interface: "lab0", rules: [
      { protocol: "tcp", destination_ports: [443, 80], action: "accept" }, { action: "drop" },
    ] }] };
    const after = structuredClone(before);
    after.firewall.input!.interfaces[0]!.rules[0]!.destination_ports!.reverse();
    expect(equalConfig(before, after)).toBe(true);
    after.firewall.input!.interfaces[0]!.rules.reverse();
    expect(differences(before, after).map(change => change.area)).toEqual(["firewall-input"]);
    expect(requiredPermissions(differences(before, after))).toEqual(["transactions.write", "firewall.write"]);
    expect(before.firewall.input.interfaces[0]!.rules[0]!.destination_ports).toEqual([443, 80]);
  });
  it("treats null and omitted host-input as equivalent and detects removal", () => {
    const before = config(), after = config(); after.firewall.input = null;
    expect(equalConfig(before, after)).toBe(true);
    before.firewall.input = { policy: "drop", interfaces: [] };
    expect(differences(before, after)).toContainEqual(expect.objectContaining({ area: "firewall-input", kind: "deleted" }));
  });
  it("ignores backend-normalized ordering and JSON key order", () => {
    const before = config(), after = config();
    after.interfaces[0]!.addresses.reverse();
    after.firewall = { nat: after.firewall.nat, rules: after.firewall.rules, policy: after.firewall.policy, allow_all_icmp: after.firewall.allow_all_icmp };
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
  it.each(["192.0.2.1:1", "192.0.2.1:65535", "[2001:db8::1]:51820", "[::1]:2055"])("accepts endpoint %s", value => {
    expect(() => endpoint(value, true)).not.toThrow();
  });
  it.each(["host.example:2055", "192.0.2.1:0", "192.0.2.1:65536", "2001:db8::1:2055", "[fe80::1%eth0]:2055", "[::ffff:192.0.2.1]:1"])("rejects endpoint %s", value => {
    expect(() => endpoint(value)).toThrow();
  });
});
describe("inclusive validation limits and dependencies", () => {
  it("validates host-input references, ports, prefixes and rule limits", () => {
    const candidate = config();
    candidate.firewall.input = { policy: "drop", interfaces: [{ interface: "lab0", rules: [{ protocol: "udp", destination_ports: [68], action: "accept" }] }] };
    expect(validateConfig(candidate)).toEqual([]);
    candidate.interfaces = [];
    expect(validateConfig(candidate)).toContainEqual(expect.objectContaining({ path: "firewall.input.interfaces.0.interface", page: "/firewall/input" }));
    candidate.firewall.input.interfaces[0]!.rules = [{ destination: "192.0.2.1/24", destination_ports: [0, 0, 65536], action: "accept" }];
    const issues = validateConfig(candidate);
    for (const suffix of ["destination", "destination_ports", "protocol", "destination_ports.0", "destination_ports.2"]) {
      expect(issues.some(issue => issue.path === `firewall.input.interfaces.0.rules.0.${suffix}`)).toBe(true);
    }
    candidate.firewall.input.interfaces[0]!.rules = Array.from({ length: 65 }, () => ({ action: "accept" as const }));
    expect(validateConfig(candidate)).toContainEqual(expect.objectContaining({ path: "firewall.input.interfaces.0.rules" }));
  });
  it("allows IPv4 DHCP NAT egress without inventing a static WAN address", () => {
    const candidate = config(); candidate.interfaces[0]!.addresses = [];
    candidate.dhcp_clients = { lab0: { client_id: "", hostname: "", route_metric: 0, use_mtu: false, use_domains: "no" } };
    expect(validateConfig(candidate).some(issue => issue.path.startsWith("firewall.nat"))).toBe(false);
    candidate.firewall.nat.masquerade[0]!.family = "ipv6";
    expect(validateConfig(candidate).some(issue => issue.path.startsWith("firewall.nat"))).toBe(true);
  });
  it("matches host-input expansion limits including implicit stateful acceptance", () => {
    const candidate = config();
    candidate.interfaces.push({ ...candidate.interfaces[0]!, name: "lan1", addresses: [] });
    candidate.firewall.input = { policy: "drop", interfaces: ["lab0", "lan1"].map(name => ({
      interface: name, rules: Array.from({ length: 64 }, () => ({ protocol: "tcp" as const, destination_ports: Array.from({ length: 32 }, (_, index) => index + 1), action: "accept" as const })),
    })) };
    expect(validateConfig(candidate)).toContainEqual(expect.objectContaining({ path: "firewall.input", message: "Input policies expand beyond 4096 entries" }));
    candidate.firewall.input.interfaces[0]!.rules[0]!.destination_ports!.pop();
    expect(validateConfig(candidate)).toEqual([]);
  });
  it("accepts a complete valid package including preserved kernel state", () => {
    expect(validateConfig(config(), [], config())).toEqual([]);
  });
  it.each([1279, 1280, 65535, 65536])("checks MTU %s", value => {
    const candidate = config(); candidate.interfaces[0]!.mtu = value;
    expect(validateConfig(candidate).some(issue => issue.path.endsWith(".mtu"))).toBe(value < 1280 || value > 65535);
  });
  it.each([9999, 10000, 19999, 20000])("checks route table bounds %s", value => {
    const candidate = config(); candidate.routes[0]!.table = value;
    const errors = validateConfig(candidate);
    expect(errors.some(issue => issue.path === "routes.0.table")).toBe(value < 10000 || value > 19999);
  });
  it.each([0, 1, 2147483647, 2147483648])("checks route metric %s", value => {
    const candidate = config(); candidate.routes[0]!.metric = value;
    expect(validateConfig(candidate).some(issue => issue.path === "routes.0.metric")).toBe(value < 1 || value > 2147483647);
  });
  it("links flow validation errors to netflow routes without changing configuration paths", () => {
    const candidate = config();
    candidate.softflowd[0]!.sampling_rate = 0;
    expect(validateConfig(candidate).find(issue => issue.path === "softflowd.0.sampling_rate")?.page).toBe("/services/netflow/capture");
    candidate.softflowd = Array.from({ length: 17 }, (_, index) => ({ ...candidate.softflowd[0]!, name: `capture${index}` }));
    expect(validateConfig(candidate).find(issue => issue.path === "softflowd")?.page).toBe("/services/netflow");
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
    candidate.interfaces.push({ name: "vlan0", kind: "vlan", role: "lan", dhcp_relay: { enabled: false, servers: [] }, mtu: 1600, up: false, addresses: [], vlan: { parent: "vlan0", id: 0 } });
    const errors = validateConfig(candidate);
    expect(errors.some(issue => issue.message.includes("cycle"))).toBe(true);
    expect(errors.some(issue => issue.path.endsWith(".vlan.id"))).toBe(true);
    candidate.interfaces[1]!.mtu = 1500;
    if (candidate.interfaces[1]?.kind === "vlan") candidate.interfaces[1].vlan = { parent: "lab0", id: 1 };
    const baseline = structuredClone(candidate);
    if (candidate.interfaces[1]?.kind === "vlan") candidate.interfaces[1].vlan.id = 2;
    expect(validateConfig(candidate, [], baseline).some(issue => issue.message.includes("immutable"))).toBe(true);
  });
  it("links VLAN and VLAN resolver validation to the dedicated detail route", () => {
    const candidate = config();
    candidate.interfaces.push({ ...candidate.interfaces[0]!, name: "vlan30", kind: "vlan", mtu: 1279, vlan: { parent: "lab0", id: 0 } });
    candidate.dns = { vlan30: { servers: ["not-an-address"], domains: [] } };
    const issues = validateConfig(candidate);
    for (const path of ["interfaces.1.mtu", "interfaces.1.vlan.id", "dns.vlan30.servers.0"]) {
      expect(issues.find(issue => issue.path === path)?.page).toBe("/vlans/vlan30");
    }
  });
  it.each([0, 1, 4094, 4095])("checks inclusive VLAN ID %s", value => {
    const candidate = config();
    candidate.interfaces.push({ name: "vlan0", kind: "vlan", role: "lan", dhcp_relay: { enabled: false, servers: [] }, mtu: 1500, up: false, addresses: [], vlan: { parent: "lab0", id: value } });
    expect(validateConfig(candidate).some(issue => issue.path.endsWith(".vlan.id"))).toBe(value < 1 || value > 4094);
  });
  it.each([0, 1, 65535, 65536])("checks WireGuard listen port %s", value => {
    const candidate = config();
    candidate.interfaces.push({ name: "wg0", kind: "wireguard", role: "wan", dhcp_relay: { enabled: false, servers: [] }, mtu: 1420, up: false, addresses: [], wireguard: { key_ref: "lab_key", listen_port: value, peers: [] } });
    expect(validateConfig(candidate).some(issue => issue.path.endsWith(".listen_port"))).toBe(value < 1 || value > 65535);
  });
  it.each([-1, 0, 65535, 65536])("checks keepalive %s, without treating zero as missing", value => {
    const candidate = config();
    candidate.interfaces.push({ name: "wg0", kind: "wireguard", role: "wan", dhcp_relay: { enabled: false, servers: [] }, mtu: 1420, up: false, addresses: [], wireguard: {
      key_ref: "lab_key", listen_port: 51820, peers: [{ public_key: btoa("\x01".repeat(32)), allowed_ips: [], persistent_keepalive_seconds: value }],
    } });
    expect(validateConfig(candidate).some(issue => issue.path.endsWith(".persistent_keepalive_seconds"))).toBe(value < 0 || value > 65535);
  });
  it("checks peer keys and exact allowed-IP duplicates but permits overlaps", () => {
    const candidate = config();
    candidate.interfaces.push({ name: "wg0", kind: "wireguard", role: "wan", dhcp_relay: { enabled: false, servers: [] }, mtu: 1420, up: false, addresses: [], wireguard: {
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
    candidate.interfaces[0]!.addresses = ["192.0.2.10/24"];
    candidate.firewall.nat.masquerade[0]!.family = "ipv6";
    const issues = validateConfig(candidate, [{ name: "lab0", kind: "dummy", index: 1, mac: "", mtu: 1500, up: true, available: true }]);
    expect(issues.some(issue => issue.message.includes("protected"))).toBe(true);
    expect(issues.some(issue => issue.message.includes("Duplicate table"))).toBe(true);
    expect(issues.some(issue => issue.message.includes("selected family"))).toBe(true);
  });
  it("checks immutable existing kinds, private addresses and rejects nonglobal addresses", () => {
    const candidate = config();
    candidate.interfaces[0]!.addresses = ["10.0.0.1/8"];
    expect(validateConfig(candidate)).toEqual([]);
    candidate.interfaces[0]!.addresses = ["127.0.0.1/8", "fe80::1/64"];
    expect(validateConfig(candidate).filter(issue => issue.path.includes("addresses"))).toHaveLength(2);
    candidate.interfaces[0] = { name: "lab0", kind: "wireguard", role: "wan", dhcp_relay: { enabled: false, servers: [] }, mtu: 1420, up: true, addresses: [], wireguard: { key_ref: "ref", listen_port: 51820, peers: [] } };
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
    candidate.interfaces.push({ name: "wg0", kind: "wireguard", role: "wan", dhcp_relay: { enabled: false, servers: [] }, mtu: 1420, up: false, addresses: [], wireguard: { key_ref: "a".repeat(length), listen_port: 51820, peers: [] } });
    expect(validateConfig(candidate).some(issue => issue.path.endsWith(".key_ref"))).toBe(length < 1 || length > 64);
  });
  it.each([{ rules: [] }, { rules: null }, { rules: [{ priority: 10000, source: "192.0.2.0/24", table: 254 }] }])("rejects removed policy rules $rules without silently discarding them", ({ rules }) => {
    const candidate = { ...config(), policy_rules: rules };
    expect(configSchema.safeParse(candidate).success).toBe(false);
    expect(() => importConfig(JSON.stringify(candidate))).toThrow();
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
