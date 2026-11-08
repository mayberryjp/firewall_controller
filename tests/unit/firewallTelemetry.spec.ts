import { describe, expect, it } from "vitest";
import { counterConfigurationMatches, dhcpRelayCounterSummaries, dhcpRelaySystemRules, firewallCountersSchema, firewallDenyPageSchema, firewallDenyQuerySchema, firewallSystemRules, parseDenyTime, sortFirewallDrops } from "@/services/firewallTelemetry";
import { cloneConfig } from "@/services/configuration";
import { hostPolicyConfig, state, transaction } from "../fixtures";
import { firewallCounters, firewallDenyPage } from "../firewallTelemetryFixtures";

describe("firewall telemetry contracts", () => {
  it("preserves nullable TCP metadata, real zeros and disabled capture while rejecting unsupported tag queries", () => {
    const page = firewallDenyPage();
    page.capture.status = "disabled";
    page.records[0]!.tcp_flags = 0; page.records[0]!.tcp_payload_length = 0;
    expect(firewallDenyPageSchema.parse(page)).toEqual(page);
    expect(firewallDenyQuerySchema.safeParse({ tag: "tcp_finish" }).success).toBe(false);
    expect(firewallDenyQuerySchema.safeParse({ exclude_tags: "ipv4_broadcast" }).success).toBe(false);
    expect(firewallDenyPageSchema.safeParse({ ...page, records: [{ ...page.records[0]!, tcp_flags: 256 }] }).success).toBe(false);
    expect(firewallDenyPageSchema.safeParse({ ...page, records: [{ ...page.records[0]!, tags: ["guessed_broadcast"] }] }).success).toBe(false);
    expect(firewallDenyPageSchema.safeParse({ ...page, records: [{ ...page.records[0]!, tags: undefined }] }).success).toBe(false);
  });
  it.each(["include_broadcast", "include_tcp_closures"] as const)("accepts only boolean client values for %s", key => {
    expect(firewallDenyQuerySchema.parse({})).toEqual({});
    for (const value of [false, true]) expect(firewallDenyQuerySchema.parse({ [key]: value })).toEqual({ [key]: value });
    for (const value of [null, "", 0, 1, "true", "false", "TRUE", " false "]) {
      expect(firewallDenyQuerySchema.safeParse({ [key]: value }).success).toBe(false);
    }
  });
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

describe("firewall drop sorting", () => {
  const base = firewallDenyPage().records[0]!;
  it.each(["timestamp_ms", "packet_length"] as const)("sorts %s numerically in both directions without changing the records", column => {
    const rows = [1000, 9, 40].map((value, index) => ({ ...base, id: String(3 - index), [column]: value }));
    const before = JSON.stringify(rows);
    expect(sortFirewallDrops(rows, column, false).map(row => row[column])).toEqual([9, 40, 1000]);
    expect(sortFirewallDrops(rows, column, true).map(row => row[column])).toEqual([1000, 40, 9]);
    expect(JSON.stringify(rows)).toBe(before);
  });
  it.each(["source", "destination"] as const)("sorts %s IPs numerically with port tie-breakers, real zeros and null ports last", column => {
    const port = column === "source" ? "source_port" : "destination_port";
    const rows = [
      { ...base, id: "5", [column]: "192.0.2.10", [port]: 443 },
      { ...base, id: "4", [column]: "192.0.2.2", [port]: null },
      { ...base, id: "3", [column]: "192.0.2.2", [port]: 80 },
      { ...base, id: "2", [column]: "192.0.2.2", [port]: 0 },
      { ...base, id: "1", [column]: "192.0.2.2", [port]: 443 },
    ];
    expect(sortFirewallDrops(rows, column, false).map(row => row.id)).toEqual(["2", "3", "1", "4", "5"]);
    expect(sortFirewallDrops(rows, column, true).map(row => row.id)).toEqual(["5", "1", "3", "2", "4"]);
  });
  it.each(["ingress", "egress"] as const)("sorts %s interface names naturally with nulls last in either direction", column => {
    const rows = [null, "vlan10", "vlan2"].map((value, index) => ({ ...base, id: String(3 - index), [column]: value }));
    expect(sortFirewallDrops(rows, column, false).map(row => row[column])).toEqual(["vlan2", "vlan10", null]);
    expect(sortFirewallDrops(rows, column, true).map(row => row[column])).toEqual(["vlan10", "vlan2", null]);
  });
  it("sorts protocol labels and reasons with chain tie-breakers", () => {
    const rows = [17, 6, 255, 1].map((protocol, index) => ({ ...base, id: String(4 - index), protocol }));
    expect(sortFirewallDrops(rows, "protocol", false).map(row => row.protocol)).toEqual([1, 255, 6, 17]);
    expect(sortFirewallDrops(rows, "protocol", true).map(row => row.protocol)).toEqual([17, 6, 255, 1]);
    const reasons = [
      { ...base, id: "3", reason: "rule" as const, chain: "forward" as const },
      { ...base, id: "2", reason: "policy" as const, chain: "input" as const },
      { ...base, id: "1", reason: "policy" as const, chain: "forward" as const },
    ];
    expect(sortFirewallDrops(reasons, "reason", false).map(row => row.id)).toEqual(["1", "2", "3"]);
    expect(sortFirewallDrops(reasons, "reason", true).map(row => row.id)).toEqual(["3", "2", "1"]);
  });
  it("keeps equal-key records in original exact-ID order and sorts fractional-second timestamps at full precision", () => {
    const rows = [
      { ...base, id: "18446744073709551614", timestamp_ms: base.timestamp_ms + 1 },
      { ...base, id: "18446744073709551613", timestamp_ms: base.timestamp_ms },
    ];
    expect(sortFirewallDrops(rows, "packet_length", true).map(row => row.id)).toEqual(rows.map(row => row.id));
    expect(sortFirewallDrops(rows, "timestamp_ms", false).map(row => row.id)).toEqual([...rows].reverse().map(row => row.id));
    expect(sortFirewallDrops([], "timestamp_ms", false)).toEqual([]);
  });
});

describe("system firewall rules", () => {
  it("preserves all relay matches, selects the backend relay address and scopes display to the configured interface", () => {
    const config = hostPolicyConfig(), link = config.interfaces[0]!;
    link.dhcp_relay = { enabled: true, servers: ["198.51.100.40", "198.51.100.41"] };
    link.addresses = ["2001:db8::10/64", "192.0.2.20/24", "192.0.2.10/24"];
    const sample = firewallCounters(config);
    expect(dhcpRelaySystemRules(config, sample, "lab0")).toEqual([
      {
        order: "Before rules", name: "DHCP clients", label: "DHCP relay clients", ingress: "LAB0",
        source: "Any IPv4", destination: "192.0.2.10/32, 255.255.255.255/32", protocol: "UDP",
        sourcePorts: "68", ports: "67", egress: "Any", action: "accept", match: "",
        counterPath: "generated/input/dhcp_relay/lab0/clients",
      },
      {
        order: "Before rules", name: "DHCP servers", label: "DHCP relay servers", ingress: "Any",
        source: "198.51.100.40/32, 198.51.100.41/32", destination: "192.0.2.10/32", protocol: "UDP",
        sourcePorts: "67", ports: "67", egress: "Any", action: "accept", match: "",
        counterPath: "generated/input/dhcp_relay/lab0/servers",
      },
    ]);
    expect(dhcpRelaySystemRules(config, sample, "wan0")).toEqual([]);
    expect(dhcpRelaySystemRules(config, null, "lab0")).toEqual([]);
    expect(dhcpRelaySystemRules(config, firewallCounters(), "lab0")).toEqual([]);
    link.dhcp_relay.enabled = false;
    expect(dhcpRelaySystemRules(config, sample, "lab0")).toEqual([]);
  });
  it("shows actual input matches and verdicts in evaluation order with exact counter paths", () => {
    const config = hostPolicyConfig();
    config.firewall.allow_all_icmp = true;
    config.firewall.input = { policy: "drop", interfaces: [] };
    expect(firewallSystemRules(config, "input")).toEqual([
      { order: "Before rules", name: "ICMP", label: "IPv4 ICMP exception", ingress: "Any", destination: "Any IPv4", protocol: "ICMP", ports: "Any", egress: "Any", action: "accept", match: "", counterPath: "/firewall/allow_all_icmp" },
      { order: "Before rules", name: "Loopback", label: "Loopback bypass", ingress: "LO", destination: "Any", protocol: "Any", ports: "Any", egress: "Any", action: "accept", match: "Ingress: lo", counterPath: "generated/input/loopback" },
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
  it.each(["enable", "disable", "servers", "address", "up"] as const)("invalidates counters for unapplied relay %s edits", edit => {
    const current = state();
    const link = current.desired.interfaces[0]!;
    link.dhcp_relay = { enabled: edit !== "enable", servers: ["198.51.100.40"] };
    const sample = firewallCounters(current.desired), draft = cloneConfig(current.desired);
    const changed = draft.interfaces[0]!;
    if (edit === "enable" || edit === "disable") changed.dhcp_relay.enabled = !changed.dhcp_relay.enabled;
    if (edit === "servers") changed.dhcp_relay.servers = ["198.51.100.41"];
    if (edit === "address") changed.addresses = ["192.0.2.11/24"];
    if (edit === "up") changed.up = false;
    expect(counterConfigurationMatches(sample, current, draft)).toBe(false);
    expect(counterConfigurationMatches(sample, current, current.desired)).toBe(true);
    expect(current.desired.firewall).toEqual(draft.firewall);
  });
  it("does not invalidate relay counters for unrelated interface metadata or disabled server-list edits", () => {
    const current = state(), sample = firewallCounters(current.desired), draft = cloneConfig(current.desired);
    draft.interfaces[0]!.metadata = { display_name: "New label", description: "" };
    draft.interfaces[0]!.dhcp_relay.servers = ["198.51.100.40"];
    expect(counterConfigurationMatches(sample, current, draft)).toBe(true);
  });
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

  describe("generated DHCP relay counters", () => {
    it("accepts exact system counter totals and sorts interfaces alphabetically without changing identifiers", () => {
      const settings = hostPolicyConfig();
      settings.interfaces = ["vlan30", "eth2", "eth10"].map(name => ({
        ...settings.interfaces[0]!, name, dhcp_relay: { enabled: true, servers: ["198.51.100.40", "198.51.100.41"] },
      }));
      const sample = firewallCounters(settings), before = JSON.stringify(sample);
      const parsed = firewallCountersSchema.parse(sample);
      const rows = dhcpRelayCounterSummaries(parsed);
      expect(rows.map(row => [row.interfaceName, row.label])).toEqual(["eth10", "eth2", "vlan30"].flatMap(name => [
        [name, "DHCP relay clients"], [name, "DHCP relay servers"],
      ]));
      expect(rows[0]).toMatchObject({
        id: "input:generated/input/dhcp_relay/eth10/clients", packets: "9007199254740993",
        bytes: "18446744073709551616", origin: "system", import_source: null,
      });
      expect(rows[1]!.packets).toBe("0");
      expect(JSON.stringify(sample)).toBe(before);
    });
    it("does not invent permits for older backends, missing samples or unrelated counter identities", () => {
      expect(dhcpRelayCounterSummaries(null)).toEqual([]);
      const sample = firewallCounters();
      expect(dhcpRelayCounterSummaries(sample)).toEqual([]);
      const base = { ...sample.rules[0]!, chain: "input", config_path: null, origin: "system" as const };
      sample.rules = [
        { ...base, id: "input:generated/input/dhcp_relay/lab0/other" },
        { ...base, id: "input:generated/input/dhcp_relay/lab0/clients", origin: "manual" },
        { ...base, id: "input:generated/input/dhcp_relay/lab0/servers", config_path: "/firewall/input/interfaces/0/rules/0" },
      ];
      expect(dhcpRelayCounterSummaries(sample)).toEqual([]);
    });
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
