import { describe, expect, it } from "vitest";
import { counterConfigurationMatches, firewallCountersSchema, firewallDenyPageSchema, firewallDenyQuerySchema, firewallSystemRules, parseDenyTime } from "@/services/firewallTelemetry";
import { cloneConfig } from "@/services/configuration";
import { hostPolicyConfig, state, transaction } from "../fixtures";
import { firewallCounters, firewallDenyPage } from "../firewallTelemetryFixtures";

describe("firewall telemetry contracts", () => {
  it("preserves exact uint128 counters, real zeros and uint64 cursors", () => {
    const sample = firewallCounters();
    sample.rules[0]!.bytes = "340282366920938463463374607431768211455";
    expect(firewallCountersSchema.parse(sample)).toEqual(sample);
    expect(firewallDenyPageSchema.parse(firewallDenyPage())).toEqual(firewallDenyPage());
  });
  it.each(["NaN", "1.5", "-1", "01", "18446744073709551616"])("rejects malformed or oversized ID %s without throwing outside Zod", id => {
    const page = firewallDenyPage();
    page.records.push({ ...page.records[0]!, id });
    expect(firewallDenyPageSchema.safeParse(page).success).toBe(false);
    expect(firewallDenyQuerySchema.safeParse({ before_id: id }).success).toBe(false);
  });
  it.each(["NaN", "01", "-1", "340282366920938463463374607431768211456"])("rejects invalid totals %s", packets => {
    const sample = firewallCounters(); sample.rules[0]!.packets = packets;
    expect(firewallCountersSchema.safeParse(sample).success).toBe(false);
  });
  it("rejects fake simulated measurements, duplicate identities and missing native identities", () => {
    const sample = firewallCounters();
    expect(firewallCountersSchema.safeParse({ ...sample, generation: null }).success).toBe(false);
    expect(firewallCountersSchema.safeParse({ ...sample, rules: [sample.rules[0], sample.rules[0]] }).success).toBe(false);
    expect(firewallCountersSchema.safeParse({ ...sample, sample: { ...sample.sample, status: "simulated" } }).success).toBe(false);
    expect(firewallCountersSchema.safeParse({ ...sample, sample: { ...sample.sample, status: "simulated" }, rules: [], generation: null, ruleset_id: null }).success).toBe(true);
  });
  it("sorts history by exact IDs rather than timestamps and rejects non-descending pages", () => {
    const page = firewallDenyPage();
    page.records.push({ ...page.records[0]!, id: "18446744073709551613", timestamp_ms: page.records[0]!.timestamp_ms + 1000 });
    expect(firewallDenyPageSchema.safeParse(page).success).toBe(true);
    page.records.reverse();
    expect(firewallDenyPageSchema.safeParse(page).success).toBe(false);
  });
  it("validates query bounds, unknown fields, IPs, time ordering and UTC dates", () => {
    for (const query of [{ limit: 501 }, { protocol: 256 }, { before_id: "0" }, { address: "*" }, { offset: 1 }, { since_ms: 2, until_ms: 1 }]) {
      expect(firewallDenyQuerySchema.safeParse(query).success).toBe(false);
    }
    expect(parseDenyTime("2026-10-30 12:34:56")).toBe(Date.parse("2026-10-30T12:34:56Z"));
    expect(parseDenyTime(" ")).toBeUndefined();
    for (const text of ["2026-02-30 12:00:00", "2026-10-30T12:34:56Z", "1969-12-31 23:59:59", "2026-10-30 24:00:00"]) {
      expect(() => parseDenyTime(text)).toThrow();
    }
  });
});

