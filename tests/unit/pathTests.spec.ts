import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { ApiFailure } from "@/services/api";
import * as api from "@/services/netcontrol";
import { useControllerStore } from "@/stores/controller";
import { generatePairingSecret, pathAddresses, pathTestRequestSchema, pathTestStatusSchema, validatePathInterfaces } from "@/services/pathTests";
import { pathTestInterfaces, pathTestRequest, pathTestResult, pathTestStatus } from "../pathTestFixtures";
import { config, state, transaction } from "../fixtures";

describe("path-test contracts", () => {
  it("accepts live VLAN/tunnel sources without MACs and never invents an interface/source/maximum", () => {
    const request = pathTestRequest();
    expect(pathTestRequestSchema.parse(request)).toEqual(request);
    expect(pathAddresses(pathTestInterfaces()[0]!)).toEqual(["192.0.2.1", "2001:db8::1"]);
    expect(() => validatePathInterfaces(request, pathTestInterfaces())).not.toThrow();
    const tunnel = { ...request, interface: "gre0", source_address: "198.51.100.1", peer_address: "198.51.100.2", parents: [] };
    expect(() => validatePathInterfaces(tunnel, pathTestInterfaces())).not.toThrow();
    for (const field of ["interface", "source_address", "maximum_mtu", "pairing_secret"] as const) {
      expect(pathTestRequestSchema.safeParse({ ...request, [field]: undefined }).success).toBe(false);
    }
  });
  it.each(["", "bad", "127.0.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "::", "::1", "ff02::1", "fe80::1", "::ffff:192.0.2.1"])("rejects invalid peer %s without throwing outside validation", peer => {
    expect(pathTestRequestSchema.safeParse({ ...pathTestRequest(), peer_address: peer }).success).toBe(false);
  });
  it("checks family, equality, MTU/port bounds, parents and strict secret constraints", () => {
    const request = pathTestRequest();
    for (const patch of [
      { peer_address: request.source_address }, { peer_address: "2001:db8::2" },
      { maximum_mtu: 1279 }, { maximum_mtu: 65536 }, { maximum_mtu: 1500.5 }, { port: 1023 }, { port: 65536 },
      { parents: [{ interface: request.interface, maximum_mtu: 9000 }] },
      { parents: [...request.parents, ...request.parents] },
      { parents: Array.from({ length: 9 }, (_, i) => ({ interface: `eth${i}`, maximum_mtu: 9000 })) },
      { pairing_secret: "short" }, { pairing_secret: " ".repeat(32) }, { pairing_secret: "x".repeat(129) },
      { pairing_secret: "\u00e9".repeat(32) }, { unknown: true },
    ]) expect(pathTestRequestSchema.safeParse({ ...request, ...patch }).success).toBe(false);
    expect(pathTestRequestSchema.parse({ ...request, port: undefined, parents: undefined })).toMatchObject({ port: 49872, parents: [] });
    expect(() => validatePathInterfaces({ ...request, source_address: "192.0.2.99" }, pathTestInterfaces())).toThrow("no longer assigned");
    expect(() => validatePathInterfaces({ ...request, maximum_mtu: 1280 }, pathTestInterfaces())).toThrow("current live MTU");
    expect(() => validatePathInterfaces({ ...request, parents: [{ interface: "eno1", maximum_mtu: 1280 }] }, pathTestInterfaces())).toThrow("current live MTU");
  });
  it("generates 32 random bytes as 64 hex characters without persisting", () => {
    const random = vi.spyOn(crypto, "getRandomValues");
    const storage = vi.spyOn(Storage.prototype, "setItem");
    expect(generatePairingSecret()).toMatch(/^[a-f0-9]{64}$/);
    expect(random.mock.calls[0]![0]).toHaveLength(32);
    expect(storage).not.toHaveBeenCalled(); random.mockRestore(); storage.mockRestore();
  });
  it("retains separate progress, measurements and cleanup ownership, including null sender evidence", () => {
    const sample = { ...pathTestStatus(true), state: "cleanup_failed", error: "MTU identity changed", result: pathTestResult() };
    const parsed = pathTestStatusSchema.parse(sample);
    expect(parsed.active).toBe(true);
    expect(parsed.result?.udp.inbound.sizes[0]!.sent).toBeNull();
    expect(parsed.result?.udp.outbound.sizes[0]!.ack_timeouts).toBe(0);
    expect(parsed.result?.tcp.outbound_trials[1]!.error).toBe("Peer authentication timed out");
    expect(parsed.result?.limits.path_mtu_bytes).toBeNull();
    expect(pathTestStatusSchema.safeParse({ ...sample, id: "protocol-id" }).success).toBe(false);
    expect(pathTestStatusSchema.safeParse({ ...sample, result: { ...sample.result, limits: { ...sample.result.limits, path_mtu_bytes: 1500 } } }).success).toBe(false);
  });
});

