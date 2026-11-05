import type { LinkDiagnostics } from "@/services/linkDiagnostics";
import type { DNSLookup } from "@/services/operations";
import type { InterfaceCapabilitySnapshot } from "@/services/interfaceCapabilities";
import type { RpsDiagnostics } from "@/services/rps";
import type { ManagedInterface } from "@/types/domain";

export function wireguardInterface(name = "wg0"): Extract<ManagedInterface, { kind: "wireguard" }> {
  return {
    name, kind: "wireguard", role: "unassigned", mtu: 1420, up: true, addresses: [],
    dhcp_relay: { enabled: false, servers: [] },
    wireguard: { key_ref: "wg-key", listen_port: 51820, peers: [] },
  };
}

export function wireguardRpsDiagnostics(): RpsDiagnostics {
  const data = rpsDiagnostics();
  data.interfaces!.push({
    name: "wg0", index: 3, mac: null, physical: false, managed: true,
    rx_queues: [{ name: "rx-0", rps_cpus: "0", rps_flow_cnt: null }], errors: [],
  });
  return data;
}

export function rpsDiagnostics(): RpsDiagnostics {
  return {
    schema: "netcontrol-performance/v1",
    sample: { scope: "host", backend_scope: "host:test", status: "available", collected_at: "2026-11-04T05:10:00.123456Z", identity_stable: true },
    sections: { online_cpus: { status: "available", data: [0, 1, 2, 3], error: null } },
    interfaces: [
      { name: "eno1", index: 2, mac: "02:00:00:00:00:01", physical: true, managed: true,
        rx_queues: [{ name: "rx-0", rps_cpus: "0", rps_flow_cnt: 0 }], errors: [] },
      { name: "lo", index: 1, mac: null, physical: false, managed: false, rx_queues: null, errors: [] },
    ],
    configured_rps: {}, configured_rfs: null, configured_offloads: {},
    rfs: { status: "ready", sock_flow_entries: 0, error: null },
    tuning_available: true, config_revision: "2026.10.29.1", transaction_id: null,
  };
}

export function interfaceCapabilitySnapshot(): InterfaceCapabilitySnapshot {
  return {
    collected_at: "2026-11-04T05:10:00.123456Z", scope: "host:test",
    inventory: {
      source: "native", status: "observed", kernel_release: "test-kernel", boot_id: "test-boot", errors: [],
      interfaces: [
        {
          name: "eno1", index: 2, mac: "02:00:00:00:00:01", kind: "ethernet",
          driver: { name: "test_driver", version: "1.0", firmware_version: null, expansion_rom_version: null, bus_address: "0000:01:00.0" },
          hardware: { bus: "pci", address: "0000:01:00.0", vendor_id: "1234", device_id: "5678", subsystem_vendor_id: null, subsystem_device_id: null, revision: "01", numa_node: 0 },
          link: {
            carrier: true, speed_mbps: 1000, duplex: "full", autonegotiation: true,
            supported_modes: [{ bit: 12, name: "10000baseT_Full", speed_mbps: 10000, duplex: "full" }, { bit: 127, name: null, speed_mbps: null, duplex: null }],
            advertised_modes: [], partner_advertised_modes: [],
          },
          channels: { rx: 0, tx: 0, other: 0, combined: 2, max_rx: 0, max_tx: 0, max_other: 0, max_combined: 8 },
          queues: [
            { name: "rx-0", rps_cpus: "00000000", rps_flow_count: 0, xps_cpus: null, xps_rxqs: null },
            { name: "tx-0", rps_cpus: null, rps_flow_count: null, xps_cpus: "00000003", xps_rxqs: "00000001" },
          ],
          capabilities: [
            { name: "rss", support: "supported", enabled: null, evidence: ["ethtool RSS indirection table size: 128"], reason: null },
            { name: "rps", support: "supported", enabled: false, evidence: ["RX queue CPU masks are zero"], reason: null },
            { name: "rfs", support: "supported", enabled: true, evidence: ["RFS flow tables configured"], reason: null },
            { name: "xps", support: "supported", enabled: true, evidence: ["TX queue CPU mask configured"], reason: null },
            { name: "xdp_native", support: "unsupported", enabled: null, evidence: ["Driver XDP feature mask"], reason: "Native XDP not advertised" },
            { name: "af_xdp_zero_copy", support: "unknown", enabled: null, evidence: [], reason: "Driver evidence unavailable" },
            { name: "dpdk", support: "unknown", enabled: null, evidence: [], reason: "PMD matching not established" },
            { name: "ethtool:rx-checksum", support: "supported", enabled: true, evidence: ["ethtool active=true"], reason: null },
            { name: "ethtool:rx-lro", support: "supported", enabled: false, evidence: ["ethtool active=false"], reason: null },
            { name: "future_feature", support: "unknown", enabled: null, evidence: ["Future evidence"], reason: null },
          ],
          errors: [],
        },
        {
          name: "lo", index: 1, mac: null, kind: "loopback", driver: null, hardware: null, link: null, channels: null, queues: [],
          capabilities: [{ name: "rss", support: "not_applicable", enabled: null, evidence: [], reason: "Loopback interface" }],
          errors: [],
        },
      ],
    },
  };
}

export function dnsResponse(requestedInterface: string | null = null): DNSLookup {
  const answer = { server: "192.0.2.53", transport: "udp" as const, rcode: 0, addresses: ["192.0.2.7"], rtt_ms: 12.5, status: "answered" as const, error: null };
  return { ...answer, interface: requestedInterface, hostname: "example.test", record_type: "A", elapsed_ms: 13.2, attempts: [answer], scope: "host:opaque", revision: "2026.10.29.4294967294" };
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
