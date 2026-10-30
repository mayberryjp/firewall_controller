import { describe, expect, it } from "vitest";
import { cloneConfig, normalize } from "@/services/configuration";
import { configSchema, inputFirewallSchema } from "@/types/domain";
import { counterConfigurationMatches, firewallCountersSchema } from "@/services/firewallTelemetry";
import { ruleOwnershipEntries, ruleOwnershipLabel, ruleOwnershipPreserved, ruleOwnershipSchema } from "@/services/ruleOwnership";
import { config, hostPolicyConfig, state } from "../fixtures";
import { dnatRule } from "../bgpFixtures";
import { firewallCounters } from "../firewallTelemetryFixtures";

describe("rule ownership contract", () => {
  function allScopes() {
    const settings = hostPolicyConfig(); settings.firewall.rules = config().firewall.rules;
    settings.firewall.input = { policy: "drop", interfaces: [{ interface: "lab0", rules: [{ action: "accept" }] }] };
    settings.firewall.nat.destination_rewrite = [dnatRule()];
    return settings;
  }
  it("round-trips labels in every filter and NAT scope, including input and revision-style config clones", () => {
    const settings = allScopes();
    for (const rule of ruleOwnershipEntries(settings).values()) Object.assign(rule, { origin: "import", import_source: "sando" });
    expect(configSchema.parse(settings)).toEqual(settings);
    expect(ruleOwnershipPreserved(settings, cloneConfig(settings))).toBe(true);
    const received = cloneConfig(settings);
    delete received.firewall.nat.destination_rewrite![0]!.origin;
    expect(ruleOwnershipPreserved(settings, received)).toBe(false);
    const sample = firewallCounters();
    Object.assign(sample.rules[0]!, { origin: "import", import_source: "other_provider-1" });
    expect(firewallCountersSchema.parse(sample)).toEqual(sample);
  });
  it.each([
    { origin: null }, { origin: "unknown" }, { origin: "import" }, { origin: "import", import_source: null },
    { origin: "import", import_source: "https://sando.example" }, { origin: "import", import_source: "Sando" },
    { origin: "import", import_source: "x".repeat(65) }, { origin: "manual", import_source: "sando" },
    { origin: "system", import_source: "sando" }, { origin: "inherited", import_source: "sando" },
  ])("rejects invalid origin/source combination %j in all rule scopes", ownership => {
    const settings = allScopes();
    for (const rule of ruleOwnershipEntries(settings).values()) Object.assign(rule, ownership);
    expect(configSchema.safeParse(settings).success).toBe(false);
    expect(ruleOwnershipSchema.safeParse(ownership).success).toBe(false);
  });
  it("displays unlabeled legacy rules as manual without rewriting their wire format", () => {
    expect(ruleOwnershipLabel({ action: "accept" })).toBe("Manual");
    expect(ruleOwnershipLabel({ origin: "import", import_source: "sando" })).toBe("Import: sando");
    expect(ruleOwnershipLabel({ origin: "system", import_source: null })).toBe("System");
    expect(ruleOwnershipLabel({ origin: "inherited", import_source: null })).toBe("Inherited");
    expect(configSchema.parse(config()).firewall.rules[0]!.origin).toBeUndefined();
    expect(inputFirewallSchema.parse({ policy: "drop", interfaces: [] }).interfaces).toEqual([]);
  });
  it("accepts backend-normalized host and interface groups without changing rule priority", () => {
    const settings = allScopes();
    for (const rule of ruleOwnershipEntries(settings).values()) Object.assign(rule, { origin: "import", import_source: "sando" });
    settings.firewall.policies!.interfaces.unshift({
      interface: "wan0", rules: [{ origin: "manual", import_source: null, action: "drop" }],
    });
    settings.firewall.input!.interfaces.unshift({
      interface: "wan0", rules: [{ origin: "import", import_source: "other_provider", action: "accept" }],
    });
    const received = normalize(settings);
    expect(received.firewall.policies!.hosts.map(host => host.id)).not.toEqual(settings.firewall.policies!.hosts.map(host => host.id));
    expect(received.firewall.policies!.interfaces[0]!.interface).toBe("lab0");
    expect(received.firewall.input!.interfaces[0]!.interface).toBe("lab0");
    expect(ruleOwnershipPreserved(settings, received)).toBe(true);
    expect(ruleOwnershipEntries(received).get("/firewall/policies/hosts/1/rules/0")).toEqual(received.firewall.policies!.hosts[1]!.rules[0]);
  });
  it("does not mistake another host's labels at the same array index for preserved ownership", () => {
    const settings = allScopes();
    settings.firewall.policies!.hosts = [{
      id: "original", name: "Original", addresses: ["192.0.2.20"], policy: "drop",
      rules: [{ origin: "import", import_source: "sando", action: "accept" }],
    }];
    const received = cloneConfig(settings);
    received.firewall.policies!.hosts[0]!.id = "replacement";
    expect(ruleOwnershipPreserved(settings, received)).toBe(false);
  });
  it("continues rejecting lost or reassigned labels after group normalization", () => {
    const settings = allScopes();
    for (const rule of ruleOwnershipEntries(settings).values()) Object.assign(rule, { origin: "import", import_source: "sando" });
    const received = normalize(settings);
    const phone = received.firewall.policies!.hosts.find(host => host.id === "phone")!;
    phone.rules[0]!.import_source = "other_provider";
    expect(ruleOwnershipPreserved(settings, received)).toBe(false);
    delete phone.rules[0]!.origin; delete phone.rules[0]!.import_source;
    expect(ruleOwnershipPreserved(settings, received)).toBe(false);
  });
  it("does not normalize away priority-sensitive rule order when checking ownership", () => {
    const settings = allScopes(), rules = settings.firewall.policies!.hosts[0]!.rules;
    Object.assign(rules[0]!, { origin: "import", import_source: "sando" });
    Object.assign(rules[1]!, { origin: "manual", import_source: null });
    const received = normalize(settings);
    received.firewall.policies!.hosts[0]!.rules.reverse();
    expect(ruleOwnershipPreserved(settings, received)).toBe(false);
  });
  it("keeps live counter attribution for ownership-only drafts while hiding real match/order changes", () => {
    const current = { ...state(), desired: hostPolicyConfig() }, sample = firewallCounters(current.desired);
    const draft = cloneConfig(current.desired);
    Object.assign(draft.firewall.policies!.hosts[0]!.rules[0]!, { origin: "import", import_source: "sando" });
    expect(counterConfigurationMatches(sample, current, draft)).toBe(true);
    draft.firewall.policies!.hosts[0]!.rules.reverse();
    expect(counterConfigurationMatches(sample, current, draft)).toBe(false);
  });
});
