import type { ExperienceHistory, ExperienceLatest, ExperienceSample, ExperienceSummary } from "../src/services/networkExperience";

const start = "2026-11-14T00:25:00.123456Z", end = "2026-11-14T00:25:10.123456Z";
const network = { name: "vlan20", index: 20, kind: "vlan", vlan_id: 20 };
const timing = () => ({ samples: "20", variation_pairs: "19", p50_ms: 15, p95_ms: 25, min_ms: 10, max_ms: 30, variation_mean_ms: 2 });
export function experienceSample(): ExperienceSample {
  return {
    ip_address: "192.0.2.20", configured_host_id: "camera", configured_name: "Front door camera",
    configuration_revision: "2026.11.14.3", observation_epoch: "epoch-1", start_at: start, end_at: end,
    measured_duration_ms: 10000, interface: { ...network }, last_seen_at: "2026-11-14T00:25:09.987654Z", activity: "active",
    traffic: {
      status: "available", error: null, sent_packets: "200", received_packets: "400", sent_bytes: "20000",
      received_bytes: "500000", sent_bps: 16000, received_bps: 400000, packet_unit: "kernel_l3_packet", byte_unit: "ip_layer_bytes",
    },
    firewall: { status: "available", error: null, dropped_sent_packets: "2", dropped_received_packets: "0", drop_coverage: "managed_nftables_only" },
    connections: { status: "available", error: null, observed_at: end, measurement_duration_ms: 50, total: "3", tcp_established: "2", unreplied: "1" },
    tcp: {
      status: "available", error: null, data_packets_sent: "100", data_packets_received: "300",
      retransmission_observations_sent: "0", retransmission_observations_received: "0",
      retransmission_percent_sent: 0, retransmission_percent_received: 0,
      window_decreases_host: "2", window_decreases_peer: "1", zero_window_observations_host: "0", zero_window_observations_peer: "0",
      zero_window_transitions_host: "0", zero_window_transitions_peer: "0",
      advertised_window_min_bytes_host: 65536, advertised_window_min_bytes_peer: 131072, rtt_remote: timing(), rtt_host: timing(),
    },
    dns: {
      status: "available", error: null, requests: "5", responses: "5", unanswered: "0", pending_at_close: "0",
      servfail_responses: "0", refused_responses: "0", excluded_observations: "0",
      response_time_p50_ms: 8, response_time_p95_ms: 12, response_time_variation_mean_ms: 1, unanswered_percent: 0,
    },
    experience: {
      algorithm: "netcontrol-passive-v1", score: 100, level: "excellent", status: "rated", confidence: "limited", basis_seconds: 10,
      components: [{ code: "dns_response_delay", score: 100, value: 12, unit: "ms", samples: "5" }], reasons: ["managed_policy_drops"],
    },
    coverage: { complete: true, reasons: ["managed_policy_drops"], traffic: "kernel_l3", firewall: "managed_nftables_only", tcp: "accepted_lan_tcp", dns: "accepted_client_visible_udp_tcp_53", connections: "shared_conntrack_snapshot" },
  };
}
export function experienceLatest(): ExperienceLatest {
  return {
    schema: "netcontrol-host-experience/v1", kind: "latest", interval_seconds: 10, retention_seconds: 3600,
    collected_at: end, age_ms: 0, collection_id: "collection-1", status: "available", error: null, clock_discontinuity: false,
    collector: {
      eligible_addresses: 1, unmapped_addresses: 0, excluded_addresses: 0, capture_dropped_packets: "0",
      analysis_exclusions: "0", tracking_evictions: "0", dropped_unattributed_packets: "0",
      sources: [{ name: "traffic", status: "available", error: null }], reasons: [],
    },
    hosts: [{
      ip_address: "192.0.2.20", address_family: "ipv4", configured_host_id: "camera", configured_name: "Front door camera",
      currently_protected: true, interface: { ...network },
      metadata: { host_name: "camera.example.test", icon: "IP_CAMERA", classification: "Front Door Camera", status: "available", last_success_at: end, error: null },
      sample: experienceSample(), retained_usage: { sent_bytes: "20000", received_bytes: "500000", coverage_seconds: 10, complete: false },
    }], next_cursor: null,
  };
}
export function experienceHistory(): ExperienceHistory {
  const latest = experienceLatest();
  const row = latest.hosts[0]!;
  return {
    schema: latest.schema, kind: "history", interval_seconds: 10, retention_seconds: 3600,
    collected_at: latest.collected_at, age_ms: 0, collection_id: latest.collection_id, status: "available",
    error: null, clock_discontinuity: false, collector: latest.collector,
    host: {
      ip_address: row.ip_address, address_family: row.address_family, configured_host_id: row.configured_host_id,
      configured_name: row.configured_name, currently_protected: row.currently_protected, interface: row.interface, metadata: row.metadata,
    },
    window: { start_at: "2026-11-13T23:25:10.123456Z", end_at: end },
    returned_samples: 1, expected_slots: 360, coverage_complete: false,
    samples: Array.from({ length: 360 }, (_, index) => index === 359
      ? { start_at: start, end_at: end, status: "observed", sample: experienceSample() }
      : { start_at: new Date(Date.parse(start) - (359 - index) * 10000).toISOString(),
        end_at: new Date(Date.parse(start) - (358 - index) * 10000).toISOString(), status: "missing", sample: null }),
  };
}

