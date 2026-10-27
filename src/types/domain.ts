import { z } from "zod";

const list = <T extends z.ZodTypeAny>(schema: T) =>
  z.array(schema).nullable().transform((value) => value ?? []);
const integer = z.number().int().safe();
export const revisionSchema = z.string().regex(/^(0|[1-9]\d*)$/)
  .refine((value) => /^(0|[1-9]\d*)$/.test(value) && BigInt(value) <= 18446744073709551615n, "Revision exceeds uint64");
const timestamp = z.string().datetime({ offset: true });
const optionalText = z.string().optional();
const stringMap = z.record(z.string()).nullable().transform((value) => value ?? {});
export const objectMetadataSchema = z.object({
  display_name: z.string().default("").refine(value => [...value].length <= 128 && !/[\p{Cc}\uD800-\uDFFF]/u.test(value) && (value === "" || /[^\p{White_Space}]/u.test(value)), "Display name must be empty or 1..128 Unicode characters without controls or whitespace-only text"),
  description: z.string().default("").refine(value => [...value].length <= 2048 && !/[\p{Cc}\uD800-\uDFFF]/u.test(value.replace(/[\n\t]/g, "")), "Description must contain at most 2048 Unicode characters; only newline and tab controls are allowed"),
}).strict().transform(value => value.display_name || value.description ? value : undefined);
const annotation = { metadata: objectMetadataSchema.optional() };
export const kernelSchema = z.object({ namespace: stringMap, host: stringMap }).strict();
export const peerSchema = z.object({
  ...annotation,
  public_key: z.string(), endpoint: optionalText, allowed_ips: list(z.string()),
  enabled: z.boolean().optional(),
  persistent_keepalive_seconds: integer,
}).strict();
export const dhcpRelaySchema = z.object({
  ...annotation,
  enabled: z.boolean().default(false), servers: list(z.string()).default([]),
}).strict().default({ enabled: false, servers: [] });
const interfaceFields = {
  ...annotation,
  name: z.string(), role: z.enum(["wan", "lan", "unassigned"]), mtu: integer, up: z.boolean(), addresses: list(z.string()),
  dhcp_relay: dhcpRelaySchema,
};
export const interfaceSchema = z.discriminatedUnion("kind", [
  z.object({ ...interfaceFields, kind: z.literal("ethernet") }).strict(),
  z.object({ ...interfaceFields, kind: z.literal("dummy") }).strict(),
  z.object({ ...interfaceFields, kind: z.literal("vlan"),
    vlan: z.object({ parent: z.string(), id: integer }).strict() }).strict(),
  z.object({ ...interfaceFields, kind: z.literal("wireguard"),
    wireguard: z.object({ key_ref: z.string(), listen_port: integer, peers: list(peerSchema) }).strict() }).strict(),
]);
export const discoveredInterfacesSchema = z.array(z.object({
  name: z.string(), kind: z.string(), index: integer.nullable(), mac: z.string().nullable(),
  mtu: integer, up: z.boolean(), addresses: z.array(z.string()), ownership: z.enum(["managed", "unmanaged", "loopback"]),
}));
export type DiscoveredInterface = z.infer<typeof discoveredInterfacesSchema>[number];
export const dhcpRetrySchema = z.object({ interface: z.string(), status: z.literal("retrying") }).strict();
export const routeSchema = z.object({
  ...annotation,
  enabled: z.boolean().default(true),
  destination: z.string(), gateway: optionalText, interface: z.string(), table: integer, metric: integer,
}).strict();
export const filterSchema = z.object({
  ...annotation,
  source: optionalText, destination: optionalText, action: z.enum(["accept", "drop"]),
}).strict();
export const masqueradeSchema = z.object({
  ...annotation,
  family: z.enum(["ipv4", "ipv6"]), source: optionalText, out_interface: z.string(),
}).strict();
export const timeoutNames = ["general", "tcp", "tcp.rst", "tcp.fin", "udp", "icmp", "maxlife", "expint"] as const;
export const softflowdSchema = z.object({
  ...annotation,
  name: z.string(), enabled: z.boolean(), interface: z.string(), collector: z.string(),
  export_version: z.union([z.literal(1), z.literal(5), z.literal(9), z.literal(10)]),
  sampling_rate: integer, max_flows: integer, snaplen: integer, promiscuous: z.boolean(),
  capture_filter: optionalText,
  timeouts: z.record(z.enum(timeoutNames), integer).nullable().transform((value) => value ?? {}),
}).strict();
const hostPolicyRuleSchema = z.object({
  ...annotation,
  out_interface: optionalText,
  destination_host: optionalText, destination: optionalText, protocol: z.enum(["", "tcp", "udp"]).optional(),
  destination_ports: list(integer).optional(), action: z.enum(["accept", "drop"]),
}).strict();
export const inputFirewallSchema = z.object({
  policy: z.enum(["accept", "drop"]),
  interfaces: z.array(z.object({
    ...annotation,
    interface: z.string(),
    rules: z.array(z.object({
      ...annotation,
      destination: z.string().optional(), protocol: z.enum(["", "tcp", "udp"]).optional(),
      destination_ports: z.array(integer).optional(), action: z.enum(["accept", "drop"]),
      out_interface: z.literal("").optional(), destination_host: z.literal("").optional(),
    }).strict()).default([]),
  }).strict()).default([]),
}).strict();
export const firewallPoliciesSchema = z.object({
  hosts: list(z.object({
    ...annotation,
    id: z.string(), name: z.string(), addresses: list(z.string()), policy: z.enum(["accept", "drop"]),
    rules: list(hostPolicyRuleSchema),
  }).strict()),
  interfaces: list(z.object({ ...annotation, interface: z.string(), rules: list(hostPolicyRuleSchema) }).strict()),
}).strict();
const defaultInteger = (fallback: number) => integer.default(fallback).transform(value => value === 0 ? fallback : value);
const gatewayMonitorSettings = {
  ...annotation,
  name: z.string(), enabled: z.boolean(), interface: z.string(), target: z.string(),
  probe_interval_ms: defaultInteger(1000), loss_timeout_ms: defaultInteger(2000), window_ms: defaultInteger(30000),
  latency_threshold_ms: defaultInteger(150), loss_threshold_percent: defaultInteger(20),
  rtt_variation_threshold_ms: integer.default(0), failure_hold_ms: defaultInteger(3000), recovery_hold_ms: defaultInteger(5000),
};
const explicitGatewayMonitorSchema = z.object({
  ...gatewayMonitorSettings, mode: z.literal("explicit").optional(),
  source_address: z.string(), gateway: z.string(), routing_table: integer,
}).strict().transform(value => { const result = { ...value }; delete result.mode; return result; });
const dhcpGatewayMonitorSchema = z.object({
  ...gatewayMonitorSettings, mode: z.literal("dhcp"),
  source_address: z.literal("").optional(), gateway: z.literal("").optional(), routing_table: z.literal(0).optional(),
}).strict().transform(value => {
  const result = { ...value }; delete result.source_address; delete result.gateway; delete result.routing_table; return result;
});
export const gatewayMonitorSchema = z.union([explicitGatewayMonitorSchema, dhcpGatewayMonitorSchema]);
export const ntpSchema = z.object({
  ...annotation,
  enabled: z.boolean().default(false), servers: list(z.string()).default([]),
}).strict().default({ enabled: false, servers: [] });
export const syslogServerSchema = z.object({
  ...annotation,
  host: z.string(), port: integer, transport: z.enum(["udp", "tcp", "tls"]),
}).strict();
export const syslogSchema = z.object({
  ...annotation,
  enabled: z.boolean().default(false), servers: list(syslogServerSchema).default([]),
}).strict().default({ enabled: false, servers: [] });
export const vnstatSchema = z.object({ ...annotation, enabled: z.boolean().default(false) }).strict().default({ enabled: false });
export const mdnsSchema = z.object({
  ...annotation,
  enabled: z.boolean().default(false),
  interface_mode: z.enum(["allow", "deny"]).default("allow"),
  interfaces: z.array(z.string()).default([]),
  ipv4: z.boolean().default(true), ipv6: z.boolean().default(true),
  reflection: z.object({
    enabled: z.boolean().default(false), filters: z.array(z.string()).default([]),
  }).strict().default({}),
  publishing: z.object({
    enabled: z.boolean().default(false), hostname: z.string().default(""), domain: z.string().default("local."),
    addresses: z.boolean().default(false), hinfo: z.boolean().default(false),
    workstation: z.boolean().default(false), browse_domain: z.boolean().default(false),
    aaaa_on_ipv4: z.boolean().default(false), a_on_ipv6: z.boolean().default(false),
  }).strict().default({}),
}).strict();
export type MDNSConfig = z.infer<typeof mdnsSchema>;
export const dhcpClientSchema = z.object({
  ...annotation,
  client_id: z.string().default(""), hostname: z.string().default(""),
  route_metric: integer.min(0).max(4294967295).default(0), use_mtu: z.boolean().default(false),
  use_domains: z.enum(["no", "route", "yes"]).default("no"),
}).strict();
export const dnsConfigSchema = z.object({
  ...annotation,
  override_dhcp_dns: z.boolean().optional(),
  servers: z.array(z.string()).default([]),
  domains: z.array(z.object({ ...annotation, name: z.string(), route_only: z.boolean() }).strict()).default([]),
}).strict();
export const mqttSchema = z.object({
  enabled: z.boolean().default(false), endpoint: z.string().default(""), username: z.string().default(""),
  password_ref: z.string().regex(/^(?:[a-f0-9]{32})?$/).default(""),
  source_interface: z.string().default(""), interval_seconds: integer.default(60),
}).strict();
export type MqttConfig = z.infer<typeof mqttSchema>;
export const mqttPasswordReferenceSchema = z.object({ password_ref: z.string().regex(/^[a-f0-9]{32}$/) }).strict();
export const mqttStatusSchema = z.object({
  device_id: z.string(), enabled: z.boolean(),
  state: z.string(),
  error: z.string().nullable(), last_published_at_unix: integer.nonnegative().nullable(),
}).strict();
export const dynamicDnsSchema = z.object({
  ...annotation,
  name: z.string(), enabled: z.boolean(), source_interface: z.string(), address_source: z.enum(["interface", "public_ip"]),
  tenant_id: z.string(), client_id: z.string(), secret_ref: z.string().regex(/^[a-f0-9]{32}$/),
  zone_resource_id: z.string(), record_name: z.string(), ttl_seconds: integer, interval_seconds: integer,
}).strict();
export type DynamicDnsEntry = z.infer<typeof dynamicDnsSchema>;
export const blackholeSchema = z.object({
  ...annotation,
  name: z.string().default(""), action: z.enum(["blackhole", "unreachable", "prohibit"]).default("blackhole"),
}).strict();
export type BlackholeConfig = z.infer<typeof blackholeSchema>;
export const systemSchema = z.object({ hostname: z.string().default(""), domain: z.string().default(""), timezone: z.string().default("") }).strict();
export type SystemConfig = z.infer<typeof systemSchema>;
export const timezonesSchema = z.object({ timezones: z.array(z.string()) }).strict();
export const dynamicDnsSecretReferenceSchema = z.object({ secret_ref: z.string().regex(/^[a-f0-9]{32}$/) }).strict();
export const dynamicDnsStatusSchema = z.object({
  entries: list(z.object({
    name: z.string(),
    state: z.string(),
    address: z.string().nullable(), last_checked_at_unix: integer.nonnegative().nullable(),
    last_updated_at_unix: integer.nonnegative().nullable(), error: z.string().nullable(),
  }).strict()),
}).strict();
export const configSchema = z.object({
  ipv6_enabled: z.boolean().optional(),
  interfaces: list(interfaceSchema), routes: list(routeSchema),
  firewall: z.object({
    allow_all_icmp: z.boolean().default(true),
    policy: z.enum(["accept", "drop"]), rules: list(filterSchema),
    nat: z.object({ masquerade: list(masqueradeSchema) }).strict(),
    policies: firewallPoliciesSchema.nullable().optional(),
    input: inputFirewallSchema.nullable().optional(),
  }).strict(),
  softflowd: list(softflowdSchema),
  gateway_monitors: list(gatewayMonitorSchema).default([]),
  ntp: ntpSchema, syslog: syslogSchema, vnstat: vnstatSchema,
  mdns: mdnsSchema.optional(),
  mqtt: mqttSchema.optional(),
  dynamic_dns: list(dynamicDnsSchema).optional(),
  blackhole: blackholeSchema.optional(),
  system: systemSchema.optional(),
  dhcp_clients: z.record(dhcpClientSchema).optional(), dns: z.record(dnsConfigSchema).optional(),
  // The backend added kernel settings after FRONTEND_SPEC; preserve, but do not edit them.
  kernel: kernelSchema.optional(),
  // Retired public field: present at all (even [] or null) is incompatible.
  policy_rules: z.never().optional(),
}).passthrough(); // Unknown top-level sections pass through drafts unchanged so a newer backend keeps them.
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
export const stateSchema: z.ZodType<StateView, z.ZodTypeDef, unknown> = z.object({
  revision: revisionSchema, desired: configSchema, observed: z.unknown(),
  drift: z.boolean().catch(false), active_transaction: transactionSchema.optional().catch(undefined),
}).passthrough();
export const parentSchema = z.object({
  name: z.string(), kind: optionalText, index: integer.optional(), mac: optionalText,
  mtu: integer.optional(), up: z.boolean().optional(), available: z.boolean(), error: optionalText,
}).superRefine((value, context) => {
  if (value.available) {
    for (const field of ["kind", "index", "mac", "mtu", "up"] as const) {
      if (value[field] === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: "Required for an available parent" });
    }
  }
});
export const serviceStatusSchema = z.object({
  name: z.string(), state: z.string(), pid: integer.optional(),
  started_at: timestamp.nullable().optional(), error: optionalText,
  dropped_packets: z.string().regex(/^(0|[1-9]\d*)$/).optional(),
  statistics_complete: z.boolean().optional(),
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
  mode: z.enum(["explicit", "dhcp"]).optional(), interface: z.string().optional(),
  resolved_source_address: z.string().nullable().optional(), resolved_gateway: z.string().nullable().optional(),
  resolved_routing_table: integer.nullable().optional(), reason: z.string().nullable().optional(),
  started_at: timestamp.nullable(), collected_at: timestamp.nullable(),
  health_changed_at: timestamp.nullable(), last_success_at: timestamp.nullable(),
  sent: integer.nonnegative(), received: integer.nonnegative(), lost: integer.nonnegative(),
  pending: integer.nonnegative(), variation_pairs: integer.nonnegative(),
  loss_percent: z.number().finite().min(0).max(100).nullable(),
  rtt_min_ms: metric, rtt_max_ms: metric, rtt_avg_ms: metric, rtt_stddev_ms: metric,
  rtt_p50_ms: metric, rtt_p95_ms: metric, rtt_variation_ms: metric, error: optionalText,
});
const sampleSchema = z.object({
  scope: z.string(), started_at: timestamp.nullable(), collected_at: timestamp, status: z.string(),
});
export const gatewayStatisticsPageSchema = z.object({ sample: sampleSchema, monitors: list(gatewayStatisticsSchema) });
export const gatewayStatisticsDetailSchema = z.object({ sample: sampleSchema, monitor: gatewayStatisticsSchema });
export const gatewayStatusPageSchema = z.object({ monitors: list(gatewayStatisticsSchema), error: optionalText });
export const applianceStatusSchema = z.object({
  name: z.string(), scope: z.enum(["host", "managed"]), state: z.string(),
  pid: integer.optional(), started_at: timestamp.nullable().optional(),
  database_directory: optionalText, error: optionalText,
  sample_status: optionalText, server: z.string().nullable().optional(),
  offset_ms: z.number().finite().nullable().optional(), delay_ms: z.number().finite().nullable().optional(),
  requested_slew_ms: z.number().finite().nullable().optional(),
  uncorrected_offset_ms: z.number().finite().nullable().optional(),
  discipline: optionalText, collected_at: timestamp.nullable().optional(),
});
export const applianceStatusPageSchema = z.object({ instances: list(applianceStatusSchema), error: optionalText });
export const mdnsCounterNames = [
  "received_packets", "transmitted_packets", "received_bytes", "transmitted_bytes",
  "malformed_packets", "hop_limit_drops", "policy_drops", "duplicate_drops", "rate_limit_drops",
  "queue_drops", "oversize_drops", "unsupported_record_drops", "send_errors",
] as const;
const decimalCounter = z.string().regex(/^(0|[1-9]\d*)$/);
export const mdnsStatusSchema = z.object({
  name: z.literal("mdns"), scope: z.literal("managed"), enabled: z.boolean(),
  state: z.enum(["disabled", "simulated", "running", "stopped", "error"]),
  started_at: timestamp.nullable(), collected_at: timestamp.nullable(), error: z.string().nullable(),
  effective_interfaces: z.array(z.string()), effective_families: z.array(z.enum(["ipv4", "ipv6"])),
  reflection_enabled: z.boolean(), publishing_enabled: z.boolean(),
  received_packets: decimalCounter, transmitted_packets: decimalCounter,
  received_bytes: decimalCounter, transmitted_bytes: decimalCounter,
  malformed_packets: decimalCounter, hop_limit_drops: decimalCounter,
  policy_drops: decimalCounter, duplicate_drops: decimalCounter, rate_limit_drops: decimalCounter,
  queue_drops: decimalCounter, oversize_drops: decimalCounter, unsupported_record_drops: decimalCounter,
  send_errors: decimalCounter, receive_drops: decimalCounter.nullable(),
  statistics_complete: z.boolean(), warnings: z.array(z.string()), limits: z.record(integer.nonnegative()),
});
export type MDNSStatus = z.infer<typeof mdnsStatusSchema>;
export type ApplianceStatus = z.infer<typeof applianceStatusSchema>;
export const mdnsStatusPageSchema = z.object({ instances: z.array(mdnsStatusSchema).length(1), error: z.string() });
const runtimeApplianceStatusSchema = z.union([
  mdnsStatusSchema,
  applianceStatusSchema.refine(value => value.name !== "mdns", "Invalid mDNS status"),
]);
export const isApplianceStatus = (value: z.infer<typeof runtimeApplianceStatusSchema>): value is ApplianceStatus => value.name !== "mdns";
export const runtimeSchema = z.preprocess(value => {
  if (value && typeof value === "object" && !Array.isArray(value) &&
      !("parent_interfaces" in value) && "parents" in value) {
    return { ...value, parent_interfaces: value.parents };
  }
  return value;
}, z.object({
  capabilities: z.object({
    gateway_monitor_modes: z.array(z.string()).optional(),
    dhcp_gateway_monitor_address_families: z.array(z.string()).optional(),
  }).optional(),
  parent_interfaces: list(parentSchema), softflowd: list(serviceStatusSchema), error: optionalText,
  dhcp_relay: list(dhcpRelayStatusSchema),
  gateway_monitors: list(gatewayStatisticsSchema), appliance_services: list(runtimeApplianceStatusSchema),
  wireguard: list(z.object({
    interface: z.string(), public_key: z.string().nullable(), listen_port: integer.nullable(),
    peers: list(z.object({
      public_key: z.string(), endpoint: z.string().nullable(),
      rx_bytes: z.string().regex(/^(0|[1-9]\d*)$/), tx_bytes: z.string().regex(/^(0|[1-9]\d*)$/),
      last_handshake_unix_seconds: integer.nonnegative().nullable(),
    }).strict()),
  }).strict()).optional(),
  ipv6: z.object({
    enabled: z.boolean(), status: z.enum(["measured", "simulated"]),
    disable_ipv6: z.record(z.enum(["0", "1"])).nullable(), drift: z.boolean().nullable(),
  }).strict().optional(),
  dhcp_clients: z.object({
    leases: z.record(z.object({
      client: dhcpClientSchema, address: z.string(), server: z.string(),
      acquired_at: z.number().finite().nonnegative(), lifetime: z.number().finite().nonnegative(),
      renewal: z.number().finite().nonnegative(), rebinding: z.number().finite().nonnegative(),
      routes: z.array(routeSchema), dns: z.array(z.string()), domain: z.string(),
      mtu: integer.min(1280).max(65535).nullable(),
    })), errors: z.record(z.string()),
  }).optional(),
}));
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
export type FilterRule = z.infer<typeof filterSchema>;
export type MasqueradeRule = z.infer<typeof masqueradeSchema>;
export type SoftflowdConfig = z.infer<typeof softflowdSchema>;
export type Peer = z.infer<typeof peerSchema>;
export type Transaction = z.infer<typeof transactionSchema>;
export interface StateView {
  revision: string;
  desired: Config;
  observed?: unknown;
  drift: boolean;
  active_transaction?: Transaction;
}
export type RuntimeState = z.infer<typeof runtimeSchema>;
export type DHCPRelayStatus = z.infer<typeof dhcpRelayStatusSchema>;
export type ParentInterface = z.infer<typeof parentSchema>;
export type Revision = z.infer<typeof revisionDetailSchema>;
export type RevisionMetadata = z.infer<typeof revisionMetadataSchema>;
export type Statistics = z.infer<typeof statisticsSchema>;
export type GatewayMonitor = z.infer<typeof gatewayMonitorSchema>;
export type ExplicitGatewayMonitor = z.infer<typeof explicitGatewayMonitorSchema>;
export type GatewayStatistics = z.infer<typeof gatewayStatisticsSchema>;
export type GatewayStatisticsPage = z.infer<typeof gatewayStatisticsPageSchema>;
const connectionCount = z.number().int().nonnegative();
const connectionPort = connectionCount.max(65535).nullable();
const connectionTupleSchema = z.object({
  source: z.string(), destination: z.string(), source_port: connectionPort, destination_port: connectionPort,
  icmp_id: connectionPort, icmp_type: connectionCount.max(255).nullable(), icmp_code: connectionCount.max(255).nullable(), zone: connectionPort,
}).strict();
const connectionCountersSchema = z.object({ packets: z.string().regex(/^(0|[1-9]\d*)$/), bytes: z.string().regex(/^(0|[1-9]\d*)$/) }).strict().nullable();
export const connectionsPageSchema = z.object({
  schema: z.literal("netcontrol-connections/v1"),
  sample: z.object({ scope: z.string(), started_at: timestamp, collected_at: timestamp, status: z.enum(["available", "partial", "simulated"]) }).strict(),
  summary: z.object({ total: connectionCount.nullable(), matched: connectionCount.nullable(), returned: connectionCount, accounting_unavailable: connectionCount.nullable() }).strict(),
  limit: connectionCount.min(1).max(1000), offset: connectionCount.max(1000000), next_offset: connectionCount.max(1000000).nullable(),
  connections: z.array(z.object({
    id: z.string().regex(/^(0|[1-9]\d*)$/).nullable(), zone: connectionCount.max(65535), family: z.enum(["ipv4", "ipv6"]),
    protocol: connectionCount.max(255), protocol_name: z.enum(["tcp", "udp", "icmp", "icmpv6", "sctp", "other"]),
    state: z.string(), tcp_state: connectionCount.max(255).nullable(), status: connectionCount.max(4294967295),
    seen_reply: z.boolean(), assured: z.boolean(), source_nat: z.boolean(), destination_nat: z.boolean(), mark: connectionCount.max(4294967295),
    timeout_seconds: connectionCount.nullable(), original: connectionTupleSchema, reply: connectionTupleSchema,
    original_counters: connectionCountersSchema, reply_counters: connectionCountersSchema,
  }).strict()),
}).strict();
export type ConnectionsPage = z.infer<typeof connectionsPageSchema>;
export type Connection = ConnectionsPage["connections"][number];
export const connectionDeletionSchema = z.object({ status: z.enum(["deleted", "flushed"]), scope: z.string() }).strict();
export const upgradeVersionSchema = z.string().max(80).regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?$/, "Use a version such as 1.2.3 or 1.2.3-rc.1, without v or build metadata");
export const upgradeJobSchema = z.object({
  id: z.string(), version: z.string(), status: z.string(), created_at: timestamp, updated_at: timestamp,
  error: z.string().nullable(), last_successful_version: z.string().nullable(),
}).strict();
export const upgradeStatusSchema = z.object({
  enabled: z.boolean(), repository: z.string().nullable(), job: upgradeJobSchema.nullable(), last_successful_version: z.string().nullable(),
}).strict();
export type UpgradeJob = z.infer<typeof upgradeJobSchema>;
export type UpgradeStatus = z.infer<typeof upgradeStatusSchema>;
export type ApplianceService = "ntp" | "syslog" | "vnstat";
export type RepairService = "softflowd" | "dhcp-relay" | "gateway-monitoring" | "mdns" | ApplianceService;
export interface PackageRequest {
  base_revision: string;
  confirm_timeout_seconds: number;
  config: Config;
  description?: string;
}
export const knownStatuses = ["applying", "pending_confirmation", "committed", "rolling_back", "rolled_back", "recovery_failed"];
export const terminal = (transaction: Transaction): boolean =>
  transaction.status === "committed" || transaction.status === "rolled_back";
