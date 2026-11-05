import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InterfaceCapabilitiesView from "@/views/InterfaceCapabilitiesView.vue";
import { useControllerStore } from "@/stores/controller";
import { ApiFailure } from "@/services/api";
import * as api from "@/services/netcontrol";
import type { InterfaceCapabilitySnapshot } from "@/services/interfaceCapabilities";
import { interfaceCapabilitySnapshot } from "../diagnosticsFixtures";
import { config, state } from "../fixtures";

const stubs = {
  VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
  VAlert: { template: "<div><slot /></div>" },
  VTable: { template: "<table><slot /></table>" },
  VChip: { props: ["color"], template: '<span :data-color="color"><slot /></span>' },
};
const render = () => mount(InterfaceCapabilitiesView, { global: { stubs } });
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  setActivePinia(createPinia());
  useControllerStore().connected = true;
  vi.spyOn(api, "getInterfaceCapabilities").mockResolvedValue(null);
  vi.spyOn(api, "refreshInterfaceCapabilities").mockResolvedValue(interfaceCapabilitySnapshot());
});
afterEach(() => { vi.restoreAllMocks(); });

describe("interface capability diagnostics", () => {
  it("reads only saved data initially and distinguishes pending from a completed null snapshot", async () => {
    const pending = deferred<InterfaceCapabilitySnapshot | null>();
    vi.mocked(api.getInterfaceCapabilities).mockReturnValue(pending.promise);
    const wrapper = render();
    expect(api.getInterfaceCapabilities).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal));
    expect(wrapper.text()).toContain("Loading interface capabilities");
    expect(wrapper.text()).not.toContain("No saved capability snapshot");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.get("button").attributes("disabled")).toBeDefined();
    expect(api.refreshInterfaceCapabilities).not.toHaveBeenCalled();
    pending.resolve(null); await flushPromises();
    expect(wrapper.text()).toContain("No saved capability snapshot");
    expect(wrapper.text()).not.toContain("Loading interface capabilities");
    expect(wrapper.find("table").exists()).toBe(false);
    expect(wrapper.get("button").attributes("disabled")).toBeUndefined();
  });

  it("shows a real initial failure rather than a fabricated empty or unsupported inventory", async () => {
    const pending = deferred<InterfaceCapabilitySnapshot | null>();
    vi.mocked(api.getInterfaceCapabilities).mockReturnValue(pending.promise);
    const wrapper = render();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    pending.reject(new ApiFailure("HTTP 503: Collector unavailable", 503)); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("HTTP 503");
    expect(wrapper.text()).not.toContain("No saved capability snapshot");
    expect(wrapper.text()).not.toContain("Loading interface capabilities");
    expect(api.refreshInterfaceCapabilities).not.toHaveBeenCalled();
  });

  it("uses one color-coded chip per capability without Details controls or collection errors", async () => {
    vi.spyOn(api, "getRpsDiagnostics");
    const snapshot = interfaceCapabilitySnapshot();
    snapshot.inventory.errors = ["Inventory collection error"];
    snapshot.inventory.interfaces[0]!.errors = ["Interface collection error"];
    vi.mocked(api.getInterfaceCapabilities).mockResolvedValue(snapshot);
    const wrapper = render(); await flushPromises();
    expect(api.getRpsDiagnostics).not.toHaveBeenCalled();
    expect(wrapper.find("form").exists()).toBe(false);
    expect(wrapper.find('[aria-label="RPS Configuration"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="NIC Offloads"]').exists()).toBe(false);
    const rows = wrapper.findAll("tbody > tr");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.text()).toContain("eno1");
    expect(rows[1]!.text()).toContain("lo");
    const chips = rows[0]!.findAll("[data-color]");
    expect(chips.map(chip => [chip.text(), chip.attributes("data-color")])).toEqual([
      ["Supported", "info"], ["Disabled", "warning"], ["Enabled", "success"],
      ["Enabled", "success"], ["Unsupported", "error"], ["Unknown", "default"],
    ]);
    expect(chips[0]!.attributes("title")).toBe("Support: Supported; enabled: Unknown");
    const virtual = rows[1]!.findAll("[data-color]");
    expect(virtual[0]!.text()).toBe("N/A");
    expect(virtual[1]!.text()).toBe("Unknown");
    expect(virtual[1]!.attributes("data-color")).toBe("default");
    expect(wrapper.findAll("button")).toHaveLength(1);
    expect(wrapper.text()).not.toMatch(/Details|[Cc]ollection error|ethtool:rx-checksum/);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(api.refreshInterfaceCapabilities).not.toHaveBeenCalled();
  });

  it("scans only on explicit single-flight actions, replaces rather than merges partial evidence, and never modifies drafts", async () => {
    const store = useControllerStore(); store.draft = config();
    const original = JSON.stringify(store.draft), pending = deferred<InterfaceCapabilitySnapshot>();
    vi.mocked(api.getInterfaceCapabilities).mockResolvedValue(interfaceCapabilitySnapshot());
    vi.mocked(api.refreshInterfaceCapabilities).mockReturnValueOnce(pending.promise);
    const wrapper = render(); await flushPromises();
    await wrapper.get("button").trigger("click");
    await wrapper.get("button").trigger("click");
    expect(api.refreshInterfaceCapabilities).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal));
    expect(wrapper.text()).toContain("eno1");
    const partial = interfaceCapabilitySnapshot();
    partial.inventory.status = "partial";
    partial.inventory.errors = ["Driver scan failed"];
    partial.inventory.interfaces = [partial.inventory.interfaces[1]!];
    partial.inventory.interfaces[0]!.errors = ["Queue scan denied"];
    pending.resolve(partial); await flushPromises();
    expect(wrapper.text()).not.toContain("eno1");
    expect(wrapper.text()).toContain("lo");
    expect(wrapper.text()).toContain("Partial snapshot");
    expect(wrapper.text()).not.toContain("Driver scan failed");
    expect(wrapper.text()).not.toContain("Queue scan denied");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    await wrapper.get("button").trigger("click"); await flushPromises();
    expect(api.refreshInterfaceCapabilities).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain("eno1");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(JSON.stringify(store.draft)).toBe(original);
  });

  it.each([400, 403, 409, 500, 503])("retains prior evidence explicitly stale after refresh HTTP %s", async status => {
    vi.mocked(api.getInterfaceCapabilities).mockResolvedValue(interfaceCapabilitySnapshot());
    vi.mocked(api.refreshInterfaceCapabilities).mockRejectedValue(new ApiFailure(`HTTP ${status}: Scan failed`, status));
    const wrapper = render(); await flushPromises();
    await wrapper.get("button").trigger("click"); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain(`HTTP ${status}`);
    expect(wrapper.text()).toContain("Stale: previous saved capabilities");
    expect(wrapper.text()).toContain("eno1");
    expect(api.refreshInterfaceCapabilities).toHaveBeenCalledTimes(1);
    expect(api.getInterfaceCapabilities).toHaveBeenCalledTimes(1);
    if (status === 403) {
      expect(wrapper.get("button").attributes("disabled")).toBeDefined();
      expect(wrapper.text()).toContain("interfaces.write");
    }
  });

  it("shows an uncertain refresh failure without retrying, then clears staleness on a successful explicit refresh", async () => {
    vi.mocked(api.getInterfaceCapabilities).mockResolvedValue(interfaceCapabilitySnapshot());
    vi.mocked(api.refreshInterfaceCapabilities).mockRejectedValueOnce(new Error("Connection lost"));
    const wrapper = render(); await flushPromises();
    await wrapper.get("button").trigger("click"); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("Refresh outcome is unknown");
    expect(wrapper.text()).toContain("Stale");
    expect(api.refreshInterfaceCapabilities).toHaveBeenCalledTimes(1);
    await wrapper.get("button").trigger("click"); await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Stale");
  });

  it("clears session-specific evidence and denial, reads only the new session cache and ignores old pending results", async () => {
    const store = useControllerStore(), previous = deferred<InterfaceCapabilitySnapshot>();
    vi.mocked(api.getInterfaceCapabilities).mockResolvedValueOnce(interfaceCapabilitySnapshot()).mockResolvedValue(null);
    vi.mocked(api.refreshInterfaceCapabilities).mockRejectedValueOnce(new ApiFailure("HTTP 403: Denied", 403)).mockReturnValueOnce(previous.promise);
    const wrapper = render(); await flushPromises();
    await wrapper.get("button").trigger("click"); await flushPromises();
    expect(wrapper.get("button").attributes("disabled")).toBeDefined();
    store.sessionVersion++; await flushPromises();
    expect(wrapper.find("table").exists()).toBe(false);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.get("button").attributes("disabled")).toBeUndefined();
    await wrapper.get("button").trigger("click");
    const signal = vi.mocked(api.refreshInterfaceCapabilities).mock.calls[1]![0]!;
    store.sessionVersion++; await flushPromises();
    expect(signal.aborted).toBe(true);
    previous.resolve(interfaceCapabilitySnapshot()); await flushPromises();
    expect(wrapper.text()).not.toContain("eno1");
    expect(wrapper.text()).toContain("No saved capability snapshot");
    expect(api.refreshInterfaceCapabilities).toHaveBeenCalledTimes(2);
    expect(api.getInterfaceCapabilities).toHaveBeenCalledTimes(3);
  });

  it("does not fetch disconnected, clears data on disconnect and aborts in-flight reads on unmount", async () => {
    const store = useControllerStore(); store.connected = false;
    const wrapper = render(); await flushPromises();
    expect(api.getInterfaceCapabilities).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Connect a firewall");
    const pending = deferred<InterfaceCapabilitySnapshot | null>();
    vi.mocked(api.getInterfaceCapabilities).mockReturnValue(pending.promise);
    store.connected = true; await flushPromises();
    const signal = vi.mocked(api.getInterfaceCapabilities).mock.calls[0]![0]!;
    wrapper.unmount();
    expect(signal.aborted).toBe(true);
    pending.resolve(interfaceCapabilitySnapshot()); await flushPromises();
    expect(api.refreshInterfaceCapabilities).not.toHaveBeenCalled();
  });

  it("clears a saved snapshot immediately on disconnect and ignores obsolete cache failures", async () => {
    const store = useControllerStore(), previous = deferred<InterfaceCapabilitySnapshot | null>();
    vi.mocked(api.getInterfaceCapabilities).mockResolvedValueOnce(interfaceCapabilitySnapshot()).mockReturnValueOnce(previous.promise).mockResolvedValue(null);
    const wrapper = render(); await flushPromises();
    expect(wrapper.text()).toContain("eno1");
    store.connected = false; await flushPromises();
    expect(wrapper.text()).not.toContain("eno1");
    expect(wrapper.text()).toContain("Connect a firewall");
    store.connected = true; await flushPromises();
    const signal = vi.mocked(api.getInterfaceCapabilities).mock.calls[1]![0]!;
    store.sessionVersion++; await flushPromises();
    previous.reject(new Error("Obsolete cache failure")); await flushPromises();
    expect(signal.aborted).toBe(true);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("No saved capability snapshot");
  });

  it("labels simulated and empty saved inventories without inventing measured support", async () => {
    const simulated = interfaceCapabilitySnapshot();
    simulated.inventory.source = "simulator"; simulated.inventory.status = "simulated"; simulated.inventory.interfaces = [];
    vi.mocked(api.getInterfaceCapabilities).mockResolvedValue(simulated);
    const wrapper = render(); await flushPromises();
    expect(wrapper.text()).toContain("Simulated inventory, not measured host hardware");
    expect(wrapper.text()).toContain("No interfaces were reported");
    expect(wrapper.text()).not.toContain("No saved capability snapshot");
    expect(wrapper.find("table").exists()).toBe(false);
  });

  it("formats fractional timestamps using only the saved timezone, preserving machine-readable precision", async () => {
    const store = useControllerStore(), saved = state();
    saved.desired.system = { hostname: "", domain: "", timezone: "America/Los_Angeles" };
    store.state.data = saved;
    vi.mocked(api.getInterfaceCapabilities).mockResolvedValue(interfaceCapabilitySnapshot());
    const wrapper = render(); await flushPromises();
    const footer = wrapper.get(".snapshot-context");
    expect(wrapper.element.lastElementChild).toBe(footer.element);
    expect(footer.classes()).toEqual(expect.arrayContaining(["text-caption", "text-medium-emphasis"]));
    expect(footer.find("time").exists()).toBe(true);
    expect(wrapper.text()).toContain("Collected (America/Los_Angeles)");
    expect(wrapper.get("time").text()).toBe("2026-11-03 21:10:00");
    expect(wrapper.get("time").attributes("datetime")).toBe("2026-11-04T05:10:00.123456Z");
    store.draft = { ...saved.desired, system: { hostname: "", domain: "", timezone: "Asia/Kolkata" } };
    await flushPromises();
    expect(wrapper.get("time").text()).toBe("2026-11-03 21:10:00");
    store.state.data = { ...saved, desired: { ...saved.desired, system: store.draft.system } };
    await flushPromises();
    expect(wrapper.text()).toContain("Collected (Asia/Kolkata)");
    expect(wrapper.get("time").text()).toBe("2026-11-04 10:40:00");
    store.state.data = null; await flushPromises();
    expect(wrapper.text()).toContain("Collected (UTC)");
    expect(wrapper.get("time").text()).toBe("2026-11-04 05:10:00");
  });
});
