import { describe, expect, it } from "vitest";
import { configSchema, gatewayMonitorSchema, gatewayStatisticsPageSchema, runtimeSchema } from "@/types/domain";
import { decodeJson, encodeJson } from "@/services/json";
import { differences, equalConfig, requiredPermissions, serviceRepairPermissions, validateConfig, validateServerHost } from "@/services/configuration";
import { gatewayHealth, gatewaySampleState, formatMetric } from "@/services/gatewayHealth";
import { config, gatewayStatistics, monitor, runtime, statistics } from "../fixtures";

describe("gateway numeric and configuration contracts", () => {
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
  it("requires matching source/interface/route/table/rule only when enabled", () => {
    const candidate = config(); candidate.gateway_monitors = [monitor()];
    expect(validateConfig(candidate)).toEqual([]);
    candidate.interfaces[0]!.up = false;
    expect(validateConfig(candidate).some(issue => issue.message.includes("up managed"))).toBe(true);
    candidate.interfaces[0]!.up = true; candidate.routes = [];
    expect(validateConfig(candidate).some(issue => issue.message.includes("matching route"))).toBe(true);
    candidate.gateway_monitors[0]!.enabled = false;
    expect(validateConfig(candidate).filter(issue => issue.path.startsWith("gateway_monitors"))).toEqual([]);
    candidate.gateway_monitors[0]!.enabled = true; candidate.routes = config().routes; candidate.policy_rules = [];
    expect(validateConfig(candidate).some(issue => issue.message.includes("source-policy"))).toBe(true);
  });
  it("accepts explicit IPv6 link-local next hop and target scoped by interface", () => {
    const candidate = config(); candidate.gateway_monitors = [{ ...monitor(), source_address: "2001:db8::10", gateway: "fe80::1", target: "fe80::1" }];
    candidate.routes = [{ destination: "fe80::/64", interface: "lab0", table: 10000, metric: 1 }];
    candidate.policy_rules = [{ source: "2001:db8::/64", table: 10000, priority: 10000 }];
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
    const data = runtime(); data.appliance_services[2]!.database_directory = "/state/host";
    data.appliance_services[3]!.database_directory = "/state/managed"; data.appliance_services[3]!.error = "inventory failed";
    data.error = "runtime failed";
    expect(runtimeSchema.parse(decodeJson(encodeJson(data)))).toEqual(data);
  });
});