describe("shared path-test lifecycle", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    const store = useControllerStore(); store.connected = true;
    store.state.data = state(); store.state.stale = false; store.state.lastSuccess = Date.now();
    vi.spyOn(api, "getState").mockResolvedValue(state());
    vi.spyOn(api, "getTransactions").mockResolvedValue({});
    vi.spyOn(api, "getDiscoveredInterfaces").mockResolvedValue(pathTestInterfaces());
    vi.spyOn(api, "getPathTests").mockResolvedValue(pathTestStatus());
    vi.spyOn(api, "startPathTest").mockResolvedValue(pathTestStatus(true));
    vi.spyOn(api, "cancelPathTest").mockResolvedValue({ ...pathTestStatus(true), state: "restoring", progress: null });
  });
  afterEach(() => { useControllerStore().$dispose(); vi.restoreAllMocks(); });
  it("starts once, preserves draft/revision, and blocks writes after measurement completion until active is false", async () => {
    const store = useControllerStore(); store.stage(config());
    const draft = JSON.stringify(store.draft), revision = store.state.data!.revision;
    vi.mocked(api.getPathTests).mockResolvedValue(pathTestStatus(true));
    await store.refreshPathTests();
    await expect(store.startPathTest(pathTestRequest())).rejects.toThrow("restoration");
    vi.mocked(api.getPathTests).mockResolvedValue(pathTestStatus());
    await store.refreshPathTests();
    let finish!: (value: ReturnType<typeof pathTestStatus>) => void;
    vi.mocked(api.startPathTest).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = store.startPathTest(pathTestRequest());
    await expect(store.startPathTest(pathTestRequest())).rejects.toThrow("pending");
    await vi.waitFor(() => expect(api.startPathTest).toHaveBeenCalledTimes(1));
    vi.mocked(api.getPathTests).mockResolvedValue(pathTestStatus(true));
    finish({ ...pathTestStatus(true), state: "completed", result: pathTestResult() }); await pending;
    expect(store.pathTestWriteBlockedReason).not.toBe("");
    expect(() => store.stage(config())).toThrow("restoration");
    await expect(store.startUpgrade("2026.11.06.1", "test/repo")).rejects.toThrow("restoration");
    await expect(store.reconcile()).rejects.toThrow("restoration");
    expect(JSON.stringify(store.draft)).toBe(draft); expect(store.state.data!.revision).toBe(revision);
    vi.mocked(api.getPathTests).mockResolvedValue({ ...pathTestStatus(true), active: false, state: "completed", restoration: "restored" });
    await store.refreshPathTests();
    expect(store.pathTestWriteBlockedReason).toBe("");
  });
  it("cancels using the native ID and keeps cleanup failures blocked without retrying POST", async () => {
    const store = useControllerStore();
    const sample = { ...pathTestStatus(true), state: "cleanup_failed" as const, error: "Foreign interface replacement" };
    vi.mocked(api.getPathTests).mockResolvedValue(sample);
    await store.refreshPathTests(); await store.cancelPathTest();
    expect(api.cancelPathTest).toHaveBeenCalledExactlyOnceWith("a".repeat(32), expect.any(AbortSignal));
    await store.refreshPathTests();
    expect(store.pathTests.data?.error).toBe("Foreign interface replacement");
    expect(store.pathTestWriteBlockedReason).not.toBe("");
  });
  it("keeps uncertain starts blocked on failed status reads, never retries the POST, and reconciles successful reads", async () => {
    const store = useControllerStore();
    vi.mocked(api.startPathTest).mockRejectedValue(new ApiFailure("Start outcome unknown", undefined, undefined, true));
    vi.mocked(api.getPathTests).mockResolvedValueOnce(pathTestStatus()).mockRejectedValue(new ApiFailure("Status unreachable", 503));
    await expect(store.startPathTest(pathTestRequest())).rejects.toThrow("unknown");
    await store.refreshPathTests();
    expect(store.pathTestUncertain).toBe(true);
    expect(store.pathTestWriteBlockedReason).toContain("unknown");
    expect(api.startPathTest).toHaveBeenCalledTimes(1);
    vi.mocked(api.getPathTests).mockResolvedValue(pathTestStatus());
    await store.refreshPathTests();
    expect(store.pathTestUncertain).toBe(false);
  });
  it.each(["address", "mtu", "transaction", "ipv6"] as const)("rechecks %s prerequisites before sending a start", async condition => {
    const request = pathTestRequest();
    if (condition === "address") request.source_address = "192.0.2.99";
    if (condition === "mtu") vi.mocked(api.getDiscoveredInterfaces).mockResolvedValue(pathTestInterfaces().map(link => ({ ...link, mtu: 9200 })));
    if (condition === "transaction") vi.mocked(api.getTransactions).mockResolvedValue({ "tx-test": transaction() });
    if (condition === "ipv6") {
      request.source_address = "2001:db8::1"; request.peer_address = "2001:db8::2";
      vi.mocked(api.getState).mockResolvedValue({ ...state(), desired: { ...config(), ipv6_enabled: false } });
    }
    await expect(useControllerStore().startPathTest(request)).rejects.toThrow();
    expect(api.startPathTest).not.toHaveBeenCalled();
  });
  it("clears session state and ignores late responses after a firewall change", async () => {
    const store = useControllerStore();
    let finish!: (value: ReturnType<typeof pathTestStatus>) => void;
    vi.mocked(api.startPathTest).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = store.startPathTest(pathTestRequest());
    await vi.waitFor(() => expect(api.startPathTest).toHaveBeenCalledTimes(1));
    store.disconnect();
    finish(pathTestStatus(true)); await pending;
    expect(store.pathTests.data).toBeNull();
    expect(store.pathTestPending).toBe("");
    expect(store.pathTestWriteBlockedReason).toBe("");
  });
});
