import { z } from "zod";
import { dateVersionSchema } from "@/services/versions";
import { stableJson } from "@/services/configuration";
import type { Config, StateView } from "@/types/domain";
import { ruleOwnershipShape, validateRuleOwnership, withoutRuleOwnership, type RuleOwnership } from "@/services/ruleOwnership";

const integer = z.number().int().safe().nonnegative();
const decimal = z.string().regex(/^(0|[1-9]\d*)$/);
const uint64 = decimal.refine(value => /^(0|[1-9]\d*)$/.test(value) && BigInt(value) <= 18446744073709551615n, "Value exceeds uint64");
const recordID = uint64.refine(value => value !== "0", "Expected a positive record ID");
const uint128 = decimal.refine(value => /^(0|[1-9]\d*)$/.test(value) && BigInt(value) <= 340282366920938463463374607431768211455n, "Value exceeds uint128");
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const milliseconds = integer.max(253402300799999);
const port = integer.max(65535).nullable();
const interfaceIndex = integer.positive().nullable();

export const firewallDenyQuerySchema = z.object({
  limit: integer.min(1).max(500).optional(),
  before_id: recordID.optional(),
  since_ms: milliseconds.optional(), until_ms: milliseconds.optional(),
  address: z.string().ip().optional(), protocol: integer.max(255).optional(),
  chain: z.enum(["input", "forward"]).optional(),
}).strict().refine(value => value.since_ms === undefined || value.until_ms === undefined || value.since_ms <= value.until_ms,
  "Since must not be after Until");
export type FirewallDenyQuery = z.infer<typeof firewallDenyQuerySchema>;

export const firewallDenyRecordSchema = z.object({
  id: recordID, timestamp_ms: milliseconds,
  source: z.string().ip(), destination: z.string().ip(), protocol: integer.max(255),
  source_port: port, destination_port: port,
  ingress_index: interfaceIndex, egress_index: interfaceIndex,
  ingress: z.string().nullable(), egress: z.string().nullable(),
  packet_length: integer, chain: z.enum(["input", "forward"]), reason: z.enum(["rule", "policy"]),
  compiled_rule_index: integer.nullable(), ruleset_id: hash,
}).strict().refine(value => value.reason !== "policy" || value.compiled_rule_index === null, "Default-policy records cannot have a rule index");
export const firewallDenyPageSchema = z.object({
  records: z.array(firewallDenyRecordSchema).max(500),
  next_before_id: recordID.nullable(), oldest_id: recordID.nullable(), newest_id: recordID.nullable(),
  cursor_expired: z.boolean(),
  retention: z.object({ max_records: integer.positive(), max_segment_bytes: integer.positive(), segments: integer.positive() }).strict(),
  capture: z.object({
    status: z.enum(["starting", "capturing", "error", "stopped"]), error: z.string().nullable(),
    group: integer, rate_limit_per_second: integer,
    discarded_records: uint64, malformed_records: uint64, overflow_events: uint64, sequence_gaps: uint64,
    counters_scope: z.literal("daemon_session"), loss_count_exact: z.literal(false),
  }).strict(),
}).strict().superRefine((value, context) => {
  for (let index = 1; index < value.records.length; index++) {
    const current = value.records[index]!.id, previous = value.records[index - 1]!.id;
    if (/^[1-9]\d*$/.test(current) && /^[1-9]\d*$/.test(previous) && BigInt(current) >= BigInt(previous)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["records", index, "id"], message: "Expected descending unique record IDs" });
    }
  }
});
export type FirewallDenyPage = z.infer<typeof firewallDenyPageSchema>;

