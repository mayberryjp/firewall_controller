import { describe, expect, it } from "vitest";
import { configSchema, destinationRewriteSchema, type Config } from "@/types/domain";
import { cloneConfig, differences, importConfig, normalize, validateConfig } from "@/services/configuration";
import { firewallProtocolSchema, expandFirewallProtocol, firewallEditorSupportsPorts, supportsFirewallPorts, parseFirewallPorts, formatFirewallProtocol } from "@/services/firewallProtocols";
import { utf8Size } from "@/services/json";
import { config } from "../fixtures";

type Scope = "host" | "interface" | "input" | "legacy";
const scopes: Scope[] = ["host", "interface", "input", "legacy"];
function configured(scope: Scope, protocol: "" | "tcp" | "udp" | "icmp" | "icmpv6"): Config {
  const candidate = config();
  candidate.firewall.rules = [];
  const rule = { protocol, action: "drop" as const, origin: "import" as const, import_source: "test" };
  if (scope === "legacy") candidate.firewall.rules = [rule];
  else if (scope === "input") candidate.firewall.input = { policy: "drop", interfaces: [{ interface: "lab0", rules: [rule] }] };
  else candidate.firewall.policies = {
    hosts: scope === "host" ? [{ id: "host", name: "Host", addresses: ["192.0.2.20", "2001:db8::20"], policy: "drop", rules: [rule] }] : [],
    interfaces: scope === "interface" ? [{ interface: "lab0", rules: [rule] }] : [],
  };
  return candidate;
}
function rules(candidate: Config, scope: Scope) {
  return scope === "legacy" ? candidate.firewall.rules : scope === "input" ? candidate.firewall.input!.interfaces[0]!.rules
    : scope === "host" ? candidate.firewall.policies!.hosts[0]!.rules : candidate.firewall.policies!.interfaces[0]!.rules;
}

describe.each(scopes)("%s firewall protocols", scope => {
  it.each(["", "tcp", "udp", "icmp", "icmpv6"] as const)("preserves %s and ownership through schema, import/export, clone, normalization and diff", protocol => {
    const candidate = configured(scope, protocol);
    if (protocol === "tcp" || protocol === "udp") rules(candidate, scope)[0]!.destination_ports = [443, 80];
    expect(validateConfig(candidate)).toEqual([]);
    const imported = importConfig(JSON.stringify(candidate));
    expect(rules(imported, scope)).toEqual(rules(candidate, scope));
    expect(rules(cloneConfig(imported), scope)).toEqual(rules(candidate, scope));
    expect(rules(configSchema.parse(candidate), scope)).toEqual(rules(candidate, scope));
    expect(rules(normalize(candidate), scope)[0]!.protocol).toBe(protocol || undefined);
    const before = cloneConfig(candidate);
    rules(before, scope)[0]!.action = "accept";
    expect(differences(before, candidate)).toHaveLength(scope === "legacy" ? 2 : 1);
    expect(rules(candidate, scope)[0]!.destination_ports).toEqual(protocol === "tcp" || protocol === "udp" ? [443, 80] : undefined);
  });
  it.each(["ICMP", "icmp6", "ipv6-icmp", "sctp", "tcp_udp", 1, 58, null])("rejects unsupported protocol %j rather than broadening to Any", protocol => {
    const candidate = configured(scope, "icmp");
    const wire = JSON.parse(JSON.stringify(candidate));
    Object.assign(rules(wire, scope)[0]!, { protocol });
    expect(configSchema.safeParse(wire).success).toBe(false);
    expect(() => importConfig(JSON.stringify(wire))).toThrow();
  });
  it.each(["", "icmp", "icmpv6"] as const)("rejects ports for %s", protocol => {
    const candidate = configured(scope, protocol);
    rules(candidate, scope)[0]!.destination_ports = [443];
    expect(validateConfig(candidate).some(issue => issue.message.includes("Destination ports require TCP or UDP"))).toBe(true);
  });
  it.each(["icmp", "icmpv6"] as const)("rejects incompatible explicit destinations for %s", protocol => {
    const candidate = configured(scope, protocol);
    rules(candidate, scope)[0]!.destination = protocol === "icmp" ? "2001:db8::/64" : "192.0.2.0/24";
    expect(validateConfig(candidate).some(issue => issue.message.includes("family"))).toBe(true);
  });
  it("rejects wildcard ICMPv6 when global IPv6 is disabled", () => {
    const candidate = configured(scope, "icmpv6");
    candidate.ipv6_enabled = false;
    expect(validateConfig(candidate).some(issue => issue.message.includes("ICMPv6 requires global IPv6"))).toBe(true);
  });
});

