import { beforeEach, describe, expect, it, vi } from "vitest";
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from "axios";
import api, { ApiFailure, onUnauthorized, request, setCredential } from "@/services/api";
import * as net from "@/services/netcontrol";
import { z } from "zod";
import { encodeJson } from "@/services/json";
import { config, state, runtime, transaction, statistics } from "../fixtures";

let status = 200, body = "{}", captured: InternalAxiosRequestConfig | undefined;
const adapter = vi.fn(async (input: InternalAxiosRequestConfig) => {
  captured = input;
  return { status, data: body, statusText: "", headers: new AxiosHeaders(), config: input };
});
beforeEach(() => {
  vi.clearAllMocks(); status = 200; body = "{}"; captured = undefined;
  api.defaults.adapter = adapter; setCredential("test-secret-never-persist");
});
describe("same-origin authenticated API boundary", () => {
  it("uses trusted /api/v1, read timeout, no cache/cookies, and rejects redirects", () => {
    expect(api.defaults.baseURL).toBe("/api/v1");
    expect(api.defaults.timeout).toBe(80_000);
    expect(api.defaults.fetchOptions).toEqual({ redirect: "error", credentials: "omit", cache: "no-store" });
  });
  it("sends bearer auth without browser persistence or URL leakage", async () => {
    body = encodeJson(state());
    await net.getState();
    expect(captured?.headers.Authorization).toBe("Bearer test-secret-never-persist");
    expect(captured?.url).toBe("/state");
    expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
    expect(location.href).not.toContain("test-secret");
    expect(JSON.stringify(config())).not.toContain("test-secret");
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
  it("stops on non-JSON 401 and bounds/sanitizes diagnostics", async () => {
    const unauthorized = vi.fn(() => setCredential("")); onUnauthorized(unauthorized);
    status = 401; body = `<h1>test-secret-never-persist</h1>${"x".repeat(6000)}`;
    await expect(net.getState()).rejects.toThrow("HTTP 401");
    expect(unauthorized).toHaveBeenCalledOnce();
    try { await net.getState(); } catch (failure) {
      expect(String(failure)).not.toContain("test-secret-never-persist"); expect(String(failure).length).toBeLessThan(4300);
      expect(String(failure)).not.toContain("<h1>");
    }
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
    status = 403; body = '{"error":"test-secret-never-persist","transaction":null}';
    await expect(net.getState()).rejects.toThrow("[redacted]");
    expect(logs.flatMap(log => log.mock.calls).flat().join(" ")).not.toContain("test-secret-never-persist");
    logs.forEach(log => log.mockRestore());
  });
});
