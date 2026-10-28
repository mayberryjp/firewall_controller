import type { LinkDiagnostics } from "@/services/linkDiagnostics";
import type { DNSLookup } from "@/services/operations";

export function dnsResponse(requestedInterface: string | null = null): DNSLookup {
  const answer = { server: "192.0.2.53", transport: "udp" as const, rcode: 0, addresses: ["192.0.2.7"], rtt_ms: 12.5, status: "answered" as const, error: null };
  return { ...answer, interface: requestedInterface, hostname: "example.test", record_type: "A", elapsed_ms: 13.2, attempts: [answer], scope: "host:opaque", revision: "9007199254740993" };
}
export function linkDiagnostics(): LinkDiagnostics {
  return {
    schema: "netcontrol-link-diagnostics/v1", scope: "host:opaque", status: "available",
    collected_at: "2026-10-28T01:02:03.987654Z", age_ms: 0, interval_seconds: 1.25, error: null,
    interfaces: [{ index: 2, name: "lab0", errors: "9007199254740993", drops: "18446744073709551615", errors_delta: null, drops_delta: "1" }],
    queues: [
      { index: 2, name: "lab0", handle: 1, parent: 0, kind: "fq_codel", status: "available", queue: { qlen_packets: 2, backlog_bytes: 4096, drops: "9007199254740993", requeues: "7", overlimits: "8" }, drops_delta: "1", backlog_growth_bytes: "-256" },
      { index: 2, name: "lab0", handle: 2, parent: 1, kind: "noqueue", status: "unavailable", queue: null, drops_delta: null, backlog_growth_bytes: null },
    ],
    local_tcp: {
      established_sockets: 0, compared_sockets: 0, retransmissions_delta: null,
      retransmissions_per_second: null, retransmissions_per_thousand_segments: null, cwnd_reductions: null,
      observed_retransmissions: "9007199254740993", observed_cwnd_reductions: "2",
      cwnd_min_segments: null, cwnd_max_segments: null, rtt_p50_ms: null, rtt_p95_ms: null,
      rtt_variation_max_ms: null, rto_max_ms: null, unacked_segments_max: null, lost_segments_max: null,
      send_queue_max_bytes: null, peer_window_min_bytes: null, peer_window_measured_sockets: 0, peer_zero_window_sockets: null,
    },
    packet_headers: {
      status: "available", tracked_directions: 1, flow_limit: 8192, kernel_drops: "18446744073709551615",
      rejected_headers: "3", untracked_packets: "4", capture_gaps: "5", statistics_complete: false,
      interfaces: [{ index: 2, name: "lab0", tcp_ack_packets: "9007199254740993", zero_window_observations: "3", zero_window_transitions: "1", window_decreases: "2", window_raw_min: 0, window_raw_max: 65535 }],
    },
    signals: ["receiver_window_pressure", "future_evidence_code"],
    coverage: { local_tcp: "Router-terminated sockets only", limitations: "No exact upstream loss localization" },
  };
}
