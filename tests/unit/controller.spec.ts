import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { ApiFailure } from "@/services/api";
import * as api from "@/services/netcontrol";
import { useControllerStore } from "@/stores/controller";
import { cloneConfig } from "@/services/configuration";
import { config, state, transaction, runtime, statistics } from "../fixtures";
vi.mock("@/services/netcontrol", () => ({
  getState: vi.fn(), getRuntime: vi.fn(), getTransactions: vi.fn(), getTransaction: vi.fn(),
  getStatistics: vi.fn(), getRevisions: vi.fn(), getRevision: vi.fn(),
  submitPackage: vi.fn(), confirmTransaction: vi.fn(), rollbackTransaction: vi.fn(),
  restoreRevision: vi.fn(), reconcileServices: vi.fn(),
}));
beforeEach(() => {
  setActivePinia(createPinia()); vi.resetAllMocks();
  vi.mocked(api.getState).mockResolvedValue(state());
  vi.mocked(api.getRuntime).mockResolvedValue(runtime());
  vi.mocked(api.getTransactions).mockResolvedValue({});
  vi.mocked(api.getRevisions).mockResolvedValue({ revisions: [] });
  vi.mocked(api.getStatistics).mockResolvedValue(statistics());
});
async function connected() {
  const store = useControllerStore();
  expect(await store.connect("test-key")).toBe(true);
  return store;
}
describe("independent reads and complete shared draft", () => {
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
});
describe("provisional transaction safety", () => {
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
  it("blocks apply on modeled drift, unknown status, failed recovery or unavailable discovery", async () => {
    const store = await connected(); const candidate = config(); candidate.routes[0]!.metric = 2; store.stage(candidate);
    store.state.data = { ...state(), drift: true }; expect(store.canApply).toBe(false);
    store.state.data = state();
    store.transactions.data = { future: transaction("future_status") }; expect(store.incompatible).toBe(true); expect(store.canApply).toBe(false);
    store.transactions.data = { failure: transaction("recovery_failed") }; expect(store.canApply).toBe(false);
    store.transactions.data = {}; store.transactions.stale = true; expect(store.canApply).toBe(false);
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
    expect(api.reconcileServices).toHaveBeenCalledWith();
    expect(store.draft).toEqual(candidate); expect(store.state.data?.revision).toBe("0");
  });
});
