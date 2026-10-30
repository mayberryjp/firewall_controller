import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFailure } from "@/services/api";
import * as api from "@/services/netcontrol";
import { useControllerStore } from "@/stores/controller";
import { hostPolicyConfig, runtime, state, transaction } from "../fixtures";

type Store = ReturnType<typeof useControllerStore>;
const description = "Clear reviewed firewall hosts and forwarding rules";

beforeEach(() => {
  setActivePinia(createPinia());
  const store = useControllerStore(), snapshot = state();
  snapshot.desired = hostPolicyConfig();
  store.connected = true;
  store.state.data = snapshot; store.state.stale = false; store.state.lastSuccess = Date.now();
  store.transactions.data = {}; store.transactions.stale = false; store.transactions.lastSuccess = Date.now();
  vi.spyOn(api, "getState").mockResolvedValue(snapshot);
  vi.spyOn(api, "getTransactions").mockResolvedValue({});
  vi.spyOn(api, "getRuntime").mockResolvedValue(runtime());
  vi.spyOn(api, "getRevisions").mockResolvedValue({ revisions: [] });
  vi.spyOn(api, "deleteFirewallHostsAndRules").mockResolvedValue(transaction());
});
afterEach(() => { useControllerStore().$dispose(); vi.restoreAllMocks(); });

describe("bulk firewall deletion lifecycle", () => {
  it("refreshes before sending the reviewed revision, without a package or local deletion draft", async () => {
    const store = useControllerStore(), pending = transaction();
    vi.mocked(api.deleteFirewallHostsAndRules).mockImplementation(async () => {
      vi.mocked(api.getTransactions).mockResolvedValue({ [pending.id]: pending });
      vi.mocked(api.getState).mockResolvedValue({ ...state(), active_transaction: pending });
      return pending;
    });
    expect(await store.deleteFirewallHostsAndRules(state().revision, 120, ` ${description} `)).toEqual(pending);
    expect(api.deleteFirewallHostsAndRules).toHaveBeenCalledExactlyOnceWith({
      base_revision: state().revision, confirm_timeout_seconds: 120, confirm: true, description,
    });
    expect(vi.mocked(api.getState).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(api.deleteFirewallHostsAndRules).mock.invocationCallOrder[0]!);
    expect(store.draft).toBeNull(); expect(store.submitted).toBeNull();
    expect(store.activeTransactions).toHaveLength(1);
  });

  const guards: Array<[string, (store: Store) => void]> = [
    ["draft", store => { store.stage(hostPolicyConfig()); }],
    ["unstaged input", store => { store.editorDirty = true; }],
    ["active transaction", store => { store.transactions.data = { "tx-test": transaction() }; }],
    ["upgrade", store => { store.upgradePending = true; }],
    ["restart", store => { store.restartPending = "mqtt"; }],
    ["drift", store => { store.state.data = { ...state(), drift: true }; }],
    ["unavailable transactions", store => { store.transactions.stale = true; }],
    ["incompatible state", store => { store.state.incompatible = true; }],
    ["legacy revision", store => { store.state.data = { ...state(), revision: "79" }; }],
  ];
  it.each(guards)("blocks deletion during %s without changing existing state", async (_name, block) => {
    const store = useControllerStore();
    block(store);
    const draft = JSON.stringify(store.draft);
    await expect(store.deleteFirewallHostsAndRules(state().revision, 120, description)).rejects.toThrow();
    expect(api.deleteFirewallHostsAndRules).not.toHaveBeenCalled();
    expect(JSON.stringify(store.draft)).toBe(draft);
  });

  it("requires another review when a fresh read finds a newer revision", async () => {
    vi.mocked(api.getState).mockResolvedValue({ ...state(), revision: "2026.10.29.2" });
    await expect(useControllerStore().deleteFirewallHostsAndRules(state().revision, 120, description)).rejects.toThrow("changed since review");
    expect(api.deleteFirewallHostsAndRules).not.toHaveBeenCalled();
  });
  it("rechecks active transactions after the preflight reads", async () => {
    vi.mocked(api.getTransactions).mockResolvedValue({ "tx-test": transaction() });
    await expect(useControllerStore().deleteFirewallHostsAndRules(state().revision, 120, description)).rejects.toThrow("active transaction");
    expect(api.deleteFirewallHostsAndRules).not.toHaveBeenCalled();
  });
  it.each([9, 301, 10.5, NaN])("rejects invalid confirmation window %s", async seconds => {
    await expect(useControllerStore().deleteFirewallHostsAndRules(state().revision, seconds, description)).rejects.toThrow("10..300");
    expect(api.deleteFirewallHostsAndRules).not.toHaveBeenCalled();
  });
  it.each([403, 409])("surfaces HTTP %i without retry or a fabricated pending transaction", async status => {
    const store = useControllerStore();
    vi.mocked(api.deleteFirewallHostsAndRules).mockRejectedValue(new ApiFailure("Request denied", status));
    expect(await store.deleteFirewallHostsAndRules(state().revision, 120, description)).toBeNull();
    expect(store.actionError).toContain("Request denied");
    expect(store.uncertain).toBeNull(); expect(store.draft).toBeNull();
    expect(api.deleteFirewallHostsAndRules).toHaveBeenCalledTimes(1);
  });
  it("freezes an uncertain write instead of resubmitting against a new revision", async () => {
    const store = useControllerStore();
    vi.mocked(api.deleteFirewallHostsAndRules).mockRejectedValue(new ApiFailure("Request outcome unknown", undefined, undefined, true));
    expect(await store.deleteFirewallHostsAndRules(state().revision, 120, description)).toBeNull();
    expect(store.uncertain?.operation).toContain("Delete firewall");
    await expect(store.deleteFirewallHostsAndRules(state().revision, 120, description)).rejects.toThrow("pending configuration");
    expect(api.deleteFirewallHostsAndRules).toHaveBeenCalledTimes(1);
  });
  it("retains a transaction supplied with a backend failure for inspection and recovery", async () => {
    const store = useControllerStore(), pending = transaction("recovery_failed");
    vi.spyOn(api, "getTransaction").mockResolvedValue(pending);
    vi.mocked(api.getTransactions).mockResolvedValueOnce({}).mockResolvedValue({ [pending.id]: pending });
    vi.mocked(api.deleteFirewallHostsAndRules).mockRejectedValue(new ApiFailure("Recovery required", 500, pending, true));
    await store.deleteFirewallHostsAndRules(state().revision, 120, description);
    expect(store.uncertain?.id).toBe(pending.id);
    expect(store.transactions.data?.[pending.id]).toEqual(pending);
    expect(store.actionError).toContain("Recovery required");
  });
  it.each(["confirm", "rollback"] as const)("uses normal %s and refreshes history without creating a deletion draft", async action => {
    const store = useControllerStore(), pending = transaction();
    vi.spyOn(api, "getTransaction").mockResolvedValue(pending);
    const finished = { ...pending, status: action === "confirm" ? "committed" : "rolled_back" };
    vi.spyOn(api, "confirmTransaction").mockResolvedValue(finished);
    vi.spyOn(api, "rollbackTransaction").mockResolvedValue(finished);
    vi.mocked(api.getTransactions).mockResolvedValue({ [pending.id]: finished });
    expect(await store.lifecycle(pending.id, action)).toEqual(finished);
    expect(api.getRevisions).toHaveBeenCalledTimes(1);
    expect(store.draft).toBeNull(); expect(store.submitted).toBeNull();
  });
});
