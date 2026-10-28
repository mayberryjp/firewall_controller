import { z } from "zod";

const count = z.number().int().safe().nonnegative();
const metric = z.number().finite().nonnegative().nullable();
const counter = z.string().regex(/^(0|[1-9]\d*)$/);
export const linkDiagnosticsSchema = z.object({
  schema: z.literal("netcontrol-link-diagnostics/v1"), scope: z.string(),
  status: z.enum(["starting", "available", "unavailable", "stale", "simulated"]),
  collected_at: z.string().datetime({ offset: true }).nullable(),
  age_ms: metric, interval_seconds: metric, error: z.string().nullable(),
  interfaces: z.array(z.object({
    index: count, name: z.string(), errors: counter, drops: counter,
    errors_delta: counter.nullable(), drops_delta: counter.nullable(),
  })).nullable(),
  queues: z.array(z.object({
    index: count, name: z.string().nullable(), handle: count, parent: count, kind: z.string(),
    status: z.enum(["available", "unavailable"]),
    queue: z.object({
      qlen_packets: count, backlog_bytes: count, drops: counter, requeues: counter, overlimits: counter,
    }).nullable(),
    drops_delta: counter.nullable(), backlog_growth_bytes: z.string().regex(/^-?(0|[1-9]\d*)$/).nullable(),
  })).nullable(),
  local_tcp: z.object({
    established_sockets: count, compared_sockets: count,
    retransmissions_delta: counter.nullable(), retransmissions_per_second: metric,
    retransmissions_per_thousand_segments: metric, cwnd_reductions: count.nullable(),
    observed_retransmissions: counter, observed_cwnd_reductions: counter,
    cwnd_min_segments: count.nullable(), cwnd_max_segments: count.nullable(),
    rtt_p50_ms: metric, rtt_p95_ms: metric, rtt_variation_max_ms: metric, rto_max_ms: metric,
    unacked_segments_max: count.nullable(), lost_segments_max: count.nullable(),
    send_queue_max_bytes: count.nullable(), peer_window_min_bytes: count.nullable(),
    peer_window_measured_sockets: count, peer_zero_window_sockets: count.nullable(),
  }).nullable(),
  packet_headers: z.object({
    status: z.literal("available"), tracked_directions: count, flow_limit: count,
    kernel_drops: counter, rejected_headers: counter, untracked_packets: counter, capture_gaps: counter,
    statistics_complete: z.boolean(),
    interfaces: z.array(z.object({
      index: count, name: z.string().nullable(), tcp_ack_packets: counter,
      zero_window_observations: counter, zero_window_transitions: counter, window_decreases: counter,
      window_raw_min: count.max(65535).nullable(), window_raw_max: count.max(65535).nullable(),
    })),
  }).nullable(),
  signals: z.array(z.string()), coverage: z.record(z.string()).optional(),
});
export type LinkDiagnostics = z.infer<typeof linkDiagnosticsSchema>;