export function experienceSummary(): ExperienceSummary {
  const latest = experienceLatest(), row = latest.hosts[0]!, sample = row.sample!;
  const identity = {
    ip_address: row.ip_address, address_family: row.address_family, configured_host_id: row.configured_host_id,
    configured_name: row.configured_name, currently_protected: row.currently_protected, interface: row.interface, metadata: row.metadata,
  };
  const total = (count: string | null) => ({
    total: count, observed_slots: count === null ? 0 : 1, complete_slots: count === null ? 0 : 1,
    measured_duration_ms: count === null ? 0 : 10000, last_observed_at: count === null ? null : end,
  });
  const ratio = (numerator: string, denominator: string, percent: number) => ({
    numerator, denominator, percent, observed_slots: 1, complete_slots: 1, last_observed_at: end,
  });
  const source = () => ({
    available_slots: 1, partial_slots: 0, not_observed_slots: 0, unavailable_slots: 0,
    observed_slots: 1, complete_slots: 1, observed_seconds: 10, complete_seconds: 10,
    observed_duration_ms: 10000, complete_duration_ms: 10000, last_observed_at: end,
  });
  const duration = (slots: number) => ({ slots, seconds: slots * 10 });
  const rtt = () => ({
    samples: "20", variation_pairs: "19", variation_mean_ms: 2, min_ms: 10, max_ms: 30,
    p50_ms: null, p95_ms: null, percentile_unavailable_reason: "per_bucket_distributions_not_retained",
    observed_slots: 1, complete_slots: 1, last_observed_at: end,
    timing_samples: "0", timing_observed_slots: 0, timing_missing_slots: 1, timing_coverage_complete: false,
  });
  return {
    schema: latest.schema, kind: "summary", interval_seconds: 10, retention_seconds: 3600,
    collected_at: end, age_ms: 0, collection_id: latest.collection_id, status: "partial", error: null,
    clock_discontinuity: false, collector: latest.collector, collector_scope: "latest_collection",
    window: { start_at: "2026-11-13T23:25:10.123456Z", end_at: end }, snapshot_at: end,
    coverage_complete: false, eligible_hosts: 1, next_cursor: null,
    hosts: [{
      ...identity,
      summary: {
        start_at: "2026-11-13T23:25:10.123456Z", end_at: end, expected_slots: 360,
        observed_slots: 1, complete_slots: 1, observed_seconds: 10, coverage_complete: false,
        first_sample_at: start, last_sample_at: end, last_seen_at: sample.last_seen_at,
        observation_epochs: 1, epoch_discontinuities: 0, identity_changed: false,
        identity_changes: { host_id: false, interface: false, configured_identity: false },
        sources: { traffic: source(), firewall: source(), tcp: source(), dns: source(), connections: source() },
        connections: {
          current: { ...sample.connections, age_ms: 0 },
          average: {
            total: 3, tcp_established: 2, unreplied: 1, observed_slots: 1, coverage_seconds: 10,
            first_observed_at: end, last_observed_at: end,
          },
        },
        traffic: {
          sent_packets: total("200"), received_packets: total("400"), sent_bytes: total("20000"), received_bytes: total("500000"),
          sent_bps: 16000, received_bps: 400000, packet_unit: "kernel_l3_packet", byte_unit: "ip_layer_bytes",
        },
        firewall: {
          dropped_sent_packets: total("2"), dropped_received_packets: total("0"), drop_coverage: "managed_nftables_only",
        },
        tcp: {
          data_packets_sent: total("100"), data_packets_received: total("300"),
          retransmission_observations_sent: total("0"), retransmission_observations_received: total("0"),
          retransmission_sent: ratio("0", "100", 0), retransmission_received: ratio("0", "300", 0),
          rtt_remote: rtt(), rtt_host: rtt(),
        },
        dns: {
          requests: total("5"), responses: total("5"), unanswered: total("0"), servfail_responses: total("0"),
          refused_responses: total("0"), excluded_observations: total("0"), unanswered_ratio: ratio("0", "5", 0),
          pending_at_close: "0", pending_at_close_at: end, pending_at_close_is_last_observed_slot: true,
          response_time_p50_ms: null, response_time_p95_ms: null, response_time_variation_mean_ms: null,
          timing_unavailable_reason: "per_bucket_distributions_and_variation_weights_not_retained",
          min_ms: null, max_ms: null, variation_pairs: "0",
          timing_samples: "0", timing_observed_slots: 0, timing_missing_slots: 1, timing_coverage_complete: false,
        },
        experience: {
          rated: duration(1), idle: duration(0), insufficient_data: duration(0), incomplete: duration(0),
          unavailable: duration(0), missing: duration(359),
          rated_levels: { excellent: duration(1), good: duration(0), fair: duration(0), poor: duration(0) },
          worst_rated_level: "excellent", last_rated: { sample_at: end, experience: sample.experience, is_last_observed_slot: true },
          reason_frequencies: { managed_policy_drops: 1 }, reason_frequencies_truncated: false,
        },
      },
    }],
  };
}
