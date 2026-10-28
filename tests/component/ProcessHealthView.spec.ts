import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProcessHealthView from "@/views/ProcessHealthView.vue";
import { useControllerStore } from "@/stores/controller";
import { cloneConfig } from "@/services/configuration";
import { config, processHealthSnapshot, state } from "../fixtures";
import * as api from "@/services/netcontrol";
import { ApiFailure } from "@/services/api";

const stubs = {
  VTable: { template: "<table><slot /></table>" },
  VChip: { props: ["color"], template: '<span class="health-chip" :data-color="color"><slot /></span>' },
  VProgressLinear: true,
  VBtn: { props: ["disabled", "icon"], template: '<button :disabled="disabled" :data-icon="icon"><slot /></button>' },
  VDialog: { props: ["modelValue"], template: '<div v-if="modelValue" role="dialog"><slot /></div>' },
  VCard: { props: ["title"], template: "<div>{{ title }}<slot /></div>" },
  VCardText: { template: "<div><slot /></div>" },
  VCardActions: { template: "<div><slot /></div>" },
};
let wrapper: ReturnType<typeof mount>;
beforeEach(() => {
  setActivePinia(createPinia());
  const store = useControllerStore();
  store.connected = true; store.state.data = state();
  store.platform.data = processHealthSnapshot();
  store.platform.stale = false; store.platform.lastSuccess = Date.now();
  vi.spyOn(store, "refreshPlatformStatus").mockResolvedValue();
});
afterEach(() => { wrapper?.unmount(); useControllerStore().$dispose(); vi.useRealTimers(); });
function render() { wrapper = mount(ProcessHealthView, { global: { stubs } }); return wrapper; }
function row(resource: string) { return wrapper.findAll("tbody tr").find(item => item.findAll("td")[1]?.text() === resource)!; }

