import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, type Component } from "vue";
import { useControllerStore } from "@/stores/controller";
import * as api from "@/services/netcontrol";
import SandoView from "@/views/SandoView.vue";
import RemoteDnsView from "@/views/RemoteDnsView.vue";
import WireGuardView from "@/views/WireGuardView.vue";
import FirewallIngressView from "@/views/FirewallIngressView.vue";
import FirewallInputView from "@/views/FirewallInputView.vue";
import SettingsView from "@/views/SettingsView.vue";
import SystemUpgrade from "@/components/feature/SystemUpgrade.vue";
import OverviewBGP from "@/components/feature/OverviewBGP.vue";
import OverviewCounters from "@/components/feature/OverviewCounters.vue";
import OverviewGateways from "@/components/feature/OverviewGateways.vue";
import OverviewInterfaces from "@/components/feature/OverviewInterfaces.vue";
import OverviewSystem from "@/components/feature/OverviewSystem.vue";
import OverviewWireGuard from "@/components/feature/OverviewWireGuard.vue";
import LinkDiagnosticsTable from "@/components/feature/LinkDiagnosticsTable.vue";
import ProcessHealthView from "@/views/ProcessHealthView.vue";
import HomeAssistantView from "@/views/HomeAssistantView.vue";
import DynamicDnsView from "@/views/DynamicDnsView.vue";
import { software, state, statistics } from "../fixtures";
import { firewallCounters } from "../firewallTelemetryFixtures";
import { linkDiagnostics } from "../diagnosticsFixtures";
import { useFirewallCounters } from "@/composables/useFirewallCounters";
import ResourceTable from "@/components/feature/ResourceTable.vue";

vi.mock("vue3-apexcharts", () => ({ default: { template: "<div />" } }));
const box = { template: "<div><slot /></div>" };
const stubs = {
  VAlert: { template: '<div role="alert"><slot /></div>' },
  VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
  VChip: { template: "<span><slot /></span>" }, VTable: { template: "<table><slot /></table>" },
  VCard: box, VCardText: box, VCardActions: box, VDivider: true, VIcon: true, VProgressLinear: true,
  VTextField: true, VSelect: true, VAutocomplete: true, VSwitch: true, VCheckbox: true, VNumberInput: true,
  VDialog: { props: ["modelValue"], template: '<div v-if="modelValue"><slot /></div>' },
  RouterLink: { template: "<a><slot /></a>" },
};
let wrappers: VueWrapper[] = [];
function render(component: Component, props: Record<string, unknown> = {}) {
  const wrapper = mount(component, { props, global: { stubs } });
  wrappers.push(wrapper);
  return wrapper;
}
function readyState() {
  const store = useControllerStore();
  store.state.data = state(); store.state.stale = false; store.state.lastSuccess = Date.now();
}
beforeEach(() => {
  setActivePinia(createPinia());
  const store = useControllerStore(); store.connected = true;
  vi.spyOn(store, "refreshBGPStatus").mockResolvedValue(undefined);
  vi.spyOn(store, "refreshPlatformStatus").mockResolvedValue(undefined);
  vi.spyOn(store, "refreshLinkDiagnostics").mockResolvedValue(undefined);
  vi.spyOn(store, "refreshHostHealth").mockResolvedValue(undefined);
  vi.spyOn(store, "refreshMqttStatus").mockResolvedValue(undefined);
  vi.spyOn(store, "refreshDynamicDnsStatus").mockResolvedValue(undefined);
  vi.spyOn(api, "getDiscoveredInterfaces").mockResolvedValue([]);
  vi.spyOn(api, "getFirewallCounters").mockResolvedValue(firewallCounters());
  vi.spyOn(api, "getTimezones").mockResolvedValue({ timezones: ["UTC"] });
});
afterEach(() => {
  for (const wrapper of wrappers) wrapper.unmount();
  wrappers = [];
  useControllerStore().$dispose(); vi.restoreAllMocks();
});

