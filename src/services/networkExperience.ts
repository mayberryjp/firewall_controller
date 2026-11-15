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

const slots = z.number().int().min(0).max(360);
const summaryCounter = z.object({
  total: counter.nullable(), observed_slots: slots, complete_slots: slots,
  measured_duration_ms: metric, last_observed_at: timestamp.nullable(),
});
const summaryRatio = z.object({
  numerator: counter.nullable(), denominator: counter.nullable(), percent: metric.nullable(),
  observed_slots: slots, complete_slots: slots, last_observed_at: timestamp.nullable(),
});
const summarySource = z.object({
  available_slots: slots, partial_slots: slots, not_observed_slots: slots, unavailable_slots: slots,
  observed_slots: slots, complete_slots: slots, observed_seconds: metric.max(3600), complete_seconds: metric.max(3600),
  observed_duration_ms: metric, complete_duration_ms: metric, last_observed_at: timestamp.nullable(),
});
const summaryDuration = z.object({ slots, seconds: metric.max(3600) });
const ratedLevel = z.enum(["excellent", "good", "fair", "poor"]);
const timingCoverage = {
  timing_samples: counter, timing_observed_slots: slots, timing_missing_slots: slots, timing_coverage_complete: z.boolean(),
};
const summaryRtt = z.object({
  ...timingCoverage,
  samples: counter.nullable(), variation_pairs: counter.nullable(), variation_mean_ms: metric.nullable(),
  min_ms: metric.nullable(), max_ms: metric.nullable(), p50_ms: metric.nullable(), p95_ms: metric.nullable(),
  percentile_unavailable_reason: z.string().nullable(), observed_slots: slots, complete_slots: slots,
  last_observed_at: timestamp.nullable(),
});
export const experienceSummarySchema = envelope.extend({
  kind: z.literal("summary"), window: z.object({ start_at: timestamp, end_at: timestamp }),
  snapshot_at: timestamp, coverage_complete: z.boolean(), eligible_hosts: z.number().int().nonnegative(),
  collector_scope: z.literal("latest_collection"), next_cursor: z.string().max(2048).nullable(),
  hosts: z.array(host.extend({
    summary: z.object({
      start_at: timestamp, end_at: timestamp, expected_slots: z.literal(360), observed_slots: slots,
      complete_slots: slots, observed_seconds: metric.max(3600), coverage_complete: z.boolean(),
      first_sample_at: timestamp.nullable(), last_sample_at: timestamp.nullable(), last_seen_at: timestamp.nullable(),
      observation_epochs: slots, epoch_discontinuities: slots, identity_changed: z.boolean(),
      identity_changes: z.object({ host_id: z.boolean(), interface: z.boolean(), configured_identity: z.boolean() }),
      sources: z.object({
        traffic: summarySource, firewall: summarySource, tcp: summarySource, dns: summarySource, connections: summarySource,
      }),
      connections: z.object({
        current: experienceSampleSchema.shape.connections.extend({
          status: z.enum(["available", "partial", "unavailable", "not_observed", "stale"]),
          age_ms: metric.nullable(),
        }),
        average: z.object({
          total: metric.nullable(), tcp_established: metric.nullable(), unreplied: metric.nullable(),
          observed_slots: slots, coverage_seconds: metric.max(3600),
          first_observed_at: timestamp.nullable(), last_observed_at: timestamp.nullable(),
        }),
      }),
      traffic: z.object({
        sent_packets: summaryCounter, received_packets: summaryCounter, sent_bytes: summaryCounter, received_bytes: summaryCounter,
        sent_bps: metric.nullable(), received_bps: metric.nullable(), packet_unit: z.string(), byte_unit: z.string(),
      }),
      firewall: z.object({
        dropped_sent_packets: summaryCounter, dropped_received_packets: summaryCounter,
        drop_coverage: z.literal("managed_nftables_only"),
      }),
      tcp: z.object({
        data_packets_sent: summaryCounter, data_packets_received: summaryCounter,
        retransmission_observations_sent: summaryCounter, retransmission_observations_received: summaryCounter,
        retransmission_sent: summaryRatio, retransmission_received: summaryRatio, rtt_remote: summaryRtt, rtt_host: summaryRtt,
      }),
      dns: z.object({
        ...timingCoverage,
        requests: summaryCounter, responses: summaryCounter, unanswered: summaryCounter,
        servfail_responses: summaryCounter, refused_responses: summaryCounter, excluded_observations: summaryCounter,
        unanswered_ratio: summaryRatio, pending_at_close: counter.nullable(), pending_at_close_at: timestamp.nullable(),
        pending_at_close_is_last_observed_slot: z.boolean(), response_time_p50_ms: metric.nullable(), response_time_p95_ms: metric.nullable(),
        response_time_variation_mean_ms: metric.nullable(), timing_unavailable_reason: z.string().nullable(),
        min_ms: metric.nullable(), max_ms: metric.nullable(), variation_pairs: counter,
      }),
      experience: z.object({
        rated: summaryDuration, idle: summaryDuration, insufficient_data: summaryDuration, incomplete: summaryDuration,
        unavailable: summaryDuration, missing: summaryDuration,
        rated_levels: z.object({ excellent: summaryDuration, good: summaryDuration, fair: summaryDuration, poor: summaryDuration }),
        worst_rated_level: ratedLevel.nullable(),
        last_rated: z.object({
          sample_at: timestamp, experience: experienceSampleSchema.shape.experience, is_last_observed_slot: z.boolean(),
        }).nullable(),
        reason_frequencies: z.record(z.number().int().min(0).max(360)),
        reason_frequencies_truncated: z.boolean(),
      }),
    }),
  })).max(256),
}).refine(value => new Set(value.hosts.map(item => item.ip_address)).size === value.hosts.length,
  "Network experience summary returned duplicate host addresses");
