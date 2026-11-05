import { z } from "zod";
import ipaddr from "ipaddr.js";
import type { DiscoveredInterface } from "@/types/domain";

const integer = z.number().int().safe().nonnegative();
const metric = z.number().finite().nonnegative();
const mtu = z.number().int().min(1280).max(65535);
const interfaceName = z.string().regex(/^[a-zA-Z0-9_.-]{1,15}$/, "Select a live interface");
export const pathAddressSchema = z.string().ip().refine(value => {
  if (!ipaddr.isValid(value)) return false;
  const address = ipaddr.parse(value);
  return !["unspecified", "multicast", "loopback", "broadcast"].includes(address.range()) &&
    !(address.kind() === "ipv6" && address.range() === "linkLocal");
}, "Use a unicast IP literal; IPv6 link-local addresses are not supported");
export function pathAddresses(link: DiscoveredInterface): string[] {
  return [...new Set(link.addresses.map(value => value.split("/")[0]!)
    .filter(value => pathAddressSchema.safeParse(value).success))];
}
export function samePathAddress(first: string, second: string): boolean {
  return ipaddr.parse(first).toNormalizedString() === ipaddr.parse(second).toNormalizedString();
}
export const pathTestRequestSchema = z.object({
  interface: interfaceName, source_address: pathAddressSchema, peer_address: pathAddressSchema,
  port: z.number().int().min(1024).max(65535).default(49872),
  maximum_mtu: mtu,
  parents: z.array(z.object({ interface: interfaceName, maximum_mtu: mtu }).strict()).max(8).default([]),
  pairing_secret: z.string().min(32).max(128).regex(/^[!-~]+$/, "Use 32..128 non-space printable ASCII characters"),
}).strict().superRefine((value, context) => {
  if (pathAddressSchema.safeParse(value.source_address).success && pathAddressSchema.safeParse(value.peer_address).success &&
      (ipaddr.parse(value.source_address).kind() !== ipaddr.parse(value.peer_address).kind() ||
      samePathAddress(value.source_address, value.peer_address))) {
    context.addIssue({ code: "custom", path: ["peer_address"], message: "Use a distinct peer IP of the same address family" });
  }
  const names = new Set([value.interface]);
  value.parents.forEach((parent, index) => {
    if (names.has(parent.interface)) context.addIssue({ code: "custom", path: ["parents", index], message: "Approve each ancestor only once; do not repeat the selected interface" });
    names.add(parent.interface);
  });
});
export type PathTestRequest = z.infer<typeof pathTestRequestSchema>;
export function validatePathInterfaces(input: PathTestRequest, links: DiscoveredInterface[]): void {
  const selected = links.find(link => link.name === input.interface);
  if (!selected || !pathAddresses(selected).some(address => samePathAddress(address, input.source_address))) {
    throw new Error("The source address is no longer assigned to the selected live interface. Refresh interfaces.");
  }
  for (const target of [{ interface: input.interface, maximum_mtu: input.maximum_mtu }, ...input.parents]) {
    const live = links.find(link => link.name === target.interface);
    if (!live || target.maximum_mtu < live.mtu) throw new Error(`${target.interface}: the maximum must not be below its current live MTU. Refresh interfaces.`);
  }
}
export function generatePairingSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
}
const udpSizeSchema = z.object({
  ip_size_bytes: integer, delivered: integer,
  attempted: integer.nullable(), sent: integer.nullable(), ack_timeouts: integer.nullable(),
  emsgsize: integer.nullable(), send_errors: integer.nullable(),
  loss_fraction: z.number().finite().min(0).max(1).nullable(), mean_rtt_ms: metric.nullable(),
  status: z.enum(["verified", "local_or_route_limit", "unknown"]),
});
const udpDirectionSchema = z.object({
  largest_verified_ip_size_bytes: integer.nullable(), delivery_evidence: z.string(),
  rtt_origin: z.enum(["local", "peer"]), sizes: z.array(udpSizeSchema),
  peer_sender_report: z.object({ sizes: z.array(udpSizeSchema) }).nullable().optional(),
});
const outboundTrialSchema = z.object({
  trial: integer, requested_mss_bytes: integer, status: z.enum(["measured", "inconclusive"]),
  effective_mss_bytes: integer.nullable(), peer_effective_mss_bytes: integer.nullable(),
  delivered_bytes: integer.nullable(), retransmits: integer.nullable(),
  elapsed_ms: metric.nullable(), goodput_bits_per_second: metric.nullable(), kernel_rtt_ms: metric.nullable(),
  connect_ms: metric.nullable(), authentication_rtt_ms: metric.nullable(),
  delivery_evidence: z.string().nullable(), error: z.string().nullable(),
});
const inboundTrialSchema = z.object({
  trial: integer, requested_mss_bytes: integer, status: z.literal("received"),
  effective_mss_bytes: integer, delivered_bytes: integer, elapsed_ms: metric,
  goodput_bits_per_second: metric, kernel_rtt_ms: metric,
  retransmits: z.null(), sender_retransmits: integer.nullable(), sender_effective_mss_bytes: integer.nullable(),
  delivery_evidence: z.string(),
});
const udpSchema = z.object({
  outbound: udpDirectionSchema, inbound: udpDirectionSchema,
  receive_path_errors: z.record(integer),
});
export const pathTestResultSchema = z.object({
  schema: z.literal("netcontrol-path-test-v1"), status: z.literal("completed"),
  interface: z.string(), source_address: z.string(), peer_address: z.string(), port: integer,
  role: z.enum(["initiator", "responder"]), session_id: z.string(), elapsed_ms: metric,
  limitations: z.array(z.string()), peer_report_received: z.boolean(), local_report_acknowledged: z.boolean(),
  limits: z.object({
    requested_maximum_mtu_bytes: integer, interface_mtu_bytes: integer, initial_route_mtu_bytes: integer,
    local_cap_bytes: integer, peer_cap_bytes: integer, local_receive_cap_bytes: integer, peer_send_cap_bytes: integer,
    inbound_tested_cap_bytes: integer, tested_cap_bytes: integer, ip_udp_overhead_bytes: integer,
    final_cached_route_mtu_bytes: integer.nullable(), ipv6_minimum_mtu_bytes: z.literal(1280).nullable(),
    path_mtu_bytes: z.null(), maximum_probes_per_size: integer, candidate_limit: integer,
    measurement_limit_seconds: integer, arm_limit_seconds: integer, lifetime_limit_seconds: integer,
  }),
  udp: udpSchema,
  tcp: z.object({
    outbound_trials: z.array(outboundTrialSchema), inbound_trials: z.array(inboundTrialSchema),
    peer_sender_trials: z.array(outboundTrialSchema).nullable(),
    trial_byte_limit: z.literal(4194304), rate_limit_bytes_per_second: z.literal(8388608), mss_observation: z.string(),
  }),
  measured_candidates: z.object({
    largest_verified_outbound_ip_size_bytes: integer.nullable(),
    best_outbound_mss_trial: outboundTrialSchema.nullable(), automatic_configuration: z.literal(false),
  }),
});
const progressSchema = z.discriminatedUnion("phase", [
  z.object({ schema: z.literal("netcontrol-path-test-progress-v1"), phase: z.literal("armed"), arm_timeout_seconds: z.literal(30) }),
  z.object({
    schema: z.literal("netcontrol-path-test-progress-v1"), phase: z.literal("paired"),
    local_cap_bytes: integer, peer_cap_bytes: integer, peer_send_cap_bytes: integer,
    local_receive_cap_bytes: integer, tested_cap_bytes: integer,
  }),
  z.object({
    schema: z.literal("netcontrol-path-test-progress-v1"), phase: z.literal("udp_complete"),
    udp: z.object({ outbound: udpDirectionSchema, inbound: udpDirectionSchema }),
  }),
  z.object({ schema: z.literal("netcontrol-path-test-progress-v1"), phase: z.literal("completed") }),
]);
export const pathTestStatusSchema = z.object({
  schema: z.literal("netcontrol-path-test-status-v1"), id: z.string().regex(/^[0-9a-f]{32}$/).nullable(),
  state: z.enum(["idle", "preparing", "running", "restoring", "completed", "cancelled", "failed", "cleanup_failed", "interrupted"]),
  active: z.boolean(), error: z.string().nullable(),
  restoration: z.enum(["not_required", "pending", "restored", "kernel_reset"]),
  deadline_unix_ms: integer.max(8640000000000000).optional(), permit_lease_seconds: z.literal(90),
  mtu_restores_on_daemon_recovery: z.literal(true), conntrack_cleanup: z.literal("not_performed"),
  warnings: z.array(z.string()),
  mtu_changes: z.array(z.object({
    interface: z.string(), index: integer, kind: z.string(), address: z.array(integer.max(255)),
    parent: integer.nullable(), approved: z.boolean(), original_mtu: integer, maximum_mtu: integer,
    observed_mtu: integer.nullable(), identity_matches: z.boolean(), restored: z.boolean(),
  })),
  progress: progressSchema.nullable(), result: pathTestResultSchema.nullable(),
});
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- Keeps the large status type named in Pinia declarations.
export interface PathTestStatus extends z.infer<typeof pathTestStatusSchema> {}
