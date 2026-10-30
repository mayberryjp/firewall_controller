import type { Config } from "../src/types/domain";
import type { FirewallCounters, FirewallDenyPage } from "../src/services/firewallTelemetry";
import { config, state } from "./fixtures";
import { ruleOwnershipEntries } from "../src/services/ruleOwnership";

export function firewallCounters(settings: Config = config()): FirewallCounters {
  const rules: FirewallCounters["rules"] = [];
  function add(chain: string, path: string, packets = "9007199254740993") {
    rules.push({ id: `${chain}:${path}`, chain, config_path: path.startsWith("/") ? path : null, expanded_rules: 2, packets, bytes: "18446744073709551616" });
  }
  settings.firewall.rules.forEach((_, index) => add("forward", `/firewall/rules/${index}`));
  settings.firewall.policies?.hosts.forEach((host, index) => {
    host.rules.forEach((_, rule) => add("forward", `/firewall/policies/hosts/${index}/rules/${rule}`));
    add("forward", `/firewall/policies/hosts/${index}/policy`, "0");
  });
  settings.firewall.policies?.interfaces.forEach((ingress, index) => ingress.rules.forEach((_, rule) => add("forward", `/firewall/policies/interfaces/${index}/rules/${rule}`)));
  settings.firewall.input?.interfaces.forEach((ingress, index) => ingress.rules.forEach((_, rule) => add("input", `/firewall/input/interfaces/${index}/rules/${rule}`)));
  settings.firewall.nat.masquerade.forEach((_, index) => add("postrouting", `/firewall/nat/masquerade/${index}`));
  settings.firewall.nat.destination_rewrite?.forEach((_, index) => add("destination_rewrite", `/firewall/nat/destination_rewrite/${index}`));
  add("forward", "/firewall/policy", "0");
  add("forward", "generated/forward/established_related");
  if (settings.firewall.allow_all_icmp) {
    add("forward", "/firewall/allow_all_icmp");
    add("input", "/firewall/allow_all_icmp");
  }
  if (settings.firewall.input) {
    add("input", "/firewall/input/policy", "0");
    add("input", "generated/input/loopback");
    add("input", "generated/input/established_related");
  } else if (settings.firewall.allow_all_icmp) add("input", "generated/input/policy", "0");
  const ownership = ruleOwnershipEntries(settings);
  for (const row of rules) {
    const configured = row.config_path ? ownership.get(row.config_path) : undefined;
    row.origin = configured ? configured.origin ?? "manual" : "system";
    row.import_source = configured?.import_source ?? null;
  }
  return {
    schema: "netcontrol-firewall-counters/v1",
    sample: { scope: "namespace:test", status: "available", started_at: "2026-10-30T12:34:55.123456Z", collected_at: "2026-10-30T12:34:56.987654Z" },
    config_revision: state().revision, transaction_id: null, ruleset_id: "a".repeat(64), generation: "b".repeat(64), rules,
  };
}

export function firewallDenyPage(): FirewallDenyPage {
  return {
    records: [{
      id: "18446744073709551614", timestamp_ms: Date.parse("2026-10-30T12:34:56.789Z"),
      source: "192.0.2.20", destination: "198.51.100.10", protocol: 6,
      source_port: 0, destination_port: null, ingress_index: 3, egress_index: null,
      ingress: null, egress: "wan0", packet_length: 60, chain: "forward", reason: "rule",
      compiled_rule_index: 0, ruleset_id: "c".repeat(64),
    }],
    next_before_id: "18446744073709551614", oldest_id: "18446744073709551610", newest_id: "18446744073709551614",
    cursor_expired: false,
    retention: { max_records: 4096, max_segment_bytes: 524288, segments: 8 },
    capture: {
      status: "capturing", error: null, group: 100, rate_limit_per_second: 100,
      discarded_records: "0", malformed_records: "0", overflow_events: "0", sequence_gaps: "0",
      counters_scope: "daemon_session", loss_count_exact: false,
    },
  };
}