describe("Process health diagnostics", () => {
  it("shows aggregate, daemon and component observations without a large page heading", () => {
    render();
    expect(wrapper.find("h1").exists()).toBe(false);
    expect(wrapper.get(".health-summary .health-chip").text()).toBe("Unhealthy");
    expect(row("netcontrold").text()).toContain("Running");
    expect(row("netcontrold").findAll(".health-chip").at(-1)!.text()).toBe("Healthy");
    expect(row("ntp").text()).toContain("Error · Recovering");
    expect(row("ntp").findAll(".health-chip").at(-1)!.attributes("data-color")).toBe("error");
    expect(row("syslog").text()).toContain("Disabled");
    expect(row("syslog").findAll(".health-chip").at(-1)!.text()).toBe("Unknown");
    expect(useControllerStore().refreshPlatformStatus).toHaveBeenCalledTimes(1);
  });
  it("shows deduplicated actionable alerts and clears recovered observations", async () => {
    const store = useControllerStore(), snapshot = processHealthSnapshot();
    snapshot.active_alerts.push(snapshot.active_alerts[0]!);
    store.platform.data = snapshot; render();
    expect(wrapper.get('[aria-label="Process alerts"]').findAll("li")).toHaveLength(1);
    expect(wrapper.text()).toContain("NTP worker is unavailable");
    snapshot.active_alerts = [];
    snapshot.process_health.status = "healthy"; snapshot.process_health.healthy = true;
    store.platform.data = structuredClone(snapshot);
    await flushPromises();
    expect(wrapper.get(".health-summary .health-chip").text()).toBe("Healthy");
    expect(wrapper.find('[aria-label="Process alerts"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("No active alerts.");
  });
  it("formats all collection and alert times to UTC seconds without changing API precision", () => {
    const store = useControllerStore(), snapshot = processHealthSnapshot();
    snapshot.process_health.components[0]!.collected_at = "2026-01-02T03:04:05.987+02:00";
    snapshot.process_health.components[1]!.collected_at = null;
    snapshot.active_alerts[0]!.last_seen_at = null;
    store.platform.data = snapshot; render();
    expect(wrapper.text()).toContain("Collected (UTC): 2026-10-27 01:02:03");
    expect(row("ntp").text()).toContain("2026-01-02 01:04:05");
    expect(row("syslog").findAll("td").at(-1)!.text()).toBe("Unavailable");
    expect(wrapper.text()).toContain("First seen (UTC): 2026-10-27 01:02:03");
    expect(wrapper.text()).toContain("Last seen (UTC): Unavailable");
    expect(wrapper.text()).not.toContain(".987");
    expect(store.platform.data.process_health.components[0]!.collected_at).toBe("2026-01-02T03:04:05.987+02:00");
  });
  it.each(["backend stale", "read failed", "expired"] as const)("never reports stale success when %s", async condition => {
    vi.useFakeTimers();
    const store = useControllerStore(), snapshot = processHealthSnapshot();
    snapshot.process_health.status = "healthy"; snapshot.process_health.healthy = true;
    store.platform.lastSuccess = null;
    store.platform.data = snapshot;
    store.platform.lastSuccess = Date.now();
    if (condition === "backend stale") snapshot.process_health.stale = true;
    if (condition === "read failed") { store.platform.error = "Health request failed"; store.platform.stale = true; }
    render();
    if (condition === "expired") await vi.advanceTimersByTimeAsync(15001);
    await flushPromises();
    expect(wrapper.get(".health-summary .health-chip").text()).toBe("Unknown");
    expect(wrapper.text()).toContain("Stale last-known observations");
    expect(wrapper.text()).toContain("Last-known alerts");
    expect(row("netcontrold").findAll(".health-chip").at(-1)!.text()).toBe("Unknown");
    expect(row("ntp").findAll(".health-chip").at(-1)!.text()).toBe("Unknown");
    expect(wrapper.text()).not.toContain("No active alerts.");
    if (condition === "read failed") expect(wrapper.text()).toContain("Health request failed");
  });
  it("keeps retained native failures explicit when runtime observation fails", () => {
    useControllerStore().platform.data!.process_health.runtime_available = false;
    render();
    expect(wrapper.text()).toContain("Native runtime could not be collected");
    expect(row("ntp").text()).toContain("Unhealthy");
    expect(wrapper.text()).toContain("NTP worker is unavailable");
  });
  it("shows missing observations and older-backend support explicitly", async () => {
    const store = useControllerStore();
    store.platform.data = null; store.platform.lastSuccess = null;
    store.platformUnsupported = true; render();
    expect(wrapper.get(".health-summary .health-chip").text()).toBe("Unknown");
    expect(wrapper.text()).toContain("This backend does not expose process health.");
    expect(wrapper.text()).toContain("No component observations available.");
    expect(wrapper.text()).not.toContain("No active alerts.");
    store.platformUnsupported = false; store.platform.error = "Health unavailable"; await flushPromises();
    expect(wrapper.text()).toContain("Health unavailable");
    expect(wrapper.text()).toContain("Process health has not been observed yet.");
  });
  it("uses compatible state health when the dedicated endpoint is unsupported", () => {
    const store = useControllerStore(), snapshot = processHealthSnapshot();
    store.platform.data = null; store.platform.lastSuccess = null; store.platformUnsupported = true;
    store.state.data = { ...state(), ...snapshot };
    store.state.stale = false; store.state.lastSuccess = Date.now();
    render();
    expect(row("ntp").text()).toContain("Error · Recovering");
    expect(wrapper.text()).not.toContain("does not expose process health");
  });
  it("preserves drafts and does not request configuration or worker repair", () => {
    const store = useControllerStore();
    store.stage(config());
    const draft = cloneConfig(store.draft!);
    const refreshState = vi.spyOn(store, "refreshState").mockResolvedValue();
    const refreshRuntime = vi.spyOn(store, "refreshRuntime").mockResolvedValue();
    const reconcile = vi.spyOn(store, "reconcile").mockResolvedValue();
    render();
    expect(store.draft).toEqual(draft);
    expect(refreshState).not.toHaveBeenCalled(); expect(refreshRuntime).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
    expect(wrapper.findAll("button")).toHaveLength(3);
    expect(wrapper.get('button[aria-label="Restart ntp"]').attributes("data-icon")).toBe("mdi-restart");
    expect(wrapper.get('button[aria-label="Restart ntp"]').text()).toBe("");
  });
  it("confirms a targeted restart without submitting a draft or repeating async requests", async () => {
    const store = useControllerStore();
    store.stage(config());
    const draft = cloneConfig(store.draft!);
    const restart = vi.spyOn(api, "restartProcess").mockResolvedValue({ target: "ntp", status: "restart_requested", generation: 1 });
    render();
    await wrapper.get('button[aria-label="Restart ntp"]').trigger("click");
    expect(restart).not.toHaveBeenCalled();
    expect(wrapper.get('[role="dialog"]').text()).toContain("caches, counters");
    await wrapper.findAll("button").find(button => button.text() === "Confirm restart")!.trigger("click");
    await flushPromises();
    expect(restart).toHaveBeenCalledExactlyOnceWith("ntp");
    expect(wrapper.text()).toContain("restart requested, not completed");
    expect(store.draft).toEqual(draft);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });
  it("disables inactive and unsupported observations and requires supervised daemon restart", async () => {
    const store = useControllerStore();
    store.platform.data!.process_health.daemon!.watchdog_enabled = false;
    render();
    expect(wrapper.get('button[aria-label="Restart syslog"]').attributes("disabled")).toBeDefined();
    expect(wrapper.get('button[aria-label="Restart netcontrold"]').attributes("disabled")).toBeDefined();
    store.platform.data = { ...store.platform.data!, process_health: { ...store.platform.data!.process_health, components: [
      ...store.platform.data!.process_health.components,
      { id: "future", component: "future", resource: "future", state: "running", healthy: true, retrying: false, collected_at: null },
    ] } };
    await flushPromises();
    expect(wrapper.get('button[aria-label="Restart future"]').attributes("disabled")).toBeDefined();
  });
  it("reports explicit authorization failures inline", async () => {
    vi.spyOn(api, "restartProcess").mockRejectedValue(new ApiFailure("HTTP 403: system.restart required", 403));
    render();
    await wrapper.get('button[aria-label="Restart ntp"]').trigger("click");
    await wrapper.findAll("button").find(button => button.text() === "Confirm restart")!.trigger("click");
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("system.restart required");
  });
});
