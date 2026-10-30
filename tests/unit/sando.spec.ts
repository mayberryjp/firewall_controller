import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getSandoConnections, getSandoDevices, importSando,
  sandoDeviceSchema, sandoConnectionSchema, sandoEndpoint, type SandoConnection,
} from "@/services/sando";
import { differences, requiredPermissions, validateConfig } from "@/services/configuration";
import { config } from "../fixtures";

const device = (ip_address = "192.0.2.20") => sandoDeviceSchema.parse({
  ip_address, dhcp_hostname: "desk", icon: "Computer", mac_vendor: "Vendor",
  ip6_address: "2001:db8::20", tags: "trusted", original_flow: '{"src_port":1234}',
  total_bytes_src: 123, future_field: { preserved: true },
});
const connection = (changes: Partial<SandoConnection> = {}): SandoConnection => ({
  ignorelist_id: "approved-1", src_ip: "192.0.2.20", dst_ip: "198.51.100.40",
  dst_port: 443, protocol: 6, ...changes,
});
function emptyConfig() { const value = config(); value.firewall.rules = []; return value; }
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); });

describe("Sando API and persistence", () => {
  it("imports compatible portless ICMP suggestions with ownership and without broadening families", () => {
    const result = importSando(emptyConfig(), [device()], [
      connection({ protocol: 1, dst_port: "*" }),
      connection({ protocol: 58, src_ip: "2001:db8::20", dst_ip: "2001:db8::40", dst_port: "*" }),
    ], "drop");
    expect(result.skipped).toEqual([]);
    expect(result.rulesAdded).toBe(2);
    expect(result.config.firewall.policies!.hosts[0]!.rules).toEqual([
      { origin: "import", import_source: "sando", destination: "198.51.100.40/32", protocol: "icmp", action: "accept" },
      { origin: "import", import_source: "sando", destination: "2001:db8::40/128", protocol: "icmpv6", action: "accept" },
    ]);
    expect(validateConfig(result.config)).toEqual([]);
    expect(importSando(result.config, [device()], [connection({ protocol: 1, dst_port: "*" })], "drop").rulesAdded).toBe(0);
  });
  it.each([
    { protocol: 1, src_ip: "2001:db8::20", dst_ip: "2001:db8::40", dst_port: "*" as const },
    { protocol: 58, dst_port: "*" as const },
    { protocol: 1, dst_port: 443 },
    { protocol: 132, dst_port: "*" as const },
  ])("rejects incompatible ICMP suggestions %j without creating rules", changes => {
    const result = importSando(emptyConfig(), [device()], [connection(changes)], "drop");
    expect(result.rulesAdded).toBe(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.config.firewall.policies!.hosts[0]!.rules).toEqual([]);
  });
  it("imports ID-less and null-ID candidates, deduplicating repeated reads without losing distinct flows or outbound ownership", async () => {
    const raw = [
      { src_ip: "192.0.2.20", dst_ip: "198.51.100.40", protocol: "6", dst_port: "443" },
      { ignorelist_id: null, src_ip: "192.0.2.20", dst_ip: "198.51.100.40", protocol: 6, dst_port: 443 },
      { src_ip: "192.0.2.20", dst_ip: "198.51.100.40", protocol: 17, dst_port: 443 },
      { src_ip: "192.0.2.20", dst_ip: "198.51.100.40", protocol: 6, dst_port: 8443 },
      { src_ip: "192.0.2.20", dst_ip: "198.51.100.41", protocol: 6, dst_port: 443 },
      { src_ip: "198.51.100.40", dst_ip: "192.0.2.20", protocol: 6, dst_port: 443 },
    ];
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(raw)))));
    const rows = await getSandoConnections("https://sando.example", new AbortController().signal, ["198.51.100.40", "192.0.2.20"]);
    expect(rows).toHaveLength(5);
    expect(rows.slice(0, 4).every(row => row.requested_host === "192.0.2.20")).toBe(true);
    expect(rows[4]!.requested_host).toBe("198.51.100.40");
    const result = importSando(emptyConfig(), [device()], rows.slice(0, 4), "drop");
    expect(result.rulesAdded).toBe(4); expect(result.skipped).toEqual([]);
    expect(validateConfig(result.config)).toEqual([]);
    const repeated = importSando(result.config, [device()], rows.slice(0, 4), "drop");
    expect(repeated.config).toEqual(result.config); expect(repeated.rulesAdded).toBe(0);
  });
  it("keeps ID-less invalid traffic unsupported and identifies skipped connections without inventing an ID", () => {
    const invalid = sandoConnectionSchema.parse({ src_ip: "192.0.2.20", dst_ip: "198.51.100.0/24", protocol: 6, dst_port: 443 });
    const result = importSando(emptyConfig(), [device()], [invalid], "drop");
    expect(result.rulesAdded).toBe(0);
    expect(result.skipped[0]).toContain("192.0.2.20 -> 198.51.100.0/24 (protocol 6, port 443)");
    expect(result.skipped[0]).not.toContain("undefined:");
  });
  it("summarizes incompatible responses without dumping nested schema errors or blaming network access", async () => {
    const raw = Array.from({ length: 49 }, () => ({ src_ip: 42, dst_ip: "198.51.100.40", protocol: 6, dst_port: 443 }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(raw))));
    const error: unknown = await getSandoConnections("https://sando.example", new AbortController().signal, ["192.0.2.20"]).catch((cause: unknown) => cause);
    if (!(error instanceof Error)) throw new Error("Expected Sando response validation to fail.");
    expect(error.message).toContain("incompatible ignorelist/ip/192.0.2.20 response");
    expect(error.message).toContain("0.src_ip: Expected string, received number");
    expect(error.message).toContain("46 more issues");
    expect(error.message).not.toMatch(/unionErrors|CORS/);
    expect(error.message.length).toBeLessThan(400);
  });
  it("normalizes database strings and skips unsupported ports instead of losing valid candidates", () => {
    const raw = sandoConnectionSchema.parse({ ...connection(), ignorelist_id: 7, protocol: "6", dst_port: "443" });
    expect(raw).toMatchObject({ ignorelist_id: "7", protocol: 6, dst_port: 443 });
    const invalid = sandoConnectionSchema.parse({ ...connection(), dst_port: "any" });
    const result = importSando(emptyConfig(), [device()], [raw, invalid], "drop");
    expect(result.rulesAdded).toBe(1); expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toContain("destination port");
  });
  it("preserves source direction for entries fetched by destination and preserves reverse-proxy and encoded IPv6 paths", async () => {
    const inbound = connection({ requested_host: "198.51.100.40" });
    const result = importSando(emptyConfig(), [device()], [inbound], "drop");
    expect(result.rulesAdded).toBe(1); expect(result.skipped).toEqual([]);
    expect(result.config.firewall.policies!.hosts[0]!.rules[0]!.destination).toBe("198.51.100.40/32");
    const fetcher = vi.fn().mockResolvedValue(new Response("[]")); vi.stubGlobal("fetch", fetcher);
    await getSandoConnections("https://sando.example/proxy", new AbortController().signal, ["2001:db8::20", "2001:db8::20"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![0]).toBe("https://sando.example/proxy/api/ignorelist/ip/2001%3Adb8%3A%3A20");
  });
  it.each(["https://sando.example", "https://sando.example/api/", "https://sando.example/api"])("normalizes %s", value => {
    expect(sandoEndpoint(value)).toBe("https://sando.example/api");
  });
  it.each(["ftp://sando.example", "https://user:password@sando.example", "https://sando.example?token=secret", "https://sando.example/#test", "not a URL"])("rejects unsafe endpoint %s", value => {
    expect(() => sandoEndpoint(value)).toThrow();
  });
  it("retains complete device records in memory without adding them to backend policy objects", () => {
    expect(device().future_field).toEqual({ preserved: true });
    const result = importSando(emptyConfig(), [device()], undefined, "drop");
    expect(Object.keys(result.config.firewall.policies!.hosts[0]!)).toEqual(["id", "name", "addresses", "policy", "rules"]);
  });
  it("uses the documented endpoints with no firewall credentials or redirects", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify([device()]))).mockResolvedValueOnce(new Response(JSON.stringify([connection()])));
    vi.stubGlobal("fetch", fetcher);
    const signal = new AbortController().signal;
    expect(await getSandoDevices("https://sando.example", signal)).toEqual([device()]);
    expect(await getSandoConnections("https://sando.example", signal, ["192.0.2.20"])).toEqual([{ ...connection(), requested_host: "192.0.2.20" }]);
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(["https://sando.example/api/localhosts", "https://sando.example/api/ignorelist/ip/192.0.2.20"]);
    expect(fetcher).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ credentials: "omit", redirect: "error", headers: { Accept: "application/json" } }));
  });
  it.each([
    new Response('{"error":"unavailable"}', { status: 503 }),
    new Response("<html>login</html>"),
    new Response('{"success":false}'),
    new Response('[{"ip_address":42}]'),
  ])("rejects failed or incompatible responses", async response => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(getSandoDevices("https://sando.example", new AbortController().signal)).rejects.toThrow("Unable to import from Sando");
  });
  it("propagates cancellation and does not retry failed reads", async () => {
    const fetcher = vi.fn().mockImplementation((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener("abort", () => reject(new DOMException("Canceled", "AbortError")), { once: true });
    }));
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    const result = getSandoDevices("https://sando.example", controller.signal);
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("Sando draft imports", () => {
  it.each(["accept", "drop"] as const)("creates missing source hosts with the selected %s default and preserves all directional flows", policy => {
    const target = { ...device("198.51.100.40"), ip6_address: null };
    const rows = [
      connection({ requested_host: "198.51.100.40", protocol: 17, dst_port: 67 }),
      connection({ requested_host: "198.51.100.40", protocol: 6, dst_port: 35870 }),
      connection({ requested_host: "198.51.100.40", protocol: 6, dst_port: "*" }),
      connection({ requested_host: "198.51.100.40", protocol: 17, dst_port: 53 }),
    ];
    const result = importSando(emptyConfig(), [target], rows, policy);
    expect(result.hostsAdded).toBe(2); expect(result.rulesAdded).toBe(4); expect(result.skipped).toEqual([]);
    expect(result.config.firewall.policies!.hosts[0]!.rules).toEqual([]);
    expect(result.config.firewall.policies!.hosts[1]).toEqual({
      id: "sando_192_0_2_20", name: "192.0.2.20", addresses: ["192.0.2.20"], policy,
      rules: [
        { destination: "198.51.100.40/32", protocol: "udp", destination_ports: [67], action: "accept" },
        { destination: "198.51.100.40/32", protocol: "tcp", destination_ports: [35870], action: "accept" },
        { destination: "198.51.100.40/32", protocol: "tcp", action: "accept" },
        { destination: "198.51.100.40/32", protocol: "udp", destination_ports: [53], action: "accept" },
      ].map(rule => ({ ...rule, origin: "import", import_source: "sando" })),
    });
    expect(validateConfig(result.config)).toEqual([]);
    const source = result.config.firewall.policies!.hosts[1]!;
    source.name = "Preserved name"; source.policy = "drop";
    source.rules.unshift({ destination: "203.0.113.0/24", action: "drop" });
    const repeated = importSando(result.config, [target], rows, "accept");
    expect(repeated.hostsAdded).toBe(0); expect(repeated.rulesAdded).toBe(0);
    expect(repeated.config).toEqual(result.config);
  });
  it("does not create missing source hosts for invalid rules or bypass an inventory device's failed validation", () => {
    for (const row of [connection({ protocol: 1 }), connection({ dst_port: 0 }), connection({ src_ip: "*" }), connection({ dst_ip: "*" , dst_port: NaN })]) {
      const result = importSando(emptyConfig(), [], [row], "drop");
      expect(result.hostsAdded).toBe(0); expect(result.rulesAdded).toBe(0); expect(result.skipped).toHaveLength(1);
      expect(result.config.firewall.policies).toBeUndefined();
    }
    const ipv4Only = emptyConfig(); ipv4Only.ipv6_enabled = false;
    const ipv6 = importSando(ipv4Only, [], [connection({ src_ip: "2001:db8::20", dst_ip: "*", dst_port: "*" })], "drop");
    expect(ipv6.hostsAdded).toBe(0); expect(ipv6.skipped[0]).toContain("IPv6 is disabled");
    const invalidDevice = importSando(emptyConfig(), [{ ...device(), ip6_address: "invalid" }], [connection()], "drop");
    expect(invalidDevice.hostsAdded).toBe(0); expect(invalidDevice.hostsSkipped).toBe(1);
    expect(invalidDevice.skipped[1]).toContain("source device could not be imported");
  });
  it("preserves explicit API destination and port wildcards without widening a dual-stack host's address family", async () => {
    const raw = [
      { src_ip: "192.0.2.20", dst_ip: "*", protocol: 6, dst_port: 443 },
      { src_ip: "192.0.2.20", dst_ip: "198.51.100.40", protocol: 17, dst_port: "*" },
      { src_ip: "192.0.2.20", dst_ip: "*", protocol: 6, dst_port: "*" },
      { src_ip: "2001:db8::20", dst_ip: "*", protocol: 17, dst_port: "*" },
    ];
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(raw)))));
    const rows = await getSandoConnections("https://sando.example", new AbortController().signal, ["192.0.2.20", "2001:db8::20"]);
    expect(rows).toHaveLength(4);
    const result = importSando(emptyConfig(), [device()], rows, "drop");
    expect(result.skipped).toEqual([]); expect(result.rulesAdded).toBe(4);
    expect(result.config.firewall.policies!.hosts[0]!.rules).toEqual([
      { destination: "0.0.0.0/0", protocol: "tcp", destination_ports: [443], action: "accept" },
      { destination: "198.51.100.40/32", protocol: "udp", action: "accept" },
      { destination: "0.0.0.0/0", protocol: "tcp", action: "accept" },
      { destination: "::/0", protocol: "udp", action: "accept" },
    ].map(rule => ({ ...rule, origin: "import", import_source: "sando" })));
    expect(validateConfig(result.config)).toEqual([]);
    result.config.firewall.policies!.hosts[0]!.rules[1]!.destination_ports = [];
    const repeated = importSando(result.config, [device()], rows, "drop");
    expect(repeated.rulesAdded).toBe(0); expect(repeated.config).toEqual(result.config);
  });
  it.each([undefined, null, "", "any", "invalid", " * ", 0, 65536])("does not interpret missing or invalid port %s as a wildcard", port => {
    const row = sandoConnectionSchema.parse({ ...connection(), dst_port: port });
    const result = importSando(emptyConfig(), [device()], [row], "drop");
    expect(result.rulesAdded).toBe(0); expect(result.skipped[0]).toContain("destination port");
  });
  it("adds dual-stack named hosts and exact TCP/UDP rules without changing unrelated settings or the input", () => {
    const before = emptyConfig();
    const result = importSando(before, [device()], [connection(), connection({ ignorelist_id: "dns", protocol: 17, dst_port: 53 })], "drop");
    expect(before.firewall.policies).toBeUndefined();
    expect(result.hostsAdded).toBe(1); expect(result.rulesAdded).toBe(2); expect(result.skipped).toEqual([]);
    expect(result.config.firewall.policies!.hosts[0]).toEqual({
      id: "sando_192_0_2_20", name: "desk", addresses: ["192.0.2.20", "2001:db8::20"], policy: "drop",
      rules: [
        { destination: "198.51.100.40/32", protocol: "tcp", destination_ports: [443], action: "accept" },
        { destination: "198.51.100.40/32", protocol: "udp", destination_ports: [53], action: "accept" },
      ].map(rule => ({ ...rule, origin: "import", import_source: "sando" })),
    });
    expect(validateConfig(result.config, [], before)).toEqual([]);
    expect(requiredPermissions(differences(before, result.config))).toEqual(["transactions.write", "firewall.write"]);
    expect(result.config.interfaces).toEqual(before.interfaces);
    expect(result.config.firewall.nat).toEqual(before.firewall.nat);
    expect(result.config.firewall.policy).toBe(before.firewall.policy);
  });
  it("is idempotent and preserves existing names, defaults, rule order and ingress overrides", () => {
    const first = importSando(emptyConfig(), [device()], [connection()], "accept");
    const policies = first.config.firewall.policies!;
    policies.hosts[0]!.name = "Custom"; policies.hosts[0]!.policy = "drop";
    policies.hosts[0]!.rules.unshift({ destination: "203.0.113.0/24", action: "drop" });
    policies.interfaces.push({ interface: "lab0", rules: [{ action: "drop" }] });
    const again = importSando(first.config, [device()], [connection(), connection()], "accept");
    expect(again.config).toEqual(first.config);
    expect(again.hostsAdded).toBe(0); expect(again.rulesAdded).toBe(0); expect(again.duplicates).toBe(3);
  });
  it("does not import rules during a host-only import", () => {
    expect(importSando(emptyConfig(), [device()], undefined, "accept").config.firewall.policies!.hosts[0]!.rules).toEqual([]);
  });
  it("never deletes or translates legacy rules", () => {
    const before = config();
    expect(() => importSando(before, [device()], [connection()], "drop")).toThrow("Legacy forwarding rules");
    expect(before.firewall.rules).toHaveLength(1);
  });
  it("reports unsupported entries without widening permissions", () => {
    const result = importSando(emptyConfig(), [device()], [
      connection({ protocol: 1 }), connection({ dst_port: 0 }), connection({ dst_port: 65536 }),
      connection({ dst_ip: "not-an-address" }), connection({ dst_ip: "198.51.100.0/24" }),
      connection({ src_ip: "*" }), connection({ dst_ip: "2001:db8::40" }),
    ], "drop");
    expect(result.skipped).toHaveLength(7); expect(result.rulesAdded).toBe(0);
    expect(result.config.firewall.policies!.hosts[0]!.rules).toEqual([]);
  });
  it("keeps overlapping host ownership unchanged and reports missing IPv6 support", () => {
    const existing = importSando(emptyConfig(), [device()], undefined, "accept").config;
    const conflicting = device("192.0.2.30");
    const result = importSando(existing, [conflicting], undefined, "drop");
    expect(result.config).toEqual(existing); expect(result.skipped).toHaveLength(1);
    const ipv4Only = emptyConfig(); ipv4Only.ipv6_enabled = false;
    expect(importSando(ipv4Only, [device()], undefined, "drop").skipped[0]).toContain("IPv6 is disabled");
  });
  it("uses distinct valid names for devices sharing a hostname", () => {
    const second = { ...device("192.0.2.30"), ip6_address: null };
    const result = importSando(emptyConfig(), [device(), second], undefined, "accept");
    expect(result.config.firewall.policies!.hosts.map(host => host.name)).toEqual(["desk", "192.0.2.30"]);
    expect(validateConfig(result.config)).toEqual([]);
  });
});