describe("firewall protocol limits", () => {
  it("expands the creation-only TCP/UDP option without widening the wire protocol or port validator", () => {
    expect(expandFirewallProtocol("tcp_udp", true)).toEqual(["tcp", "udp"]);
    expect(firewallEditorSupportsPorts("tcp_udp")).toBe(true);
    expect(supportsFirewallPorts("tcp_udp")).toBe(false);
    expect(() => expandFirewallProtocol("tcp_udp", false)).toThrow();
    expect(expandFirewallProtocol(undefined, true)).toEqual([""]);
    expect(expandFirewallProtocol("tcp", false)).toEqual(["tcp"]);
  });
  it("normalizes legacy Any/empty ports and sorted port sets without reordering rules", () => {
    const before = configured("legacy", "tcp");
    before.firewall.rules = [{ protocol: "", destination_ports: [], action: "drop" }, { protocol: "tcp", destination_ports: [443, 80], action: "accept" }];
    const after = cloneConfig(before);
    delete after.firewall.rules[0]!.protocol;
    delete after.firewall.rules[0]!.destination_ports;
    after.firewall.rules[1]!.destination_ports!.reverse();
    expect(differences(before, after)).toEqual([]);
    expect(before.firewall.rules[1]!.destination_ports).toEqual([443, 80]);
    after.firewall.rules.reverse();
    expect(differences(before, after).length).toBeGreaterThan(0);
  });
  it("accepts exactly 20480 expanded legacy entries and rejects 20481", () => {
    const candidate = configured("legacy", "tcp");
    candidate.firewall.rules = Array.from({ length: 640 }, () => ({
      protocol: "tcp", action: "accept", destination_ports: Array.from({ length: 32 }, (_, index) => index + 1),
    }));
    expect(validateConfig(candidate)).toEqual([]);
    candidate.firewall.rules.push({ action: "drop" });
    expect(validateConfig(candidate)).toContainEqual(expect.objectContaining({ path: "firewall.rules", message: "Legacy rules expand beyond 20480 entries" }));
  });
  it("counts only protocol-compatible dual-stack address pairs", () => {
    const candidate = configured("host", "icmp");
    candidate.firewall.policies!.hosts = Array.from({ length: 80 }, (_, index) => ({
      id: `h${index}`, name: `Host ${index}`, policy: "drop",
      addresses: [`192.0.2.${index + 1}`, `198.51.100.${index + 1}`, `2001:db8::${index + 1}`, `2001:db8:1::${index + 1}`],
      rules: Array.from({ length: 32 }, () => ({ destination_host: "h0", protocol: "icmp", action: "drop" })),
    }));
    expect(validateConfig(candidate)).toEqual([]);
    for (const host of candidate.firewall.policies!.hosts) for (const rule of host.rules) delete rule.protocol;
    expect(validateConfig(candidate)).toContainEqual(expect.objectContaining({ path: "firewall.policies", message: "Host policies expand beyond 20480 entries" }));
  });
  it.each(["host", "interface", "input"] as const)("accepts 320 %s rules and rejects 321", scope => {
    const candidate = configured(scope, "tcp"), entries = rules(candidate, scope);
    entries.splice(0, entries.length, ...Array.from({ length: 320 }, () => ({ action: "accept" as const })));
    expect(validateConfig(candidate)).toEqual([]);
    entries.push({ action: "accept" });
    expect(validateConfig(candidate)).toContainEqual(expect.objectContaining({
      message: scope === "input" ? "At most 320 ordered rules per interface" : "At most 320 ordered rules per host/interface",
    }));
  });
  it.each(["host", "interface"] as const)("accepts exactly 20480 expanded %s entries and rejects 20481", scope => {
    const candidate = configured(scope, "tcp");
    const entries = () => Array.from({ length: 320 }, () => ({
      protocol: "tcp" as const, action: "accept" as const, destination_ports: Array.from({ length: 32 }, (_, index) => index + 1),
    }));
    candidate.interfaces.push({ ...candidate.interfaces[0]!, name: "lan1", addresses: [] });
    candidate.firewall.policies = {
      hosts: scope === "host" ? ["192.0.2.20", "192.0.2.21"].map((address, index) => ({
        id: `h${index}`, name: `Host ${index}`, addresses: [address], policy: "drop", rules: entries(),
      })) : [],
      interfaces: scope === "interface" ? ["lab0", "lan1"].map(name => ({ interface: name, rules: entries() })) : [],
    };
    const first = scope === "host" ? candidate.firewall.policies.hosts[0]!.rules[0]!
      : candidate.firewall.policies.interfaces[0]!.rules[0]!;
    first.destination_ports!.splice(0, scope === "host" ? 3 : 1);
    expect(validateConfig(candidate)).toEqual([]);
    first.destination_ports!.push(1);
    expect(validateConfig(candidate)).toContainEqual(expect.objectContaining({
      path: "firewall.policies", message: "Host policies expand beyond 20480 entries",
    }));
  });
  it.each(["host", "interface", "input"] as const)("accepts exactly 327680 UTF-8 metadata bytes for %s and rejects one byte more", scope => {
    const candidate = configured(scope, "tcp"), entries = rules(candidate, scope);
    entries.splice(0, entries.length, ...Array.from({ length: 320 }, () => ({
      action: "accept" as const, metadata: { display_name: "", description: "\u00e9" },
    })));
    const serialized = () => {
      const firewall = normalize(candidate).firewall;
      return JSON.stringify(scope === "input" ? { hosts: [], interfaces: firewall.input!.interfaces } : firewall.policies);
    };
    const remaining = 327680 - utf8Size(serialized());
    entries.forEach((entry, index) => {
      entry.metadata!.description += "x".repeat(Math.floor(remaining / entries.length) + (index < remaining % entries.length ? 1 : 0));
    });
    expect(utf8Size(serialized())).toBe(327680);
    expect(validateConfig(candidate)).toEqual([]);
    entries[0]!.metadata!.description += "x";
    expect(utf8Size(serialized())).toBe(327681);
    expect(validateConfig(candidate)).toContainEqual(expect.objectContaining({
      message: scope === "input" ? "Input policy metadata exceeds 327680 bytes" : "Host policy metadata exceeds 327680 bytes",
    }));
  });
  it.each([null, "443-445", "1.5", "0", "65536", "443,443", Array.from({ length: 33 }, (_, index) => index + 1)])("rejects invalid port lists %j", value => {
    expect(() => parseFirewallPorts(value)).toThrow();
  });
  it("accepts individual comma/space-separated ports and keeps NAT restricted to TCP/UDP", () => {
    expect(parseFirewallPorts("80, 443 65535")).toEqual([80, 443, 65535]);
    expect(formatFirewallProtocol("icmpv6")).toBe("ICMPv6");
    expect(firewallProtocolSchema.parse("icmp")).toBe("icmp");
    expect(destinationRewriteSchema.safeParse({ out_interface: "lab0", target_interface: "lab0", target_address: "192.0.2.20", destination_port: 80, protocol: "icmp" }).success).toBe(false);
  });
});