export const firewallCountersSchema = z.object({
  schema: z.literal("netcontrol-firewall-counters/v1"),
  sample: z.object({
    scope: z.string(), status: z.enum(["available", "simulated"]),
    started_at: z.string().datetime({ offset: true }), collected_at: z.string().datetime({ offset: true }),
  }).strict(),
  config_revision: dateVersionSchema, transaction_id: z.string().nullable(),
  ruleset_id: hash.nullable(), generation: hash.nullable(),
  rules: z.array(z.object({
    ...ruleOwnershipShape,
    id: z.string(), chain: z.string(), config_path: z.string().regex(/^\//).nullable(),
    expanded_rules: integer.positive(), packets: uint128, bytes: uint128,
  }).strict().superRefine(validateRuleOwnership)),
}).strict().superRefine((value, context) => {
  if (value.sample.status === "available" && (!value.ruleset_id || !value.generation)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Native counters require ruleset and generation identities" });
  }
  if (value.sample.status === "simulated" && (value.ruleset_id !== null || value.generation !== null || value.rules.length)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Simulated counters must be unmeasured" });
  }
  const ids = new Set<string>();
  for (const [index, row] of value.rules.entries()) {
    if (ids.has(row.id) || !row.id.startsWith(`${row.chain}:`) || (row.config_path !== null && row.id !== `${row.chain}:${row.config_path}`)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["rules", index, "id"], message: "Invalid or duplicate logical counter identity" });
    }
    ids.add(row.id);
  }
});
export type FirewallCounters = z.infer<typeof firewallCountersSchema>;
export interface FirewallCounts { packets: string; bytes: string }
export interface FirewallCounterSummary extends FirewallCounts, RuleOwnership { id: string; label: string }

export function counterConfigurationMatches(sample: FirewallCounters, state: StateView | null, selected: Config | undefined): boolean {
  if (!state || state.drift || !selected || sample.sample.status !== "available" || sample.config_revision !== state.revision) return false;
  const active = state.active_transaction;
  if (active && active.status !== "pending_confirmation") return false;
  if (sample.transaction_id !== (active?.id ?? null)) return false;
  return stableJson(withoutRuleOwnership(selected.firewall)) === stableJson(withoutRuleOwnership((active?.candidate ?? state.desired).firewall));
}

export const firewallCounterSummaries = {
  forward: [
    { id: "forward:/firewall/policy", label: "Forwarding default", kind: "default" },
    { id: "forward:/firewall/allow_all_icmp", label: "IPv4 ICMP exception", kind: "icmp" },
    { id: "forward:generated/forward/established_related", label: "Established/related bypass", kind: "established" },
  ],
  input: [
    { id: "input:/firewall/input/policy", label: "Input default", kind: "default" },
    { id: "input:/firewall/allow_all_icmp", label: "IPv4 ICMP exception", kind: "icmp" },
    { id: "input:generated/input/loopback", label: "Loopback bypass", kind: "loopback" },
    { id: "input:generated/input/established_related", label: "Established/related bypass", kind: "established" },
    { id: "input:generated/input/policy", label: "Generated input default", kind: "generated-default" },
  ],
} as const;

export interface FirewallSystemRule {
  order: string; name: string; label: string; ingress: string; destination: string; protocol: string;
  ports: string; egress: string; action: string; match: string; counterPath: string;
}

export function firewallSystemRules(config: Config | undefined, chain: "forward" | "input"): FirewallSystemRule[] {
  if (!config) return [];
  const firewall = config.firewall;
  const hasPolicy = Boolean(chain === "input" ? firewall.input : firewall.policies);
  const priority = { icmp: 0, loopback: 1, established: 2, default: 3, "generated-default": 3 };
  const names = { icmp: "ICMP", loopback: "Loopback", established: "Est./related", default: "Default", "generated-default": "Default" };
  return [...firewallCounterSummaries[chain]].sort((first, second) => priority[first.kind] - priority[second.kind]).flatMap(item => {
    const enabled = item.kind === "icmp" ? firewall.allow_all_icmp
      : item.kind === "generated-default" ? !firewall.input && firewall.allow_all_icmp
        : item.kind === "default" ? chain === "forward" || Boolean(firewall.input)
          : hasPolicy;
    if (!enabled) return [];
    return [{
      order: item.kind === "default" || item.kind === "generated-default" ? "Default" : "Before rules",
      name: names[item.kind],
      label: item.label,
      ingress: "Any",
      destination: item.kind === "icmp" ? "Any IPv4" : "Any",
      protocol: item.kind === "icmp" ? "ICMP" : "Any",
      ports: "Any", egress: "Any",
      action: item.kind === "default" ? (chain === "input" ? firewall.input!.policy : firewall.policy) : "accept",
      match: item.kind === "loopback" ? "Ingress: lo"
        : item.kind === "established" ? "Connection state: established, related" : "",
      counterPath: item.id.slice(chain.length + 1),
    }];
  });
}

export { parseTimestamp as parseDenyTime } from "@/services/timestamps";
