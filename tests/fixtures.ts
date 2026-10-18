import type { Config, StateView, Transaction, RuntimeState, Statistics, GatewayMonitor, GatewayStatistics } from "@/types/domain";
export function monitor(): GatewayMonitor {
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
    routes: [{ destination: "198.51.100.0/24", interface: "lab0", table: 10000, metric: 1 }],
    policy_rules: [{ source: "192.0.2.0/24", priority: 10000, table: 10000 }],
    firewall: { allow_all_icmp: true, policy: "accept", rules: [{ source: "192.0.2.0/24", action: "accept" }], nat: { masquerade: [{ family: "ipv4", out_interface: "lab0" }] } },
    softflowd: [{ name: "capture", enabled: false, interface: "lab0", collector: "127.0.0.1:2055", export_version: 9, sampling_rate: 1, max_flows: 8192, snaplen: 128, promiscuous: false, timeouts: {} }],
    kernel: { namespace: { "net.ipv4.tcp_syncookies": "1" }, host: {} },
    gateway_monitors: [], ntp: { enabled: false, servers: [] }, syslog: { enabled: false, servers: [] }, vnstat: { enabled: false },
  };
}
export function state(): StateView {
  return { revision: "0", desired: config(), observed: config(), drift: false };
}
export function runtime(): RuntimeState { return {
  parent_interfaces: [], softflowd: [{ name: "capture", state: "simulated" }], dhcp_relay: [{ interface: "lab0", state: "disabled" }],
  gateway_monitors: [], appliance_services: [
    { name: "ntp", scope: "host", state: "disabled" }, { name: "syslog", scope: "host", state: "disabled" },
    { name: "vnstat-host", scope: "host", state: "disabled" }, { name: "vnstat-managed", scope: "managed", state: "disabled" },
  ],
}; }
export function transaction(status = "pending_confirmation"): Transaction {
  return {
    id: "tx-test", actor: "operator", status, base_revision: "0", candidate: config(), previous: config(),
    confirmation_deadline: new Date(Date.now() + 120_000).toISOString(), submitted_at: new Date().toISOString(), committed_at: null,
  };
}
export function statistics(): Statistics {
  return {
    sample: { scope: "simulator:test", started_at: new Date().toISOString(), collected_at: new Date().toISOString(), status: "simulated" },
    interfaces: [{ name: "lab0", kind: "dummy", ownership: "managed", mtu: 1500, admin_up: true, oper_state: "UNKNOWN", status: "simulated", counters: { rx_bytes: "18446744073709551615", tx_bytes: "0" } }],
    protocols: [{ name: "snmp", status: "available", groups: { Tcp: { MaxConn: "-1" } } }],
  };
}