export type ExperienceSummary = z.infer<typeof experienceSummarySchema>;
export type ExperienceSummaryHost = ExperienceSummary["hosts"][number];

export function getNetworkExperienceSummary(signal?: AbortSignal): Promise<ExperienceSummary> {
  return request("GET", "/statistics/host-experience/summary?limit=256", experienceSummarySchema, undefined, signal);
}

export async function getNetworkExperience(signal?: AbortSignal): Promise<ExperienceLatest> {
  let limit = 256;
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
const experienceNumberFormat = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const experienceCompactFormat = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2, notation: "compact" });
const experienceWholeFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const experienceWholeCompactFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0, notation: "compact" });
export function experienceNumber(value: number | null | undefined, compact = false, decimals: 0 | 2 = 2): string {
  const formatter = decimals === 0
    ? (compact ? experienceWholeCompactFormat : experienceWholeFormat)
    : (compact ? experienceCompactFormat : experienceNumberFormat);
  return value == null ? "Unavailable" : formatter.format(value);
}
export function experienceRate(value: number | null | undefined, decimals: 0 | 2 = 2): string {
  if (value == null) return "Unavailable";
  const units = ["bps", "Kbps", "Mbps", "Gbps", "Tbps"];
  let index = 0;
  while (value >= 1000 && index < units.length - 1) { value /= 1000; index++; }
  return `${experienceNumber(value, false, decimals)} ${units[index]}`;
}
export const experienceColors = { excellent: "success", good: "light-green", fair: "warning", poor: "error", unknown: "default" };
export const experienceLabel = (value: string): string => value.replace(/_/g, " ").replace(/^./, char => char.toUpperCase());
export function experienceMetricColor(value: number | bigint | null, band: "dns" | "rtt" | "drops", stale = false): string {
  if (stale || value === null) return "default";
  const [yellow, orange, red] = ({ dns: [100, 250, 500], rtt: [100, 200, 300], drops: [1, 10, 100] } as const)[band];
  if (value >= red) return "error";
  if (value >= orange) return "orange-darken-2";
  if (value >= yellow) return "yellow-darken-2";
  return "info";
}
