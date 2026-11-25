import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SandoView from "@/views/SandoView.vue";
import { useControllerStore } from "@/stores/controller";
import * as sando from "@/services/sando";
import { state } from "../fixtures";
import { sandoStatus } from "../sandoFixtures";
import { sandoSchema } from "@/services/sandoState";
import { cloneConfig } from "@/services/configuration";

const field = {
  props: ["modelValue", "disabled", "label"], emits: ["update:modelValue"],
  template: '<input :aria-label="label" :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)" />',
};
const stubs = {
  VTextField: field,
  VSwitch: {
    props: ["modelValue", "disabled", "label"], emits: ["update:modelValue"],
    template: '<input type="checkbox" role="switch" :aria-label="label" :checked="modelValue" :disabled="disabled" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
  },
  VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
  VAlert: { template: '<div role="alert"><slot /></div>' },
  VChip: { template: "<span><slot /></span>" },
};
let wrapper: ReturnType<typeof mount>;
const toggle = (key: string) => wrapper.get(`input[aria-label="${key === "sync_enabled" ? "Automatic host and threat-score sync" : "Automatically sync policies"}"]`);
const endpoint = () => wrapper.get('input[aria-label="Sando API endpoint"]');
beforeEach(() => {
  setActivePinia(createPinia());
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const store = useControllerStore();
  store.connected = true; store.state.data = state();
  store.state.data.desired.sando = sandoSchema.parse({ api_url: "https://sando.example" });
  store.state.stale = false; store.state.lastSuccess = Date.now();
  vi.spyOn(sando, "getSandoStatus").mockResolvedValue(sandoStatus());
});
afterEach(() => {
  wrapper?.unmount(); useControllerStore().$dispose(); vi.restoreAllMocks(); vi.useRealTimers();
});