describe("host policy validation", () => {
  function candidate() { return importSando(emptyConfig(), [device()], [connection()], "drop").config; }
  it("validates host identity, ownership, rule references and destination families", () => {
    const value = candidate(), host = value.firewall.policies!.hosts[0]!;
    value.firewall.policies!.hosts.push({ ...host, addresses: [...host.addresses], rules: [] });
    host.rules.push({ destination_host: "missing", action: "accept" });
    host.rules.push({ destination: "198.51.100.40/32", destination_host: host.id, action: "accept" });
    host.rules.push({ protocol: "", destination_ports: [0, 0], action: "accept" });
    host.rules.push({ out_interface: "missing", action: "accept" });
    const errors = validateConfig(value);
    expect(errors.some(issue => issue.path.endsWith(".id"))).toBe(true);
    expect(errors.some(issue => issue.path.endsWith(".name"))).toBe(true);
    expect(errors.some(issue => issue.message.includes("globally unique"))).toBe(true);
    expect(errors.some(issue => issue.message.includes("Destination host must exist"))).toBe(true);
    expect(errors.some(issue => issue.message.includes("not both"))).toBe(true);
    expect(errors.some(issue => issue.message.includes("destination ports"))).toBe(true);
    expect(errors.some(issue => issue.message.includes("managed egress"))).toBe(true);
  });
  it("enforces exact host, rule, port and metadata limits", () => {
    const value = candidate(), host = value.firewall.policies!.hosts[0]!;
    host.rules = Array.from({ length: 64 }, () => ({ protocol: "tcp", destination_ports: Array.from({ length: 32 }, (_, i) => i + 1), action: "accept" }));
    // Two source addresses x 64 rules x 32 ports + two defaults + stateful return.
    expect(validateConfig(value)).toContainEqual(expect.objectContaining({ message: "Host policies expand beyond 4096 entries" }));
    host.rules = Array.from({ length: 65 }, () => ({ action: "accept" }));
    expect(validateConfig(value).some(issue => issue.message === "At most 64 ordered rules per host/interface")).toBe(true);
    host.rules = [{ protocol: "tcp", destination_ports: Array.from({ length: 33 }, (_, i) => i + 1), action: "accept" }];
    expect(validateConfig(value).some(issue => issue.message.includes("at most 32 unique"))).toBe(true);
    host.rules = [];
    value.firewall.policies!.hosts = Array.from({ length: 129 }, (_, index) => ({
      id: `host_${index}`, name: `Host ${index}`, addresses: [`10.0.0.${index + 1}`], policy: "drop", rules: [],
      metadata: { display_name: "", description: "x".repeat(1000) },
    }));
    const errors = validateConfig(value);
    expect(errors.some(issue => issue.message === "At most 128 hosts")).toBe(true);
    expect(errors.some(issue => issue.message === "Host policy metadata exceeds 65536 bytes")).toBe(true);
  });
  it("accepts the documented host, name, address, ingress, rule and port boundaries", () => {
    const value = emptyConfig();
    value.firewall.policies = {
      hosts: Array.from({ length: 128 }, (_, index) => ({
        id: `host_${index}`, name: index === 0 ? "é".repeat(40) : `Host ${index}`,
        addresses: index === 0 ? Array.from({ length: 16 }, (_, address) => `10.1.0.${address + 1}`) : [`10.0.0.${index + 1}`],
        policy: "drop", rules: [],
      })),
      interfaces: Array.from({ length: 32 }, (_, index) => ({ interface: `lan${index}`, rules: [] })),
    };
    const hosts = value.firewall.policies.hosts;
    hosts[1]!.rules = Array.from({ length: 64 }, () => ({
      protocol: "tcp", destination: "198.51.100.40/32", destination_ports: Array.from({ length: 32 }, (_, i) => i + 1), action: "accept",
    }));
    const parents = Array.from({ length: 32 }, (_, index) => ({ name: `lan${index}`, kind: "ethernet", available: true }));
    expect(validateConfig(value, parents)).toEqual([]);
    hosts[0]!.name += "é";
    hosts[0]!.addresses.push("10.1.0.17");
    value.firewall.policies.interfaces.push({ interface: "lan32", rules: [] });
    const issues = validateConfig(value, parents);
    expect(issues.some(issue => issue.path.endsWith(".name"))).toBe(true);
    expect(issues.some(issue => issue.message === "Use 1..16 host addresses")).toBe(true);
    expect(issues.some(issue => issue.message === "At most 32 ingress interfaces")).toBe(true);
  });
});
