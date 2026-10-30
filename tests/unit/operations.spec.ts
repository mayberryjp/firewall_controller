import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFailure } from "@/services/api";
import { dnsLookupRequestSchema, dnsLookupSchema, processRestartTarget } from "@/services/operations";
import { linkDiagnosticsSchema } from "@/services/linkDiagnostics";
import { statisticsSchema } from "@/types/domain";
import { useControllerStore } from "@/stores/controller";
import * as api from "@/services/netcontrol";
import { config, monitor, processHealthSnapshot, state, statistics, transaction } from "../fixtures";
import { dnsResponse, linkDiagnostics } from "../diagnosticsFixtures";

describe("operational contracts", () => {
  it("accepts exact link counters, signed growth and missing simulator sections", () => {
    const sample = linkDiagnosticsSchema.parse(linkDiagnostics());
    expect(sample.interfaces![0]!.drops).toBe("18446744073709551615");
    expect(sample.queues![0]!.backlog_growth_bytes).toBe("-256");
    expect(statisticsSchema.parse({ ...statistics(), link_diagnostics: sample }).link_diagnostics).toEqual(sample);
    expect(linkDiagnosticsSchema.parse({ ...sample, status: "simulated", age_ms: null, collected_at: null, interval_seconds: null, interfaces: null, queues: null, local_tcp: null, packet_headers: null, signals: [], coverage: undefined }).status).toBe("simulated");
    expect(linkDiagnosticsSchema.safeParse({ ...sample, interfaces: [{ ...sample.interfaces![0], drops: 123 }] }).success).toBe(false);
    expect(linkDiagnosticsSchema.safeParse({ ...sample, local_tcp: { ...sample.local_tcp, rtt_p50_ms: "1" } }).success).toBe(false);
  });
  it("validates strict DNS requests, defaults, normalization and boundary limits", () => {
    expect(dnsLookupRequestSchema.parse({ interface: "wan0", hostname: "Example.TEST." })).toEqual({ interface: "wan0", hostname: "example.test", record_type: "A", timeout_ms: 2000 });
    expect(dnsLookupRequestSchema.parse({ server: "192.0.2.53", hostname: "Example.TEST." })).toEqual({ server: "192.0.2.53", hostname: "example.test", record_type: "A", timeout_ms: 2000 });
    expect(dnsLookupRequestSchema.safeParse({ hostname: "example.test" }).success).toBe(false);
    expect(dnsLookupRequestSchema.parse({ interface: null, server: "192.0.2.53", hostname: "example.test" })).toMatchObject({ interface: null, server: "192.0.2.53" });
    expect(dnsLookupRequestSchema.parse({ interface: "wan0", server: null, hostname: "example.test" })).toMatchObject({ interface: "wan0", server: null });
    for (const selection of [{ interface: null }, { server: null }, { interface: null, server: null }, { interface: "", server: "192.0.2.53" }, { interface: 123, server: "192.0.2.53" }, { interface: "wan0", server: false }]) {
      expect(dnsLookupRequestSchema.safeParse({ ...selection, hostname: "example.test" }).success).toBe(false);
    }
    for (const hostname of ["123", "127.1", [63, 63, 63, 61].map(length => "a".repeat(length)).join(".")]) {
      expect(dnsLookupRequestSchema.safeParse({ interface: "wan0", hostname }).success).toBe(true);
    }
    for (const timeout_ms of [100, 5000]) expect(dnsLookupRequestSchema.safeParse({ interface: "wan0", hostname: "test", timeout_ms }).success).toBe(true);
    for (const hostname of ["bad.test\n", "127.0.0.1", "::1", "bad..test", "bad_.test", "a".repeat(64), Array(5).fill("a".repeat(63)).join(".")]) {
      expect(dnsLookupRequestSchema.safeParse({ interface: "wan0", hostname }).success).toBe(false);
    }
    for (const server of ["1.1.1.1", "2606:4700:4700::1111"]) {
      expect(dnsLookupRequestSchema.parse({ interface: "wan0", hostname: "test", server }).server).toBe(server);
    }
    for (const server of ["resolver.example.com", "1.1.1.1:53", "invalid"]) {
      expect(dnsLookupRequestSchema.safeParse({ interface: "wan0", hostname: "test", server }).success).toBe(false);
    }
    expect(dnsLookupRequestSchema.safeParse({ interface: "wan0", hostname: "test", unknown: true }).success).toBe(false);
    const failed = { ...dnsResponse(), status: "failed", error: undefined, rtt_ms: null, server: null, transport: null, rcode: null, addresses: [], attempts: [{ server: "192.0.2.53", status: "failed", rtt_ms: null, error: "timeout" }] };
    expect(dnsLookupSchema.parse(failed).attempts[0]!.error).toBe("timeout");
  });
  it("accepts nullable DNS response interfaces without inventing egress identity, but requires the field", () => {
    for (const status of ["answered", "failed", "simulated"] as const) {
      expect(dnsLookupSchema.parse({ ...dnsResponse(), status, interface: null }).interface).toBeNull();
    }
    expect(dnsLookupSchema.parse(dnsResponse("wan0")).interface).toBe("wan0");
    expect(dnsLookupSchema.safeParse({ ...dnsResponse(), interface: undefined }).success).toBe(false);
    expect(dnsLookupSchema.safeParse({ ...dnsResponse(), interface: 123 }).success).toBe(false);
  });
  it("maps process observations only to documented targets, including manager aliases and shared workers", () => {
    const row = processHealthSnapshot().process_health.components[0]!;
    const desired = config(); desired.gateway_monitors = [monitor(), { mode: "dhcp", name: "auto", enabled: true, interface: "lab0", target: "198.51.100.1", probe_interval_ms: 1000, loss_timeout_ms: 2000, window_ms: 30000, latency_threshold_ms: 150, loss_threshold_percent: 20, rtt_variation_threshold_ms: 0, failure_hold_ms: 3000, recovery_hold_ms: 5000 }];
    for (const [component, resource, target] of [
      ["appliance_services", "vnstat", "vnstat"], ["appliance_services", "vnstat-host", null], ["appliance_services", "vnstat-managed", null], ["softflowd", "capture", "flow:capture"],
      ["dhcp_relay", "lab0", "dhcp-relay"], ["dhcp_client", "wan0", "dhcp-client:wan0"],
      ["gateway_monitors", "uplink", "gateway:uplink"], ["gateway_monitors", "auto", "dhcp-gateway-monitors"],
      ["managed_processes", "dynamic-dns", "dynamic-dns"], ["daemon_tasks", "dynamic_dns", "dynamic-dns"],
      ["system", "hostname", "system"], ["future", "future", null], ["platform", "runtime", null],
    ]) expect(processRestartTarget({ ...row, component: component!, resource: resource! }, desired)).toBe(target);
  });
});

