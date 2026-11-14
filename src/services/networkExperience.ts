import { z } from "zod";
import { ApiFailure, request } from "@/services/api";

const counter = z.string().regex(/^(0|[1-9]\d*)$/);
const metric = z.number().finite().nonnegative();
const timestamp = z.string().datetime({ offset: true });
const source = { status: z.enum(["available", "partial", "unavailable", "not_observed"]), error: z.string().nullable() };
const network = z.object({
  name: z.string(), index: z.number().int().nonnegative(), kind: z.string(),
  vlan_id: z.number().int().min(1).max(4094).nullable(),
}).nullable();
const host = z.object({
  ip_address: z.string().ip(), address_family: z.enum(["ipv4", "ipv6"]),
  configured_host_id: z.string(), configured_name: z.string(), currently_protected: z.boolean(),
  interface: network,
  metadata: z.object({
    host_name: z.string().nullable(), icon: z.string().nullable(), classification: z.string().nullable(),
    status: z.enum(["available", "stale", "unavailable"]), last_success_at: timestamp.nullable(), error: z.string().nullable(),
  }),
});
const timing = z.object({
  samples: counter, variation_pairs: counter, p50_ms: metric.nullable(), p95_ms: metric.nullable(),
  min_ms: metric.nullable(), max_ms: metric.nullable(), variation_mean_ms: metric.nullable(),
});
export const experienceSampleSchema = z.object({
  ip_address: z.string().ip(), configured_host_id: z.string(), configured_name: z.string(),
  configuration_revision: z.string(), observation_epoch: z.string(), start_at: timestamp, end_at: timestamp,
  measured_duration_ms: metric, interface: network, last_seen_at: timestamp.nullable(),
  activity: z.enum(["active", "idle", "not_recently_seen", "unknown"]),
  traffic: z.object({
    ...source, sent_packets: counter.nullable(), received_packets: counter.nullable(),
    sent_bytes: counter.nullable(), received_bytes: counter.nullable(),
    sent_bps: metric.nullable(), received_bps: metric.nullable(), packet_unit: z.string(), byte_unit: z.string(),
  }),
  firewall: z.object({
    ...source, dropped_sent_packets: counter.nullable(), dropped_received_packets: counter.nullable(), drop_coverage: z.string(),
  }),
  connections: z.object({
    ...source, observed_at: timestamp.nullable(), measurement_duration_ms: metric.nullable(),
    total: counter.nullable(), tcp_established: counter.nullable(), unreplied: counter.nullable(),
  }),
  tcp: z.object({
    ...source, data_packets_sent: counter.nullable(), data_packets_received: counter.nullable(),
    retransmission_observations_sent: counter.nullable(), retransmission_observations_received: counter.nullable(),
    retransmission_percent_sent: metric.nullable(), retransmission_percent_received: metric.nullable(),
    window_decreases_host: counter.nullable(), window_decreases_peer: counter.nullable(),
    zero_window_observations_host: counter.nullable(), zero_window_observations_peer: counter.nullable(),
    zero_window_transitions_host: counter.nullable(), zero_window_transitions_peer: counter.nullable(),
    advertised_window_min_bytes_host: metric.nullable(), advertised_window_min_bytes_peer: metric.nullable(),
    rtt_remote: timing, rtt_host: timing,
  }),
  dns: z.object({
    ...source, requests: counter.nullable(), responses: counter.nullable(), unanswered: counter.nullable(),
    pending_at_close: counter.nullable(), servfail_responses: counter.nullable(), refused_responses: counter.nullable(),
    excluded_observations: counter.nullable(), response_time_p50_ms: metric.nullable(),
    response_time_p95_ms: metric.nullable(), response_time_variation_mean_ms: metric.nullable(), unanswered_percent: metric.nullable(),
  }),
  experience: z.object({
    algorithm: z.literal("netcontrol-passive-v1"), score: metric.max(100).nullable(),
    level: z.enum(["excellent", "good", "fair", "poor", "unknown"]),
    status: z.enum(["rated", "idle", "insufficient_data", "incomplete", "unavailable"]),
    confidence: z.enum(["none", "limited", "high"]), basis_seconds: metric,
    components: z.array(z.object({ code: z.string(), score: metric.max(100), value: z.number().finite(), unit: z.string(), samples: counter })),
    reasons: z.array(z.string()),
  }),
  coverage: z.object({
    complete: z.boolean(), reasons: z.array(z.string()),
    traffic: z.string(), firewall: z.string(), tcp: z.string(), dns: z.string(), connections: z.string(),
  }),
});
const envelope = z.object({
  schema: z.literal("netcontrol-host-experience/v1"), interval_seconds: z.literal(10), retention_seconds: z.literal(3600),
  collected_at: timestamp.nullable(), age_ms: metric.nullable(), collection_id: z.string().nullable(),
  status: z.enum(["starting", "available", "partial", "stale", "unavailable"]), error: z.string().nullable(),
  clock_discontinuity: z.boolean(),
  collector: z.object({
    capture_dropped_packets: counter.nullable(), analysis_exclusions: counter.nullable(),
    tracking_evictions: counter.nullable(), dropped_unattributed_packets: counter.nullable(),
    eligible_addresses: metric, unmapped_addresses: metric, excluded_addresses: metric,
    sources: z.array(z.object({ name: z.string(), status: z.string(), error: z.string().nullable() })),
    reasons: z.array(z.string()),
  }),
});
export const experienceLatestSchema = envelope.extend({
  kind: z.literal("latest"), next_cursor: z.string().max(1024).nullable(),
  hosts: z.array(host.extend({
    sample: experienceSampleSchema.nullable(),
    retained_usage: z.object({
      sent_bytes: counter.nullable(), received_bytes: counter.nullable(), coverage_seconds: metric.max(3600), complete: z.boolean(),
    }),
  })),
});
export const experienceHistorySchema = envelope.extend({
  kind: z.literal("history"), host, window: z.object({ start_at: timestamp, end_at: timestamp }),
  returned_samples: metric.max(360), expected_slots: z.literal(360), coverage_complete: z.boolean(),
  samples: z.array(z.object({
    start_at: timestamp, end_at: timestamp, status: z.enum(["observed", "missing"]), sample: experienceSampleSchema.nullable(),
  }).refine(slot => (slot.status === "observed") === (slot.sample !== null), "Missing history slots must have null samples")).length(360),
}).refine(value => value.returned_samples === value.samples.filter(slot => slot.sample !== null).length,
  "History observation count differs from returned slots");
