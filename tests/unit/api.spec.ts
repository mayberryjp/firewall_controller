import { beforeEach, describe, expect, it, vi } from "vitest";
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from "axios";
import api, { ApiFailure, onUnauthorized, request, setApiDevice } from "@/services/api";
import { registryApiBaseUrl, setRegistrySessionToken } from "@/services/registry";
import * as net from "@/services/netcontrol";
import { z } from "zod";
import { decodeJson, encodeJson } from "@/services/json";
import { gatewayMonitorSchema, upgradeVersionSchema } from "@/types/domain";
import { config, state, runtime, transaction, statistics, gatewayStatistics, connections } from "../fixtures";

const deviceId = "11111111-1111-4111-8111-111111111111";
let status = 200, body = "{}", captured: InternalAxiosRequestConfig | undefined, responseHeaders = new AxiosHeaders();
const adapter = vi.fn(async (input: InternalAxiosRequestConfig) => {
  captured = input;
  return { status, data: body, statusText: "", headers: responseHeaders, config: input };
});
beforeEach(() => {
  vi.clearAllMocks(); status = 200; body = "{}"; captured = undefined; responseHeaders = new AxiosHeaders();
  api.defaults.adapter = adapter; setRegistrySessionToken("registry-test-session"); setApiDevice(deviceId);
});
describe("controller-proxied API boundary", () => {
  it("preserves DHCP monitor variants through full state, transaction reads and package writes without lease pins", async () => {
    const candidate = config();
    candidate.interfaces[0]!.kind = "ethernet"; candidate.interfaces[0]!.addresses = []; candidate.routes = [];
    candidate.dhcp_clients = { lab0: { client_id: "", hostname: "", route_metric: 0, use_mtu: false, use_domains: "no" } };
    candidate.gateway_monitors = [gatewayMonitorSchema.parse({ name: "wan-health", enabled: true, mode: "dhcp", interface: "lab0", target: "1.1.1.1" })];
    const pending = { ...transaction(), candidate, previous: candidate };
    body = encodeJson({ ...state(), desired: candidate, active_transaction: pending });
    expect((await net.getState()).active_transaction?.candidate).toEqual(candidate);
    body = encodeJson({ [pending.id]: pending });
    expect((await net.getTransactions())[pending.id]?.previous.gateway_monitors).toEqual(candidate.gateway_monitors);
    body = encodeJson(pending);
    expect((await net.submitPackage({ base_revision: "0", config: candidate, confirm_timeout_seconds: 120 })).candidate).toEqual(candidate);
    const sent = decodeJson(String(captured?.data)) as { config: { gateway_monitors: unknown[] } };
    expect(sent.config.gateway_monitors).toEqual(candidate.gateway_monitors);
    for (const key of ["source_address", "gateway", "routing_table"]) expect(sent.config.gateway_monitors[0]).not.toHaveProperty(key);
  });
  it("deletes only a complete projected connection identity and never falls back to a flush", async () => {
    const row = connections().connections[0]!;
    row.id = "123"; row.zone = 0; row.original.zone = null; row.reply.zone = null;
    body = encodeJson({ status: "deleted", scope: "host" });
    await net.deleteConnection(row);
    expect(captured?.url).toBe("/connections/123"); expect(captured?.method).toBe("delete");
    expect(decodeJson(String(captured?.data))).toEqual({ family: row.family, protocol: row.protocol, zone: row.zone, original: row.original });
    expect(net.connectionSelector({ ...row, id: null })).toBeNull();
    expect(net.connectionSelector({ ...row, id: "01" })).toBeNull();
    expect(net.connectionSelector({ ...row, protocol: 255 })).toBeNull();
    expect(() => net.deleteConnection({ ...row, id: null })).toThrow("complete deletion identity");
    expect(adapter).toHaveBeenCalledTimes(1);
    body = encodeJson({ status: "flushed", scope: "host" }); await net.deleteAllConnections();
    expect(captured?.url).toBe("/connections"); expect(decodeJson(String(captured?.data))).toEqual({ confirm: true });
  });
  it("treats uncertain DELETE outcomes as writes without retrying", async () => {
    adapter.mockRejectedValueOnce(new AxiosError("timeout", "ETIMEDOUT"));
    await expect(net.deleteAllConnections()).rejects.toMatchObject({ uncertain: true });
    expect(adapter).toHaveBeenCalledTimes(1);
  });
  it("reads disabled self-upgrade setup and submits only an explicit canonical version", async () => {
    body = encodeJson({ enabled: false, repository: null, job: null, last_successful_version: null });
    expect((await net.getSystemUpgrade()).enabled).toBe(false);
    status = 202;
    body = encodeJson({ id: "upgrade-1", version: "1.2.3", status: "queued", created_at: "2026-10-24T00:00:00Z", updated_at: "2026-10-24T00:00:00Z", error: null, last_successful_version: null });
    const accepted = await net.startSystemUpgrade("1.2.3"); expect(accepted.id).toBe("upgrade-1");
    expect(captured?.url).toBe("/system/upgrade"); expect(decodeJson(String(captured?.data))).toEqual({ version: "1.2.3" });
    for (const version of ["v1.2.3", "01.2.3", "1.2.3+build", "1.2.3-01", "https://example.test"]) expect(upgradeVersionSchema.safeParse(version).success).toBe(false);
    expect(upgradeVersionSchema.safeParse("1.2.3-rc.1").success).toBe(true);
    body = encodeJson({ ...accepted, version: "2.0.0" });
    await expect(net.startSystemUpgrade("1.2.3")).rejects.toMatchObject({ uncertain: true, incompatible: true });
  });
  it("reads filtered connection snapshots with exact nullable counters and strict schema", async () => {
    body = encodeJson(connections());
    const result = await net.getConnections({ address: "2001:db8::1", protocol: "tcp", port: 0, zone: 0, limit: 100, offset: 0 });
    expect(captured?.method).toBe("get"); expect(captured?.data).toBeUndefined();
    expect(captured?.url).toBe("/statistics/connections?address=2001%3Adb8%3A%3A1&protocol=tcp&port=0&zone=0&limit=100&offset=0");
    expect(result.connections[0]!.original_counters?.bytes).toBe("18446744073709551615");
    expect(result.connections[0]!.reply_counters).toBeNull();
    body = encodeJson({ ...connections(), schema: "unsupported" });
    await expect(net.getConnections()).rejects.toThrow("Incompatible API response");
  });
  it("retries one DHCP interface with a bodyless POST and strict accepted response", async () => {
    status = 202; body = encodeJson({ interface: "wan.10", status: "retrying" });
    expect(await net.retryDHCP("wan.10")).toEqual({ interface: "wan.10", status: "retrying" });
    expect(captured?.url).toBe("/interfaces/wan.10/dhcp/retry");
    expect(captured?.method).toBe("post"); expect(captured?.data).toBeUndefined();
    body = encodeJson({ interface: "wan.10", status: "leased" });
    await expect(net.retryDHCP("wan.10")).rejects.toThrow("Incompatible API response");
  });
  it("reads backend input policies in transaction maps and full state", async () => {
    const pending = transaction(), current = state();
    pending.candidate.firewall.input = { policy: "drop", interfaces: [{ interface: "lab0", rules: [{ action: "accept" }] }] };
    body = encodeJson({ [pending.id]: pending });
    expect((await net.getTransactions())[pending.id]?.candidate.firewall.input).toEqual(pending.candidate.firewall.input);
    current.desired.firewall.input = pending.candidate.firewall.input;
    current.active_transaction = pending;
    body = encodeJson(current);
    expect((await net.getState()).active_transaction?.candidate.firewall.input).toEqual(pending.candidate.firewall.input);
  });
  it("preserves host-input and forwarding policies in full-package submissions", async () => {
    const candidate = config(); candidate.firewall.rules = [];
    candidate.firewall.input = { policy: "drop", interfaces: [{ interface: "lab0", rules: [{ protocol: "udp", destination_ports: [68], action: "accept" }] }] };
    candidate.firewall.policies = { hosts: [], interfaces: [{ interface: "lab0", rules: [{ out_interface: "lab0", action: "accept" }] }] };
    const pending = transaction(); pending.candidate = candidate; body = encodeJson(pending);
    const result = await net.submitPackage({ base_revision: "0", config: candidate, confirm_timeout_seconds: 120 });
    expect(decodeJson(String(captured?.data))).toMatchObject({ config: { firewall: candidate.firewall } });
    expect(result.candidate.firewall).toEqual(candidate.firewall);
  });
  it("reads discovered NICs without converting null simulator identity or hiding errors", async () => {
    const inventory = [{ name: "eth0", kind: "ethernet", index: null, mac: null, mtu: 1500, up: true, addresses: [], ownership: "unmanaged" }];
    body = encodeJson(inventory);
    expect(await net.getDiscoveredInterfaces()).toEqual(inventory);
    expect(captured?.url).toBe("/interfaces/discovered");
    expect(captured?.method).toBe("get");
    body = "null";
    await expect(net.getDiscoveredInterfaces()).rejects.toThrow(/Incompatible API response/);
  });
  it("targets the selected device through the registry with no cache/cookies or redirects", () => {
    expect(api.defaults.baseURL).toBe(`${registryApiBaseUrl}/devices/${deviceId}/proxy`);
    expect(api.defaults.timeout).toBe(80_000);
    expect(api.defaults.fetchOptions).toEqual({ redirect: "error", credentials: "omit", cache: "no-store" });
  });
  it("selects only a saved device ID and restores the registry base when disconnected", () => {
    const otherId = "22222222-2222-4222-8222-222222222222";
    setApiDevice(otherId);
    expect(api.defaults.baseURL).toBe(`${registryApiBaseUrl}/devices/${otherId}/proxy`);
    expect(() => setApiDevice("https://device.example")).toThrow(/saved firewall/);
    setApiDevice("");
    expect(api.defaults.baseURL).toBe(registryApiBaseUrl);
  });
  it("sends the registry session without persisting a firewall key or leaking tokens in URLs", async () => {
    body = encodeJson(state());
    await net.getState();
    expect(captured?.headers.Authorization).toBe("Bearer registry-test-session");
    expect(captured?.url).toBe("/state");
    expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
    expect(location.href).not.toContain("registry-test-session");
    expect(JSON.stringify(config())).not.toContain("registry-test-session");
  });
  it.each([
    ["state", "/state"], ["runtime", "/runtime"], ["transactions", "/transactions"], ["statistics", "/statistics"],
  ])("reads the exact %s endpoint", async (resource, path) => {
    const actions = {
      state: () => net.getState(), runtime: () => net.getRuntime(), transactions: () => net.getTransactions(), statistics: () => net.getStatistics(),
    };
    const data = { state: state(), runtime: runtime(), transactions: { "tx-test": transaction() }, statistics: statistics() };
    if (!(resource in actions)) throw new Error("Unknown test resource");
    const key = resource as keyof typeof actions;
    body = encodeJson(data[key]); await actions[key]();
    expect(captured?.url).toBe(path); expect(captured?.method).toBe("get");
  });
  it("serializes exact uint64 base as a numeric token and preserves whole config", async () => {
    body = encodeJson(transaction());
    const configValue = config();
    await net.submitPackage({ base_revision: "18446744073709551615", confirm_timeout_seconds: 120, config: configValue });
    expect(captured?.url).toBe("/transactions"); expect(captured?.method).toBe("post");
    expect(captured?.timeout).toBe(90_000);
    expect(captured?.data).toContain('"base_revision":18446744073709551615');
    expect(captured?.data).toContain('"kernel"');
    expect(captured?.headers["Content-Type"]).toBe("application/json");
  });
  it.each(["confirm", "rollback"] as const)("uses a bodyless encoded %s POST", async action => {
    body = encodeJson(transaction());
    if (action === "confirm") await net.confirmTransaction("tx /1"); else await net.rollbackTransaction("tx /1");
    expect(captured?.url).toBe(`/transactions/tx%20%2F1/${action}`);
    expect(captured?.data).toBeUndefined();
  });
  it("uses restore endpoint including revision zero, not a package submit", async () => {
    body = encodeJson(transaction());
    await net.restoreRevision("0", { base_revision: "0", confirm_timeout_seconds: 120 });
    expect(captured?.url).toBe("/revisions/0/restore"); expect(captured?.data).not.toContain('"config"');
  });
  it("reconciles services bodylessly", async () => {
    body = encodeJson(runtime()); await net.reconcileServices();
    expect(captured?.url).toBe("/services/softflowd/reconcile"); expect(captured?.data).toBeUndefined();
  });
  it("reads relay status with visible top-level and per-interface errors", async () => {
    body = encodeJson({ interfaces: [{ interface: "lab0", state: "unavailable", error: "binary unavailable" }], error: "relay runtime failed" });
    const result = await net.getDHCPRelayStatus();
    expect(captured?.url).toBe("/services/dhcp-relay/status");
    expect(result.error).toBe("relay runtime failed");
    expect(result.interfaces[0]?.error).toBe("binary unavailable");
  });
  it("repairs relay via the bodyless relay endpoint and decodes shared runtime", async () => {
    body = encodeJson(runtime());
    const result = await net.reconcileServices("dhcp-relay");
    expect(captured?.url).toBe("/services/dhcp-relay/reconcile");
    expect(captured?.data).toBeUndefined();
    expect(result.dhcp_relay[0]?.state).toBe("disabled");
  });
  it.each([400, 403, 422])("surfaces HTTP %s without replay or uncertain-success fallback", async code => {
    status = code; body = '{"error":"role or relay rejected","transaction":null}';
    await expect(net.submitPackage({ base_revision: "0", config: config(), confirm_timeout_seconds: 120 }))
      .rejects.toMatchObject({ status: code, uncertain: false });
    expect(adapter).toHaveBeenCalledOnce();
  });
  it("uses the supplied exact history cursor", async () => {
    body = '{"revisions":[],"next_before_revision":9007199254740993}';
    const page = await net.getRevisions("18446744073709551615");
    expect(captured?.url).toBe("/revisions?limit=50&before_revision=18446744073709551615");
    expect(page.next_before_revision).toBe("9007199254740993");
  });
  it("reads independent fractional gateway measurements with no query", async () => {
    body = encodeJson({ sample: statistics().sample, monitors: [gatewayStatistics()] });
    const data = await net.getGatewayStatistics();
    expect(captured?.url).toBe("/statistics/gateways");
    expect(data.monitors[0]?.rtt_avg_ms).toBe(1.25);
    body = encodeJson({ sample: statistics().sample, monitor: gatewayStatistics() });
    await net.getGatewayStatistic("a /b");
    expect(captured?.url).toBe("/statistics/gateways/a%20%2Fb");
  });
  it.each(["ntp", "syslog", "vnstat"] as const)("reads %s metadata/status and repairs bodylessly", async service => {
    body = encodeJson(config()[service]);
    await net.getApplianceConfig(service); expect(captured?.url).toBe(`/services/${service}`);
    body = encodeJson({ instances: runtime().appliance_services, error: "partial" });
    expect((await net.getApplianceStatus(service)).error).toBe("partial");
    expect(captured?.url).toBe(`/services/${service}/status`);
    body = encodeJson(runtime()); await net.reconcileServices(service);
    expect(captured?.url).toBe(`/services/${service}/reconcile`); expect(captured?.data).toBeUndefined();
  });
  it("surfaces unknown gateway 404 without manufacturing an empty successful sample", async () => {
    status = 404; body = '{"error":"gateway monitor not found","transaction":null}';
    await expect(net.getGatewayStatistic("missing")).rejects.toMatchObject({ status: 404 });
    expect(adapter).toHaveBeenCalledOnce();
  });
  it("stops on non-JSON registry 401 and bounds/sanitizes diagnostics", async () => {
    const unauthorized = vi.fn(() => setRegistrySessionToken("")); onUnauthorized(unauthorized);
    responseHeaders = new AxiosHeaders({ "X-Registry-Auth-Error": "true" });
    status = 401; body = `<h1>registry-test-session</h1>${"x".repeat(6000)}`;
    await expect(net.getState()).rejects.toThrow("HTTP 401");
    expect(unauthorized).toHaveBeenCalledOnce();
    try { await net.getState(); } catch (failure) {
      expect(String(failure)).not.toContain("registry-test-session"); expect(String(failure).length).toBeLessThan(4300);
      expect(String(failure)).not.toContain("<h1>");
    }
  });
  it("does not treat a firewall 401 as an expired registry session", async () => {
    const unauthorized = vi.fn(); onUnauthorized(unauthorized);
    status = 401; body = '{"error":"Invalid device key","transaction":null}';
    await expect(net.getState()).rejects.toMatchObject({ status: 401 });
    expect(unauthorized).not.toHaveBeenCalled();
  });
  it("retains a transaction on operational failure", async () => {
    status = 500; body = encodeJson({ error: "recovery detail", transaction: transaction("recovery_failed") });
    await expect(net.submitPackage({ base_revision: "0", config: config(), confirm_timeout_seconds: 120 }))
      .rejects.toMatchObject({ status: 500, uncertain: true, transaction: { status: "recovery_failed" } });
  });
  it("rejects malformed successful response visibly rather than inventing empty state", async () => {
    body = '{"revision":0,"desired":{}}';
    await expect(net.getState()).rejects.toMatchObject({ incompatible: true });
  });
  it("does not retry a failed POST and marks unknown outcome", async () => {
    adapter.mockRejectedValueOnce(new AxiosError("offline", "ERR_NETWORK"));
    await expect(net.confirmTransaction("one")).rejects.toMatchObject({ uncertain: true });
    expect(adapter).toHaveBeenCalledOnce();
  });
  it("measures complete UTF-8 request before sending", async () => {
    await expect(request("POST", "/transactions", z.unknown(), { text: "é".repeat(524288) })).rejects.toBeInstanceOf(ApiFailure);
    expect(adapter).not.toHaveBeenCalled();
  });
  it("accepts exactly 1 MiB and rejects a request one byte larger", async () => {
    body = '{"ok":true}';
    await request("POST", "/boundary", z.object({ ok: z.boolean() }), { text: "x".repeat(1_048_565) });
    expect(adapter).toHaveBeenCalledOnce();
    await expect(request("POST", "/boundary", z.unknown(), { text: "x".repeat(1_048_566) })).rejects.toThrow("1 MiB");
    expect(adapter).toHaveBeenCalledOnce();
  });
  it("does not log a credential or reflected response payload", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    status = 403; body = '{"error":"registry-test-session","transaction":null}';
    await expect(net.getState()).rejects.toThrow("[redacted]");
    expect(logs.flatMap(log => log.mock.calls).flat().join(" ")).not.toContain("registry-test-session");
    logs.forEach(log => log.mockRestore());
  });
});
