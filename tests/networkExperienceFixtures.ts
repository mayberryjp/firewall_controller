import type { ExperienceHistory, ExperienceLatest, ExperienceSample } from "../src/services/networkExperience";

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
