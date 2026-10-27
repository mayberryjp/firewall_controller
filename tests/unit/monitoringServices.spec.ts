import { describe, expect, it } from "vitest";
import { configSchema, gatewayMonitorSchema, gatewayStatisticsPageSchema, gatewayStatisticsDetailSchema, statisticsSchema, runtimeSchema, isApplianceStatus } from "@/types/domain";
import { decodeJson, encodeJson } from "@/services/json";
import { differences, equalConfig, requiredPermissions, serviceRepairPermissions, validateConfig, validateServerHost } from "@/services/configuration";
import { gatewayHealth, gatewayMetricIndicator, gatewaySampleState, formatMetric } from "@/services/gatewayHealth";
import { config, gatewayStatistics, monitor, runtime, statistics } from "../fixtures";

describe("gateway numeric and configuration contracts", () => {
  it.each([
    { metric: "Loss", thresholds: [1, 3, 5] },
    { metric: "Mean RTT", thresholds: [100, 150, 300] },
    { metric: "Stddev", thresholds: [10, 20, 30] },
    { metric: "RTT variation", thresholds: [10, 20, 30] },
  ] as const)("colors $metric at exact raw-value boundaries and leaves missing/stale values neutral", ({ metric, thresholds: [low, medium, high] }) => {
    for (const [value, color] of [
      [0, "green"], [low - 0.0001, "green"], [low, "yellow"],
      [medium - 0.0001, "yellow"], [medium, "orange"],
      [high - 0.0001, "orange"], [high, "red"], [high * 2, "red"],
    ] as const) {
      const indicator = gatewayMetricIndicator(metric, value, true);
      expect(indicator.color).toBe(color);
      expect(indicator.tooltip).toContain("Green <");
      expect(indicator.tooltip).toContain("red >=");
    }
    for (const value of [null, 0, high]) {
      expect(gatewayMetricIndicator(metric, value, false).color).toBe("default");
      expect(gatewayMetricIndicator(metric, value, false).rating).toBe("Unrated");
    }
    expect(gatewayMetricIndicator(metric, null, true).color).toBe("default");
    if (metric === "Stddev" || metric === "RTT variation") expect(gatewayMetricIndicator(metric, low, true).tooltip).toContain("not");
  });
  it.each([
    [101.7203643, "ms", "101.72 ms"], [4.390802409838049, "ms", "4.39 ms"],
    [33.333333333333336, "%", "33.33 %"], [0.125, "ms", "0.13 ms"],
    [1.005, "ms", "1.01 ms"], [1.25, "ms", "1.25 ms"],
    [0, "%", "0 %"], [null, "ms", "Unavailable"],
  ] as const)("formats gateway metric %s %s to at most two decimal places", (value, unit, expected) => {
    expect(formatMetric(value, unit)).toBe(expected);
  });
  it("decodes DHCP capabilities and nullable resolved paths while keeping waiting health unknown", () => {
    const capabilities = { gateway_monitor_modes: ["explicit", "dhcp"], dhcp_gateway_monitor_address_families: ["ipv4"] };
    expect(runtimeSchema.parse({ ...runtime(), capabilities }).capabilities).toEqual(capabilities);
    expect(runtimeSchema.parse(runtime()).capabilities).toBeUndefined();
    const configured = gatewayMonitorSchema.parse({ name: "wan-health", enabled: true, mode: "dhcp", interface: "lab0", target: "1.1.1.1" });
    const waiting = { ...gatewayStatistics(), name: configured.name, mode: "dhcp", interface: "lab0", process_state: "waiting", sample_status: "waiting_for_dhcp", health: "down", resolved_source_address: null, resolved_gateway: null, resolved_routing_table: null, reason: "waiting for DHCP lease", rtt_avg_ms: null };
    const decoded = gatewayStatisticsPageSchema.parse({ sample: statistics().sample, monitors: [waiting] }).monitors[0]!;
    expect(decoded.resolved_source_address).toBeNull(); expect(decoded.reason).toBe("waiting for DHCP lease");
    expect(gatewayHealth(decoded, configured, Date.now(), false)).toBe("unknown");
    expect(formatMetric(decoded.rtt_avg_ms, "ms")).toBe("Unavailable");
    expect(gatewayStatisticsDetailSchema.parse({ sample: statistics().sample, monitor: waiting }).monitor.mode).toBe("dhcp");
    expect(runtimeSchema.parse({ ...runtime(), gateway_monitors: [waiting] }).gateway_monitors[0]?.reason).toBe(waiting.reason);
    expect(statisticsSchema.parse({ ...statistics(), gateways: [waiting] }).gateways?.[0]?.mode).toBe("dhcp");
  });
  it("saves DHCP monitors without a lease, static source or configured route and canonicalizes empty pins", () => {
    const candidate = config(); candidate.interfaces[0]!.kind = "ethernet"; candidate.interfaces[0]!.addresses = [];
    candidate.dhcp_clients = { lab0: { client_id: "", hostname: "", route_metric: 0, use_mtu: false, use_domains: "no" } };
    candidate.routes = [];
    const automatic = { name: "wan-health", enabled: true, mode: "dhcp", interface: "lab0", target: "1.1.1.1" };
    candidate.gateway_monitors = [gatewayMonitorSchema.parse(automatic)];
    expect(validateConfig(candidate)).toEqual([]);
    const parsed = gatewayMonitorSchema.parse({ ...automatic, source_address: "", gateway: "", routing_table: 0 });
    for (const key of ["source_address", "gateway", "routing_table"]) expect(parsed).not.toHaveProperty(key);
    expect(configSchema.parse(decodeJson(encodeJson(candidate))).gateway_monitors).toEqual(candidate.gateway_monitors);
    expect(gatewayMonitorSchema.parse({ ...monitor(), mode: "explicit" })).not.toHaveProperty("mode");
    const explicit = config(); explicit.gateway_monitors = [monitor()];
    const withMode = { ...explicit, gateway_monitors: [{ ...monitor(), mode: "explicit" as const }] };
    expect(equalConfig(explicit, withMode)).toBe(true); expect(differences(explicit, withMode)).toEqual([]);
    expect(equalConfig(candidate, configSchema.parse(decodeJson(encodeJson(candidate))))).toBe(true);
  });
  it.each([
    { source_address: "192.0.2.10" }, { gateway: "192.0.2.1" }, { routing_table: 254 }, { mode: null }, { mode: "automatic" },
  ])("rejects incompatible DHCP monitor fields %j", fields => {
    expect(gatewayMonitorSchema.safeParse({ name: "wan-health", enabled: true, mode: "dhcp", interface: "lab0", target: "1.1.1.1", ...fields }).success).toBe(false);
  });
  it("validates DHCP interface references even when disabled and IPv4-only targets", () => {
    const candidate = config(); candidate.gateway_monitors = [gatewayMonitorSchema.parse({ name: "wan-health", enabled: false, mode: "dhcp", interface: "lab0", target: "1.1.1.1" })];
    expect(validateConfig(candidate).some(issue => issue.message.includes("DHCP-configured"))).toBe(true);
    candidate.interfaces[0]!.kind = "ethernet"; candidate.interfaces[0]!.addresses = [];
    candidate.dhcp_clients = { lab0: { client_id: "", hostname: "", route_metric: 0, use_mtu: false, use_domains: "no" } };
    expect(validateConfig(candidate)).toEqual([]);
    candidate.interfaces[0]!.up = false; candidate.gateway_monitors[0]!.enabled = true;
    expect(validateConfig(candidate).some(issue => issue.message.includes("up managed"))).toBe(true);
    candidate.interfaces[0]!.up = true; candidate.gateway_monitors[0]!.target = "2001:db8::1";
    expect(validateConfig(candidate).some(issue => issue.message.includes("IPv4 unicast"))).toBe(true);
  });
  it("requires enabled monitors with the same exact source to share a table", () => {
    const candidate = config(); candidate.gateway_monitors = [monitor(), { ...monitor(), name: "second" }];
    expect(validateConfig(candidate)).toEqual([]);
    candidate.routes.push({ ...candidate.routes[0]!, table: 254 });
    candidate.gateway_monitors[1]!.routing_table = 254;
    expect(validateConfig(candidate).some(issue => issue.message.includes("sharing a source address"))).toBe(true);
    candidate.gateway_monitors[1]!.enabled = false;
    expect(validateConfig(candidate)).toEqual([]);
  });
  it("preserves measured IPv6 controls without presenting simulator values as measurements", () => {
    const measured = { enabled: false, status: "measured", disable_ipv6: { all: "1", default: "1", lo: "1", unmanaged0: "1" }, drift: false };
    expect(runtimeSchema.parse({ ...runtime(), ipv6: measured }).ipv6).toEqual(measured);
    expect(runtimeSchema.parse({ ...runtime(), ipv6: { enabled: true, status: "simulated", disable_ipv6: null, drift: null } }).ipv6?.disable_ipv6).toBeNull();
    expect(runtimeSchema.safeParse({ ...runtime(), ipv6: { ...measured, disable_ipv6: { all: "true" } } }).success).toBe(false);
  });
  it("preserves fractional metrics, exact revisions and quoted counters together", () => {
    const decoded = decodeJson('{"revision":18446744073709551615,"loss_percent":33.333333333333336,"rtt_avg_ms":0.125,"rx_bytes":"18446744073709551615"}');
    expect(decoded).toEqual({ revision: "18446744073709551615", loss_percent: 100 / 3, rtt_avg_ms: 0.125, rx_bytes: "18446744073709551615" });
    expect(encodeJson(decoded)).toContain('"revision":18446744073709551615');
    expect(() => decodeJson('{"count":9007199254740993}')).toThrow("Unsafe");
    expect(() => decodeJson('{"rtt":1e999}')).toThrow("Unsafe");
  });
  it("normalizes documented defaults while retaining disabled settings and zero variation", () => {
    const parsed = gatewayMonitorSchema.parse({ ...monitor(), probe_interval_ms: 0, window_ms: undefined });
    expect(parsed.probe_interval_ms).toBe(1000); expect(parsed.window_ms).toBe(30000); expect(parsed.rtt_variation_threshold_ms).toBe(0);
    const candidate = config(); candidate.gateway_monitors = [{ ...monitor(), enabled: false, interface: "absent0" }];
    expect(validateConfig(candidate)).toEqual([]);
    expect(configSchema.parse(decodeJson(encodeJson(candidate))).gateway_monitors).toEqual(candidate.gateway_monitors);
  });
  it("requires matching source/interface/route/table only when enabled without public policy rules", () => {
    const candidate = config(); candidate.gateway_monitors = [monitor()];
    expect(validateConfig(candidate)).toEqual([]);
    candidate.interfaces[0]!.up = false;
    expect(validateConfig(candidate).some(issue => issue.message.includes("up managed"))).toBe(true);
    candidate.interfaces[0]!.up = true; candidate.routes = [];
    expect(validateConfig(candidate).some(issue => issue.message.includes("matching route"))).toBe(true);
    candidate.gateway_monitors[0]!.enabled = false;
    expect(validateConfig(candidate).filter(issue => issue.path.startsWith("gateway_monitors"))).toEqual([]);
    candidate.gateway_monitors[0]!.enabled = true; candidate.routes = config().routes;
    expect(validateConfig(candidate)).toEqual([]);
  });
  it("requires an enabled matching route for explicit monitors and permits a shared route/monitor disable draft", () => {
    const candidate = config(); candidate.gateway_monitors = [monitor()];
    candidate.routes[0]!.enabled = false;
    expect(validateConfig(candidate).some(issue => issue.path.startsWith("gateway_monitors") && issue.message.includes("matching route"))).toBe(true);
    candidate.gateway_monitors[0]!.enabled = false;
    expect(validateConfig(candidate)).toEqual([]);
    const before = config(); before.gateway_monitors = [monitor()];
    expect(requiredPermissions(differences(before, candidate))).toEqual(["transactions.write", "routes.write", "gateway_monitors.write"]);
  });
  it("accepts explicit IPv6 link-local next hop and target scoped by interface", () => {
    const candidate = config(); candidate.gateway_monitors = [{ ...monitor(), source_address: "2001:db8::10", gateway: "fe80::1", target: "fe80::1" }];
    candidate.routes = [{ enabled: true, destination: "fe80::/64", interface: "lab0", table: 10000, metric: 1 }];
    expect(validateConfig(candidate)).toEqual([]);
  });
  it.each(["127.0.0.1", "0.0.0.0", "host.example", "fe80::1%lab0", "::ffff:192.0.2.1"])("rejects invalid source %s", source => {
    const candidate = config(); candidate.gateway_monitors = [{ ...monitor(), enabled: false, source_address: source }];
    expect(validateConfig(candidate).some(issue => issue.path.startsWith("gateway_monitors"))).toBe(true);
  });
  it.each([
    ["probe_interval_ms", 99], ["probe_interval_ms", 60001], ["loss_timeout_ms", 99], ["loss_timeout_ms", 10001],
    ["window_ms", 999], ["window_ms", 300001], ["window_ms", 3999], ["latency_threshold_ms", 0],
    ["latency_threshold_ms", 60001], ["loss_threshold_percent", 0], ["loss_threshold_percent", 101],
    ["rtt_variation_threshold_ms", -1], ["rtt_variation_threshold_ms", 60001], ["failure_hold_ms", 99],
    ["failure_hold_ms", 60001], ["recovery_hold_ms", 99], ["recovery_hold_ms", 60001], ["routing_table", 9999],
  ] as const)("validates exact %s bound %s", (key, value) => {
    const candidate = config(), valueMonitor = monitor(); valueMonitor[key] = value;
    candidate.gateway_monitors = [valueMonitor];
    expect(validateConfig(candidate).some(issue => issue.path === `gateway_monitors.0.${key}`)).toBe(true);
  });
  it("enforces the <=1024 intervals cap and >=3 intervals window", () => {
    const candidate = config(); candidate.gateway_monitors = [{ ...monitor(), probe_interval_ms: 100, loss_timeout_ms: 100, window_ms: 102401 }];
    expect(validateConfig(candidate).some(issue => issue.path.endsWith(".window_ms"))).toBe(true);
    candidate.gateway_monitors[0]!.probe_interval_ms = 60000; candidate.gateway_monitors[0]!.window_ms = 120000;
    expect(validateConfig(candidate).some(issue => issue.path.endsWith(".window_ms"))).toBe(true);
  });
  it("normalizes monitor identity, permissions and appliance server order without reordering rules", () => {
    const before = config(), after = config();
    after.gateway_monitors = [monitor(), { ...monitor(), name: "other" }];
    after.ntp = { enabled: false, servers: ["b.example", "a.example"] };
    after.syslog = { enabled: true, servers: [{ host: "logs.example", port: 6514, transport: "tls" }] };
    after.vnstat.enabled = true;
    expect(requiredPermissions(differences(before, after))).toEqual(["transactions.write", "gateway_monitors.write", "ntp.write", "syslog.write", "vnstat.write"]);
    const reordered = structuredClone(after); reordered.gateway_monitors.reverse(); reordered.ntp.servers.reverse();
    expect(equalConfig(after, reordered)).toBe(true);
  });
});
describe("gateway sample truthfulness", () => {
  it.each([null, "2026-10-23T12:00:00Z"])("preserves sample start time %s across statistics responses", started_at => {
    const sample = { ...statistics().sample, started_at };
    expect(gatewayStatisticsPageSchema.parse({ sample, monitors: [] }).sample.started_at).toBe(started_at);
    expect(gatewayStatisticsDetailSchema.parse({ sample, monitor: gatewayStatistics() }).sample.started_at).toBe(started_at);
    expect(statisticsSchema.parse({ ...statistics(), sample }).sample.started_at).toBe(started_at);
  });
  it("still rejects invalid start-time types and missing collection times", () => {
    for (const started_at of [42, {}, undefined]) {
      expect(gatewayStatisticsPageSchema.safeParse({ sample: { ...statistics().sample, started_at }, monitors: [] }).success).toBe(false);
    }
    expect(gatewayStatisticsPageSchema.safeParse({ sample: { ...statistics().sample, started_at: null, collected_at: null }, monitors: [] }).success).toBe(false);
  });
  it("distinguishes real zero from null loss/RTT/variation", () => {
    const sample = gatewayStatistics(); sample.rtt_variation_ms = null;
    const page = gatewayStatisticsPageSchema.parse(decodeJson(encodeJson({ sample: statistics().sample, monitors: [sample] })));
    expect(page.monitors[0]!.rtt_min_ms).toBe(0); expect(page.monitors[0]!.rtt_variation_ms).toBeNull();
    expect(formatMetric(0, "ms")).toBe("0 ms"); expect(formatMetric(null, "ms")).toBe("Unavailable");
  });
  it("uses measurement time, not fresh retrieval time, and marks health unknown past threshold", () => {
    const row = gatewayStatistics(), value = monitor(), now = Date.now();
    row.collected_at = new Date(now - 3000).toISOString();
    expect(gatewayHealth(row, value, now, false)).toBe("up");
    expect(gatewaySampleState(row, value, now + 1, false)).toBe("stale");
    expect(gatewayHealth(row, value, now + 1, false)).toBe("unknown");
    expect(gatewayHealth(row, value, now, true)).toBe("unknown");
  });
  it.each(["warming_up", "simulated", "disabled", "unavailable", "future"])("never reports current reachability for %s", sample_status => {
    const row = { ...gatewayStatistics(), sample_status };
    expect(gatewayHealth(row, monitor(), Date.now(), false)).toBe("unknown");
  });
  it("does not classify local worker errors as remote down", () => {
    const row = gatewayStatistics(); row.health = "down"; row.error = "FIB path failed";
    expect(gatewayHealth(row, monitor(), Date.now(), false)).toBe("unknown");
    row.error = undefined; row.process_state = "exited";
    expect(gatewayHealth(row, monitor(), Date.now(), false)).toBe("unknown");
  });
});
describe("appliance configuration and all-service repair", () => {
  it.each(["127.0.0.1", "::1", "10.0.0.1", "fd00::1", "clock.example", "a", `${"a".repeat(63)}.example`])("accepts host %s", host => expect(() => validateServerHost(host)).not.toThrow());
  it.each(["", "UPPER.example", "a.", " a", "https://a", "a:123", "192.168.001.1", "256.1.1.1", "0.0.0.0", "224.0.0.1", "169.254.1.1", "fe80::1", "::ffff:192.0.2.1", "-a", "a-", "a..b", "a".repeat(64)])("rejects host %s", host => expect(() => validateServerHost(host)).toThrow());
  it("enforces disabled/enabled server limits, duplicates, explicit ports and transport", () => {
    const candidate = config(); candidate.ntp.enabled = true; candidate.syslog.enabled = true;
    expect(validateConfig(candidate).filter(issue => /^(ntp|syslog)/.test(issue.path))).toHaveLength(2);
    candidate.ntp.servers = Array.from({ length: 8 }, (_, index) => `clock${index}.example`);
    candidate.syslog.servers = [{ host: "logs.example", port: 6514, transport: "tls" }];
    expect(validateConfig(candidate)).toEqual([]);
    candidate.ntp.servers.push("extra.example");
    candidate.syslog.servers.push({ ...candidate.syslog.servers[0]! });
    expect(validateConfig(candidate).filter(issue => /^(ntp|syslog)/.test(issue.path))).toHaveLength(2);
    candidate.syslog.enabled = false; candidate.syslog.servers[0]!.port = 0;
    expect(validateConfig(candidate).some(issue => issue.path.startsWith("syslog"))).toBe(true);
  });
  it("preserves disabled lists through complete package serialization", () => {
    const candidate = config(); candidate.ntp.servers = ["clock.example"];
    candidate.syslog.servers = [{ host: "::1", port: 65535, transport: "tcp" }];
    expect(configSchema.parse(decodeJson(encodeJson(candidate)))).toEqual(candidate);
    expect(validateConfig(candidate)).toEqual([]);
  });
  it("includes every enabled service for every repair endpoint, never just its own permission", () => {
    const candidate = config(); candidate.ntp.enabled = true; candidate.syslog.enabled = true; candidate.vnstat.enabled = true;
    candidate.gateway_monitors = [monitor()]; candidate.softflowd[0]!.enabled = true; candidate.interfaces[0]!.dhcp_relay.enabled = true;
    for (const service of ["ntp", "syslog", "vnstat", "softflowd", "dhcp-relay", "gateway-monitoring"] as const) {
      expect(new Set(serviceRepairPermissions(candidate, service))).toEqual(new Set([
        "state.read", "transactions.write", "interfaces.write", "softflowd.write", "gateway_monitors.write", "ntp.write", "syslog.write", "vnstat.write",
      ]));
    }
  });
  it("keeps two vnStat scopes and per-row/top-level errors", () => {
    const data = runtime(), services = data.appliance_services.filter(isApplianceStatus);
    services[2]!.database_directory = "/state/host";
    services[3]!.database_directory = "/state/managed"; services[3]!.error = "inventory failed";
    data.error = "runtime failed";
    expect(runtimeSchema.parse(decodeJson(encodeJson(data)))).toEqual(data);
  });
});