describe("server-side Sando sync settings", () => {
  it("removes browser imports and Test sync, reading only server status without staging changes", async () => {
    const store = useControllerStore(), apply = vi.spyOn(store, "apply");
    const inventory = vi.spyOn(sando, "getSandoDevices");
    wrapper = mount(SandoView, { global: { stubs } }); await flushPromises();
    expect(wrapper.findAll("button").map(button => button.text())).toEqual(["Save endpoint"]);
    expect(wrapper.text()).not.toMatch(/Last import|New host default|Test sync/);
    expect(sando.getSandoStatus).toHaveBeenCalledWith(expect.any(AbortSignal), null);
    expect(inventory).not.toHaveBeenCalled();
    expect(store.draft).toBeNull(); expect(apply).not.toHaveBeenCalled();
  });
  it.each(["sync_enabled", "policy_sync_enabled"] as const)("stages %s independently in both directions without a test, apply, or popup", async key => {
    const store = useControllerStore(), before = cloneConfig(store.state.data!.desired);
    const apply = vi.spyOn(store, "apply"), confirm = vi.spyOn(window, "confirm"), alert = vi.spyOn(window, "alert");
    wrapper = mount(SandoView, { global: { stubs } }); await flushPromises();
    for (const enabled of [true, false]) {
      await toggle(key).setValue(enabled); await flushPromises();
      expect(store.draft).toEqual({ ...before, sando: { ...before.sando, [key]: enabled } });
      expect(cloneConfig(store.state.data!.desired)).toEqual(before);
      expect(store.canApply).toBe(enabled);
    }
    expect(sando.getSandoStatus).toHaveBeenCalledOnce();
    expect(apply).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled(); expect(alert).not.toHaveBeenCalled();
  });
  it.each(["sync_enabled", "policy_sync_enabled"] as const)("requires an endpoint for %s and preserves enabled settings on invalid edits", async key => {
    const store = useControllerStore();
    store.state.data!.desired.sando!.api_url = "";
    wrapper = mount(SandoView, { global: { stubs } });
    await toggle(key).setValue(true); await flushPromises();
    expect(store.draft).toBeNull();
    expect(toggle(key).element).toHaveProperty("checked", false);
    expect(wrapper.text()).toContain("Save a Sando API endpoint");
    await endpoint().setValue(" https://sando.example/api/ ");
    await wrapper.get("button").trigger("click");
    await toggle(key).setValue(true); await flushPromises();
    expect(store.draft!.sando).toMatchObject({ api_url: "https://sando.example", [key]: true });
    await endpoint().setValue(""); await wrapper.get("button").trigger("click"); await flushPromises();
    expect(store.draft!.sando).toMatchObject({ api_url: "https://sando.example", [key]: true });
    expect(store.editorDirty).toBe(true);
  });
  it("shows distinct server success timestamps in the saved timezone, never browser reports or attempt times", async () => {
    const store = useControllerStore();
    store.state.data!.desired.system = { hostname: "", domain: "", timezone: "America/Los_Angeles" };
    store.state.data!.desired.sando!.hosts_import = {
      source_url: "https://sando.example", import_count: 1, status: "succeeded",
      imported_count: 1, skipped_count: 0, last_import_at: "2026-11-25T00:00:00Z",
    };
    wrapper = mount(SandoView, { global: { stubs } }); await flushPromises();
    const host = () => wrapper.get('[aria-label="Last successful host sync"]').text();
    const policy = () => wrapper.get('[aria-label="Last successful policy sync"]').text();
    expect(host()).toBe("Last successful host sync (America/Los_Angeles): 2026-10-30 07:00:00");
    expect(policy()).toBe("Last successful policy sync (America/Los_Angeles): 2026-10-30 12:30:08");
    expect(wrapper.text()).not.toContain("2026-11-25");
    store.draft = cloneConfig(store.state.data!.desired);
    store.draft.system!.timezone = "Asia/Tokyo"; await flushPromises();
    expect(host()).toContain("America/Los_Angeles");
    expect(policy()).toContain("America/Los_Angeles");
    const desired = cloneConfig(store.state.data!.desired);
    desired.system!.timezone = "Asia/Tokyo";
    store.state.data = { ...store.state.data!, desired }; await flushPromises();
    expect(host()).toBe("Last successful host sync (Asia/Tokyo): 2026-10-30 23:00:00");
    expect(policy()).toBe("Last successful policy sync (Asia/Tokyo): 2026-10-31 04:30:08");
  });
  it("keeps disabled sync history visible and missing or invalid timestamps explicit with UTC fallback", async () => {
    const status = sandoStatus();
    status.last_success_at = null; status.policies.last_success_at = "invalid";
    vi.mocked(sando.getSandoStatus).mockResolvedValue(status);
    wrapper = mount(SandoView, { global: { stubs } }); await flushPromises();
    expect(wrapper.get('[aria-label="Last successful host sync"]').text()).toBe("Last successful host sync (UTC): No successful sync yet");
    expect(wrapper.get('[aria-label="Last successful policy sync"]').text()).toBe("Last successful policy sync (UTC): Invalid timestamp");
  });
  it.each(["success", "failure"])("keeps initial status pending neutral, then handles %s", async outcome => {
    let resolve!: (status: sando.SandoStatus) => void, reject!: (error: Error) => void;
    vi.mocked(sando.getSandoStatus).mockReturnValue(new Promise((done, fail) => { resolve = done; reject = fail; }));
    wrapper = mount(SandoView, { global: { stubs } });
    expect(wrapper.get('[role="status"]').text()).toContain("Loading server-side");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Last successful host sync"]').exists()).toBe(false);
    if (outcome === "success") resolve(sandoStatus());
    else reject(new Error("HTTP 503: status unavailable"));
    await flushPromises();
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    if (outcome === "success") expect(wrapper.get('[aria-label="Last successful host sync"]').text()).toContain("2026-10-30 14:00:00");
    else expect(wrapper.get('[role="alert"]').text()).toContain("HTTP 503: status unavailable");
  });
  it("polls read-only status every 30 seconds, retaining stale timestamps on failure and updating on recovery", async () => {
    vi.useFakeTimers();
    wrapper = mount(SandoView, { global: { stubs } }); await flushPromises();
    vi.mocked(sando.getSandoStatus).mockRejectedValueOnce(new Error("Status read denied"));
    await vi.advanceTimersByTimeAsync(30_000); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("Previously loaded sync timestamps are stale");
    expect(wrapper.get('[aria-label="Last successful host sync"]').text()).toContain("2026-10-30 14:00:00");
    const status = sandoStatus(); status.last_success_at = "2026-11-25T01:00:00.999Z";
    vi.mocked(sando.getSandoStatus).mockResolvedValue(status);
    await vi.advanceTimersByTimeAsync(30_000); await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.get('[aria-label="Last successful host sync"]').text()).toContain("2026-11-25 01:00:00");
    expect(useControllerStore().draft).toBeNull();
  });
  it("reports host and policy worker errors separately while preserving their last successes", async () => {
    const status = sandoStatus();
    status.error = "Host source unreachable"; status.policies.error = "Policy apply busy";
    vi.mocked(sando.getSandoStatus).mockResolvedValue(status);
    wrapper = mount(SandoView, { global: { stubs } }); await flushPromises();
    expect(wrapper.text()).toContain("Host sync failed: Host source unreachable");
    expect(wrapper.text()).toContain("Policy sync failed: Policy apply busy");
    expect(wrapper.get('[aria-label="Last successful host sync"]').text()).toContain("2026-10-30 14:00:00");
    expect(wrapper.get('[aria-label="Last successful policy sync"]').text()).toContain("2026-10-30 19:30:08");
  });
  it("disables settings during initial configuration loading and frozen writes without false support warnings", async () => {
    const store = useControllerStore(), desired = store.state.data;
    store.state.data = null;
    wrapper = mount(SandoView, { global: { stubs } });
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(toggle("sync_enabled").attributes("disabled")).toBeDefined();
    store.state.data = desired; store.busy = true; await flushPromises();
    expect(toggle("policy_sync_enabled").attributes("disabled")).toBeDefined();
    expect(wrapper.get("button").attributes("disabled")).toBeDefined();
  });
  it("cancels prior-session status reads and does not show old source timestamps for a new source", async () => {
    let resolve!: (status: sando.SandoStatus) => void;
    vi.mocked(sando.getSandoStatus).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    wrapper = mount(SandoView, { global: { stubs } });
    const signal = vi.mocked(sando.getSandoStatus).mock.calls[0]![0]!;
    const status = sandoStatus(); status.last_success_at = null;
    vi.mocked(sando.getSandoStatus).mockResolvedValue(status);
    useControllerStore().sessionVersion++;
    await flushPromises();
    expect(signal.aborted).toBe(true);
    resolve(sandoStatus()); await flushPromises();
    expect(wrapper.get('[aria-label="Last successful host sync"]').text()).toContain("No successful sync yet");
  });
});