describe("system firewall rules", () => {
  it("shows actual input matches and verdicts in evaluation order with exact counter paths", () => {
    const config = hostPolicyConfig();
    config.firewall.allow_all_icmp = true;
    config.firewall.input = { policy: "drop", interfaces: [] };
    expect(firewallSystemRules(config, "input")).toEqual([
      { order: "Before rules", name: "ICMP", label: "IPv4 ICMP exception", ingress: "Any", destination: "Any IPv4", protocol: "ICMP", ports: "Any", egress: "Any", action: "accept", match: "", counterPath: "/firewall/allow_all_icmp" },
      { order: "Before rules", name: "Loopback", label: "Loopback bypass", ingress: "Any", destination: "Any", protocol: "Any", ports: "Any", egress: "Any", action: "accept", match: "Ingress: lo", counterPath: "generated/input/loopback" },
      { order: "Before rules", name: "Est./related", label: "Established/related bypass", ingress: "Any", destination: "Any", protocol: "Any", ports: "Any", egress: "Any", action: "accept", match: "Connection state: established, related", counterPath: "generated/input/established_related" },
      { order: "Default", name: "Default", label: "Input default", ingress: "Any", destination: "Any", protocol: "Any", ports: "Any", egress: "Any", action: "drop", match: "", counterPath: "/firewall/input/policy" },
    ]);
    config.firewall.input.policy = "accept";
    config.firewall.allow_all_icmp = false;
    expect(firewallSystemRules(config, "input").map(rule => [rule.label, rule.action])).toEqual([
      ["Loopback bypass", "accept"], ["Established/related bypass", "accept"], ["Input default", "accept"],
    ]);
  });
  it("only generates the ICMP input chain and its accept fallback when input policies are absent", () => {
    const config = hostPolicyConfig();
    delete config.firewall.input;
    config.firewall.allow_all_icmp = true;
    expect(firewallSystemRules(config, "input").map(rule => [rule.counterPath, rule.action])).toEqual([
      ["/firewall/allow_all_icmp", "accept"], ["generated/input/policy", "accept"],
    ]);
    config.firewall.allow_all_icmp = false;
    expect(firewallSystemRules(config, "input")).toEqual([]);
    expect(firewallSystemRules(undefined, "input")).toEqual([]);
  });
  it("does not invent established/related bypasses for legacy forwarding and follows the selected default", () => {
    const config = hostPolicyConfig(), before = JSON.stringify(config);
    config.firewall.allow_all_icmp = true;
    config.firewall.policy = "drop";
    expect(firewallSystemRules(config, "forward").map(rule => rule.label)).toEqual([
      "IPv4 ICMP exception", "Established/related bypass", "Forwarding default",
    ]);
    expect(firewallSystemRules(config, "forward").at(-1)?.action).toBe("drop");
    delete config.firewall.policies;
    config.firewall.policy = "accept";
    config.firewall.allow_all_icmp = false;
    expect(firewallSystemRules(config, "forward").map(rule => [rule.label, rule.action])).toEqual([["Forwarding default", "accept"]]);
    const snapshot = JSON.stringify(config);
    firewallSystemRules(config, "forward");
    expect(JSON.stringify(config)).toBe(snapshot);
    expect(before).not.toBe(snapshot);
  });
});

describe("applied firewall identity", () => {
  it("allows unrelated draft changes but never reattributes edited or reordered rules", () => {
    const current = { ...state(), desired: hostPolicyConfig() }, sample = firewallCounters(current.desired);
    const draft = cloneConfig(current.desired);
    draft.ntp.enabled = !draft.ntp.enabled;
    expect(counterConfigurationMatches(sample, current, draft)).toBe(true);
    draft.firewall.policies!.hosts.reverse();
    expect(counterConfigurationMatches(sample, current, draft)).toBe(false);
    expect(counterConfigurationMatches({ ...sample, config_revision: "2026.10.30.1" }, current, current.desired)).toBe(false);
    expect(counterConfigurationMatches(sample, { ...current, drift: true }, current.desired)).toBe(false);
  });
  it("matches the pending applied candidate only with the same transaction identity", () => {
    const current = state(), pending = transaction();
    pending.candidate = hostPolicyConfig(); current.active_transaction = pending;
    const sample = { ...firewallCounters(pending.candidate), transaction_id: pending.id };
    expect(counterConfigurationMatches(sample, current, pending.candidate)).toBe(true);
    expect(counterConfigurationMatches(sample, current, current.desired)).toBe(false);
    expect(counterConfigurationMatches({ ...sample, transaction_id: null }, current, pending.candidate)).toBe(false);
    pending.status = "applying";
    expect(counterConfigurationMatches(sample, current, pending.candidate)).toBe(false);
  });
});