describe("initial loading feedback", () => {
  it.each([
    ["Sando import", SandoView, "This backend does not support saved Sando"],
    ["remote DNS", RemoteDnsView, "Configure an interface with the LAN or WAN role"],
    ["WireGuard", WireGuardView, "Add a tunnel interface"],
    ["interface rules", FirewallIngressView, "No interface ingress policies configured"],
    ["input rules", FirewallInputView, "No host input filter configured"],
  ] as const)("does not mistake pending configuration for missing prerequisites on %s", async (_name, component, message) => {
    const wrapper = render(component);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain(message);
    expect(wrapper.text()).not.toContain("configuration is unavailable");
    expect(wrapper.findAll("button").filter(button => button.attributes("disabled") === undefined)).toHaveLength(0);
    readyState();
    useControllerStore().state.data!.desired.interfaces = [];
    await flushPromises();
    expect(wrapper.text()).toContain(message);
  });
  it("does not flash a sign-in warning during connection, but keeps writes blocked", () => {
    const store = useControllerStore();
    store.connected = false; store.connecting = true; readyState();
    expect(store.readOnlyNotice).toBe("");
    expect(store.readOnlyReason).toContain("Sign in");
    expect(store.firewallDeletionNotice).toBe("");
    expect(store.firewallDeletionBlockedReason).toBeTruthy();
    store.connecting = false;
    expect(store.readOnlyNotice).toContain("Sign in");
  });
  it("does not report software unavailable before initialization and preserves real failures and unsupported metadata", async () => {
    const store = useControllerStore(), wrapper = render(SystemUpgrade);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Unavailable");
    expect(wrapper.get("button").attributes("disabled")).toBeDefined();
    store.softwareCheckError = "Release check failed"; await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("Release check failed");
    store.softwareCheckError = "";
    store.state.error = "state.read permission required"; await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("state.read permission required");
    store.state.loading = true; await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("state.read permission required");
    readyState(); delete store.state.data!.desired.software; store.state.error = null; await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("Update the appliance backend");
    store.state.data = { ...store.state.data!, desired: { ...store.state.data!.desired, software: software() } }; await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });
  it.each(["success", "failure"] as const)("waits for the timezone request before displaying its %s outcome", async outcome => {
    let resolve!: (value: { timezones: string[] }) => void, reject!: (reason: Error) => void;
    vi.mocked(api.getTimezones).mockReturnValue(new Promise((done, fail) => { resolve = done; reject = fail; }));
    readyState();
    const wrapper = render(SettingsView);
    expect(wrapper.find("#general-timezone-description").exists()).toBe(false);
    if (outcome === "success") resolve({ timezones: ["UTC"] });
    else reject(new Error("Time zone permission denied"));
    await flushPromises();
    expect(wrapper.get("#general-timezone-description").text()).toContain(outcome === "success" ? "Clear to stop managing" : "Time zone permission denied");
  });
  it.each([OverviewBGP, OverviewCounters, OverviewGateways, OverviewInterfaces, OverviewSystem, OverviewWireGuard])(
    "does not mark an uninitialized overview dataset stale or unavailable (%s)", async component => {
      const wrapper = render(component); await flushPromises();
      expect(wrapper.find(".widget-note").exists()).toBe(false);
      expect(wrapper.text()).not.toMatch(/(?:status|configuration|counters) unavailable\./i);
      const store = useControllerStore();
      store.state.error = store.runtime.error = store.statistics.error = store.gatewayStatistics.error = store.hostHealth.error = store.bgpStatus.error = "Read denied";
      await flushPromises();
      expect(wrapper.get(".widget-note").text()).toMatch(/unavailable/i);
    },
  );
  it.each(["interfaces", "queues", "windows", "capture"] as const)("keeps %s diagnostics neutral until a response arrives", async kind => {
    const store = useControllerStore(), wrapper = render(LinkDiagnosticsTable, { kind });
    expect(wrapper.text()).not.toContain("unavailable");
    expect(wrapper.text()).not.toContain("Unavailable");
    store.linkDiagnostics.data = linkDiagnostics(); store.linkDiagnostics.lastSuccess = Date.now(); store.linkDiagnostics.stale = false;
    await flushPromises();
    expect(wrapper.text()).toContain("Current");
    store.linkDiagnostics.stale = true; store.linkDiagnostics.error = "Diagnostics read denied";
    await flushPromises();
    expect(wrapper.text()).toContain("Diagnostics read denied");
    expect(wrapper.text()).toMatch(/Historical|unavailable/);
  });
  it("does not report missing process health until the platform response establishes that it is absent", async () => {
    const store = useControllerStore(), wrapper = render(ProcessHealthView);
    expect(wrapper.text()).not.toContain("has not been observed");
    store.platform.error = "Platform read denied"; await flushPromises();
    expect(wrapper.text()).toContain("Platform read denied");
    expect(wrapper.text()).toContain("has not been observed");
  });
  it("keeps MQTT status neutral before its initial response without hiding read failures", async () => {
    readyState();
    const store = useControllerStore(), wrapper = render(HomeAssistantView);
    expect(wrapper.text()).not.toContain("Unavailable");
    store.mqttStatus.error = "MQTT read denied"; await flushPromises();
    expect(wrapper.text()).toContain("Unavailable");
    expect(wrapper.text()).toContain("MQTT read denied");
  });
  it("does not claim configured dynamic DNS entries are unavailable before their status read", async () => {
    readyState();
    const store = useControllerStore();
    store.state.data!.desired.dynamic_dns = [{
      name: "public", enabled: true, source_interface: "lab0", address_source: "interface",
      tenant_id: "tenant", client_id: "client", secret_ref: "credentials/public",
      zone_resource_id: "/subscriptions/test/resourceGroups/dns/providers/Microsoft.Network/dnsZones/example.test",
      record_name: "router", ttl_seconds: 300, interval_seconds: 300,
    }];
    const wrapper = render(DynamicDnsView);
    expect(wrapper.text()).not.toContain("Unavailable");
    store.dynamicDnsStatus.error = "Dynamic DNS read denied"; await flushPromises();
    expect(wrapper.text()).toContain("Unavailable");
  });
  it("does not claim firewall counters are unavailable while their configuration is still loading", async () => {
    const store = useControllerStore();
    vi.mocked(api.getFirewallCounters).mockRejectedValue(new Error("Counter read denied"));
    const wrapper = render(defineComponent({
      setup() {
        const counters = useFirewallCounters(() => store.state.data?.desired);
        return () => h("p", counters.notice.value);
      },
    }));
    expect(wrapper.text()).toBe("");
    expect(api.getFirewallCounters).not.toHaveBeenCalled();
    readyState(); await flushPromises();
    expect(wrapper.text()).toContain("Counter read denied");
  });
  it("keeps known stale data visible during subsequent refreshes", async () => {
    const store = useControllerStore();
    store.statistics.data = statistics(); store.statistics.lastSuccess = Date.now(); store.statistics.stale = true; store.statistics.loading = true;
    const wrapper = render(OverviewCounters); await flushPromises();
    expect(wrapper.get(".widget-note").text()).toBe("Stale");
  });
  it("shows failed Sando configuration reads rather than claiming the backend lacks support", async () => {
    const store = useControllerStore(), wrapper = render(SandoView);
    store.state.error = "Configuration read denied"; await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("Configuration read denied");
    expect(wrapper.text()).not.toContain("does not support saved Sando");
  });
  it("does not report missing resources until the selected configuration is loaded", async () => {
    const wrapper = render(ResourceTable, { section: "routes", rows: [], total: 0, disabled: true, detail: true });
    expect(wrapper.text()).not.toContain("Resource not found");
    readyState(); await flushPromises();
    expect(wrapper.text()).toContain("Resource not found in this configuration");
  });
});
