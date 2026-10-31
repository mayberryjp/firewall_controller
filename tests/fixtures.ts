import type { Config, StateView, Transaction, RuntimeState, Statistics, ExplicitGatewayMonitor, GatewayStatistics, ConnectionsPage, MDNSStatus, PlatformStatus, SoftwareMetadata, VnStatReporting, WireGuardDNS, MqttStatus } from "@/types/domain";
import type { HostHealth } from "../src/services/hostHealth";
export function vnstatReporting(): VnStatReporting {
  return {
    scope: "host", last_report_date: "2026-10-29", last_report_error: null,
    sent_datagrams: "18446744073709551615", failed_datagrams: "0",
  };
}
export function mqttStatus(): MqttStatus {
  return {
    device_id: "a".repeat(32), enabled: false, state: "disabled", error: null, last_published_at_unix: null,
    connection_attempts: "0", reconnect_count: "0", last_connected_at_unix: null, last_failure: null,
  };
}
export function healthSnapshot(ticks = "9007199254740993", idle = "9007199254740993", uptime = 100): HostHealth {
  const unavailable = { status: "unavailable" as const, data: null, error: "Not supported" };
  return {
    schema: "netcontrol-host-health/v1",
    sample: { scope: "host", boot_id: "boot-1", status: "partial", started_at: "2026-10-24T12:00:00Z", collected_at: new Date(Date.UTC(2026, 9, 24, 12, 0, uptime, 123)).toISOString() },
    sections: {
      cpu: { status: "available", error: null, data: { ticks_per_second: 100, cpus: [{ name: "cpu", ticks: { user: ticks, nice: "0", system: "0", idle, guest: ticks } }], scheduler: {} } },
      uptime: { status: "available", error: null, data: { uptime_seconds: uptime, idle_seconds: uptime } },
      memory: { status: "available", error: null, data: { bytes: { MemTotal: "8000000000", MemFree: "1000000000", MemAvailable: "2000000000", SwapTotal: "2000000000", SwapFree: "2000000000" }, used_bytes: "6000000000", swap_used_bytes: "0" } },
      load: { status: "available", error: null, data: { one: 0.1, five: 0.2, fifteen: 0.3, runnable_tasks: "1", total_tasks: "100", last_pid: "123" } },
      vm: unavailable, pressure_cpu: unavailable, pressure_memory: unavailable, pressure_io: unavailable, disks: unavailable,
      filesystems: { status: "available", error: null, data: [{ mount_id: "1", device: "8:1", mount_point: "/", filesystem: "ext4", usage: { status: "available", error: null, data: { total_bytes: "100000000000", free_bytes: "10000000000", available_bytes: "8000000000", used_bytes: "90000000000", total_inodes: "1000", free_inodes: "500", available_inodes: "500", read_only: false } } }] },
      thermal: { status: "available", error: null, data: [{ id: "thermal_zone0", status: "available", error: null, data: { type: "CPU package", temperature_millicelsius: 48125 } }] },
      hwmon: { status: "available", error: null, data: [{ id: "hwmon0/fan1", chip: "test-fan", unit: "rpm", status: "available", error: null, data: { value: 0, label: "Chassis fan" } }] },
    },
  };
}
export function connections(): ConnectionsPage {
  return {
    schema: "netcontrol-connections/v1", sample: { scope: "test:namespace", started_at: "2026-10-24T12:00:00Z", collected_at: "2026-10-24T12:00:01Z", status: "partial" },
    summary: { total: 1, matched: 1, returned: 1, accounting_unavailable: 1 }, limit: 100, offset: 0, next_offset: null,
    connections: [{
      id: "42", zone: 0, family: "ipv4", protocol: 6, protocol_name: "tcp", state: "ESTABLISHED", tcp_state: 3, status: 22,
      seen_reply: true, assured: true, source_nat: true, destination_nat: false, mark: 0, timeout_seconds: 120,
      original: { source: "192.0.2.10", destination: "198.51.100.20", source_port: 40000, destination_port: 443, icmp_id: null, icmp_type: null, icmp_code: null, zone: null },
      reply: { source: "198.51.100.20", destination: "203.0.113.10", source_port: 443, destination_port: 50000, icmp_id: null, icmp_type: null, icmp_code: null, zone: null },
      original_counters: { packets: "9007199254740993", bytes: "18446744073709551615" }, reply_counters: null,
    }],
  };
}
export function monitor(): ExplicitGatewayMonitor {
  return {
    name: "uplink", enabled: true, interface: "lab0", source_address: "192.0.2.10", gateway: "198.51.100.1", target: "198.51.100.1",
    routing_table: 10000, probe_interval_ms: 1000, loss_timeout_ms: 2000, window_ms: 30000,
    latency_threshold_ms: 150, loss_threshold_percent: 20, rtt_variation_threshold_ms: 0, failure_hold_ms: 3000, recovery_hold_ms: 5000,
  };
}
export function gatewayStatistics(): GatewayStatistics {
  return {
    name: "uplink", process_state: "running", sample_status: "available", health: "up",
    started_at: new Date(Date.now() - 60000).toISOString(), collected_at: new Date().toISOString(),
    health_changed_at: new Date().toISOString(), last_success_at: new Date().toISOString(),
    sent: 4, received: 2, lost: 1, pending: 1, variation_pairs: 1, loss_percent: 100 / 3,
    rtt_min_ms: 0, rtt_max_ms: 2.5, rtt_avg_ms: 1.25, rtt_stddev_ms: 1.25,
    rtt_p50_ms: 0, rtt_p95_ms: 2.5, rtt_variation_ms: 2.5,
  };
}
export function config(): Config {
  return {
    interfaces: [{ name: "lab0", kind: "dummy", role: "lan", mtu: 1500, up: true, addresses: ["192.0.2.10/24", "2001:db8::10/64"], dhcp_relay: { enabled: false, servers: [] } }],
    routes: [{ enabled: true, destination: "198.51.100.0/24", interface: "lab0", table: 10000, metric: 1 }],
    firewall: { allow_all_icmp: true, policy: "accept", rules: [{ source: "192.0.2.0/24", action: "accept" }], nat: { masquerade: [{ family: "ipv4", out_interface: "lab0" }] } },
    softflowd: [{ name: "capture", enabled: false, interface: "lab0", collector: "127.0.0.1:2055", export_version: 9, sampling_rate: 1, max_flows: 8192, snaplen: 128, promiscuous: false, timeouts: {} }],
    kernel: { namespace: { "net.ipv4.tcp_syncookies": "1" }, host: {} },
    gateway_monitors: [], ntp: { enabled: false, servers: [] }, syslog: { enabled: false, servers: [] }, vnstat: { enabled: false },
  };
}
export function state(): StateView {
  return { revision: "2026.10.29.1", desired: { ...config(), software: software() }, observed: config(), drift: false };
}
export function hostPolicyConfig(): Config {
  const result = config();
  result.firewall.rules = [];
  result.firewall.policies = {
    hosts: [
      { id: "desk", name: "Workstation", addresses: ["192.0.2.20"], policy: "drop", rules: [
        { destination_host: "server", protocol: "tcp", destination_ports: [443, 8443], out_interface: "lab0", action: "accept" },
        { destination: "198.51.100.0/24", protocol: "udp", destination_ports: [53], action: "drop" },
        { action: "accept" },
      ] },
      { id: "server", name: "Server", addresses: ["198.51.100.10"], policy: "accept", rules: [] },
      { id: "phone", name: "Phone", addresses: ["192.0.2.30"], policy: "drop", rules: [
        { destination: "2001:db8::/64", protocol: "udp", destination_ports: [5353], action: "accept" },
      ] },
    ],
    interfaces: [{ interface: "lab0", rules: [{ destination: "203.0.113.99/32", action: "drop" }] }],
  };
  return result;
}
export function software(): SoftwareMetadata {
  return {
    version: "2026.10.29.1", repository: null, latest_version: null,
    update_available: null, last_checked_at: null, error: null,
  };
}
export function mdnsStatus(): MDNSStatus {
  return {
    name: "mdns", scope: "managed", enabled: true, state: "running",
    started_at: "2026-10-25T12:00:00.123456Z", collected_at: "2026-10-25T12:00:01.987654Z", error: null,
    effective_interfaces: ["lan0", "lan1"], effective_families: ["ipv4"],
    reflection_enabled: true, publishing_enabled: false,
    received_packets: "9007199254740993", transmitted_packets: "18446744073709551615",
    received_bytes: "0", transmitted_bytes: "0", malformed_packets: "0", hop_limit_drops: "0",
    policy_drops: "0", duplicate_drops: "0", rate_limit_drops: "0", queue_drops: "0",
    oversize_drops: "0", unsupported_record_drops: "0", send_errors: "0", receive_drops: null,
    statistics_complete: false, warnings: ["receive_loss_accounting_unavailable"], limits: { interfaces: 32, filters: 64 },
  };
}
export function udpRelayStatus() {
  return {
    name: "udp-broadcast-relay" as const, instance_id: 1, scope: "managed" as const, enabled: true, state: "running",
    port: 4001, interfaces: ["lan0", "iot0"], multicast_address: "239.255.255.250", source: "original" as const,
    started_at: "2026-10-28T12:00:00.123456Z", collected_at: "2026-10-28T12:00:01.987654Z", error: null,
    received_packets: "9007199254740993", transmitted_packets: "18446744073709551615",
    received_bytes: "0", transmitted_bytes: "0", policy_drops: "0", loop_drops: "0", rate_limit_drops: "0", send_errors: "0",
    receive_drops: null, statistics_complete: false, last_send_error: null, last_send_error_at: null,
    retrying: false, restart_count: 0, limits: { interfaces: 32, payload_bytes: 65507, packets_per_second: 200, burst: 400, poll_ms: 100, shutdown_ms: 1000 },
  };
}
export function runtime(): RuntimeState { return {
  parent_interfaces: [], softflowd: [{ name: "capture", state: "simulated" }], dhcp_relay: [{ interface: "lab0", state: "disabled" }],
  gateway_monitors: [], appliance_services: [
    { name: "ntp", scope: "host", state: "disabled" }, { name: "syslog", scope: "host", state: "disabled" },
    { name: "vnstat", scope: "host", state: "disabled" },
  ],
}; }
export function transaction(status = "pending_confirmation"): Transaction {
  return {
    id: "tx-test", actor: "operator", status, base_revision: "2026.10.29.1",
    committed_revision: status === "committed" ? "2026.10.29.2" : null, candidate: config(), previous: config(),
    confirmation_deadline: new Date(Date.now() + 120_000).toISOString(), submitted_at: new Date().toISOString(), committed_at: null,
  };
}
export function wireguardDns(): WireGuardDNS {
  return {
    running: true, refresh_interval_seconds: 60, error: null,
    peers: [{
      interface: "wg0", public_key: btoa("\x01".repeat(32)), endpoint: "vpn.example.test:51820",
      ipv6_enabled: true, resolved_endpoint: "192.0.2.20:51820",
      last_attempt_unix_ms: Date.parse("2026-10-30T19:53:27.987Z"),
      last_success_unix_ms: Date.parse("2026-10-30T19:53:27.987Z"), error: null,
    }],
  };
}
export function statistics(): Statistics {
  return {
    sample: { scope: "simulator:test", started_at: new Date().toISOString(), collected_at: new Date().toISOString(), status: "simulated" },
    interfaces: [{ name: "lab0", kind: "dummy", ownership: "managed", mtu: 1500, admin_up: true, oper_state: "UNKNOWN", status: "simulated", counters: { rx_bytes: "18446744073709551615", tx_bytes: "0" } }],
    protocols: [{ name: "snmp", status: "available", groups: { Tcp: { MaxConn: "-1" } } }],
  };
}
export function trafficStatistics(seconds = 0, increment = 0n): Statistics {
  return {
    sample: {
      scope: "managed:test", started_at: new Date(Date.UTC(2026, 9, 27, 12, 0, seconds)).toISOString(),
      collected_at: new Date(Date.UTC(2026, 9, 27, 12, 0, seconds, 123)).toISOString(), status: "available",
    },
    interfaces: ["eth0", "eth1"].map((name, index) => ({
      name, index: index + 1, kind: "ethernet", ownership: "managed", mtu: 1500,
      admin_up: true, oper_state: "UP", status: "available", counter_bits: 64,
      counters: {
        rx_bytes: (1000n + increment * BigInt(index + 1)).toString(),
        tx_bytes: (2000n + increment * 2n * BigInt(index + 1)).toString(),
        rx_packets: (100n + increment * 3n * BigInt(index + 1)).toString(),
        tx_packets: (200n + increment * 4n * BigInt(index + 1)).toString(),
      },
    })),
    protocols: [],
  };
}
export function processHealthSnapshot(): PlatformStatus {
  const timestamp = "2026-10-27T01:02:03.987Z";
  return {
    process_health: {
      status: "unhealthy", healthy: false, collected_at: timestamp, stale: false, runtime_available: true,
      daemon: { pid: 123, state: "running", healthy: true, uptime_seconds: 900, watchdog_enabled: true },
      components: [
        { id: "ntp", component: "appliance_services", resource: "ntp", state: "error", healthy: false, retrying: true, collected_at: timestamp },
        { id: "syslog", component: "appliance_services", resource: "syslog", state: "disabled", healthy: null, retrying: false, collected_at: timestamp },
      ],
    },
    active_alerts: [{
      id: "ntp:worker_unavailable", component: "appliance_services", resource: "ntp",
      severity: "error", code: "worker_unavailable", message: "NTP worker is unavailable",
      retrying: true, first_seen_at: timestamp, last_seen_at: timestamp,
    }],
  };
}
