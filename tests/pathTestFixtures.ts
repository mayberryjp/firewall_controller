import type { PathTestRequest, PathTestStatus } from "../src/services/pathTests";
import type { DiscoveredInterface } from "../src/types/domain";

export function pathTestRequest(): PathTestRequest {
  return {
    interface: "vlan100", source_address: "192.0.2.1", peer_address: "192.0.2.2",
    port: 49872, maximum_mtu: 9000, parents: [{ interface: "eno1", maximum_mtu: 9100 }],
    pairing_secret: "synthetic-only-pairing-secret-1234567890",
  };
}
export function pathTestInterfaces(): DiscoveredInterface[] {
  const link: DiscoveredInterface = {
    name: "vlan100", kind: "vlan", index: 4, mac: null, mtu: 1500, up: true,
    addresses: ["192.0.2.1/24", "2001:db8::1/64", "fe80::1/64"],
    ownership: "managed", role: null, addressing_type: null,
  };
  return [link, { ...link, name: "eno1", kind: "ethernet", index: 2, addresses: [] },
    { ...link, name: "gre0", kind: "gre", index: 5, addresses: ["198.51.100.1/24"] }];
}
export function pathTestResult(): NonNullable<PathTestStatus["result"]> {
  const size = {
    ip_size_bytes: 1500, delivered: 3, attempted: 3, sent: 3, ack_timeouts: 0,
    emsgsize: 0, send_errors: 0, loss_fraction: 0, mean_rtt_ms: 1.25, status: "verified" as const,
  };
  const measured = {
    trial: 0, requested_mss_bytes: 1460, status: "measured" as const,
    effective_mss_bytes: 1448, peer_effective_mss_bytes: 1448, delivered_bytes: 4096,
    retransmits: 0, elapsed_ms: 50, goodput_bits_per_second: 655360, kernel_rtt_ms: 1.5,
    connect_ms: 2, authentication_rtt_ms: 1, delivery_evidence: "Authenticated byte-count and SHA256 receipt", error: null,
  };
  return {
    schema: "netcontrol-path-test-v1", status: "completed", interface: "vlan100",
    source_address: "192.0.2.1", peer_address: "192.0.2.2", port: 49872, role: "initiator",
    session_id: "protocol-identity-not-the-native-id", elapsed_ms: 30000,
    limitations: ["Inner delivery does not prove absence of outer fragmentation."],
    peer_report_received: false, local_report_acknowledged: false,
    limits: {
      requested_maximum_mtu_bytes: 9000, interface_mtu_bytes: 9000, initial_route_mtu_bytes: 9000,
      local_cap_bytes: 9000, peer_cap_bytes: 9000, local_receive_cap_bytes: 9000, peer_send_cap_bytes: 9000,
      inbound_tested_cap_bytes: 9000, tested_cap_bytes: 9000, ip_udp_overhead_bytes: 28,
      final_cached_route_mtu_bytes: null, ipv6_minimum_mtu_bytes: null, path_mtu_bytes: null,
      maximum_probes_per_size: 3, candidate_limit: 12, measurement_limit_seconds: 30,
      arm_limit_seconds: 30, lifetime_limit_seconds: 90,
    },
    udp: {
      outbound: { largest_verified_ip_size_bytes: 1500, delivery_evidence: "Authenticated receive-size ACK", rtt_origin: "local", sizes: [size] },
      inbound: {
        largest_verified_ip_size_bytes: 1500, delivery_evidence: "Authenticated local receive", rtt_origin: "peer",
        sizes: [{ ...size, attempted: null, sent: null, ack_timeouts: null, emsgsize: null, send_errors: null, loss_fraction: null, mean_rtt_ms: null }],
        peer_sender_report: null,
      }, receive_path_errors: { emsgsize: 0 },
    },
    tcp: {
      outbound_trials: [measured, {
        ...measured, trial: 1, status: "inconclusive", effective_mss_bytes: null, peer_effective_mss_bytes: null,
        delivered_bytes: null, retransmits: null, elapsed_ms: null, goodput_bits_per_second: null,
        kernel_rtt_ms: null, connect_ms: null, authentication_rtt_ms: null, delivery_evidence: null,
        error: "Peer authentication timed out",
      }],
      inbound_trials: [{
        trial: 0, requested_mss_bytes: 1460, status: "received", effective_mss_bytes: 1448,
        delivered_bytes: 4096, elapsed_ms: 50, goodput_bits_per_second: 655360, kernel_rtt_ms: 1.5,
        retransmits: null, sender_retransmits: null, sender_effective_mss_bytes: null,
        delivery_evidence: "Authenticated local receive",
      }],
      peer_sender_trials: null, trial_byte_limit: 4194304, rate_limit_bytes_per_second: 8388608,
      mss_observation: "TCP_INFO sender and receiver MSS",
    },
    measured_candidates: { largest_verified_outbound_ip_size_bytes: 1500, best_outbound_mss_trial: measured, automatic_configuration: false },
  };
}
export function pathTestStatus(active = false): PathTestStatus {
  return {
    schema: "netcontrol-path-test-status-v1", id: active ? "a".repeat(32) : null,
    state: active ? "running" : "idle", active, error: null,
    restoration: active ? "pending" : "not_required", permit_lease_seconds: 90,
    mtu_restores_on_daemon_recovery: true, conntrack_cleanup: "not_performed",
    warnings: [], mtu_changes: [],
    progress: active ? { schema: "netcontrol-path-test-progress-v1", phase: "armed", arm_timeout_seconds: 30 } : null,
    result: null,
  };
}