export type ExperienceLatest = z.infer<typeof experienceLatestSchema>;
export type ExperienceHost = ExperienceLatest["hosts"][number];
export type ExperienceSample = z.infer<typeof experienceSampleSchema>;
export type ExperienceHistory = z.infer<typeof experienceHistorySchema>;

export async function getNetworkExperience(signal?: AbortSignal): Promise<ExperienceLatest> {
  let limit = 100;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      let snapshot: ExperienceLatest | undefined, cursor: string | null = null, receivedAt = 0;
      const hosts: ExperienceHost[] = [], cursors = new Set<string>(), addresses = new Set<string>();
      do {
        const query = new URLSearchParams({ limit: String(limit) });
        if (cursor) query.set("cursor", cursor);
        const page: ExperienceLatest = await request("GET", `/statistics/host-experience/latest?${query}`, experienceLatestSchema, undefined, signal);
        if (snapshot && (snapshot.collection_id !== page.collection_id || snapshot.collected_at !== page.collected_at)) {
          throw new ApiFailure("Network experience collection changed; restarting latest paging.", 409);
        }
        if (!snapshot) { snapshot = page; receivedAt = Date.now(); }
        for (const host of page.hosts) {
          if (addresses.has(host.ip_address)) throw new Error("Network experience returned duplicate host addresses.");
          addresses.add(host.ip_address); hosts.push(host);
        }
        cursor = page.next_cursor;
        if (hosts.length > 2048 || (cursor !== null && cursors.has(cursor))) throw new Error("Network experience pagination exceeded its bounds.");
        if (cursor !== null) cursors.add(cursor);
      } while (cursor !== null);
      return { ...snapshot!, hosts, next_cursor: null,
        age_ms: snapshot!.age_ms === null ? null : snapshot!.age_ms + Math.max(0, Date.now() - receivedAt) };
    } catch (failure) {
      if (signal?.aborted || attempt === 3 || !(failure instanceof ApiFailure)) throw failure;
      if (failure.status === 409) continue;
      if (failure.status === 503 && /capacity|4 mib|body.*ceiling|response.*(large|size)/i.test(failure.message) && limit > 1) {
        limit = Math.max(1, Math.floor(limit / 2)); continue;
      }
      throw failure;
    }
  }
  throw new Error("Unable to read a coherent network experience collection.");
}
export function getNetworkExperienceHistory(address: string, signal?: AbortSignal) {
  const ip = z.string().ip().parse(address);
  return request("GET", `/statistics/host-experience/history?${new URLSearchParams({ address: ip })}`,
    experienceHistorySchema.refine(value => value.host.ip_address === ip &&
      value.samples.every(slot => slot.sample === null || slot.sample.ip_address === ip), "History belongs to a different address"),
    undefined, signal);
}
export function sumExperienceCounters(a: string | null | undefined, b: string | null | undefined): string | null {
  return a == null || b == null ? null : String(BigInt(a) + BigInt(b));
}
export function experienceRate(value: number | null | undefined): string {
  if (value == null) return "Unavailable";
  const units = ["bps", "Kbps", "Mbps", "Gbps", "Tbps"];
  let index = 0;
  while (value >= 1000 && index < units.length - 1) { value /= 1000; index++; }
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)} ${units[index]}`;
}
export const experienceColors = { excellent: "success", good: "light-green", fair: "warning", poor: "error", unknown: "default" };
export const experienceLabel = (value: string): string => value.replace(/_/g, " ").replace(/^./, char => char.toUpperCase());
