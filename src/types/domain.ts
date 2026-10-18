import { z } from "zod";

const list = <T extends z.ZodTypeAny>(schema: T) =>
  z.array(schema).nullable().transform((value) => value ?? []);
const integer = z.number().int().safe();
export const revisionSchema = z.string().regex(/^(0|[1-9]\d*)$/)
  .refine((value) => /^(0|[1-9]\d*)$/.test(value) && BigInt(value) <= 18446744073709551615n, "Revision exceeds uint64");
const timestamp = z.string().datetime({ offset: true });
const optionalText = z.string().optional();
const stringMap = z.record(z.string()).nullable().transform((value) => value ?? {});
export const kernelSchema = z.object({ namespace: stringMap, host: stringMap }).strict();
export const peerSchema = z.object({
  public_key: z.string(), endpoint: optionalText, allowed_ips: list(z.string()),
  persistent_keepalive_seconds: integer,
}).strict();
export const dhcpRelaySchema = z.object({
  enabled: z.boolean().default(false), servers: list(z.string()).default([]),
}).strict().default({ enabled: false, servers: [] });
const interfaceFields = {
  name: z.string(), role: z.enum(["wan", "lan"]), mtu: integer, up: z.boolean(), addresses: list(z.string()),
  dhcp_relay: dhcpRelaySchema,
};
export const interfaceSchema = z.discriminatedUnion("kind", [
  z.object({ ...interfaceFields, kind: z.literal("dummy") }).strict(),
  z.object({ ...interfaceFields, kind: z.literal("vlan"),
    vlan: z.object({ parent: z.string(), id: integer }).strict() }).strict(),
  z.object({ ...interfaceFields, kind: z.literal("wireguard"),
    wireguard: z.object({ key_ref: z.string(), listen_port: integer, peers: list(peerSchema) }).strict() }).strict(),
]);
export const routeSchema = z.object({
  destination: z.string(), gateway: optionalText, interface: z.string(), table: integer, metric: integer,
}).strict();
export const policySchema = z.object({ priority: integer, source: z.string(), table: integer }).strict();
export const filterSchema = z.object({
  source: optionalText, destination: optionalText, action: z.enum(["accept", "drop"]),
}).strict();
export const masqueradeSchema = z.object({
  family: z.enum(["ipv4", "ipv6"]), source: optionalText, out_interface: z.string(),
}).strict();
export const timeoutNames = ["general", "tcp", "tcp.rst", "tcp.fin", "udp", "icmp", "maxlife", "expint"] as const;
export const softflowdSchema = z.object({
  name: z.string(), enabled: z.boolean(), interface: z.string(), collector: z.string(),
  export_version: z.union([z.literal(1), z.literal(5), z.literal(9), z.literal(10)]),
  sampling_rate: integer, max_flows: integer, snaplen: integer, promiscuous: z.boolean(),
  capture_filter: optionalText,
  timeouts: z.record(z.enum(timeoutNames), integer).nullable().transform((value) => value ?? {}),
}).strict();
const hostPolicyRuleSchema = z.object({
  destination_host: optionalText, destination: optionalText, protocol: z.enum(["", "tcp", "udp"]).optional(),
  destination_ports: list(integer).optional(), action: z.enum(["accept", "drop"]),
}).strict();
export const firewallPoliciesSchema = z.object({
  hosts: list(z.object({
    id: z.string(), name: z.string(), addresses: list(z.string()), policy: z.enum(["accept", "drop"]),
    rules: list(hostPolicyRuleSchema),
  }).strict()),
  interfaces: list(z.object({ interface: z.string(), rules: list(hostPolicyRuleSchema) }).strict()),
}).strict();
const defaultInteger = (fallback: number) => integer.default(fallback).transform(value => value === 0 ? fallback : value);
export const gatewayMonitorSchema = z.object({
  name: z.string(), enabled: z.boolean(), interface: z.string(),
  source_address: z.string(), gateway: z.string(), target: z.string(), routing_table: integer,
  probe_interval_ms: defaultInteger(1000), loss_timeout_ms: defaultInteger(2000), window_ms: defaultInteger(30000),
  latency_threshold_ms: defaultInteger(150), loss_threshold_percent: defaultInteger(20),
  rtt_variation_threshold_ms: integer.default(0), failure_hold_ms: defaultInteger(3000), recovery_hold_ms: defaultInteger(5000),
}).strict();
export const ntpSchema = z.object({
  enabled: z.boolean().default(false), servers: list(z.string()).default([]),
}).strict().default({ enabled: false, servers: [] });
export const syslogServerSchema = z.object({
  host: z.string(), port: integer, transport: z.enum(["udp", "tcp", "tls"]),
}).strict();
export const syslogSchema = z.object({
  enabled: z.boolean().default(false), servers: list(syslogServerSchema).default([]),
}).strict().default({ enabled: false, servers: [] });
export const vnstatSchema = z.object({ enabled: z.boolean().default(false) }).strict().default({ enabled: false });
export const configSchema = z.object({
  interfaces: list(interfaceSchema), routes: list(routeSchema), policy_rules: list(policySchema),
  firewall: z.object({
    allow_all_icmp: z.boolean().nullish().transform(value => value ?? true),
    policy: z.enum(["accept", "drop"]), rules: list(filterSchema),
    nat: z.object({ masquerade: list(masqueradeSchema) }).strict(),
    policies: firewallPoliciesSchema.nullable().optional(),
  }).strict(),
  softflowd: list(softflowdSchema),
  gateway_monitors: list(gatewayMonitorSchema).default([]),
  ntp: ntpSchema, syslog: syslogSchema, vnstat: vnstatSchema,
  // The backend added kernel settings after FRONTEND_SPEC; preserve, but do not edit them.
  kernel: kernelSchema.optional(),
}).strict();
export const transactionSchema = z.object({
  id: z.string(), actor: z.string(), status: z.string(),
  base_revision: revisionSchema, candidate: configSchema, previous: configSchema,
  confirmation_deadline: timestamp, error: optionalText, description: optionalText,
  submitted_at: timestamp.nullable(), committed_at: timestamp.nullable(),
  committed_by: optionalText, restored_from_revision: revisionSchema.optional(),
  kernel_before: kernelSchema.optional(), kernel_after: kernelSchema.optional(),
}).strict();
export const transactionsSchema = z.record(transactionSchema).nullable().transform(value => value ?? {}).superRefine((value, context) => {
  for (const [key, transaction] of Object.entries(value)) {
    if (key !== transaction.id) context.addIssue({ code: z.ZodIssueCode.custom, path: [key, "id"], message: "Transaction map key does not match ID" });
  }
});
export const stateSchema = z.object({
  revision: revisionSchema, desired: configSchema, observed: z.unknown(),
  drift: z.boolean(), active_transaction: transactionSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.observed === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ["observed"], message: "Observed diagnostics must be present" });
});
export const parentSchema = z.object({
  name: z.string(), kind: z.string(), index: integer, mac: z.string(),
  mtu: integer, up: z.boolean(), available: z.boolean(), error: optionalText,
});
export const serviceStatusSchema = z.object({
  name: z.string(), state: z.string(), pid: integer.optional(),
  started_at: timestamp.nullable().optional(), error: optionalText,
});
export const dhcpRelayStatusSchema = z.object({
  interface: z.string(), state: z.string(), pid: integer.optional(),
  started_at: timestamp.nullable().optional(), error: optionalText,
});
export const dhcpRelayStatusPageSchema = z.object({
  interfaces: list(dhcpRelayStatusSchema), error: optionalText,
});
const metric = z.number().finite().nonnegative().nullable();
export const gatewayStatisticsSchema = z.object({
  name: z.string(), process_state: z.string(), sample_status: z.string(), health: z.string(),
  started_at: timestamp.nullable(), collected_at: timestamp.nullable(),
  health_changed_at: timestamp.nullable(), last_success_at: timestamp.nullable(),
  sent: integer.nonnegative(), received: integer.nonnegative(), lost: integer.nonnegative(),
  pending: integer.nonnegative(), variation_pairs: integer.nonnegative(),
  loss_percent: z.number().finite().min(0).max(100).nullable(),
  rtt_min_ms: metric, rtt_max_ms: metric, rtt_avg_ms: metric, rtt_stddev_ms: metric,
  rtt_p50_ms: metric, rtt_p95_ms: metric, rtt_variation_ms: metric, error: optionalText,
});
const sampleSchema = z.object({
  scope: z.string(), started_at: timestamp, collected_at: timestamp, status: z.string(),
});
export const gatewayStatisticsPageSchema = z.object({ sample: sampleSchema, monitors: list(gatewayStatisticsSchema) });
export const gatewayStatisticsDetailSchema = z.object({ sample: sampleSchema, monitor: gatewayStatisticsSchema });
export const gatewayStatusPageSchema = z.object({ monitors: list(gatewayStatisticsSchema), error: optionalText });
export const applianceStatusSchema = z.object({
  name: z.string(), scope: z.enum(["host", "managed"]), state: z.string(),
  pid: integer.optional(), started_at: timestamp.nullable().optional(),
  database_directory: optionalText, error: optionalText,
});
export const applianceStatusPageSchema = z.object({ instances: list(applianceStatusSchema), error: optionalText });
export const runtimeSchema = z.object({
  parent_interfaces: list(parentSchema), softflowd: list(serviceStatusSchema), error: optionalText,
  dhcp_relay: list(dhcpRelayStatusSchema),
  gateway_monitors: list(gatewayStatisticsSchema), appliance_services: list(applianceStatusSchema),
});
const metadata = {
  revision: revisionSchema, current: z.boolean(), transaction_id: optionalText,
  submitted_at: timestamp.nullable(), committed_at: timestamp.nullable(),
  submitted_by: optionalText, committed_by: optionalText, description: optionalText,
  restored_from_revision: revisionSchema.optional(),
};
export const revisionMetadataSchema = z.object(metadata);
export const revisionDetailSchema = z.object({ ...metadata, config: configSchema });
export const revisionPageSchema = z.object({
  revisions: list(revisionMetadataSchema), next_before_revision: revisionSchema.optional(),
});
const decimal = z.string().regex(/^-?\d+$/);
export const statisticsSchema = z.object({
  sample: sampleSchema,
  gateways: list(gatewayStatisticsSchema).optional(),
  interfaces: list(z.object({
    name: z.string(), index: integer.optional(), kind: z.string(), ownership: z.string(),
    mtu: integer, admin_up: z.boolean(), oper_state: z.string(), mac: optionalText,
    status: z.string(), counter_bits: z.union([z.literal(32), z.literal(64)]).optional(),
    counters: z.record(decimal).nullable(), error: optionalText,
  })),
  protocols: list(z.object({
    name: z.string(), status: z.string(), groups: z.record(z.record(decimal)).nullable(), error: optionalText,
  })),
});
export type Config = z.infer<typeof configSchema>;
export type ManagedInterface = z.infer<typeof interfaceSchema>;
export type Route = z.infer<typeof routeSchema>;
export type PolicyRule = z.infer<typeof policySchema>;
export type FilterRule = z.infer<typeof filterSchema>;
export type MasqueradeRule = z.infer<typeof masqueradeSchema>;
export type SoftflowdConfig = z.infer<typeof softflowdSchema>;
export type Peer = z.infer<typeof peerSchema>;
export type Transaction = z.infer<typeof transactionSchema>;
export type StateView = z.infer<typeof stateSchema>;
export type RuntimeState = z.infer<typeof runtimeSchema>;
export type DHCPRelayStatus = z.infer<typeof dhcpRelayStatusSchema>;
export type ParentInterface = z.infer<typeof parentSchema>;
export type Revision = z.infer<typeof revisionDetailSchema>;
export type RevisionMetadata = z.infer<typeof revisionMetadataSchema>;
export type Statistics = z.infer<typeof statisticsSchema>;
export type GatewayMonitor = z.infer<typeof gatewayMonitorSchema>;
export type GatewayStatistics = z.infer<typeof gatewayStatisticsSchema>;
export type GatewayStatisticsPage = z.infer<typeof gatewayStatisticsPageSchema>;
export type ApplianceService = "ntp" | "syslog" | "vnstat";
export type RepairService = "softflowd" | "dhcp-relay" | "gateway-monitoring" | ApplianceService;
export interface PackageRequest {
  base_revision: string;
  confirm_timeout_seconds: number;
  config: Config;
  description?: string;
}
export const knownStatuses = ["applying", "pending_confirmation", "committed", "rolling_back", "rolled_back", "recovery_failed"];
export const terminal = (transaction: Transaction): boolean =>
  transaction.status === "committed" || transaction.status === "rolled_back";
