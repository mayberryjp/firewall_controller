import { describe, expect, it } from "vitest";
import { cloneConfig, stableJson } from "@/services/configuration";
import { importSando, replaceSandoRules, type SandoConnection } from "@/services/sando";
import { hostPolicyConfig } from "../fixtures";

const source: SandoConnection = { src_ip: "192.0.2.20", dst_ip: "203.0.113.20", protocol: 6, dst_port: 443 };
const owned = { origin: "import", import_source: "sando" } as const;
function settings() {
  const value = hostPolicyConfig();
  value.firewall.policies!.hosts[0]!.rules = [
    { ...owned, destination: "198.51.100.1/32", action: "accept" },
    { origin: "import", import_source: "other", destination: "198.51.100.2/32", action: "drop" },
    { action: "drop", metadata: { display_name: "Keep manual", description: "Preserved" } },
    { origin: "manual", import_source: null, destination: "198.51.100.3/32", action: "accept" },
  ];
  value.firewall.policies!.hosts[1]!.rules = [{ ...owned, action: "drop" }];
  return value;
}
describe("reviewed Sando replacement", () => {
  it("replaces only owned rules, including disappeared targets, and keeps manual-first/source ordering without changing scope", () => {
    const before = settings(), untouched = cloneConfig(before);
    const result = replaceSandoRules(before, [], [source, { ...source, protocol: 17, dst_port: 53 }], "accept");
    const rules = result.config.firewall.policies!.hosts[0]!.rules;
    expect(result.rulesRemoved).toBe(2); expect(result.rulesAdded).toBe(2);
    expect(rules.slice(0, 3)).toEqual([untouched.firewall.policies!.hosts[0]!.rules[2], untouched.firewall.policies!.hosts[0]!.rules[3], untouched.firewall.policies!.hosts[0]!.rules[1]]);
    expect(rules.slice(3).map(rule => [rule.origin, rule.import_source, rule.protocol, rule.destination_ports])).toEqual([["import", "sando", "tcp", [443]], ["import", "sando", "udp", [53]]]);
    expect(result.config.firewall.policies!.hosts[1]!.rules).toEqual([]);
    expect(result.config.firewall.policies!.hosts.map(host => [host.id, host.name, host.addresses, host.policy])).toEqual(untouched.firewall.policies!.hosts.map(host => [host.id, host.name, host.addresses, host.policy]));
    expect(result.config.firewall.policies!.interfaces).toEqual(before.firewall.policies!.interfaces);
    expect(result.config.firewall.nat).toEqual(before.firewall.nat);
    expect(before).toEqual(untouched);
    expect(result.changes).toHaveLength(2);
    const repeated = replaceSandoRules(result.config, [], [source, { ...source, protocol: 17, dst_port: 53 }], "drop");
    expect(repeated.config).toEqual(result.config); expect(repeated.rulesAdded).toBe(2); expect(repeated.rulesRemoved).toBe(2);
  });
  it("treats a successful empty source as removal of Sando-owned rules only, never inventory/defaults or other providers", () => {
    const before = settings(), result = replaceSandoRules(before, [], [], "accept");
    expect(result.rulesRemoved).toBe(2); expect(result.rulesAdded).toBe(0);
    expect(result.config.firewall.policies!.hosts).toHaveLength(before.firewall.policies!.hosts.length);
    expect(result.config.firewall.policies!.hosts[0]!.rules.every(rule => rule.import_source !== "sando")).toBe(true);
    expect(result.config.firewall.policies!.hosts[0]!.policy).toBe("drop");
  });
  it("does not mistake old unlabeled rules for imports or create duplicate rules already covered by manual policy", () => {
    const before = settings();
    before.firewall.policies!.hosts[0]!.rules.push({ destination: "203.0.113.20/32", protocol: "tcp", destination_ports: [443], action: "accept" });
    const result = replaceSandoRules(before, [], [source], "drop");
    expect(result.rulesAdded).toBe(0);
    expect(result.config.firewall.policies!.hosts[0]!.rules.filter(rule => rule.destination === "203.0.113.20/32")).toEqual([before.firewall.policies!.hosts[0]!.rules.at(-1)]);
  });
  it("preserves input and NAT ownership and never relabels or duplicates inherited interface policy", () => {
    const before = settings();
    before.firewall.input = { policy: "drop", interfaces: [{ interface: "lab0", rules: [{ ...owned, action: "accept" }] }] };
    before.firewall.nat.masquerade[0]!.origin = "manual";
    const result = replaceSandoRules(before, [], [source], "drop");
    expect(result.config.firewall.input).toEqual(before.firewall.input);
    expect(result.config.firewall.nat).toEqual(before.firewall.nat);
    expect(result.config.firewall.policies!.interfaces).toEqual(before.firewall.policies!.interfaces);
  });
  it("fails safely for an all-invalid source instead of interpreting skipped records as empty success", () => {
    const before = settings(), original = stableJson(before);
    expect(() => replaceSandoRules(before, [], [{ ...source, dst_port: NaN }], "drop")).toThrow("Existing rules and reports were retained");
    expect(stableJson(before)).toBe(original);
    const partial = replaceSandoRules(before, [], [source, { ...source, dst_port: 0 }], "drop");
    expect(partial.rulesAdded).toBe(1); expect(partial.skipped).toHaveLength(1);
  });
  it("does not replace anything on a host-only import", () => {
    const before = settings();
    expect(importSando(before, [], undefined, "drop").config).toEqual(before);
  });
});