describe("restart lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers(); setActivePinia(createPinia());
    const store = useControllerStore(); store.connected = true; store.state.data = state();
    vi.spyOn(api, "getPlatformStatus").mockResolvedValue(processHealthSnapshot());
    vi.spyOn(api, "restartProcess").mockResolvedValue({ target: "mqtt", status: "restart_requested", generation: 1 });
  });
  afterEach(() => { useControllerStore().$dispose(); vi.useRealTimers(); });
  it("single-flights all process requests and preserves drafts without a revision/config write", async () => {
    const store = useControllerStore(); store.stage(config()); const draft = JSON.stringify(store.draft);
    let finish!: (value: Awaited<ReturnType<typeof api.restartProcess>>) => void;
    vi.mocked(api.restartProcess).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = store.restartProcess("mqtt");
    await expect(store.restartProcess("ntp")).rejects.toThrow("restart is already");
    finish({ target: "mqtt", status: "restart_requested", generation: 1 }); await pending;
    await vi.advanceTimersByTimeAsync(30000);
    expect(api.restartProcess).toHaveBeenCalledExactlyOnceWith("mqtt");
    expect(store.restartNotice).toContain("not completed"); expect(JSON.stringify(store.draft)).toBe(draft);
    expect(store.state.data!.revision).toBe("2026.10.29.1");
  });
  it("blocks active transactions, upgrades and uncertain configuration writes", async () => {
    const store = useControllerStore(); store.transactions.data = { "tx-test": transaction() };
    await expect(store.restartProcess("ntp")).rejects.toThrow("active transaction");
    expect(api.restartProcess).not.toHaveBeenCalled();
    store.transactions.data = {}; store.upgradePending = true;
    await expect(store.restartProcess("ntp")).rejects.toThrow("upgrade");
  });
  it.each([false, true])("reconnects after daemon scheduling or unknown outcome (%s) without resubmitting", async unknown => {
    const store = useControllerStore(); store.stage(config()); const draft = JSON.stringify(store.draft);
    if (unknown) vi.mocked(api.restartProcess).mockRejectedValue(new ApiFailure("Connection lost", undefined, undefined, true));
    else vi.mocked(api.restartProcess).mockResolvedValue({ target: "netcontrold", status: "restart_requested" });
    vi.mocked(api.getPlatformStatus).mockRejectedValueOnce(new ApiFailure("offline", 503));
    await store.restartProcess("netcontrold"); expect(store.restartReconnecting).toBe(true);
    await vi.advanceTimersByTimeAsync(5000); expect(store.restartReconnecting).toBe(true);
    await vi.advanceTimersByTimeAsync(4000); expect(store.restartReconnecting).toBe(false);
    expect(store.restartNotice).toContain("Management is reachable");
    expect(api.restartProcess).toHaveBeenCalledTimes(1); expect(JSON.stringify(store.draft)).toBe(draft);
  });
  it("stops reconnect attempts after a bounded retry budget and reports the unknown outcome", async () => {
    const store = useControllerStore();
    vi.mocked(api.restartProcess).mockResolvedValue({ target: "netcontrold", status: "restart_requested" });
    vi.mocked(api.getPlatformStatus).mockRejectedValue(new ApiFailure("offline", 503));
    await store.restartProcess("netcontrold"); await vi.advanceTimersByTimeAsync(60000);
    expect(api.getPlatformStatus).toHaveBeenCalledTimes(8); expect(api.restartProcess).toHaveBeenCalledTimes(1);
    expect(store.restartReconnecting).toBe(false); expect(store.restartError).toContain("eight checks");
  });
  it("does not apply an old device's pending response after disconnect", async () => {
    const store = useControllerStore();
    let finish!: (value: Awaited<ReturnType<typeof api.restartProcess>>) => void;
    vi.mocked(api.restartProcess).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = store.restartProcess("netcontrold"); store.disconnect();
    finish({ target: "netcontrold", status: "restart_requested" }); await pending; await vi.advanceTimersByTimeAsync(60000);
    expect(store.restartNotice).toBe(""); expect(api.getPlatformStatus).not.toHaveBeenCalled();
  });
});
