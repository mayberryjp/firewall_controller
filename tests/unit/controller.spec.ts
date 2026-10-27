import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { ApiFailure } from "@/services/api";
import * as api from "@/services/netcontrol";
import { useControllerStore } from "@/stores/controller";
import { cloneConfig } from "@/services/configuration";
import { config, state, transaction, runtime, statistics } from "../fixtures";
vi.mock("@/services/netcontrol", () => ({
  getState: vi.fn(), getRuntime: vi.fn(), getTransactions: vi.fn(), getTransaction: vi.fn(),
  getStatistics: vi.fn(), getGatewayStatistics: vi.fn(), getRevisions: vi.fn(), getRevision: vi.fn(),
  submitPackage: vi.fn(), confirmTransaction: vi.fn(), rollbackTransaction: vi.fn(),
  restoreRevision: vi.fn(), reconcileServices: vi.fn(),
  getSystemUpgrade: vi.fn(), startSystemUpgrade: vi.fn(),
  getPlatformStatus: vi.fn(),
}));
beforeEach(() => {
  setActivePinia(createPinia()); vi.resetAllMocks();
  vi.mocked(api.getState).mockResolvedValue(state());
  vi.mocked(api.getRuntime).mockResolvedValue(runtime());
  vi.mocked(api.getTransactions).mockResolvedValue({});
  vi.mocked(api.getRevisions).mockResolvedValue({ revisions: [] });
  vi.mocked(api.getStatistics).mockResolvedValue(statistics());
  vi.mocked(api.getGatewayStatistics).mockResolvedValue({ sample: statistics().sample, monitors: [] });
  vi.mocked(api.getSystemUpgrade).mockResolvedValue({ enabled: false, repository: null, job: null, last_successful_version: null });
});
async function connected() {
  const store = useControllerStore();
  expect(await store.connect("11111111-1111-4111-8111-111111111111")).toBe(true);
  await store.refresh();
  return store;
}
describe("independent reads and complete shared draft", () => {
  it("expires cached health even when an older successful state read masks failed health polling", async () => {
    const store = await connected();
    vi.useFakeTimers();
    try {
      const processHealth = { status: "healthy", healthy: true, collected_at: new Date().toISOString(), stale: false, components: [] };
      store.state.data = { ...state(), process_health: processHealth, active_alerts: [] };
      store.state.lastSuccess = Date.now();
      vi.mocked(api.getPlatformStatus).mockRejectedValue(new ApiFailure("Health unavailable", 503));
      await store.refreshPlatformStatus();
      expect(store.healthStatus?.stale).toBe(false);
      await vi.advanceTimersByTimeAsync(15000);
      expect(store.healthStatus?.stale).toBe(true);
      expect(store.state.stale).toBe(false);
      expect(store.readOnlyReason).toBe("");
      await store.refreshState();
      expect(store.healthStatus).toBeNull();
      vi.mocked(api.getPlatformStatus).mockResolvedValue({ process_health: processHealth, active_alerts: [] });
      await store.refreshPlatformStatus();
      expect(store.healthStatus?.stale).toBe(false);
    } finally { store.$dispose(); vi.useRealTimers(); }
  });
  it("deduplicates platform alerts, clears recovered conditions, and never copies health into drafts", async () => {
    const store = await connected();
    const alert = { id: "ntp:worker", component: "appliance_services", resource: "ntp", severity: "error", code: "future_code", message: "NTP recovering", retrying: true, first_seen_at: "2026-10-27T00:00:00.123Z", last_seen_at: null };
    const snapshot = { process_health: { status: "unhealthy", healthy: false, collected_at: "2026-10-27T00:00:00.123Z", stale: false, components: [] }, active_alerts: [alert, alert] };
    vi.mocked(api.getPlatformStatus).mockResolvedValue(snapshot);
    vi.mocked(api.getState).mockRejectedValue(new Error("Observation unavailable"));
    await store.refreshState(); await store.refreshPlatformStatus();
    expect(store.healthStatus?.active_alerts).toEqual([alert]);
    expect(store.readOnlyReason).toBe("");
    store.stage(config());
    expect(store.draft).not.toHaveProperty("process_health"); expect(store.draft).not.toHaveProperty("active_alerts");
    vi.mocked(api.getPlatformStatus).mockResolvedValue({ ...snapshot, process_health: { ...snapshot.process_health, status: "healthy", healthy: true }, active_alerts: [] });
    await store.refreshPlatformStatus();
    expect(store.healthStatus?.active_alerts).toEqual([]);
    store.disconnect(); expect(store.platform.data).toBeNull();
  });
  it("connects through readable configuration when transaction discovery is unavailable", async () => {
    vi.mocked(api.getTransactions).mockRejectedValue(new ApiFailure("transactions unavailable", 503));
    const store = await connected();
    expect(store.readOnlyReason).toBe("");
    const candidate = config(); candidate.routes[0]!.metric = 42;
    store.stage(candidate);
    expect(store.canApply).toBe(true);
  });
  it("pushes configuration despite failed runtime, transaction and upgrade status reads", async () => {
    const store = await connected();
    vi.mocked(api.getRuntime).mockRejectedValue(new ApiFailure("NTP unavailable", 503));
    vi.mocked(api.getTransactions).mockRejectedValue(new ApiFailure("transactions unavailable", 503));
    vi.mocked(api.getSystemUpgrade).mockRejectedValue(new ApiFailure("upgrade status unavailable", 503));
    await store.refresh(); await store.refreshUpgrade();
    store.state.data = { ...state(), drift: true };
    const candidate = config(); candidate.routes[0]!.metric = 42;
    store.stage(candidate);
    const pending = transaction(); pending.candidate = candidate;
    vi.mocked(api.submitPackage).mockResolvedValue(pending);
    const upgradeReads = vi.mocked(api.getSystemUpgrade).mock.calls.length;
    await store.apply(120, "Repair configuration");
    expect(api.submitPackage).toHaveBeenCalledWith(expect.objectContaining({ config: candidate }));
    expect(api.getSystemUpgrade).toHaveBeenCalledTimes(upgradeReads);
    expect(api.reconcileServices).not.toHaveBeenCalled();
    expect(api.startSystemUpgrade).not.toHaveBeenCalled();
    expect(api.rollbackTransaction).not.toHaveBeenCalled();
  });
  it("backfills peer routes atomically on WireGuard staging and preserves other draft edits", async () => {
    const store = await connected(), candidate = cloneConfig(store.state.data!.desired);
    const link = {
      ...candidate.interfaces[0]!, name: "wg0", kind: "wireguard" as const,
      wireguard: { key_ref: "key", listen_port: 51820, peers: [
        { public_key: btoa("\x01".repeat(32)), allowed_ips: ["10.20.0.0/24"], persistent_keepalive_seconds: 0 },
      ] },
    };
    store.state.data!.desired.interfaces.push(link);
    candidate.interfaces.push(cloneConfig(store.state.data!.desired).interfaces[1]!);
    candidate.routes[0]!.metric = 42;
    store.stage(candidate, true);
    expect(store.draft?.routes).toEqual([
      { ...candidate.routes[0], metric: 42 },
      expect.objectContaining({ destination: "10.20.0.0/24", interface: "wg0", enabled: true, table: 254, metric: 1 }),
    ]);
    expect(store.state.data!.desired.routes).toHaveLength(1);
    expect(candidate.routes).toHaveLength(1);
    const changed = cloneConfig(store.draft!);
    const tunnel = changed.interfaces.find(item => item.kind === "wireguard")!;
    if (tunnel.kind !== "wireguard") throw new Error("Missing tunnel");
    tunnel.wireguard.peers = [];
    store.stage(changed);
    expect(store.draft?.routes).toEqual([{ ...candidate.routes[0], metric: 42 }]);
    expect(api.submitPackage).not.toHaveBeenCalled();
  });
  it("does not stage a partial peer change when an automatic route conflicts", async () => {
    const store = await connected(), candidate = cloneConfig(store.state.data!.desired);
    candidate.interfaces.push({
      ...candidate.interfaces[0]!, name: "wg0", kind: "wireguard",
      wireguard: { key_ref: "key", listen_port: 51820, peers: [
        { public_key: btoa("\x01".repeat(32)), allowed_ips: ["198.51.100.0/24"], persistent_keepalive_seconds: 0 },
      ] },
    });
    candidate.routes[0]!.table = 254;
    expect(() => store.stage(candidate)).toThrow("conflicts with a manual route");
    expect(store.draft).toBeNull();
    expect(store.baseline).toBeNull();
  });
  it("does not let a status read started before acceptance replace the accepted upgrade job", async () => {
    const available = { enabled: true, repository: "operator/appliance", job: null, last_successful_version: null };
    const job = { id: "upgrade-1", version: "1.2.3", status: "queued", created_at: "2026-10-24T00:00:00Z", updated_at: "2026-10-24T00:00:00Z", error: null, last_successful_version: null };
    vi.mocked(api.getSystemUpgrade).mockResolvedValue(available);
    let finishWrite!: (value: typeof job) => void, finishRead!: (value: typeof available) => void;
    vi.mocked(api.startSystemUpgrade).mockImplementation(() => new Promise(resolve => { finishWrite = resolve; }));
    const store = await connected();
    const submission = store.startUpgrade("1.2.3", "operator/appliance");
    await vi.waitFor(() => expect(api.startSystemUpgrade).toHaveBeenCalledTimes(1));
    vi.mocked(api.getSystemUpgrade).mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
    const read = store.refreshUpgrade();
    finishWrite(job); await submission;
    finishRead(available); await read;
    expect(store.upgrade.data?.job?.id).toBe("upgrade-1"); expect(store.upgradeNotice).toBe("");
    expect(store.upgrade.stale).toBe(false); expect(store.upgradePending).toBe(false);
  });
  it("refuses an upgrade if its operator-configured repository changed after confirmation", async () => {
    vi.mocked(api.getSystemUpgrade).mockResolvedValue({ enabled: true, repository: "operator/changed", job: null, last_successful_version: null });
    const store = await connected();
    await expect(store.startUpgrade("1.2.3", "operator/original")).rejects.toThrow("repository changed");
    expect(api.startSystemUpgrade).not.toHaveBeenCalled(); expect(store.upgradePending).toBe(false);
  });
  it("preserves drafts, blocks active upgrades and refreshes state after a terminal job", async () => {
    const available = { enabled: true, repository: "operator/appliance", job: null, last_successful_version: null };
    const job = { id: "upgrade-1", version: "1.2.3", status: "queued", created_at: "2026-10-24T00:00:00Z", updated_at: "2026-10-24T00:00:00Z", error: null, last_successful_version: null };
    vi.mocked(api.getSystemUpgrade).mockResolvedValue(available);
    vi.mocked(api.startSystemUpgrade).mockResolvedValue(job);
    const store = await connected();
    const candidate = config(); candidate.routes[0]!.metric = 42; store.stage(candidate);
    await store.startUpgrade("1.2.3", "operator/appliance");
    expect(store.readOnlyReason).toBe(""); expect(store.draft?.routes[0]?.metric).toBe(42);
    vi.mocked(api.getSystemUpgrade).mockResolvedValue({ ...available, job: { ...job, status: "recovery_required" } });
    await expect(store.checkMaintenance()).rejects.toThrow("console recovery");
    vi.mocked(api.getSystemUpgrade).mockResolvedValue({ ...available, job: { ...job, status: "rolled_back" } });
    const changed = state(); changed.revision = "1"; vi.mocked(api.getState).mockResolvedValue(changed);
    await store.refreshUpgrade();
    expect(store.upgradeBlockedReason).toBe(""); expect(store.state.data?.revision).toBe("1");
    expect(store.draft?.routes[0]?.metric).toBe(42); expect(store.draftStale).toBe(true);
    expect(api.submitPackage).not.toHaveBeenCalled();
  });
  it("reconciles an uncertain upgrade by job identity without resubmitting and detects supersession", async () => {
    const available = { enabled: true, repository: "operator/appliance", job: null, last_successful_version: null };
    const job = { id: "upgrade-1", version: "1.2.3", status: "checking", created_at: "2026-10-24T00:00:00Z", updated_at: "2026-10-24T00:00:00Z", error: null, last_successful_version: null };
    vi.mocked(api.getSystemUpgrade).mockResolvedValue(available);
    vi.mocked(api.startSystemUpgrade).mockRejectedValue(new ApiFailure("disconnected", undefined, undefined, true));
    const store = await connected();
    await expect(store.startUpgrade("1.2.3", "operator/appliance")).rejects.toThrow("disconnected");
    expect(store.upgradeUncertain).toBe(true);
    vi.mocked(api.getSystemUpgrade).mockResolvedValue({ ...available, job }); await store.refreshUpgrade();
    expect(store.acceptedUpgradeID).toBe("upgrade-1"); expect(store.upgradeUncertain).toBe(false);
    vi.mocked(api.getSystemUpgrade).mockResolvedValue({ ...available, job: { ...job, id: "upgrade-2", status: "succeeded" } }); await store.refreshUpgrade();
    expect(store.upgradeBlockedReason).toContain("operator verification"); expect(store.upgradeNotice).toContain("upgrade-1");
    expect(api.startSystemUpgrade).toHaveBeenCalledTimes(1);
  });
  it("loads gateway statistics while observation is unavailable and clears their cache on disconnect", async () => {
    const store = await connected();
    vi.mocked(api.getState).mockRejectedValue(new Error("observation failed"));
    await store.refreshState(); await store.refreshGatewayStatistics();
    expect(store.gatewayStatistics.stale).toBe(false); expect(store.state.stale).toBe(true);
    store.disconnect(); expect(store.gatewayStatistics.data).toBeNull();
  });
  it("opens the authenticated shell without waiting for a blocked observation", async () => {
    let complete: ((value: ReturnType<typeof state>) => void) | undefined;
    vi.mocked(api.getState).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const store = useControllerStore();
    expect(await store.connect("11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(store.connected).toBe(true); expect(store.state.loading).toBe(true);
    expect(store.transactions.data).toEqual({});
    complete?.(state()); await store.refreshState();
  });
  it("establishes read access when state observation fails; keeps recovery/runtime usable", async () => {
    vi.mocked(api.getState).mockRejectedValue(new ApiFailure("observation failed", 503));
    vi.mocked(api.getTransactions).mockResolvedValue({ one: transaction("recovery_failed") });
    const store = await connected();
    expect(store.state.error).toContain("observation failed");
    expect(store.runtime.data).not.toBeNull();
    expect(store.activeTransactions[0]?.status).toBe("recovery_failed");
    expect(store.canApply).toBe(false);
  });
  it("stages multi-page edits with zero mutation requests and full unrelated state", async () => {
    const store = await connected();
    const candidate = cloneConfig(store.state.data!.desired);
    candidate.routes[0]!.metric = 12; store.stage(candidate);
    const next = cloneConfig(store.draft!); next.firewall.policy = "drop"; store.stage(next);
    expect(store.baseRevision).toBe("0");
    expect(store.draft?.softflowd).toEqual(config().softflowd);
    expect(store.draft?.kernel).toEqual(config().kernel);
    expect(store.diff.some(item => item.area === "routes")).toBe(true);
    expect(store.diff.some(item => item.area === "firewall-policy")).toBe(true);
    expect(api.submitPackage).not.toHaveBeenCalled();
  });
  it("marks stale after an external revision change without rebasing", async () => {
    const store = await connected(); const candidate = config(); candidate.routes[0]!.metric = 2; store.stage(candidate);
    vi.mocked(api.getState).mockResolvedValue({ ...state(), revision: "1" });
    await store.refreshState();
    expect(store.draftStale).toBe(true); expect(store.baseRevision).toBe("0"); expect(store.canApply).toBe(false);
  });
  it("does not overlap an in-flight read", async () => {
    const store = await connected();
    let complete: ((value: ReturnType<typeof state>) => void) | undefined;
    vi.mocked(api.getState).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const count = vi.mocked(api.getState).mock.calls.length;
    const first = store.refreshState(), second = store.refreshState();
    expect(api.getState).toHaveBeenCalledTimes(count + 1);
    complete?.(state()); await Promise.all([first, second]);
  });
  it("discards late reads and sensitive caches after disconnect", async () => {
    const store = await connected();
    let complete: ((value: ReturnType<typeof state>) => void) | undefined;
    vi.mocked(api.getState).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const pending = store.refreshState(); store.disconnect();
    complete?.(state()); await pending;
    expect(store.state.data).toBeNull(); expect(store.transactions.data).toBeNull(); expect(store.draft).toBeNull();
  });
  it("preserves last good statistics as stale and never modifies the draft", async () => {
    const store = await connected(); store.stage(config()); const captured = JSON.stringify(store.draft);
    await store.refreshStatistics();
    vi.mocked(api.getStatistics).mockRejectedValue(new ApiFailure("statistics unavailable", 503));
    await store.refreshStatistics();
    expect(store.statistics.stale).toBe(true);
    expect(store.statistics.data?.interfaces[0]?.counters?.rx_bytes).toBe("18446744073709551615");
    expect(JSON.stringify(store.draft)).toBe(captured);
  });
  it("caches immutable revision configs for session comparison and clears caches on disconnect", async () => {
    const store = await connected();
    const history = { revision: "0", current: true, submitted_at: null, committed_at: null, config: config() };
    vi.mocked(api.getRevision).mockResolvedValue(history);
    await store.loadRevision("0"); await store.compareRevision("0");
    expect(api.getRevision).toHaveBeenCalledOnce();
    expect(store.comparisonRevision.data?.config).toEqual(history.config);
    store.disconnect();
    expect(store.comparisonRevision.data).toBeNull();
    await store.connect("11111111-1111-4111-8111-111111111111"); await store.loadRevision("0");
    expect(api.getRevision).toHaveBeenCalledTimes(2);
  });
  it("ignores older revision detail reads when the selected revision changes", async () => {
    const store = await connected();
    let complete: ((value: { revision: string; current: boolean; submitted_at: null; committed_at: null; config: ReturnType<typeof config> }) => void) | undefined;
    vi.mocked(api.getRevision).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const first = store.loadRevision("0");
    vi.mocked(api.getRevision).mockResolvedValueOnce({ revision: "1", current: true, submitted_at: null, committed_at: null, config: config() });
    await store.loadRevision("1");
    complete?.({ revision: "0", current: false, submitted_at: null, committed_at: null, config: config() }); await first;
    expect(store.revisionDetail.data?.revision).toBe("1");
  });
});
describe("provisional transaction safety", () => {
  it("uses stored relay repair endpoint, never the local draft or transaction submit", async () => {
    const store = await connected(), candidate = config();
    candidate.interfaces[0]!.dhcp_relay = { enabled: true, servers: ["198.51.100.10"] };
    candidate.interfaces[0]!.role = "wan"; candidate.firewall.allow_all_icmp = false;
    store.stage(candidate); vi.mocked(api.reconcileServices).mockResolvedValue(runtime());
    await store.reconcile("dhcp-relay");
    expect(api.reconcileServices).toHaveBeenCalledWith("dhcp-relay");
    expect(api.submitPackage).not.toHaveBeenCalled();
    expect(store.draft).toEqual(candidate);
  });
  it("preserves the draft and surfaces forbidden service repair", async () => {
    const store = await connected(); store.stage(config());
    vi.mocked(api.reconcileServices).mockRejectedValue(new ApiFailure("HTTP 403: interfaces.write required", 403));
    await expect(store.reconcile("dhcp-relay")).rejects.toThrow("403");
    expect(store.uncertain).toBeNull(); expect(store.draft).toEqual(config());
    expect(api.reconcileServices).toHaveBeenCalledOnce();
  });
  it("freezes unknown relay repair outcome and blocks replay", async () => {
    const store = await connected();
    vi.mocked(api.reconcileServices).mockRejectedValue(new ApiFailure("Connection lost", undefined, undefined, true));
    await expect(store.reconcile("dhcp-relay")).rejects.toThrow("Connection lost");
    expect(store.uncertain).not.toBeNull();
    await expect(store.reconcile("dhcp-relay")).rejects.toThrow("safety state");
    expect(api.reconcileServices).toHaveBeenCalledOnce();
  });
  it("treats 202 as pending, freezes the snapshot and never confirms automatically", async () => {
    const store = await connected(); const candidate = config(); candidate.routes[0]!.metric = 2; store.stage(candidate);
    const pending = transaction(); pending.candidate = candidate;
    vi.mocked(api.submitPackage).mockResolvedValue(pending);
    vi.mocked(api.getTransactions).mockResolvedValue({ [pending.id]: pending });
    // Discovery before submit must have no active transaction.
    vi.mocked(api.getTransactions).mockResolvedValueOnce({});
    await store.apply(120, " route change ");
    expect(store.state.data?.revision).toBe("0"); expect(store.submitted?.id).toBe(pending.id);
    expect(store.canApply).toBe(false); expect(api.confirmTransaction).not.toHaveBeenCalled();
    expect(api.submitPackage).toHaveBeenCalledWith(expect.objectContaining({ config: candidate, description: "route change" }));
    expect(() => store.stage(config())).toThrow("frozen");
  });
  it("keeps configuration writable despite drift, unknown status, failed recovery or unavailable transaction discovery", async () => {
    const store = await connected(); const candidate = config(); candidate.routes[0]!.metric = 2; store.stage(candidate);
    store.state.data = { ...state(), drift: true }; expect(store.canApply).toBe(true);
    store.state.data = state();
    store.transactions.data = { future: transaction("future_status") }; expect(store.incompatible).toBe(true); expect(store.canApply).toBe(true);
    store.transactions.data = { failure: transaction("recovery_failed") }; expect(store.canApply).toBe(true);
    store.transactions.data = {}; store.transactions.stale = true; expect(store.canApply).toBe(true);
    expect(store.readOnlyReason).toBe("");
  });
  it("freezes unknown writes with no automatic replay or false failure", async () => {
    const store = await connected(); const candidate = config(); candidate.routes[0]!.metric = 2; store.stage(candidate);
    vi.mocked(api.submitPackage).mockRejectedValue(new ApiFailure("connection lost", undefined, undefined, true));
    await store.apply(120, "");
    expect(store.uncertain?.operation).toBe("Apply package"); expect(store.submitted?.config).toEqual(candidate);
    expect(api.submitPackage).toHaveBeenCalledOnce(); expect(store.canApply).toBe(false);
    await store.refresh(); expect(api.submitPackage).toHaveBeenCalledOnce();
    store.resolveUncertainty(); expect(store.uncertain).toBeNull(); expect(store.draft).not.toBeNull();
  });
  it("keeps server error transactions and recovery controls after a failed apply", async () => {
    const store = await connected(); const candidate = config(); candidate.routes[0]!.metric = 2; store.stage(candidate);
    const failure = transaction("recovery_failed");
    vi.mocked(api.getTransaction).mockResolvedValue(failure);
    vi.mocked(api.submitPackage).mockRejectedValue(new ApiFailure("rollback failed", 500, failure, true));
    vi.mocked(api.getTransactions).mockResolvedValueOnce({}).mockResolvedValue({ [failure.id]: failure });
    await store.apply(120, "");
    expect(store.activeTransactions[0]?.status).toBe("recovery_failed");
    expect(store.uncertain?.id).toBe(failure.id); expect(store.draft).not.toBeNull();
  });
  it.each(["rolled_back", "recovery_failed"])("retains the full %s cause, transaction identity and draft without automatically retrying", async outcome => {
    const store = await connected(), candidate = config(); candidate.routes[0]!.metric = 2; store.stage(candidate);
    const cause = `apply failed: ${"nested apply context: ".repeat(300)}gateway monitoring opt-in missing; rollback detail retained`;
    const failure = { ...transaction(outcome), candidate, error: cause };
    vi.mocked(api.getTransaction).mockResolvedValue(failure);
    vi.mocked(api.submitPackage).mockRejectedValue(new ApiFailure(cause, 500, failure, true));
    vi.mocked(api.getTransactions).mockResolvedValueOnce({}).mockResolvedValue({ [failure.id]: failure });
    await store.apply(120, "");
    expect(store.transactions.data?.[failure.id]).toMatchObject({ id: failure.id, status: outcome, error: cause });
    expect(store.actionError).toBe(cause); expect(store.draft).toEqual(candidate); expect(store.baseRevision).toBe("0");
    await store.refresh(); expect(api.submitPackage).toHaveBeenCalledOnce();
  });
  it("a 403 preserves the draft and reports the action instead of claiming success", async () => {
    const store = await connected(); const candidate = config(); candidate.routes[0]!.metric = 2; store.stage(candidate);
    vi.mocked(api.submitPackage).mockRejectedValue(new ApiFailure("permission denied", 403));
    await store.apply(120, "");
    expect(store.actionError).toContain("permission denied"); expect(store.draft).not.toBeNull(); expect(store.submitted).toBeNull();
  });
  it("refreshes lifecycle before confirmation and rejects expired displayed deadline", async () => {
    const store = await connected(); const pending = transaction();
    pending.confirmation_deadline = new Date(Date.now() - 1000).toISOString();
    vi.mocked(api.getTransaction).mockResolvedValue(pending);
    await expect(store.lifecycle(pending.id, "confirm")).rejects.toThrow("not currently available");
    expect(api.confirmTransaction).not.toHaveBeenCalled();
  });
  it("supports independent retry rollback when aggregate observation fails", async () => {
    vi.mocked(api.getState).mockRejectedValue(new ApiFailure("observation unavailable", 503));
    const store = await connected();
    vi.mocked(api.getTransaction).mockResolvedValue(transaction("recovery_failed"));
    vi.mocked(api.rollbackTransaction).mockResolvedValue(transaction("rolled_back"));
    await store.lifecycle("tx-test", "rollback");
    expect(api.rollbackTransaction).toHaveBeenCalledWith("tx-test");
  });
  it("does not let incompatible optional statistics obstruct known recovery", async () => {
    const store = await connected();
    store.statistics.incompatible = true; store.statistics.error = "Unsupported monitoring schema";
    vi.mocked(api.getTransaction).mockResolvedValue(transaction("recovery_failed"));
    vi.mocked(api.rollbackTransaction).mockResolvedValue(transaction("rolled_back"));
    await store.lifecycle("tx-test", "rollback");
    expect(api.rollbackTransaction).toHaveBeenCalledWith("tx-test");
  });
  it.each([9, 10, 300, 301])("checks confirmation window %s", async seconds => {
    const store = await connected(); const candidate = config(); candidate.routes[0]!.metric = 2; store.stage(candidate);
    vi.mocked(api.submitPackage).mockResolvedValue(transaction());
    if (seconds < 10 || seconds > 300) await expect(store.apply(seconds, "")).rejects.toThrow("10..300");
    else { await store.apply(seconds, ""); expect(api.submitPackage).toHaveBeenCalledOnce(); }
  });
  it("enforces the trimmed 1024-byte description boundary", async () => {
    const store = await connected(); const candidate = config(); candidate.routes[0]!.metric = 2; store.stage(candidate);
    await expect(store.apply(120, "é".repeat(513))).rejects.toThrow("1024");
    vi.mocked(api.submitPackage).mockResolvedValue(transaction());
    await store.apply(120, ` ${"é".repeat(512)} `); expect(api.submitPackage).toHaveBeenCalledOnce();
  });
  it("uses historical restore revision 0 and blocks restore with an unsaved draft", async () => {
    const store = await connected(); store.stage(config());
    await expect(store.restore("0", 120, "")).rejects.toThrow("no draft");
    store.discardDraft();
    vi.mocked(api.getRevision).mockResolvedValue({ revision: "0", current: true, submitted_at: null, committed_at: null, config: config() });
    vi.mocked(api.restoreRevision).mockResolvedValue(transaction());
    await store.restore("0", 120, "");
    expect(api.restoreRevision).toHaveBeenCalledWith("0", { base_revision: "0", confirm_timeout_seconds: 120, description: "" });
    expect(api.submitPackage).not.toHaveBeenCalled();
  });
  it("reconcile uses stored state and leaves an unsent draft unchanged", async () => {
    const store = await connected(); const candidate = config(); candidate.routes[0]!.metric = 2; store.stage(candidate);
    vi.mocked(api.reconcileServices).mockResolvedValue(runtime());
    await store.reconcile();
    expect(api.reconcileServices).toHaveBeenCalledWith("softflowd");
    expect(store.draft).toEqual(candidate); expect(store.state.data?.revision).toBe("0");
  });
  it("clears the submitted draft only after a verified commit and fresh desired state", async () => {
    const store = await connected(), candidate = config(); candidate.routes[0]!.metric = 2; store.stage(candidate);
    const pending = transaction(); pending.candidate = candidate;
    vi.mocked(api.submitPackage).mockResolvedValue(pending);
    vi.mocked(api.getTransactions).mockResolvedValueOnce({}).mockResolvedValue({ [pending.id]: pending });
    await store.apply(120, "");
    expect(store.draft).not.toBeNull();
    const committed = { ...pending, status: "committed" };
    vi.mocked(api.getTransactions).mockResolvedValue({ [pending.id]: committed });
    vi.mocked(api.getState).mockRejectedValueOnce(new ApiFailure("temporarily unavailable", 503));
    await store.refreshTransactions();
    expect(store.draft).not.toBeNull();
    vi.mocked(api.getState).mockResolvedValue({ ...state(), revision: "1", desired: candidate });
    await store.refreshTransactions();
    expect(store.draft).toBeNull(); expect(store.submitted).toBeNull();
    expect(store.notice).toBeNull();
    expect(store.transactions.data?.[pending.id]?.status).toBe("committed");
  });
  it("retains the candidate as an editable draft after verified rollback", async () => {
    const store = await connected(), candidate = config(); candidate.routes[0]!.metric = 2; store.stage(candidate);
    const rolledBack = transaction("rolled_back"); rolledBack.candidate = candidate;
    vi.mocked(api.submitPackage).mockResolvedValue(rolledBack);
    vi.mocked(api.getTransactions).mockResolvedValue({ [rolledBack.id]: rolledBack });
    await store.apply(120, "");
    expect(store.draft).toEqual(candidate); expect(store.submitted).toBeNull(); expect(store.baseRevision).toBe("0");
    expect(store.notice).toContain("Server verified rollback");
  });
  it("a rejected 401 releases an unsubmitted snapshot but preserves the draft", async () => {
    const store = await connected(), candidate = config(); candidate.routes[0]!.metric = 2; store.stage(candidate);
    vi.mocked(api.submitPackage).mockRejectedValue(new ApiFailure("Credential rejected", 401));
    await store.apply(120, "");
    expect(store.submitted).toBeNull(); expect(store.draft).toEqual(candidate);
  });
});
