import { mount, flushPromises, type DOMWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import InterfacesView from "@/views/InterfacesView.vue";
import LoopbacksView from "@/views/LoopbacksView.vue";
import InterfaceDetailView from "@/views/InterfaceDetailView.vue";
import VLANsView from "@/views/VLANsView.vue";
import RoutesView from "@/views/RoutesView.vue";
import NATView from "@/views/NATView.vue";
import ConnectionsView from "@/views/ConnectionsView.vue";
import FirewallView from "@/views/FirewallView.vue";
import SettingsView from "@/views/SettingsView.vue";
import HomeAssistantView from "@/views/HomeAssistantView.vue";
import DynamicDnsView from "@/views/DynamicDnsView.vue";
import FirewallInputView from "@/views/FirewallInputView.vue";
import WireGuardView from "@/views/WireGuardView.vue";
import TunnelsView from "@/views/TunnelsView.vue";
import DHCPRelayView from "@/views/DHCPRelayView.vue";
import RelayStatus from "@/components/feature/RelayStatus.vue";
import ServiceRepair from "@/components/feature/ServiceRepair.vue";
import SystemUpgrade from "@/components/feature/SystemUpgrade.vue";
import FieldInput from "@/components/base/FieldInput.vue";
import PhysicalInterfaceEditor from "@/components/feature/PhysicalInterfaceEditor.vue";
import ResourceRowEditor from "@/components/feature/ResourceRowEditor.vue";
import ResourceFilters from "@/components/feature/ResourceFilters.vue";
import DHCPRetryButton from "@/components/feature/DHCPRetryButton.vue";
import ConfigDiff from "@/components/feature/ConfigDiff.vue";
import NTPView from "@/views/NTPView.vue";
import SyslogView from "@/views/SyslogView.vue";
import VnStatView from "@/views/VnStatView.vue";
import ServiceMaintenanceView from "@/views/ServiceMaintenanceView.vue";
import SoftflowdView from "@/views/SoftflowdView.vue";
import GatewayMonitorsView from "@/views/GatewayMonitorsView.vue";
import GatewayStatisticsPanel from "@/components/feature/GatewayStatisticsPanel.vue";
import InterfaceInventory from "@/components/feature/InterfaceInventory.vue";
import DatasetStatus from "@/components/base/DatasetStatus.vue";
import JsonPanel from "@/components/base/JsonPanel.vue";
import * as api from "@/services/netcontrol";
import { ApiFailure } from "@/services/api";
import { useControllerStore } from "@/stores/controller";
import { configSchema, runtimeSchema } from "@/types/domain";
import { displayResourceValue } from "@/services/resourceCollections";
import { cloneConfig, differences, requiredPermissions, validateConfig } from "@/services/configuration";
import { config, state, runtime, transaction, gatewayStatistics, monitor, statistics, connections } from "../fixtures";
import type { Component } from "vue";

const box = { template: "<div><slot /></div>" };
const stubs = {
  VAlert: box, VDivider: true, VCard: box, VCardText: box, VCardActions: box, VTable: { template: "<table><slot /></table>" },
  VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
  VChip: { props: ["color", "size", "variant"], template: '<span class="status-chip" :data-color="color"><slot /></span>' },
  VSwitch: { props: ["modelValue", "label", "disabled"], emits: ["update:modelValue"], template: '<label>{{ label }}<input type="checkbox" :checked="modelValue" :disabled="disabled" @change="$emit(\'update:modelValue\', $event.target.checked)"></label>' },
  VDialog: { props: ["modelValue"], template: '<div v-if="modelValue" role="dialog"><slot /></div>' },
  VSelect: { props: ["modelValue", "label", "items", "disabled"], emits: ["update:modelValue"], template: '<label>{{ label }}<select :disabled="disabled" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option value="">Select</option><option v-for="item in items" :key="item.value ?? item" :value="item.value ?? item">{{ item.title ?? item }}</option></select></label>' },
  VTextField: true, VAutocomplete: true, VNumberInput: true, VTextarea: true, VCheckbox: true, VCombobox: true, VBtnToggle: true, VIcon: true, VExpansionPanels: box, VExpansionPanel: box, VExpansionPanelTitle: box, VExpansionPanelText: box,
  DatasetStatus: true, JsonPanel: true, VProgressLinear: true,
};
beforeEach(() => {
  setActivePinia(createPinia());
  const store = useControllerStore();
  store.connected = true; store.state.data = state(); store.runtime.data = runtime();
  vi.spyOn(api, "getMqttStatus").mockResolvedValue({ device_id: "a".repeat(32), enabled: false, state: "disabled", error: null, last_published_at_unix: null });
  vi.spyOn(api, "getGatewayStatistics").mockResolvedValue({ sample: statistics().sample, monitors: [] });
  vi.spyOn(api, "getSystemUpgrade").mockResolvedValue({ enabled: false, repository: null, job: null, last_successful_version: null });
  vi.spyOn(api, "getDiscoveredInterfaces").mockImplementation(async () => (store.state.data?.desired.interfaces ?? []).map((link, index) => ({ name: link.name, kind: link.kind, index, mac: null, mtu: link.mtu, up: link.up, addresses: [...link.addresses], ownership: "managed" as const })));
});
async function render(component: Component, path: string, props: Record<string, unknown> = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:pathMatch(.*)*", component }] });
  await router.push(path); await router.isReady();
  const wrapper = mount(component, { props, global: { plugins: [router], stubs } });
  await flushPromises();
  return wrapper;
}
function cellValue(cell: Pick<DOMWrapper<Element>, "element">): string {
  const content = cell.element.cloneNode(true) as Element;
  content.querySelectorAll(".compact-cell-label").forEach(label => label.remove());
  return (content.textContent ?? "").trim();
}
describe("October 17 frontend workflows", () => {
  it("renders export instance names as plain text while keeping the edit action", async () => {
    const wrapper = await render(SoftflowdView, "/services/netflow");
    expect(wrapper.find("tbody").text()).toContain("capture");
    expect(wrapper.findAll("tbody a").some(link => link.text() === "capture")).toBe(false);
    await wrapper.get('button[aria-label="Edit / stage"]').trigger("click");
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(wrapper.find('tr[aria-label="Export editor"]').exists()).toBe(true);
    expect(wrapper.find('tr[aria-label="Export options"]').attributes("style")).toContain("display: none");
    await wrapper.findAll("button").find(button => button.text() === "Show advanced")!.trigger("click");
    expect(wrapper.find('tr[aria-label="Export options"]').attributes("style") ?? "").not.toContain("display: none");
    expect(wrapper.findComponent(FieldInput).exists()).toBe(true);
    wrapper.unmount();
  });
  it("shows cumulative capture drops as a colored chip column without a warning banner or staging a change", async () => {
    const store = useControllerStore();
    store.runtime.data = runtimeSchema.parse({
      ...runtime(),
      softflowd: [{ name: "capture", state: "running", dropped_packets: "1234567", statistics_complete: false }],
    });
    const wrapper = await render(SoftflowdView, "/services/netflow");
    expect(wrapper.findAll("th").map(header => header.text())).toEqual(expect.arrayContaining(["Observed", "State", "Dropped packets"]));
    expect(wrapper.findAll("th").map(header => header.text())).not.toContain("Observed enabled / runtime");
    expect(wrapper.text()).not.toContain("Capture statistics are incomplete");
    const chips = () => wrapper.findAll("tbody tr")[0]!.findAll(".status-chip").map(chip => [chip.text(), chip.attributes("data-color")]);
    expect(chips().at(-1)).toEqual(["1,234,567", "red"]);
    expect(chips().at(-2)).toEqual(["Running", "success"]);
    expect(wrapper.find('[title*="capture statistics are incomplete"]').exists()).toBe(true);
    expect(store.runtime.data.softflowd[0]?.state).toBe("running");
    expect(store.draft).toBeNull();
    for (const [dropped, color] of [["0", "green"], ["5", "yellow"], ["1000", "orange"]] as const) {
      store.runtime.data = runtimeSchema.parse({ ...runtime(), softflowd: [{ name: "capture", state: "running", dropped_packets: dropped, statistics_complete: true }] });
      await flushPromises();
      expect(chips().at(-1)![1]).toBe(color);
    }
    store.runtime.data = runtime(); await flushPromises();
    expect(chips().at(-1)).toEqual(["—", "default"]);
    wrapper.unmount();
  });
  it("labels the add button Add NetFlow/IPFIX export and stages an inline enabled toggle without a live request", async () => {
    const store = useControllerStore();
    const before = cloneConfig(store.state.data!.desired), submit = vi.spyOn(api, "submitPackage");
    const wrapper = await render(SoftflowdView, "/services/netflow");
    try {
      expect(wrapper.findAll("button").some(button => button.text() === "Add NetFlow/IPFIX export")).toBe(true);
      expect(wrapper.findAll("button").some(button => button.text() === "Add export")).toBe(false);
      expect(wrapper.findAll("th").map(header => header.text())).toContain("Status");
      const toggle = () => wrapper.get<HTMLInputElement>('[aria-label="Export enabled for capture"] input');
      const enabled = before.softflowd[0]!.enabled;
      await toggle().setValue(!enabled); await flushPromises();
      expect(store.draft?.softflowd).toEqual([{ ...before.softflowd[0], enabled: !enabled }]);
      expect(store.state.data!.desired).toEqual(before); expect(submit).not.toHaveBeenCalled();
      await toggle().setValue(enabled); await flushPromises();
      expect(store.draft?.softflowd[0]).toEqual(before.softflowd[0]);
    } finally { wrapper.unmount(); }
  });

  it("stages Home Assistant credentials as a reference, preserving shared draft changes without applying", async () => {
    const store = useControllerStore(), draft = config(); draft.routes[0]!.metric = 42; store.stage(draft);
    const upload = vi.spyOn(api, "uploadMqttPassword").mockResolvedValue({ password_ref: "a".repeat(32) });
    const submit = vi.spyOn(api, "submitPackage");
    const wrapper = await render(HomeAssistantView, "/settings/home-assistant");
    const field = (id: string) => wrapper.findAllComponents({ name: "VTextField" }).find(input => input.attributes("id") === id)!;
    wrapper.findComponent(stubs.VSwitch).vm.$emit("update:modelValue", true);
    field("mqtt-endpoint").vm.$emit("update:modelValue", "mqtts://broker.example.test:8883");
    field("mqtt-username").vm.$emit("update:modelValue", "publisher");
    field("mqtt-password").vm.$emit("update:modelValue", "synthetic-password");
    wrapper.findComponent(stubs.VSelect).vm.$emit("update:modelValue", "lab0");
    await flushPromises();
    store.state.data = { ...state(), desired: { ...config() } }; await flushPromises();
    expect(field("mqtt-password").attributes("modelvalue")).toBe("synthetic-password");
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(store.draft?.mqtt).toMatchObject({ enabled: true, username: "publisher", password_ref: "a".repeat(32), interval_seconds: 60 });
    expect(store.draft?.routes[0]?.metric).toBe(42); expect(submit).not.toHaveBeenCalled();
    expect(field("mqtt-password").attributes("modelvalue")).toBe("");
    expect(JSON.stringify(store.$state)).not.toContain("synthetic-password");
    await wrapper.get("form").trigger("submit"); await flushPromises(); expect(upload).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
  it("clears Home Assistant replacement passwords after validation or upload errors", async () => {
    const upload = vi.spyOn(api, "uploadMqttPassword").mockRejectedValue(new Error("Upload denied"));
    const wrapper = await render(HomeAssistantView, "/settings/home-assistant");
    const field = (id: string) => wrapper.findAllComponents({ name: "VTextField" }).find(input => input.attributes("id") === id)!;
    field("mqtt-password").vm.$emit("update:modelValue", "synthetic-password");
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(wrapper.text()).toContain("requires a username"); expect(upload).not.toHaveBeenCalled();
    expect(field("mqtt-password").attributes("modelvalue")).toBe("");
    field("mqtt-username").vm.$emit("update:modelValue", "publisher");
    field("mqtt-password").vm.$emit("update:modelValue", "synthetic-password");
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(wrapper.text()).toContain("Upload denied"); expect(field("mqtt-password").attributes("modelvalue")).toBe("");
    expect(useControllerStore().draft).toBeNull(); wrapper.unmount();
  });
  it("does not stage a Home Assistant upload after dismissing the page", async () => {
    let resolve!: (value: { password_ref: string }) => void;
    const upload = vi.spyOn(api, "uploadMqttPassword").mockImplementation(() => new Promise(done => { resolve = done; }));
    const wrapper = await render(HomeAssistantView, "/settings/home-assistant");
    const fields = wrapper.findAllComponents({ name: "VTextField" });
    fields.find(input => input.attributes("id") === "mqtt-username")!.vm.$emit("update:modelValue", "publisher");
    fields.find(input => input.attributes("id") === "mqtt-password")!.vm.$emit("update:modelValue", "synthetic-password");
    await wrapper.get("form").trigger("submit"); wrapper.unmount();
    expect(upload.mock.calls[0]?.[1]?.aborted).toBe(true);
    resolve({ password_ref: "a".repeat(32) }); await flushPromises(); expect(useControllerStore().draft).toBeNull();
  });
  it("formats the Home Assistant broker acknowledgment in UTC without implying ingestion", async () => {
    vi.mocked(api.getMqttStatus).mockResolvedValue({ device_id: "a".repeat(32), enabled: true, state: "running", error: null, last_published_at_unix: Date.UTC(2026, 9, 24, 12, 34, 56) / 1000 });
    const wrapper = await render(HomeAssistantView, "/settings/home-assistant");
    expect(wrapper.text()).toContain("Last broker acknowledgment (UTC): 2026-10-24 12:34:56");
    expect(wrapper.find(".status-chip").attributes("data-color")).toBe("success"); wrapper.unmount();
  });
  it("keeps probe details stable while a background refresh is pending and updates on completion", async () => {
    vi.useFakeTimers();
    const store = useControllerStore(), sample = gatewayStatistics();
    store.state.data!.desired.gateway_monitors = [monitor()];
    store.gatewayStatistics.stale = false;
    store.gatewayStatistics.data = { sample: statistics().sample, monitors: [sample] };
    const wrapper = await render(GatewayStatisticsPanel, "/gateway-monitors", { name: sample.name });
    const measurement = (name: string) => wrapper.findAll("dl > div").find(item => item.get("dt").text() === name)!.get("dd").text();
    let complete!: (value: NonNullable<typeof store.gatewayStatistics.data>) => void;
    vi.mocked(api.getGatewayStatistics).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    try {
      const refresh = store.refreshGatewayStatistics();
      await vi.advanceTimersByTimeAsync(7000);
      expect(store.gatewayStatistics.loading).toBe(true);
      expect(measurement("Sample")).toBe("available"); expect(measurement("Health")).toBe("up");
      expect(measurement("Mean RTT")).toBe("1.25 ms");
      complete({ sample: statistics().sample, monitors: [{ ...sample, collected_at: new Date().toISOString(), health: "down", rtt_avg_ms: 4.5 }] });
      await refresh; await flushPromises();
      expect(measurement("Health")).toBe("down"); expect(measurement("Mean RTT")).toBe("4.5 ms");
      vi.mocked(api.getGatewayStatistics).mockRejectedValueOnce(new Error("Probe read failed"));
      await store.refreshGatewayStatistics(); await flushPromises();
      expect(measurement("Health")).toBe("unknown"); expect(measurement("Sample")).toBe("stale");
    } finally { wrapper.unmount(); vi.useRealTimers(); }
  });
  it("shows probe statistics without expanding the monitor and preserves zero and unavailable values", async () => {
    const store = useControllerStore(); store.state.data!.desired.gateway_monitors = [monitor()];
    const measured = { ...gatewayStatistics(), rtt_avg_ms: 0, rtt_variation_ms: null };
    vi.mocked(api.getGatewayStatistics).mockResolvedValue({ sample: statistics().sample, monitors: [measured] });
    const wrapper = await render(GatewayMonitorsView, "/gateway-monitors");
    try {
      const summary = wrapper.get("tbody > tr");
      const measurement = (name: string) => cellValue(summary.get(`[data-metric="${name}"]`));
      expect(measurement("Mean RTT")).toBe("0 ms"); expect(measurement("Stddev")).toBe("1.25 ms");
      expect(measurement("RTT variation")).toBe("Unavailable"); expect(measurement("Loss")).toBe("33.33 %");
      expect(summary.text()).not.toContain("no monitor sample");
      expect(summary.get('[data-metric="Loss"]').attributes("title")).toBe("33.33 %");
      expect(wrapper.findAll("thead th").map(item => item.text())).toEqual(["Name", "Interface", "Status", "Health", "Loss", "Mean RTT", "Stddev", "RTT variation", "Actions"]);
      expect(summary.findAll("td")).toHaveLength(9);
      expect(summary.get(".status-chip").attributes("data-color")).toBe("success");
      expect(summary.get(".status-chip").text()).toBe("up");
      expect(summary.findAll(".status-chip")).toHaveLength(5);
      for (const [metric, color] of [["Loss", "red"], ["Mean RTT", "green"], ["Stddev", "green"], ["RTT variation", "default"]]) {
        expect(summary.get(`[data-metric="${metric}"] .status-chip`).attributes("data-color")).toBe(color);
      }
      expect(summary.get('[data-metric="Loss"] .status-chip').attributes("title")).toContain("red >= 5 %");
      expect(summary.get('[data-metric="Mean RTT"] .status-chip').attributes("aria-label")).toContain("Good");
      const row = summary.element.closest("tr")!;
      expect(row.textContent).toContain("uplink");
      expect(row.querySelector('[aria-label="Monitoring enabled for uplink"]')?.closest("td")).not.toBe(row.querySelector('[aria-label="Edit / stage"]')?.closest("td"));
      expect(summary.findAll("td")[2]!.find('[aria-label="Monitoring enabled for uplink"]').exists()).toBe(true);
      expect(wrapper.findAll("tbody > tr")).toHaveLength(1);
      expect(wrapper.find('[aria-label="uplink live statistics"]').exists()).toBe(false);
      expect(wrapper.get('[aria-label="Live statistics for uplink"]').attributes("aria-expanded")).toBe("false");
      expect(row.textContent).not.toContain(monitor().target);
      await wrapper.get('[aria-label="Live statistics for uplink"]').trigger("click");
      const detail = wrapper.get('[aria-label="uplink live statistics"]');
      expect(detail.text()).toContain(monitor().target);
      for (const key of ["Sample", "Sent", "Received", "Lost", "Pending"]) expect(detail.findAll("dt").map(item => item.text())).toContain(key);
    } finally { wrapper.unmount(); }
  });
  it.each(["stale", "disabled", "warming_up", "simulated", "error", "no-data", "worker-stopped"])("keeps metric chips neutral for %s samples", async condition => {
    const store = useControllerStore(); store.state.data!.desired.gateway_monitors = [monitor()];
    vi.mocked(api.getGatewayStatistics).mockResolvedValue({ sample: statistics().sample, monitors: [gatewayStatistics()] });
    const wrapper = await render(GatewayMonitorsView, "/gateway-monitors");
    try {
      const data = { ...store.gatewayStatistics.data!.monitors[0]! };
      if (condition === "stale") store.gatewayStatistics.stale = true;
      else if (condition === "disabled") store.state.data = {
        ...store.state.data!,
        desired: { ...store.state.data!.desired, gateway_monitors: [{ ...monitor(), enabled: false }] },
      };
      else if (condition === "warming_up" || condition === "simulated") data.sample_status = condition;
      else if (condition === "error") data.error = "Probe unavailable";
      else if (condition === "worker-stopped") data.process_state = "not_running";
      store.gatewayStatistics.data = { ...store.gatewayStatistics.data!, monitors: condition === "no-data" ? [] : [data] };
      await flushPromises();
      const chips = wrapper.findAll('tbody > tr [data-metric]:not([data-metric="Health"]) .status-chip');
      expect(chips).toHaveLength(4);
      for (const chip of chips) {
        expect(chip.attributes("data-color")).toBe("default");
        expect(chip.attributes("aria-label")).toContain("Unrated");
      }
      if (condition === "error") expect(wrapper.get('[role="alert"]').text()).toContain("Probe unavailable");
    } finally { wrapper.unmount(); }
  });
  it.each([
    { health: "up", color: "success" },
    { health: "degraded", color: "warning" },
    { health: "down", color: "error" },
    { health: "unknown", color: "default" },
  ])("colors the $health monitor health chip", async ({ health, color }) => {
    const store = useControllerStore(); store.state.data!.desired.gateway_monitors = [monitor()];
    vi.mocked(api.getGatewayStatistics).mockResolvedValue({ sample: statistics().sample, monitors: [{ ...gatewayStatistics(), health }] });
    const wrapper = await render(GatewayMonitorsView, "/gateway-monitors");
    try {
      const chip = wrapper.get('tbody > tr [data-metric="Health"] .status-chip');
      expect(chip.text()).toBe(health); expect(chip.attributes("data-color")).toBe(color);
    } finally { wrapper.unmount(); }
  });
  it("rederives monitor paths when interfaces change and retains explicit IPv6 probing on DHCP interfaces", async () => {
    const store = useControllerStore(), desired = store.state.data!.desired;
    desired.interfaces.push({ ...cloneConfig(desired).interfaces[0]!, name: "lab1" });
    desired.interfaces[0]!.kind = "ethernet"; desired.interfaces[0]!.addresses = ["2001:db8::10/64"];
    desired.dhcp_clients = { lab0: { client_id: "", hostname: "", route_metric: 0, use_mtu: false, use_domains: "no" } };
    desired.routes = [{ enabled: true, destination: "0.0.0.0/0", interface: "lab1", gateway: "192.0.2.1", table: 254, metric: 0 }, { enabled: true, destination: "::/0", interface: "lab0", gateway: "2001:db8::1", table: 254, metric: 0 }];
    const wrapper = await render(GatewayMonitorsView, "/gateway-monitors");
    try {
      await wrapper.findAll("button").find(button => button.text() === "Add monitor")!.trigger("click");
      const editor = wrapper.getComponent(ResourceRowEditor);
      editor.vm.$emit("change", "target", "1.1.1.1"); editor.vm.$emit("change", "interface", "lab1"); await flushPromises();
      expect(editor.props("form")).toMatchObject({ interface: "lab1", source_address: "192.0.2.10", gateway: "192.0.2.1", routing_table: 254 });
      expect(editor.props("form")).not.toHaveProperty("mode");
      editor.vm.$emit("change", "interface", "lab0"); await flushPromises();
      expect(editor.props("form").mode).toBe("dhcp"); expect(editor.props("form")).not.toHaveProperty("source_address");
      expect(editor.props("fields").find(field => field.key === "interface")?.choices?.map(choice => choice.value)).toEqual(["lab0", "lab1"]);
      editor.vm.$emit("change", "target", "2001:db8::20"); await flushPromises();
      expect(editor.props("form")).toMatchObject({ source_address: "2001:db8::10", gateway: "2001:db8::1", routing_table: 254 });
      expect(editor.props("form")).not.toHaveProperty("mode");
      editor.vm.$emit("change", "target", "1.1.1.1"); editor.vm.$emit("change", "interface", "lab1"); await flushPromises();
      expect(editor.props("form")).not.toHaveProperty("mode"); expect(editor.props("form").source_address).toBe("192.0.2.10");
    } finally { wrapper.unmount(); }
  });
  it("renders DHCP waiting and resolved paths read-only without reporting remote Down or inventing RTT", async () => {
    const store = useControllerStore();
    const automatic = configSchema.shape.gateway_monitors.parse([{ name: "wan-health", enabled: true, mode: "dhcp", interface: "lab0", target: "1.1.1.1" }])[0]!;
    store.state.data!.desired.gateway_monitors = [automatic];
    store.gatewayStatistics.stale = false;
    store.gatewayStatistics.data = { sample: statistics().sample, monitors: [{ ...gatewayStatistics(), name: automatic.name, mode: "dhcp", interface: "lab0", process_state: "waiting", sample_status: "waiting_for_dhcp", health: "down", resolved_source_address: null, resolved_gateway: null, resolved_routing_table: null, reason: "waiting for DHCP lease", loss_percent: null, rtt_avg_ms: null }] };
    const wrapper = await render(GatewayStatisticsPanel, "/gateway-monitors", { name: automatic.name });
    try {
      expect(wrapper.text()).toContain("Waiting for DHCP"); expect(wrapper.text()).toContain("waiting for DHCP lease");
      expect(wrapper.text()).toContain("unknown"); expect(wrapper.text()).not.toContain("down");
      const measurement = (name: string) => wrapper.findAll("dl > div").find(item => item.get("dt").text() === name)!.get("dd").text();
      expect(measurement("Mean RTT")).toBe("Unavailable"); expect(measurement("Resolved source")).toBe("Unavailable");
      store.gatewayStatistics.data = { ...store.gatewayStatistics.data!, monitors: [{ ...store.gatewayStatistics.data!.monitors[0]!, process_state: "running", sample_status: "warming_up", health: "unknown", resolved_source_address: "192.0.2.20", resolved_gateway: null, resolved_routing_table: 20000, reason: null }] };
      await flushPromises();
      expect(measurement("Resolved source")).toBe("192.0.2.20"); expect(measurement("Resolved gateway")).toBe("Direct");
      expect(measurement("Resolved table")).toBe("20000"); expect(automatic).not.toHaveProperty("source_address");
    } finally { wrapper.unmount(); }
  });
  it("derives DHCP monitor mode from the interface without a lease or mode choice", async () => {
    const store = useControllerStore();
    store.runtime.stale = false;
    store.runtime.data!.capabilities = { gateway_monitor_modes: ["explicit", "dhcp"], dhcp_gateway_monitor_address_families: ["ipv4"] };
    store.state.data!.desired.interfaces[0]!.kind = "ethernet"; store.state.data!.desired.interfaces[0]!.addresses = [];
    store.state.data!.desired.dhcp_clients = { lab0: { client_id: "", hostname: "", route_metric: 0, use_mtu: false, use_domains: "no" } };
    store.state.data!.desired.routes = [];
    const submit = vi.spyOn(api, "submitPackage"), wrapper = await render(GatewayMonitorsView, "/gateway-monitors");
    try {
      await wrapper.findAll("button").find(button => button.text() === "Add monitor")!.trigger("click");
      const editor = wrapper.getComponent(ResourceRowEditor);
      expect(editor.props("fields").some(field => field.key === "mode")).toBe(false);
      for (const [key, value] of Object.entries({ name: "wan-health", interface: "lab0", target: "1.1.1.1" })) editor.vm.$emit("change", key, value);
      await flushPromises();
      expect(editor.props("fields").find(field => field.key === "interface")?.choices?.map(choice => choice.value)).toEqual(["lab0"]);
      expect(editor.props("form").mode).toBe("dhcp");
      expect(editor.props("form")).not.toHaveProperty("source_address");
      editor.vm.$emit("stage"); await flushPromises();
      expect(store.draft?.gateway_monitors[0]).toMatchObject({ name: "wan-health", mode: "dhcp", enabled: true, interface: "lab0", target: "1.1.1.1" });
      for (const key of ["source_address", "gateway", "routing_table"]) expect(store.draft?.gateway_monitors[0]).not.toHaveProperty(key);
      expect(submit).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); }
  });
  it("hides DHCP mode without advertised capabilities and blocks imported DHCP monitor submissions", async () => {
    const store = useControllerStore(), wrapper = await render(GatewayMonitorsView, "/gateway-monitors");
    try {
      await wrapper.findAll("button").find(button => button.text() === "Add monitor")!.trigger("click");
      expect(wrapper.getComponent(ResourceRowEditor).props("fields").some(field => field.key === "mode")).toBe(false);
      store.state.stale = false; store.state.lastSuccess = Date.now(); store.transactions.stale = false; store.transactions.data = {};
      const candidate = cloneConfig(store.state.data!.desired);
      candidate.gateway_monitors = [configSchema.shape.gateway_monitors.parse([{ name: "wan-health", enabled: true, mode: "dhcp", interface: "lab0", target: "1.1.1.1" }])[0]!];
      store.stage(candidate);
      expect(store.applyBlockedReason).toContain("advertise DHCP IPv4");
      expect(store.canApply).toBe(false);
    } finally { wrapper.unmount(); }
  });
  it.each([
    { component: GatewayMonitorsView, path: "/gateway-monitors" },
    { component: NTPView, path: "/ntp" },
    { component: FirewallInputView, path: "/firewall/input" },
    { component: SettingsView, path: "/settings" },
  ])("keeps missing configuration warnings off $path without enabling writes", async ({ component, path }) => {
    const store = useControllerStore();
    store.state.data = null;
    const wrapper = await render(component, path);
    try {
      expect(wrapper.text()).not.toContain("Committed desired configuration is unavailable");
      expect(wrapper.text()).not.toContain("Committed configuration is unavailable.");
      expect(store.readOnlyNotice).toBe("");
      expect(store.readOnlyReason).toContain("Committed desired configuration is unavailable");
      expect(store.canApply).toBe(false);
      const save = wrapper.findAll("button").find(button => /^(Save|Add monitor)$/.test(button.text()));
      if (save) expect(save.attributes("disabled")).toBeDefined();
      store.state.incompatible = true;
      await flushPromises();
      expect(wrapper.text()).toContain("Incompatible API data");
    } finally { wrapper.unmount(); }
  });
  it("requires explicit connection deletion and separate namespace flush confirmation without changing drafts", async () => {
    const store = useControllerStore(), draft = config(); draft.routes[0]!.metric = 42; store.stage(draft);
    const before = JSON.stringify(store.draft), sample = connections();
    vi.spyOn(api, "getConnections").mockResolvedValue(sample);
    vi.spyOn(api, "getState").mockResolvedValue(state()); vi.spyOn(api, "getTransactions").mockResolvedValue({});
    const remove = vi.spyOn(api, "deleteConnection").mockResolvedValue({ status: "deleted", scope: sample.sample.scope });
    const flush = vi.spyOn(api, "deleteAllConnections").mockResolvedValue({ status: "flushed", scope: sample.sample.scope });
    const wrapper = await render(ConnectionsView, "/connections");
    try {
      const headers = wrapper.findAll("thead th");
      expect(headers.at(-1)!.text()).toBe("Delete");
      expect(headers.at(-1)!.find("button").exists()).toBe(false);
      for (const row of wrapper.findAll(".connection-row")) {
        expect(row.findAll("td")).toHaveLength(headers.length);
        expect(row.get("td:last-child").classes()).toContain("connection-actions");
        expect(row.get(".connection-actions button").attributes("aria-label")).toMatch(/^Delete connection /);
        expect(row.get(".connection-state").find("button").exists()).toBe(false);
      }
      await wrapper.get(`[aria-label="Delete connection ${sample.connections[0]!.id}"]`).trigger("click");
      expect(remove).not.toHaveBeenCalled(); expect(flush).not.toHaveBeenCalled();
      expect(wrapper.get('[role="dialog"]').text()).toContain("Management access and NAT sessions can be interrupted");
      await wrapper.findAll("button").find(button => button.text() === "Delete state")!.trigger("click"); await flushPromises();
      expect(remove).toHaveBeenCalledWith(sample.connections[0]); expect(flush).not.toHaveBeenCalled();
      await wrapper.get('[aria-label="Flush all connection states"]').trigger("click");
      expect(wrapper.get('[role="dialog"]').text()).toContain("Current filters and pagination do not limit this flush");
      expect(wrapper.get('[role="dialog"]').text()).toContain("All IPv4 and IPv6");
      await wrapper.findAll("button").find(button => button.text() === "Flush ALL states")!.trigger("click"); await flushPromises();
      expect(flush).toHaveBeenCalledTimes(1); expect(flush).toHaveBeenCalledWith();
      expect(JSON.stringify(store.draft)).toBe(before);
    } finally { wrapper.unmount(); }
  });
  it.each([404, 504])("refreshes after connection deletion HTTP %s without destructive retries", async status => {
    const sample = connections(), store = useControllerStore();
    const read = vi.spyOn(api, "getConnections").mockResolvedValue(sample);
    vi.spyOn(api, "getState").mockResolvedValue(state()); vi.spyOn(api, "getTransactions").mockResolvedValue({});
    const remove = vi.spyOn(api, "deleteConnection").mockRejectedValue(new ApiFailure("rejected", status, undefined, status === 504));
    const wrapper = await render(ConnectionsView, "/connections");
    try {
      await wrapper.get(`[aria-label="Delete connection ${sample.connections[0]!.id}"]`).trigger("click");
      await wrapper.findAll("button").find(button => button.text() === "Delete state")!.trigger("click"); await flushPromises();
      expect(remove).toHaveBeenCalledTimes(1); expect(read).toHaveBeenCalledTimes(2);
      expect(wrapper.text()).toContain(status === 404 ? "expired or changed" : "Outcome uncertain");
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false); expect(store.draft).toBeNull();
    } finally { wrapper.unmount(); }
  });
  it("confirms the exact signed-upgrade version and configured repository before submitting", async () => {
    const available = { enabled: true, repository: "operator/appliance", job: null, last_successful_version: null };
    vi.mocked(api.getSystemUpgrade).mockResolvedValue(available); vi.spyOn(api, "getTransactions").mockResolvedValue({});
    const install = vi.spyOn(api, "startSystemUpgrade").mockResolvedValue({ id: "upgrade-1", version: "1.2.3", status: "queued", created_at: "2026-10-24T00:00:00Z", updated_at: "2026-10-24T00:00:00Z", error: null, last_successful_version: null });
    const wrapper = await render(SystemUpgrade, "/services/maintenance");
    try {
      wrapper.getComponent({ name: "VTextField" }).vm.$emit("update:modelValue", "1.2.3"); await flushPromises();
      await wrapper.findAll("button").find(button => button.text() === "Upgrade")!.trigger("click"); await flushPromises();
      expect(install).not.toHaveBeenCalled(); expect(wrapper.get('[role="dialog"]').text()).toContain("operator/appliance");
      expect(wrapper.get('[role="dialog"]').text()).toContain("interrupt management connectivity");
      await wrapper.findAll("button").find(button => button.text() === "Install upgrade")!.trigger("click"); await flushPromises();
      expect(install).toHaveBeenCalledWith("1.2.3"); expect(install).toHaveBeenCalledTimes(1);
      expect(useControllerStore().upgrade.data?.job?.id).toBe("upgrade-1");
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });
  it.each(["add", "edit"])("collapses advanced probe settings on %s without discarding values", async mode => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const store = useControllerStore();
    store.state.data!.desired.gateway_monitors = [{ ...monitor(), probe_interval_ms: 1500 }];
    const wrapper = await render(GatewayMonitorsView, "/gateway-monitors");
    const open = async () => {
      if (mode === "add") await wrapper.findAll("button").find(button => button.text() === "Add monitor")!.trigger("click");
      else await wrapper.get('[aria-label="Edit / stage"]').trigger("click");
    };
    try {
      await open();
      const editor = wrapper.getComponent(ResourceRowEditor);
      const options = editor.get(".resource-editor-options");
      const toggle = editor.findAll("button").find(button => button.text() === "Show advanced")!;
      expect(editor.get(".probe-target-controls").text()).toContain("Show advanced");
      expect(editor.get(".probe-target-controls").findAllComponents(FieldInput)[0]!.props("field").key).toBe("target");
      expect(toggle.attributes("append-icon")).toBe("mdi-chevron-down");
      expect(editor.get(".editor-actions").text()).not.toContain("Show advanced");
      expect(wrapper.text()).not.toContain("Following DHCP lease and gateway changes requires a backend update");
      expect((options.element as HTMLElement).style.display).toBe("none");
      expect(toggle.attributes("aria-expanded")).toBe("false");
      expect(toggle.attributes("aria-controls")).toBe(options.attributes("id"));
      expect(editor.props("form").probe_interval_ms).toBe(mode === "add" ? 1000 : 1500);
      await toggle.trigger("click");
      expect((options.element as HTMLElement).style.display).not.toBe("none");
      expect(toggle.text()).toBe("Hide advanced");
      expect(toggle.attributes("append-icon")).toBe("mdi-chevron-up");
      const interval = editor.findAllComponents(FieldInput).find(field => field.props("field").key === "probe_interval_ms")!;
      interval.vm.$emit("update:modelValue", 2000);
      await flushPromises();
      await toggle.trigger("click");
      expect((options.element as HTMLElement).style.display).toBe("none");
      expect(editor.props("form").probe_interval_ms).toBe(2000);
      await toggle.trigger("click");
      expect(interval.props("modelValue")).toBe(2000);
      await editor.findAll("button").find(button => button.text() === "Cancel")!.trigger("click");
      await open();
      expect(wrapper.getComponent(ResourceRowEditor).get(".resource-editor-options").isVisible()).toBe(false);
      expect(store.draft).toBeNull();
    } finally { wrapper.unmount(); }
  });
  it.each([
    { component: RoutesView, path: "/routes", key: "interface" },
    { component: NATView, path: "/nat", key: "out_interface" },
    { component: SoftflowdView, path: "/softflowd", key: "interface" },
    { component: GatewayMonitorsView, path: "/gateway-monitors", key: "interface" },
    { component: VLANsView, path: "/vlans", key: "parent" },
    { component: FirewallInputView, path: "/firewall/input", key: "interface" },
  ])("shows reactive display names and interface identities in $path choices", async ({ component, path, key }) => {
    const store = useControllerStore();
    store.state.data!.desired.interfaces[0] = {
      ...config().interfaces[0]!, kind: "ethernet", metadata: { display_name: "WAN", description: "" },
    };
    store.state.data!.desired.firewall.input = { policy: "drop", interfaces: [{ interface: "lab0", rules: [] }] };
    const wrapper = await render(component, path);
    await wrapper.findAll("button").find(button => button.text().startsWith(path === "/firewall/input" ? "Edit input policy" : "Add "))!.trigger("click");
    const choiceField = () => wrapper.findAllComponents(FieldInput).find(field => field.props("field").key === key)!;
    expect(choiceField().props("field").choices).toContainEqual({ title: "WAN (lab0)", value: "lab0" });
    await choiceField().get("select").setValue("lab0");
    expect(choiceField().props("modelValue")).toBe("lab0");

    store.draft = cloneConfig(store.state.data!.desired);
    store.draft.interfaces[0]!.metadata = { display_name: "Office", description: "" };
    await flushPromises();
    expect(choiceField().props("field").choices).toContainEqual({ title: "Office (lab0)", value: "lab0" });
    wrapper.unmount();
  });
  it("rejects unsupported DHCP monitor paths without changing DHCP configuration", async () => {
    const store = useControllerStore();
    const desired = store.state.data!.desired;
    desired.interfaces[0] = { ...desired.interfaces[0]!, kind: "ethernet", addresses: [] };
    desired.dhcp_clients = { lab0: { client_id: "", hostname: "", route_metric: 0, use_mtu: false, use_domains: "no" } };
    const before = cloneConfig(desired), submit = vi.spyOn(api, "submitPackage");
    const wrapper = await render(GatewayMonitorsView, "/gateway-monitors");
    expect(wrapper.text()).not.toContain("DHCP-learned IPv4 addresses and routes are not supported");
    await wrapper.findAll("button").find(button => button.text() === "Add monitor")!.trigger("click");
    const editor = wrapper.getComponent(ResourceRowEditor);
    expect(editor.props("fields").some(field => field.key === "mode")).toBe(false);
    for (const [key, value] of Object.entries({ name: "wan", interface: "lab0", target: "1.1.1.1" })) {
      editor.vm.$emit("change", key, value);
    }
    await flushPromises();
    await editor.findAll("button").find(button => button.text() === "Save")!.trigger("click");
    expect(wrapper.get('[role="alert"]').text()).toContain("does not advertise DHCP monitor support");
    expect(store.draft).toBeNull();
    expect(store.state.data!.desired).toEqual(before);
    expect(submit).not.toHaveBeenCalled();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await editor.findAll("button").find(button => button.text() === "Cancel")!.trigger("click");
    expect(wrapper.text()).not.toContain("DHCP-learned IPv4 addresses and routes are not supported");
    wrapper.unmount();
  });
  it("stages route status without popup confirmation, path rewrites or live requests", async () => {
    const store = useControllerStore();
    store.state.data!.desired.routes[0]!.gateway = "192.0.2.1";
    store.state.data!.desired.routes[0]!.metadata = { display_name: "Management path", description: "Keep all fields" };
    const before = cloneConfig(store.state.data!.desired), submit = vi.spyOn(api, "submitPackage");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const wrapper = await render(RoutesView, "/routes");
    try {
      const toggle = () => wrapper.get<HTMLInputElement>('[aria-label="Route enabled for 198.51.100.0/24"] input');
      await toggle().setValue(false);
      expect(store.draft).toEqual({ ...before, routes: [{ ...before.routes[0], enabled: false }] });
      expect(store.draft!.routes[0]!.table).toBe(10000);
      expect(store.state.data!.desired).toEqual(before); expect(submit).not.toHaveBeenCalled();
      expect(toggle().element.checked).toBe(false);
      await toggle().setValue(true);
      expect(store.draft?.routes[0]).toEqual(before.routes[0]);
      expect(confirm).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); }
  });
  it("saves a disabled route from the inline editor without popup confirmation", async () => {
    const store = useControllerStore(), confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const wrapper = await render(RoutesView, "/routes");
    try {
      await wrapper.get('button[aria-label="Edit / stage"]').trigger("click");
      const editor = wrapper.getComponent(ResourceRowEditor);
      editor.vm.$emit("change", "enabled", false); await flushPromises();
      await editor.findAll("button").find(button => button.text() === "Save")!.trigger("click");
      expect(store.draft?.routes[0]!.enabled).toBe(false);
      expect(confirm).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); }
  });
  it("filters routes by enabled status without hiding disabled records by default", async () => {
    const store = useControllerStore();
    store.state.data!.desired.routes = Array.from({ length: 21 }, (_, index) => ({ ...config().routes[0]!, metric: index + 1, enabled: index % 2 === 0 }));
    const wrapper = await render(RoutesView, "/routes");
    try {
      expect(wrapper.findAll("tbody tr")).toHaveLength(21);
      const status = wrapper.getComponent(ResourceFilters).findAll("select").find(select => select.find('option[value="Disabled"]').exists())!;
      await status.setValue("Disabled"); expect(wrapper.findAll("tbody tr")).toHaveLength(10);
      await status.setValue("Enabled"); expect(wrapper.findAll("tbody tr")).toHaveLength(11);
    } finally { wrapper.unmount(); }
  });
  it("filters routes by interface identity while showing display names", async () => {
    const store = useControllerStore();
    store.state.data!.desired.interfaces[0]!.metadata = { display_name: "WAN", description: "" };
    store.state.data!.desired.routes = Array.from({ length: 21 }, () => ({ ...config().routes[0]! }));
    const wrapper = await render(RoutesView, "/routes");
    const filters = wrapper.getComponent(ResourceFilters);
    const select = filters.findAll("select").find(select => select.text().includes("WAN (lab0)"))!;
    expect(select.find('option[value="All"]').exists()).toBe(true);
    await select.setValue("lab0");
    expect(filters.props("modelValue").interface).toBe("lab0");
    wrapper.unmount();
  });
  it("stages Dynamic DNS entries with a secret reference only and clears the secret", async () => {
    const store = useControllerStore();
    vi.spyOn(api, "getDynamicDnsStatus").mockResolvedValue({ entries: [] });
    const upload = vi.spyOn(api, "uploadDynamicDnsSecret").mockResolvedValue({ secret_ref: "b".repeat(32) });
    const wrapper = await render(DynamicDnsView, "/settings/dynamic-dns");
    await wrapper.findAll("button").find(button => button.text() === "Add entry")!.trigger("click");
    const set = (label: string, value: unknown) => wrapper.findAllComponents({ name: "VTextField" }).find(item => item.attributes("label") === label)!.vm.$emit("update:modelValue", value);
    set("Name", "azure-wan"); set("Tenant ID", "11111111-1111-4111-8111-111111111111"); set("Client ID", "22222222-2222-4222-8222-222222222222");
    set("Azure DNS zone resource ID", "/subscriptions/x/resourceGroups/dns-rg/providers/Microsoft.Network/dnszones/example.com");
    set("Record name (@ for the zone apex)", "home"); set("Client secret", "synthetic-secret");
    wrapper.findComponent(stubs.VSelect).vm.$emit("update:modelValue", "lab0");
    await flushPromises(); await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(store.draft?.dynamic_dns).toEqual([expect.objectContaining({ name: "azure-wan", secret_ref: "b".repeat(32), source_interface: "lab0", ttl_seconds: 300 })]);
    expect(JSON.stringify(store.$state)).not.toContain("synthetic-secret");
    expect(wrapper.find("form").exists()).toBe(false);
    wrapper.unmount();
  });
  it("marks enabled IPv4 routes on DHCP interfaces as waiting without a valid lease, never changing configured intent", async () => {
    const store = useControllerStore(), base = config().routes[0]!;
    store.state.data!.desired.dhcp_clients = { lab0: { client_id: "", hostname: "", route_metric: 0, use_mtu: false, use_domains: "no" } };
    store.state.data!.desired.routes = [{ ...base, destination: "198.51.100.0/24" }, { ...base, destination: "203.0.113.0/24", enabled: false }, { ...base, destination: "2001:db8:1::/48" }];
    store.runtime.data = { ...runtime(), dhcp_clients: { leases: {}, errors: { lab0: "no offers" } } }; store.runtime.stale = false; store.runtime.lastSuccess = Date.now();
    const wrapper = await render(RoutesView, "/routes");
    const waiting = () => wrapper.findAll("tbody tr").map(row => row.text().includes("Waiting for DHCP"));
    expect(waiting()).toEqual([true, false, false]);
    expect(wrapper.find('[title*="no offers"]').exists()).toBe(true);
    const lease = { client: store.state.data!.desired.dhcp_clients!.lab0!, address: "192.0.2.10/24", server: "192.0.2.1", acquired_at: Math.floor(Date.now() / 1000), lifetime: 3600, renewal: 1800, rebinding: 3000, routes: [], dns: [], domain: "", mtu: null };
    store.runtime.data = { ...runtime(), dhcp_clients: { leases: { lab0: lease }, errors: {} } }; await flushPromises();
    expect(waiting()).toEqual([false, false, false]);
    expect(store.state.data!.desired.routes[0]!.enabled).toBe(true);
    wrapper.unmount();
  });
  it("infers a new static route's next hop from the interface's default gateway but not for connected networks", async () => {
    const store = useControllerStore();
    store.state.data!.desired.routes = [{ ...config().routes[0]!, destination: "0.0.0.0/0", gateway: "192.0.2.1", table: 254, metric: 100 }];
    const wrapper = await render(RoutesView, "/routes");
    for (const [destination, gateway] of [["20.243.160.145/32", "192.0.2.1"], ["192.0.2.128/25", undefined]] as const) {
      await wrapper.findAll("button").find(button => button.text().startsWith("Add "))!.trigger("click");
      const editor = wrapper.getComponent(ResourceRowEditor);
      editor.vm.$emit("change", "destination", destination); editor.vm.$emit("change", "interface", "lab0"); editor.vm.$emit("change", "metric", 1);
      await flushPromises();
      await editor.findAll("button").find(button => button.text() === "Save")!.trigger("click");
      expect(store.draft?.routes.find(route => route.destination === destination)?.gateway).toBe(gateway);
      store.discardDraft();
    }
    wrapper.unmount();
  });
  it.each([
    { component: RoutesView, path: "/routes", section: "routes" as const, identity: "203.0.113.0/24", invalid: "metric", valid: 10,
      values: { destination: "203.0.113.0/24", interface: "lab0", table: 10000, metric: 10 } },
    { component: GatewayMonitorsView, path: "/gateway-monitors", section: "gateway_monitors" as const, identity: "backup", invalid: "probe_interval_ms", valid: 1000,
      values: { name: "backup", interface: "lab0", target: "198.51.100.1", routing_table: 10001 } },
  ])("adds and validates $section inline while protecting dirty input", async ({ component, path, section, identity, invalid, valid, values }) => {
    const store = useControllerStore();
    if (section === "gateway_monitors") {
      store.state.data!.desired.routes.push({ ...store.state.data!.desired.routes[0]!, table: 254 });
    }
    const before = cloneConfig(store.state.data!.desired), submit = vi.spyOn(api, "submitPackage");
    const wrapper = await render(component, path);
    await wrapper.findAll("button").find(button => button.text().startsWith("Add "))!.trigger("click");
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    let editor = wrapper.getComponent(ResourceRowEditor);
    expect(editor.findAllComponents(FieldInput).map(field => field.props("field").key)).not.toContain("metadata");
    if (section === "gateway_monitors") expect(editor.findAllComponents(FieldInput).map(field => field.props("field").key)).not.toContain("routing_table");
    if (section === "gateway_monitors") {
      expect(editor.props("fields").map(field => field.key)).not.toContain("enabled");
      expect(editor.props("fields").map(field => field.key)).not.toContain("source_address");
      expect(editor.props("fields").map(field => field.key)).not.toContain("gateway");
      expect(editor.props("form").enabled).toBe(true);
    }
    if (section === "routes") expect(editor.findAllComponents(FieldInput).map(field => field.props("field").key)).not.toContain("table");
    if (section === "routes") expect(editor.findAllComponents(FieldInput).map(field => field.props("field").key)).not.toContain("gateway");
    for (const [key, value] of Object.entries(values)) editor.vm.$emit("change", key, value);
    editor.vm.$emit("change", invalid, -1);
    await flushPromises();
    await editor.findAll("button").find(button => button.text() === "Save")!.trigger("click");
    expect(wrapper.findComponent(ResourceRowEditor).exists()).toBe(true);
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    if (section === "gateway_monitors") {
      expect(editor.get(".resource-editor-options").isVisible()).toBe(true);
      expect(editor.findAll("button").find(button => button.text() === "Hide advanced")!.attributes("aria-expanded")).toBe("true");
    }
    expect(store.draft).toBeNull();
    editor.vm.$emit("change", invalid, valid);
    await flushPromises();
    await editor.findAll("button").find(button => button.text() === "Save")!.trigger("click");
    expect(wrapper.findComponent(ResourceRowEditor).exists()).toBe(false);
    expect(store.draft?.[section]).toHaveLength(before[section].length + 1);
    if (section === "gateway_monitors") {
      expect(store.draft?.gateway_monitors.at(-1)?.routing_table).toBe(254);
      expect(store.draft?.gateway_monitors.at(-1)?.source_address).toBe("192.0.2.10");
      expect(store.draft?.gateway_monitors.at(-1)?.enabled).toBe(true);
      expect(wrapper.findAll("th").map(header => header.text())).not.toContain("Enabled");
      await wrapper.get('input[type="checkbox"]').setValue(false);
      expect(store.draft?.gateway_monitors.at(-1)?.enabled).toBe(false);
      await wrapper.get('input[type="checkbox"]').setValue(true);
      expect(store.draft?.gateway_monitors.at(-1)?.enabled).toBe(true);
      expect(store.draft?.gateway_monitors.slice(0, -1)).toEqual(before.gateway_monitors);
    }
    if (section === "routes") {
      expect(store.draft?.routes.at(-1)?.table).toBe(254);
      expect(store.draft?.routes.at(-1)?.gateway).toBeUndefined();
      expect(store.draft?.routes.slice(0, -1)).toEqual(before.routes);
    }
    expect(store.draft?.interfaces).toEqual(before.interfaces);
    expect(store.draft?.firewall).toEqual(before.firewall);
    expect(wrapper.findAll("th").map(header => header.text())).not.toContain("Changes");
    const saved = cloneConfig(store.draft!);
    const row = wrapper.findAll("tbody tr").find(item => item.text().includes(identity))!;
    await row.get('[aria-label="Edit / stage"]').trigger("click");
    editor = wrapper.getComponent(ResourceRowEditor);
    expect(editor.props("form")[invalid]).toBe(valid);
    if (section === "routes") expect(editor.findAllComponents(FieldInput).map(field => field.props("field").key)).not.toContain("metadata");
    else expect(editor.findAllComponents(FieldInput).map(field => field.props("field").key)).toContain("metadata");
    if (section === "gateway_monitors") expect(editor.findAllComponents(FieldInput).map(field => field.props("field").key)).toContain("latency_threshold_ms");
    editor.vm.$emit("change", invalid, valid + 1); await flushPromises(); await flushPromises();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await wrapper.findAll("button").find(button => button.text().startsWith("Add "))!.trigger("click");
    expect(confirm).toHaveBeenCalled();
    expect(wrapper.getComponent(ResourceRowEditor).props("form")[invalid]).toBe(valid + 1);
    confirm.mockReturnValue(true);
    await editor.findAll("button").find(button => button.text() === "Cancel")!.trigger("click");
    expect(wrapper.findComponent(ResourceRowEditor).exists()).toBe(false);
    expect(store.draft).toEqual(saved); expect(store.editorDirty).toBe(false);
    expect(submit).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it("adds and edits masquerading inline with local validation and draft-only saves", async () => {
    const store = useControllerStore();
    store.state.data!.desired.firewall.nat.masquerade[0]!.metadata = { display_name: "Existing", description: "Keep this" };
    const before = cloneConfig(store.state.data!.desired), submit = vi.spyOn(api, "submitPackage");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const wrapper = await render(NATView, "/nat");
    try {
      await wrapper.findAll("button").find(button => button.text() === "Add rule")!.trigger("click");
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
      let editor = wrapper.getComponent(ResourceRowEditor);
      expect(editor.props("position")).toBe(2);
      expect(editor.findAllComponents(FieldInput).map(field => field.props("field").key)).toEqual(["family", "source", "out_interface"]);
      expect(editor.findAll("td").map(cell => Number(cell.attributes("colspan") ?? 1)).reduce((sum, count) => sum + count, 0)).toBe(5);
      editor.vm.$emit("change", "out_interface", "lab0");
      editor.vm.$emit("change", "source", "2001:db8::/64");
      await flushPromises();
      editor.vm.$emit("stage"); await flushPromises();
      expect(wrapper.get('[role="alert"]').text()).toBeTruthy();
      expect(editor.props("errors").editor).toContain("Source must match selected family");
      expect(store.draft).toBeNull();
      editor.vm.$emit("change", "source", "192.0.2.0/24"); await flushPromises();
      editor.vm.$emit("stage"); await flushPromises();
      expect(wrapper.findComponent(ResourceRowEditor).exists()).toBe(false);
      expect(store.draft?.firewall.nat.masquerade).toEqual([
        ...before.firewall.nat.masquerade, { family: "ipv4", source: "192.0.2.0/24", out_interface: "lab0" },
      ]);
      await wrapper.findAll('[aria-label="Edit / stage"]')[0]!.trigger("click");
      editor = wrapper.getComponent(ResourceRowEditor);
      expect(editor.props("position")).toBe(1);
      expect(editor.props("form").metadata).toEqual(before.firewall.nat.masquerade[0]!.metadata);
      expect(editor.findAllComponents(FieldInput).map(field => field.props("field").key)).toEqual(["family", "source", "out_interface"]);
      expect(editor.find("fieldset").exists()).toBe(false);
      editor.vm.$emit("change", "source", "198.51.100.0/24"); await flushPromises();
      editor.vm.$emit("stage"); await flushPromises();
      expect(store.draft?.firewall.nat.masquerade[0]).toEqual({ ...before.firewall.nat.masquerade[0], source: "198.51.100.0/24" });
      expect(store.draft?.routes).toEqual(before.routes);
      expect(store.draft?.interfaces).toEqual(before.interfaces);
      expect(store.state.data!.desired).toEqual(before);
      expect(wrapper.findAll("th").map(header => header.text())).not.toContain("Changes");
      expect(submit).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); }
  });
  it("cancels, switches and reorders inline masquerade rules without popups or stale edits", async () => {
    const store = useControllerStore(), desired = store.state.data!.desired;
    desired.firewall.nat.masquerade.push({ family: "ipv6", out_interface: "lab0" });
    const before = cloneConfig(desired), confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const wrapper = await render(NATView, "/nat");
    try {
      await wrapper.findAll('[aria-label="Edit / stage"]')[0]!.trigger("click");
      wrapper.getComponent(ResourceRowEditor).vm.$emit("change", "source", "192.0.2.0/24"); await flushPromises();
      await wrapper.get('[aria-label="Edit / stage"]').trigger("click");
      expect(wrapper.findAllComponents(ResourceRowEditor)).toHaveLength(1);
      expect(wrapper.getComponent(ResourceRowEditor).props("form").family).toBe("ipv6");
      wrapper.getComponent(ResourceRowEditor).vm.$emit("change", "source", "2001:db8::/64"); await flushPromises();
      await wrapper.findAll("button").find(button => button.text() === "Add rule")!.trigger("click");
      expect(wrapper.getComponent(ResourceRowEditor).props("position")).toBe(3);
      wrapper.getComponent(ResourceRowEditor).vm.$emit("change", "source", "192.0.2.0/24"); await flushPromises();
      await wrapper.get('[aria-label="Masquerade editor"]').trigger("keydown", { key: "Escape" });
      expect(wrapper.findComponent(ResourceRowEditor).exists()).toBe(false);
      expect(store.draft).toBeNull(); expect(store.editorDirty).toBe(false);
      await wrapper.findAll('[aria-label="Edit / stage"]')[0]!.trigger("click");
      wrapper.getComponent(ResourceRowEditor).vm.$emit("change", "source", "192.0.2.0/24"); await flushPromises();
      await wrapper.get('[aria-label="Move up"]').trigger("click");
      expect(wrapper.findComponent(ResourceRowEditor).exists()).toBe(false);
      expect(store.draft?.firewall.nat.masquerade).toEqual([...before.firewall.nat.masquerade].reverse());
      await wrapper.findAll("button").find(button => button.text() === "Add rule")!.trigger("click");
      wrapper.getComponent(ResourceRowEditor).vm.$emit("change", "out_interface", "lab0"); await flushPromises();
      await wrapper.findAll("button").find(button => button.text() === "Cancel")!.trigger("click");
      expect(wrapper.findComponent(ResourceRowEditor).exists()).toBe(false);
      expect(store.editorDirty).toBe(false);
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
      expect(confirm).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); }
  });
  it("adds masquerading inline to an empty table and disables editing in read-only mode", async () => {
    const store = useControllerStore();
    store.state.data!.desired.firewall.nat.masquerade = [];
    const wrapper = await render(NATView, "/nat");
    try {
      await wrapper.findAll("button").find(button => button.text() === "Add rule")!.trigger("click");
      expect(wrapper.findAllComponents(ResourceRowEditor)).toHaveLength(1);
      expect(wrapper.getComponent(ResourceRowEditor).props("position")).toBe(1);
      expect(wrapper.text()).not.toContain("No configured resources.");
      wrapper.getComponent(ResourceRowEditor).vm.$emit("change", "out_interface", "lab0"); await flushPromises();
      wrapper.getComponent(ResourceRowEditor).vm.$emit("stage"); await flushPromises();
      expect(store.draft?.firewall.nat.masquerade).toEqual([{ family: "ipv4", out_interface: "lab0" }]);
      store.busy = true; await flushPromises();
      expect(wrapper.findAll("button").find(button => button.text() === "Add rule")!.attributes("disabled")).toBeDefined();
      expect(wrapper.get('[aria-label="Edit / stage"]').attributes("disabled")).toBeDefined();
    } finally { wrapper.unmount(); }
  });
  it("saves edited routes in table 254 regardless of their previous table", async () => {
    const store = useControllerStore();
    store.state.data!.desired.routes[0]!.gateway = "192.0.2.1";
    const before = cloneConfig(store.state.data!.desired);
    expect(before.routes[0]!.table).toBe(10000);
    const wrapper = await render(RoutesView, "/routes");
    await wrapper.get('[aria-label="Edit / stage"]').trigger("click");
    const editor = wrapper.getComponent(ResourceRowEditor);
    expect(editor.findAllComponents(FieldInput).map(field => field.props("field").key)).not.toContain("table");
    expect(wrapper.findAll("th").map(header => header.text())).not.toContain("Table");
    expect(editor.findAllComponents(FieldInput).map(field => field.props("field").key)).not.toContain("gateway");
    expect(wrapper.findAll("th").map(header => header.text())).not.toContain("Gateway");
    editor.vm.$emit("change", "table", 10001);
    editor.vm.$emit("change", "metric", 42);
    await flushPromises();
    await editor.findAll("button").find(button => button.text() === "Save")!.trigger("click");
    expect(wrapper.findComponent(ResourceRowEditor).exists()).toBe(false);
    expect(store.draft?.routes).toEqual([{ ...before.routes[0], table: 254, metric: 42 }, ...before.routes.slice(1)]);
    expect(store.state.data!.desired).toEqual(before);
    wrapper.unmount();
  });
  it("saves edited gateway monitors in table 254 without a routing table control", async () => {
    const store = useControllerStore();
    store.state.data!.desired.gateway_monitors = [monitor()];
    store.state.data!.desired.routes.push({ ...store.state.data!.desired.routes[0]!, table: 254 });
    const before = cloneConfig(store.state.data!.desired);
    expect(before.gateway_monitors[0]!.routing_table).toBe(10000);
    const wrapper = await render(GatewayMonitorsView, "/gateway-monitors");
    await wrapper.get('[aria-label="Edit / stage"]').trigger("click");
    const editor = wrapper.getComponent(ResourceRowEditor);
    expect(editor.findAllComponents(FieldInput).map(field => field.props("field").key)).not.toContain("routing_table");
    expect(wrapper.findAll("th").map(header => header.text())).not.toContain("Routing table");
    editor.vm.$emit("change", "routing_table", 10001);
    editor.vm.$emit("change", "latency_threshold_ms", 175);
    await flushPromises();
    await editor.findAll("button").find(button => button.text() === "Save")!.trigger("click");
    expect(wrapper.findComponent(ResourceRowEditor).exists()).toBe(false);
    expect(store.draft?.gateway_monitors).toEqual([{ ...before.gateway_monitors[0], routing_table: 254, latency_threshold_ms: 175 }]);
    expect(store.draft?.routes).toEqual(before.routes);
    expect(store.state.data!.desired).toEqual(before);
    wrapper.unmount();
  });
  it.each([
    { target: "198.51.100.1", source: "192.0.2.10", network: "198.51.100.0/24", sourceNetwork: "192.0.2.0/24", via: undefined },
    { target: "2001:db8:1::1", source: "2001:db8::10", network: "2001:db8:1::/64", sourceNetwork: "2001:db8::/64", via: undefined },
    { target: "2001:db8:1::1", source: "2001:db8::10", network: "2001:db8:1::/64", sourceNetwork: "2001:db8::/64", via: "2001:db8::1" },
  ])("derives the monitor source and gateway for $target through $via", async ({ target, source, network, via }) => {
    const store = useControllerStore();
    store.state.data!.desired.interfaces[0]!.addresses = ["2001:db8::10/64", "192.0.2.10/24"];
    store.state.data!.desired.routes = [{ enabled: true, destination: network, interface: "lab0", table: 254, metric: 1, ...(via ? { gateway: via } : {}) }];
    const wrapper = await render(GatewayMonitorsView, "/gateway-monitors");
    await wrapper.findAll("button").find(button => button.text() === "Add monitor")!.trigger("click");
    const editor = wrapper.getComponent(ResourceRowEditor);
    expect(editor.props("fields").map(field => field.key)).not.toContain("gateway");
    expect(editor.props("fields").find(field => field.key === "target")?.label).toBe("Probe Target");
    for (const [key, value] of Object.entries({ name: "automatic", interface: "lab0", target })) editor.vm.$emit("change", key, value);
    await flushPromises();
    expect(editor.props("form").source_address).toBe(source);
    await editor.findAll("button").find(button => button.text() === "Save")!.trigger("click");
    expect(wrapper.findComponent(ResourceRowEditor).exists()).toBe(false);
    expect(store.draft?.gateway_monitors[0]).toMatchObject({ enabled: true, source_address: source, gateway: via ?? target, routing_table: 254 });
    wrapper.unmount();
  });
  it("updates the monitor source on interface changes and reports missing addresses at Interface", async () => {
    const store = useControllerStore();
    store.state.data!.desired.interfaces.push({ ...store.state.data!.desired.interfaces[0]!, name: "empty0", addresses: [] });
    const wrapper = await render(GatewayMonitorsView, "/gateway-monitors");
    await wrapper.findAll("button").find(button => button.text() === "Add monitor")!.trigger("click");
    const editor = wrapper.getComponent(ResourceRowEditor);
    for (const [key, value] of Object.entries({ name: "automatic", interface: "lab0", target: "198.51.100.1" })) editor.vm.$emit("change", key, value);
    await flushPromises(); expect(editor.props("form").source_address).toBe("192.0.2.10");
    editor.vm.$emit("change", "interface", "empty0"); await flushPromises();
    expect(editor.props("form").source_address).toBe("");
    await editor.findAll("button").find(button => button.text() === "Save")!.trigger("click");
    expect(editor.props("errors")["editor.interface"]).toEqual(["The selected interface needs a configured source IP of the same IP version as the probe target, not the same address or subnet."]);
    expect(store.draft).toBeNull();
    editor.vm.$emit("change", "interface", "lab0"); await flushPromises();
    expect(editor.props("form").source_address).toBe("192.0.2.10");
    wrapper.unmount();
  });
  it("derives the monitor gateway by prefix length then metric on its selected interface and table", async () => {
    const store = useControllerStore(), desired = store.state.data!.desired;
    desired.interfaces.push({ ...desired.interfaces[0]!, name: "other0", addresses: ["203.0.113.10/24"] });
    desired.routes = [
      { enabled: true, destination: "0.0.0.0/0", interface: "lab0", gateway: "192.0.2.1", table: 254, metric: 1 },
      { enabled: true, destination: "198.51.100.0/24", interface: "lab0", gateway: "192.0.2.2", table: 254, metric: 20 },
      { enabled: true, destination: "198.51.100.0/24", interface: "lab0", gateway: "192.0.2.3", table: 254, metric: 5 },
      { enabled: true, destination: "198.51.100.1/32", interface: "lab0", gateway: "192.0.2.4", table: 10000, metric: 1 },
      { enabled: true, destination: "198.51.100.1/32", interface: "other0", gateway: "203.0.113.1", table: 254, metric: 1 },
    ];
    const wrapper = await render(GatewayMonitorsView, "/gateway-monitors");
    await wrapper.findAll("button").find(button => button.text() === "Add monitor")!.trigger("click");
    const editor = wrapper.getComponent(ResourceRowEditor);
    for (const [key, value] of Object.entries({ name: "automatic", interface: "lab0", target: "198.51.100.1" })) editor.vm.$emit("change", key, value);
    await flushPromises(); expect(editor.props("form").gateway).toBe("192.0.2.3");
    await editor.findAll("button").find(button => button.text() === "Save")!.trigger("click");
    expect(wrapper.findComponent(ResourceRowEditor).exists()).toBe(false);
    expect(store.draft?.gateway_monitors[0]?.gateway).toBe("192.0.2.3");
    wrapper.unmount();
  });
  it.each(["missing", "ambiguous"])("rejects a %s monitor route without changing the draft", async mode => {
    const store = useControllerStore(), desired = store.state.data!.desired;
    desired.routes = mode === "missing" ? [] : ["192.0.2.1", "192.0.2.2"].map(gateway => ({ enabled: true, destination: "198.51.100.0/24", interface: "lab0", gateway, table: 254, metric: 1 }));
    const wrapper = await render(GatewayMonitorsView, "/gateway-monitors");
    await wrapper.findAll("button").find(button => button.text() === "Add monitor")!.trigger("click");
    const editor = wrapper.getComponent(ResourceRowEditor);
    for (const [key, value] of Object.entries({ name: "automatic", interface: "lab0", target: "198.51.100.1" })) editor.vm.$emit("change", key, value);
    await flushPromises();
    await editor.findAll("button").find(button => button.text() === "Save")!.trigger("click");
    expect(editor.props("errors")["editor.target"]).toEqual(["Select a probe target with an unambiguous route in table 254 on this interface."]);
    expect(store.draft).toBeNull();
    wrapper.unmount();
  });
  it("preserves disabled monitor state and its suitable source, and validates the saved-row switch", async () => {
    const store = useControllerStore();
    store.state.data!.desired.interfaces[0]!.addresses.push("192.0.2.20/24");
    store.state.data!.desired.gateway_monitors = [{ ...monitor(), enabled: false, source_address: "192.0.2.20", routing_table: 254 }];
    const wrapper = await render(GatewayMonitorsView, "/gateway-monitors");
    await wrapper.get('[aria-label="Edit / stage"]').trigger("click");
    const editor = wrapper.getComponent(ResourceRowEditor);
    editor.vm.$emit("change", "latency_threshold_ms", 175); await flushPromises();
    await editor.findAll("button").find(button => button.text() === "Save")!.trigger("click");
    expect(store.draft?.gateway_monitors[0]).toMatchObject({ enabled: false, source_address: "192.0.2.20", latency_threshold_ms: 175 });
    store.connected = false; await flushPromises();
    expect(wrapper.get('input[type="checkbox"]').attributes("disabled")).toBeDefined();
    store.connected = true; await flushPromises();
    await wrapper.get('input[type="checkbox"]').setValue(true);
    expect(store.draft?.gateway_monitors[0]?.enabled).toBe(false);
    expect(wrapper.getComponent(ResourceRowEditor).props("error")).toContain("No unambiguous route");
    expect(wrapper.text()).toContain("route in table 254");
    wrapper.unmount();
  });
  it("separates physical inventory from dummy interfaces and read-only loopback", async () => {
    useControllerStore().state.data!.desired.interfaces = [];
    const link = { name: "eth0", kind: "ethernet", index: 2, mac: null, mtu: 1500, up: true, addresses: [] as string[], ownership: "unmanaged" as const };
    vi.mocked(api.getDiscoveredInterfaces).mockResolvedValue([link, { ...link, name: "dummy0", kind: "dummy" }, { ...link, name: "lo", kind: "loopback", ownership: "loopback", addresses: ["127.0.0.1/8", "::1/128"] }]);
    const physical = await render(InterfaceInventory, "/interfaces");
    try {
      expect(physical.findAll("tbody tr").map(row => cellValue(row.find("td")))).toEqual(["eth0"]);
    } finally { physical.unmount(); }
    const loopbacks = await render(InterfaceInventory, "/loopbacks", { loopbacks: true });
    try {
      expect(loopbacks.findAll("tbody tr").map(row => cellValue(row.find("td")))).toEqual(["dummy0", "lo"]);
      expect(loopbacks.findAll("th").map(header => header.text())).not.toContain("Reload DHCP");
      const loopback = loopbacks.findAll("tbody tr").find(row => row.text().includes("127.0.0.1/8"))!;
      expect(loopback.text()).toContain("Read-only"); expect(loopback.find("button").exists()).toBe(false);
    } finally { loopbacks.unmount(); }
  });
  it("edits dummy settings from Loopbacks without copying live addresses or writing to the firewall", async () => {
    const store = useControllerStore(), before = config(), submit = vi.spyOn(api, "submitPackage");
    vi.mocked(api.getDiscoveredInterfaces).mockResolvedValue([
      { name: "lab0", kind: "dummy", index: 2, mac: null, mtu: 1500, up: true, addresses: ["203.0.113.99/32"], ownership: "managed" },
      { name: "lo", kind: "loopback", index: 1, mac: null, mtu: 65536, up: true, addresses: ["127.0.0.1/8", "::1/128"], ownership: "loopback" },
    ]);
    const wrapper = await render(LoopbacksView, "/loopbacks");
    try {
      expect(wrapper.get("tbody").text()).toContain("203.0.113.99/32");
      expect(wrapper.findAll("th").map(header => header.text())).toEqual(["Name", "Role", "Admin state", "MTU", "Active Addresses", "Actions"]);
      expect(wrapper.text()).not.toMatch(/dummy/i);
      const loopback = wrapper.findAll("tbody tr").find(row => cellValue(row.find("td")) === "lo")!;
      expect(loopback.find("button").exists()).toBe(false); expect(loopback.text()).toContain("Read-only");
      await wrapper.get('[aria-label="Edit / stage"]').trigger("click");
      const fields = wrapper.findAllComponents(FieldInput);
      expect(fields.map(field => field.props("field").key)).toEqual(["name", "role", "addresses"]);
      expect(cellValue(wrapper.get('[aria-label="Loopback editor"]').findAll("td")[3]!)).toBe("1500");
      expect(wrapper.find('input[type="checkbox"]').exists()).toBe(true);
      expect(wrapper.text()).not.toContain("not carrier readiness");
      expect(wrapper.text()).not.toMatch(/dummy/i);
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
      expect(wrapper.find('tbody tr[aria-label="Loopback editor"]').exists()).toBe(true);
      expect(fields.find(field => field.props("field").key === "addresses")!.props("modelValue")).toBe("192.0.2.10/24");
      fields.find(field => field.props("field").key === "addresses")!.vm.$emit("update:modelValue", "10.10.0.1/32");
      await flushPromises(); await wrapper.findAll("button").find(button => button.text() === "Save")!.trigger("click");
      expect(store.draft?.interfaces[0]).toMatchObject({ name: "lab0", kind: "dummy", mtu: 1500, addresses: ["10.10.0.1/32", "2001:db8::10/64"] });
      expect(store.state.data!.desired).toEqual(before); expect(store.draft?.routes).toEqual(before.routes);
      expect(store.draft?.interfaces.some(link => link.name === "lo")).toBe(false); expect(submit).not.toHaveBeenCalled();
      expect(wrapper.findAll("th").map(header => header.text())).not.toContain("Changes");
      expect(wrapper.find("tbody").text()).not.toContain("Unsaved");
    } finally { wrapper.unmount(); }
  });
  it("creates staged dummy loopbacks even before discovery and refuses to manage lo", async () => {
    const store = useControllerStore(), submit = vi.spyOn(api, "submitPackage");
    vi.mocked(api.getDiscoveredInterfaces).mockResolvedValue([]);
    const wrapper = await render(LoopbacksView, "/loopbacks");
    try {
      expect(wrapper.get("tbody").text()).toContain("lab0");
      await wrapper.findAll("button").find(button => button.text() === "Add loopback")!.trigger("click");
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
      expect(wrapper.findAll('tbody tr[aria-label="Loopback editor"]')).toHaveLength(1);
      const fields = wrapper.findAllComponents(FieldInput), name = fields.find(field => field.props("field").key === "name")!;
      const admin = wrapper.get('input[type="checkbox"]');
      expect((admin.element as HTMLInputElement).checked).toBe(true);
      expect(fields.map(field => field.props("field").key)).toEqual(["name", "role", "addresses"]);
      expect(cellValue(wrapper.get('[aria-label="Loopback editor"]').findAll("td")[3]!)).toBe("65535");
      expect(wrapper.text()).not.toContain("not carrier readiness");
      await admin.setValue(false);
      name.vm.$emit("update:modelValue", "lo");
      fields.find(field => field.props("field").key === "role")!.vm.$emit("update:modelValue", "unassigned");
      await flushPromises(); await wrapper.findAll("button").find(button => button.text() === "Save")!.trigger("click");
      expect(store.draft).toBeNull(); expect(wrapper.text()).toContain("Only loopback interfaces other than lo");
      name.vm.$emit("update:modelValue", "dummy1");
      await flushPromises(); await wrapper.findAll("button").find(button => button.text() === "Save")!.trigger("click");
      expect(store.draft?.interfaces[1]).toMatchObject({ name: "dummy1", kind: "dummy", role: "unassigned", mtu: 65535, up: false, addresses: [] });
      expect(wrapper.get("tbody").text()).toContain("dummy1"); expect(submit).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); }
  });
  it("adopts an unmanaged dummy through Loopbacks without treating live addresses as configuration", async () => {
    const store = useControllerStore(), submit = vi.spyOn(api, "submitPackage");
    vi.mocked(api.getDiscoveredInterfaces).mockResolvedValue([{ name: "dummy1", kind: "dummy", index: 3, mac: null, mtu: 9000, up: false, addresses: ["203.0.113.99/32"], ownership: "unmanaged" }]);
    const wrapper = await render(LoopbacksView, "/loopbacks");
    try {
      await wrapper.findAll("button").find(button => button.text() === "Manage this interface")!.trigger("click");
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
      expect(wrapper.findAll('tbody tr[aria-label="Loopback editor"]')).toHaveLength(1);
      expect(wrapper.findAllComponents(FieldInput).some(field => field.props("field").key === "mtu")).toBe(false);
      expect(cellValue(wrapper.get('[aria-label="Loopback editor"]').findAll("td")[3]!)).toBe("9000");
      expect(wrapper.findAllComponents(FieldInput).find(field => field.props("field").key === "addresses")!.props("modelValue")).toBe("");
      await wrapper.findAll("button").find(button => button.text() === "Save")!.trigger("click");
      expect(store.draft?.interfaces.find(link => link.name === "dummy1")).toMatchObject({ kind: "dummy", role: "unassigned", mtu: 9000, up: false, addresses: [] });
      expect(submit).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); }
  });
  it("keeps loopback validation inline and protects unstaged input when switching rows", async () => {
    const store = useControllerStore(), before = config();
    const wrapper = await render(LoopbacksView, "/loopbacks");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      const add = wrapper.findAll("button").find(button => button.text() === "Add loopback")!;
      await add.trigger("click");
      const field = (key: string) => wrapper.findAllComponents(FieldInput).find(input => input.props("field").key === key)!;
      field("name").vm.$emit("update:modelValue", "dummy1");
      field("addresses").vm.$emit("update:modelValue", "invalid");
      await flushPromises();
      await wrapper.findAll("button").find(button => button.text() === "Save")!.trigger("click");
      expect(wrapper.get('[role="alert"]').text()).not.toBe("");
      expect(store.draft).toBeNull();
      await add.trigger("click");
      await wrapper.get('[aria-label="Edit / stage"]').trigger("click");
      await wrapper.get('[aria-label="Delete"]').trigger("click");
      expect(confirm).toHaveBeenCalledTimes(3);
      expect(field("name").props("modelValue")).toBe("dummy1");
      field("addresses").vm.$emit("update:modelValue", "2001:db8::1/64");
      await flushPromises();
      await wrapper.findAll("button").find(button => button.text() === "Save")!.trigger("click");
      expect(wrapper.get('[role="alert"]').text()).toContain("Enter IPv4");
      field("addresses").vm.$emit("update:modelValue", "10.10.0.1/32, 10.10.0.2/32");
      await flushPromises();
      await wrapper.findAll("button").find(button => button.text() === "Save")!.trigger("click");
      expect(store.draft?.interfaces[1]).toMatchObject({ name: "dummy1", addresses: ["10.10.0.1/32", "10.10.0.2/32"] });
      expect(store.state.data!.desired).toEqual(before);
      await add.trigger("click");
      field("name").vm.$emit("update:modelValue", "dummy2");
      await flushPromises();
      confirm.mockReturnValue(true);
      await wrapper.findAll("button").find(button => button.text() === "Cancel")!.trigger("click");
      expect(wrapper.find('[aria-label="Loopback editor"]').exists()).toBe(false);
      expect(store.editorDirty).toBe(false);
    } finally { confirm.mockRestore(); wrapper.unmount(); }
  });
  it("inserts a single loopback editor in an empty inventory even when discovery fails", async () => {
    const store = useControllerStore();
    store.state.data!.desired.interfaces = [];
    vi.mocked(api.getDiscoveredInterfaces).mockRejectedValue(new Error("Discovery failed"));
    const wrapper = await render(LoopbacksView, "/loopbacks");
    try {
      await wrapper.findAll("button").find(button => button.text() === "Add loopback")!.trigger("click");
      expect(wrapper.text()).toContain("Discovery failed");
      expect(wrapper.findAll('tbody tr[aria-label="Loopback editor"]')).toHaveLength(1);
      expect(wrapper.text()).not.toContain("No discovered interfaces");
      wrapper.findAllComponents(FieldInput).find(field => field.props("field").key === "name")!.vm.$emit("update:modelValue", "dummy1");
      await flushPromises();
      await wrapper.findAll("button").find(button => button.text() === "Save")!.trigger("click");
      expect(store.draft?.interfaces).toHaveLength(1);
      expect(store.draft?.interfaces[0]).toMatchObject({ name: "dummy1", kind: "dummy", role: "unassigned", up: true });
    } finally { wrapper.unmount(); }
  });
  it("shows exact read-only connection counters and NAT details and resets paging on filter changes", async () => {
    const store = useControllerStore(), draft = config(); draft.routes[0]!.metric = 42; store.stage(draft);
    const before = JSON.stringify(store.draft), submit = vi.spyOn(api, "submitPackage");
    const read = vi.spyOn(api, "getConnections").mockImplementation(async (query = {}) => ({ ...connections(), offset: query.offset ?? 0, next_offset: query.offset ? null : 100 }));
    const wrapper = await render(ConnectionsView, "/connections");
    try {
      expect(wrapper.get(".connection-bytes").attributes("title")).toBe("18446744073709551615 bytes");
      expect(wrapper.get(".connection-bytes").text()).toBe("18.4 EB"); expect(wrapper.text()).toContain("9007199254740993");
      expect(wrapper.findAll("th").map(header => header.text())).toEqual(["Protocol", "Source", "Destination", "State", "Sent packets", "Received packets", "Sent bytes", "Received bytes", "Timeout", "Delete"]);
      expect(wrapper.get('[data-label="Received packets"]').text()).toBe("Unavailable");
      expect(wrapper.get('[data-label="Received bytes"]').text()).toBe("Unavailable");
      expect(wrapper.findAll(".status-chip").map(chip => [chip.text(), chip.attributes("data-color")])).toContainEqual(["TCP", "info"]);
      expect(wrapper.findAll(".status-chip").map(chip => [chip.text(), chip.attributes("data-color")])).toContainEqual(["ESTABLISHED", "success"]);
      expect(wrapper.text()).toContain("SNAT");
      expect(wrapper.get('[data-label="Source"]').text()).toBe("192.0.2.10");
      expect(wrapper.find('[title^="Source port"]').exists()).toBe(false);
      expect(wrapper.get('[data-label="Destination"] [title="Destination port 443"]').text()).toBe("443");
      expect(wrapper.find('[aria-label^="Connection details"]').exists()).toBe(false);
      expect(wrapper.find(".connection-details").exists()).toBe(false);
      await wrapper.get('[aria-label="Next connections page"]').trigger("click"); await flushPromises();
      expect(read).toHaveBeenLastCalledWith({ limit: 100, offset: 100 }, expect.any(AbortSignal));
      await wrapper.get('[aria-label="More filters"]').trigger("click");
      await wrapper.findAll("select").find(select => select.element.parentElement?.textContent?.startsWith("Family"))!.setValue("ipv6");
      await wrapper.get('form[aria-label="Connection filters"]').trigger("submit"); await flushPromises();
      expect(read).toHaveBeenLastCalledWith(expect.objectContaining({ family: "ipv6", offset: 0 }), expect.any(AbortSignal));
      expect(JSON.stringify(store.draft)).toBe(before); expect(submit).not.toHaveBeenCalled();
      expect(localStorage.getItem("connections")).toBeNull();
    } finally { wrapper.unmount(); }
  });
  it("filters connection states locally while preserving sorting, paging and refresh selection", async () => {
    const sample = connections(), original = sample.connections[0]!;
    const rows = [original, { ...original, id: "43", state: "UNREPLIED" }, { ...original, id: "44", state: "ESTABLISHED", original_counters: { packets: "2", bytes: "1000" } }];
    const read = vi.spyOn(api, "getConnections").mockResolvedValue({ ...sample, connections: rows, summary: { ...sample.summary, returned: 3, matched: 3 }, next_offset: 100 });
    const wrapper = await render(ConnectionsView, "/connections");
    const stateSelect = wrapper.findAll("select").find(select => select.element.parentElement?.textContent?.startsWith("State"))!;
    try {
      expect(stateSelect.text()).toContain("All states"); expect(stateSelect.text()).toContain("UNREPLIED");
      await stateSelect.setValue("ESTABLISHED");
      expect(wrapper.findAll(".connection-row")).toHaveLength(2); expect(wrapper.text()).toContain("2 shown");
      await wrapper.findAll("th").find(header => header.text() === "Sent packets")!.get("button").trigger("click");
      expect(wrapper.findAll('[data-label="Sent packets"]').map(cell => cell.text())).toEqual(["2", "9007199254740993"]);
      expect(read).toHaveBeenCalledTimes(1);
      read.mockResolvedValue({ ...sample, connections: [{ ...original, state: "CUSTOM_STATE" }] });
      await wrapper.get('[aria-label="Next connections page"]').trigger("click"); await flushPromises();
      expect(read).toHaveBeenLastCalledWith({ limit: 100, offset: 100 }, expect.any(AbortSignal));
      expect(wrapper.findAll(".connection-row")).toHaveLength(0);
      expect(wrapper.text()).toContain("No ESTABLISHED connections on this page."); expect(wrapper.text()).toContain("0 shown");
      expect(stateSelect.element.value).toBe("ESTABLISHED"); expect(stateSelect.text()).toContain("CUSTOM_STATE");
      await stateSelect.setValue(""); expect(wrapper.findAll(".connection-row")).toHaveLength(1);
      await stateSelect.setValue("CUSTOM_STATE");
      await wrapper.get('[aria-label="Refresh connections"]').trigger("click"); await flushPromises();
      expect(stateSelect.element.value).toBe("CUSTOM_STATE"); expect(wrapper.findAll(".connection-row")).toHaveLength(1);
      expect(read).toHaveBeenCalledTimes(3);
    } finally { wrapper.unmount(); }
  });
  it("sorts connection headers both ways with exact counters, natural addresses and unavailable values last", async () => {
    const sample = connections(), original = sample.connections[0]!;
    const rows = [
      { ...original, id: "1", protocol_name: "udp" as const, state: "UNREPLIED", original: { ...original.original, source: "192.0.2.10", destination: "198.51.100.20" }, original_counters: { packets: "9007199254740993", bytes: "9007199254740993" }, reply_counters: { packets: "9007199254740992", bytes: "9007199254740992" }, timeout_seconds: 120 },
      { ...original, id: "2", protocol_name: "tcp" as const, state: "ESTABLISHED", original: { ...original.original, source: "192.0.2.2", destination: "198.51.100.3" }, original_counters: { packets: "9007199254740992", bytes: "9007199254740992" }, reply_counters: { packets: "9007199254740993", bytes: "9007199254740993" }, timeout_seconds: 9 },
      { ...original, id: "3", protocol_name: "icmp" as const, state: "NEW", original_counters: null, timeout_seconds: null },
    ];
    const read = vi.spyOn(api, "getConnections").mockResolvedValue({ ...sample, connections: rows });
    const wrapper = await render(ConnectionsView, "/connections");
    const packets = () => wrapper.findAll('.connection-row [data-label="Sent packets"]').map(cell => cell.text());
    const header = (label: string) => wrapper.findAll("th").find(cell => cell.text() === label)!;
    try {
      expect(wrapper.get('[data-label="Received bytes"]').attributes("title")).toBe("9007199254740992 bytes");
      expect(wrapper.get('[data-label="Received packets"]').text()).toBe("9007199254740992");
      for (const label of ["Sent packets", "Sent bytes", "Timeout"]) {
        await header(label).get("button").trigger("click");
        expect(header(label).attributes("aria-sort")).toBe("ascending");
        expect(packets()).toEqual(["9007199254740992", "9007199254740993", "Unavailable"]);
        await header(label).get("button").trigger("click");
        expect(header(label).attributes("aria-sort")).toBe("descending");
        expect(packets()).toEqual(["9007199254740993", "9007199254740992", "Unavailable"]);
      }
      for (const label of ["Received packets", "Received bytes"]) {
        await header(label).get("button").trigger("click");
        expect(header(label).attributes("aria-sort")).toBe("ascending");
        expect(packets()).toEqual(["9007199254740993", "9007199254740992", "Unavailable"]);
        await header(label).get("button").trigger("click");
        expect(header(label).attributes("aria-sort")).toBe("descending");
        expect(packets()).toEqual(["9007199254740992", "9007199254740993", "Unavailable"]);
      }
      for (const label of ["Source", "Destination", "State"]) {
        await header(label).get("button").trigger("click");
        expect(packets()[0]).toBe("9007199254740992");
      }
      await header("Protocol").get("button").trigger("click");
      expect(packets()).toEqual(["Unavailable", "9007199254740992", "9007199254740993"]);
      await header("Sent packets").get("button").trigger("click");
      await wrapper.get('[aria-label="Refresh connections"]').trigger("click"); await flushPromises();
      expect(packets()).toEqual(["9007199254740992", "9007199254740993", "Unavailable"]);
      expect(read).toHaveBeenCalledTimes(2);
      expect(rows.map(row => row.id)).toEqual(["1", "2", "3"]);
    } finally { wrapper.unmount(); }
  });
  it("does not overlap connection reads, backs off on 503, and pauses when hidden or unmounted", async () => {
    vi.useFakeTimers();
    let finish!: (value: ReturnType<typeof connections>) => void;
    const read = vi.spyOn(api, "getConnections").mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const wrapper = await render(ConnectionsView, "/connections");
    try {
      await vi.advanceTimersByTimeAsync(20000); expect(read).toHaveBeenCalledTimes(1);
      finish(connections()); await flushPromises();
      read.mockRejectedValue(new ApiFailure("HTTP 503: kernel unavailable", 503));
      await vi.advanceTimersByTimeAsync(5000); await flushPromises();
      expect(read).toHaveBeenCalledTimes(2); expect(wrapper.text()).toContain("Stale snapshot");
      expect(wrapper.get(".connection-bytes").attributes("title")).toBe("18446744073709551615 bytes");
      await vi.advanceTimersByTimeAsync(9999); expect(read).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1); expect(read).toHaveBeenCalledTimes(3);
      visibility.mockReturnValue("hidden"); document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(60000); expect(read).toHaveBeenCalledTimes(3);
      read.mockResolvedValue(connections()); visibility.mockReturnValue("visible"); document.dispatchEvent(new Event("visibilitychange")); await flushPromises();
      expect(read).toHaveBeenCalledTimes(4);
      wrapper.unmount(); await vi.advanceTimersByTimeAsync(60000); expect(read).toHaveBeenCalledTimes(4);
    } finally { wrapper.unmount(); visibility.mockRestore(); vi.useRealTimers(); }
  });
  it("shows simulated connections as unmeasured and clears snapshots on disconnect", async () => {
    vi.spyOn(api, "getConnections").mockResolvedValue({ ...connections(), connections: [], next_offset: null, sample: { ...connections().sample, status: "simulated" }, summary: { total: null, matched: null, returned: 0, accounting_unavailable: null } });
    const wrapper = await render(ConnectionsView, "/connections");
    expect(wrapper.text()).toContain("Simulated; no measured connections"); expect(wrapper.text()).toContain("Total: Unavailable");
    useControllerStore().connected = false; await flushPromises(); expect(wrapper.find("table").exists()).toBe(false);
    wrapper.unmount();
  });
  it("reloads only committed DHCP interfaces without changing the shared draft", async () => {
    const store = useControllerStore();
    store.state.data!.desired.interfaces[0]!.kind = "ethernet";
    store.state.data!.desired.dhcp_clients = { lab0: { client_id: "", hostname: "", route_metric: 0, use_mtu: false, use_domains: "no" } };
    store.transactions.data = {}; store.transactions.stale = false;
    const draft = config(); draft.routes[0]!.metric = 42; store.stage(draft);
    const before = JSON.stringify(store.draft), refresh = vi.spyOn(store, "refreshRuntime").mockResolvedValue();
    let finish!: (value: { interface: string; status: "retrying" }) => void;
    const retry = vi.spyOn(api, "retryDHCP").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const wrapper = mount(DHCPRetryButton, { props: { name: "lab0" }, global: { stubs } });
    await wrapper.get("button").trigger("click"); await wrapper.get("button").trigger("click");
    await flushPromises();
    expect(retry).toHaveBeenCalledTimes(1); expect(retry).toHaveBeenCalledWith("lab0");
    expect(wrapper.get("button").attributes("disabled")).toBeDefined();
    finish({ interface: "lab0", status: "retrying" }); await flushPromises();
    expect(wrapper.text()).toContain("awaiting a lease update"); expect(refresh).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(store.draft)).toBe(before);
    store.state.data = { ...store.state.data!, desired: { ...store.state.data!.desired, interfaces: store.state.data!.desired.interfaces.map(link => ({ ...link, up: false })) } }; await flushPromises();
    expect(wrapper.get("button").attributes("disabled")).toBeDefined();
    store.state.data = { ...store.state.data!, desired: { ...store.state.data!.desired, dhcp_clients: {} } }; await flushPromises();
    expect(wrapper.find("button").exists()).toBe(false); wrapper.unmount();
  });
  it("keeps DHCP retry errors inline and does not retry the action automatically", async () => {
    const store = useControllerStore();
    store.state.data!.desired.dhcp_clients = { lab0: { client_id: "", hostname: "", route_metric: 0, use_mtu: false, use_domains: "no" } };
    store.transactions.data = {}; store.transactions.stale = false;
    vi.spyOn(store, "refreshRuntime").mockResolvedValue();
    const retry = vi.spyOn(api, "retryDHCP").mockRejectedValue(new Error("HTTP 503: simulator unsupported"));
    const wrapper = mount(DHCPRetryButton, { props: { name: "lab0" }, global: { stubs } });
    await wrapper.get("button").trigger("click"); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("HTTP 503"); expect(retry).toHaveBeenCalledOnce();
    expect(store.draft).toBeNull(); wrapper.unmount();
  });
  it("edits physical settings with compact dropdowns and preserves hidden settings", async () => {
    const store = useControllerStore(), base = { ...config().interfaces[0]!, kind: "ethernet" as const, metadata: { display_name: "", description: "Saved interface notes" } };
    store.state.data!.desired.interfaces = [base];
    store.state.data!.desired.dns = { lab0: { servers: ["192.0.2.53"], domains: [] } };
    const wrapper = await render(InterfacesView, "/interfaces");
    expect(wrapper.findAll("th").map(header => header.text())).not.toContain("DHCP");
    expect(wrapper.findComponent(DHCPRetryButton).exists()).toBe(false);
    expect(wrapper.find('a[href="/interfaces/lab0"]').exists()).toBe(false);
    await wrapper.find("tbody tr").trigger("click");
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Changing a management NIC");
    const editor = wrapper.getComponent(PhysicalInterfaceEditor);
    expect(editor.findComponent(DHCPRetryButton).exists()).toBe(false);
    expect(editor.findAll("td")).toHaveLength(wrapper.findAll("th").length);
    expect(editor.findAllComponents(FieldInput).map(field => field.props("field").key)).toEqual(["display_name", "mtu", "addresses", "ipv6_addresses"]);
    expect(wrapper.findAll("tbody tr")).toHaveLength(1);
    expect(editor.find("td[colspan]").exists()).toBe(false);
    expect(editor.findAll("select")).toHaveLength(3);
    const headers = wrapper.findAll("th").map(header => header.text());
    for (const [heading, key] of [["Name", "display_name"], ["MTU", "mtu"], ["IPv4", "addresses"], ["IPv6", "ipv6_addresses"]]) {
      expect(editor.findAll("td")[headers.indexOf(heading!)]!.getComponent(FieldInput).props("field").key).toBe(key);
    }
    expect(wrapper.text()).not.toContain("Saved interface notes");
    expect(editor.findAllComponents(FieldInput).every(field => field.props("field").kind !== "lines")).toBe(true);
    await editor.get('select[aria-label="Role"]').setValue("wan");
    const admin = editor.get('select[aria-label="Admin state"]');
    expect((admin.element as HTMLSelectElement).value).toBe("true");
    await admin.setValue("false");
    editor.findAllComponents(FieldInput).find(field => field.props("field").key === "display_name")!.vm.$emit("update:modelValue", "Office uplink");
    editor.vm.$emit("change", "mtu", 1450);
    editor.findAllComponents(FieldInput).find(field => field.props("field").key === "addresses")!.vm.$emit("update:modelValue", "10.10.0.1/24");
    await flushPromises(); await editor.get("form").trigger("submit");
    expect(store.draft?.interfaces[0]).toEqual({ ...base, role: "wan", up: false, metadata: { display_name: "Office uplink", description: "Saved interface notes" }, mtu: 1450, addresses: ["10.10.0.1/24", "2001:db8::10/64"] });
    expect(wrapper.find("tbody").text()).toContain("1450");
    expect(store.state.data!.desired.interfaces[0]!.up).toBe(true);
    expect(store.draft?.dns).toEqual(store.state.data!.desired.dns);
    expect(wrapper.findComponent(PhysicalInterfaceEditor).exists()).toBe(false);
    expect(wrapper.findAll("th").map(header => header.text())).not.toContain("Changes");
    expect(wrapper.find("tbody").text()).not.toContain("Unsaved");
    expect(wrapper.find("tbody tr").findAll("td")).toHaveLength(8);
  });
  it("switches inline IPv4 to DHCP without removing IPv6 or existing client options", async () => {
    const store = useControllerStore(); store.state.data!.desired.interfaces[0]!.kind = "ethernet";
    const wrapper = await render(InterfacesView, "/interfaces");
    await wrapper.find("tbody tr").trigger("click");
    const editor = wrapper.getComponent(PhysicalInterfaceEditor);
    await editor.get('select[aria-label="IPv4 configuration"]').setValue("dhcp");
    const address = editor.findAllComponents(FieldInput).find(field => field.props("field").key === "addresses")!;
    expect(address.props("modelValue")).toBe("DHCP");
    expect(address.props("field").disabled).toBe(true);
    await flushPromises(); await editor.get("form").trigger("submit");
    expect(store.draft?.interfaces[0]!.addresses).toEqual(["2001:db8::10/64"]);
    expect(store.draft?.dhcp_clients?.lab0).toMatchObject({ route_metric: 0, use_domains: "no" });
    expect(store.draft?.interfaces[0]!.role).toBe("lan");
    expect(wrapper.find("tbody").text()).toContain("DHCP");
  });
  it("edits IPv6 in its own cell, validates in place, and cancels without a popup", async () => {
    const store = useControllerStore(); store.state.data!.desired.interfaces[0]!.kind = "ethernet";
    const confirm = vi.spyOn(window, "confirm");
    const wrapper = await render(InterfacesView, "/interfaces");
    await wrapper.find("tbody tr").trigger("click");
    const editor = wrapper.getComponent(PhysicalInterfaceEditor);
    const ipv6 = editor.findAllComponents(FieldInput).find(field => field.props("field").key === "ipv6_addresses")!;
    ipv6.vm.$emit("update:modelValue", "2001:db8::20/64");
    await flushPromises(); await editor.get("form").trigger("submit");
    expect(store.draft?.interfaces[0]!.addresses).toEqual(["192.0.2.10/24", "2001:db8::20/64"]);
    await wrapper.find("tbody tr").trigger("click");
    const invalid = wrapper.getComponent(PhysicalInterfaceEditor);
    invalid.vm.$emit("change", "mtu", 1);
    await flushPromises(); await invalid.get("form").trigger("submit");
    expect(wrapper.get('[role="alert"]').text()).not.toBe("");
    expect(store.draft?.interfaces[0]!.mtu).toBe(1500);
    await invalid.findAll("button").find(button => button.text() === "Cancel")!.trigger("click");
    expect(confirm).not.toHaveBeenCalled();
    expect(wrapper.findComponent(PhysicalInterfaceEditor).exists()).toBe(false);
    expect(store.editorDirty).toBe(false);
    wrapper.unmount();
  });
  it("excludes managed and unmanaged VLANs and dummy links from Physical interfaces", async () => {
    const store = useControllerStore(), base = config().interfaces[0]!;
    store.state.data!.desired.interfaces.push(
      { ...base, name: "eth0", kind: "ethernet" },
      { ...base, name: "vlan30", kind: "vlan", vlan: { parent: "eth0", id: 30 } },
      { ...base, name: "wg0", kind: "wireguard", wireguard: { key_ref: "key", listen_port: 51820, peers: [] } },
    );
    vi.mocked(api.getDiscoveredInterfaces).mockResolvedValue([
      ...store.state.data!.desired.interfaces.map((link, index) => ({ name: link.name, kind: link.name === "vlan30" ? "unknown" : link.kind, index, mac: null, mtu: link.mtu, up: link.up, addresses: link.addresses, ownership: "managed" as const })),
      { name: "unmanaged20", kind: "vlan", index: 20, mac: null, mtu: 1500, up: true, addresses: [], ownership: "unmanaged" },
    ]);
    const wrapper = await render(InterfacesView, "/interfaces");
    expect(wrapper.findAll("tbody tr")).toHaveLength(1);
    expect(wrapper.find("tbody").text()).toContain("eth0");
    for (const name of ["lab0", "vlan30", "wg0", "unmanaged20"]) expect(wrapper.find("tbody").text()).not.toContain(name);
    expect(wrapper.findAll("button").some(button => button.text() === "Add interface")).toBe(false);
    expect(wrapper.find('button[aria-label="Edit / stage"]').exists()).toBe(true);
  });
  it("creates VLANs on their dedicated page without altering other interfaces", async () => {
    const store = useControllerStore(), before = config(), submit = vi.spyOn(api, "submitPackage");
    before.interfaces[0] = { ...before.interfaces[0]!, name: "eth0", kind: "ethernet" };
    store.state.data!.desired.interfaces = before.interfaces;
    const wrapper = await render(VLANsView, "/vlans");
    expect(wrapper.text()).not.toContain("lab0");
    await wrapper.findAll("button").find(button => button.text() === "Add VLAN")!.trigger("click");
    const fields = wrapper.findAllComponents(FieldInput);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(wrapper.find('tbody tr[aria-label="VLAN editor"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain("No configured resources.");
    expect(fields.map(field => field.props("field").key)).toEqual(["name", "id", "mtu", "parent", "addresses"]);
    fields.find(field => field.props("field").key === "name")!.vm.$emit("update:modelValue", "vlan30");
    fields.find(field => field.props("field").key === "id")!.vm.$emit("update:modelValue", 30);
    await flushPromises();
    wrapper.findAllComponents(FieldInput).find(field => field.props("field").key === "parent")!.vm.$emit("update:modelValue", "eth0");
    await flushPromises();
    await wrapper.findAll("button").find(button => button.text() === "Save")!.trigger("click");
    expect(store.draft?.interfaces).toHaveLength(2);
    expect(store.draft?.interfaces[0]).toEqual(before.interfaces[0]);
    expect(store.draft?.interfaces[1]).toMatchObject({ name: "vlan30", kind: "vlan", role: "unassigned", mtu: 1500, up: true, addresses: [], vlan: { parent: "eth0", id: 30 } });
    expect(store.draft?.routes).toEqual(before.routes);
    expect(wrapper.findAll("th").map(header => header.text())).toEqual(["Name", "VLAN ID", "Admin state", "MTU", "Parent", "IPv4", "Actions"]);
    expect(wrapper.findAll("tbody td").map(cellValue)).toContain("30");
    expect(wrapper.find('a[href="/vlans/vlan30"]').exists()).toBe(false);
    expect(cellValue(wrapper.get("tbody tr td"))).toBe("vlan30");
    await wrapper.get('button[aria-label="Edit / stage"]').trigger("click");
    wrapper.findAllComponents(FieldInput).find(field => field.props("field").key === "addresses")!.vm.$emit("update:modelValue", "10.30.0.1/24");
    await flushPromises();
    await wrapper.findAll("button").find(button => button.text() === "Save")!.trigger("click");
    expect(store.draft?.interfaces[1]!.addresses).toEqual(["10.30.0.1/24"]);
    expect(wrapper.find("tbody").text()).toContain("10.30.0.1/24");
    expect(submit).not.toHaveBeenCalled();
  });
  it("shows VLAN admin state as colored chips and aligns its inline editor", async () => {
    const store = useControllerStore(), base = config().interfaces[0]!;
    store.state.data!.desired.interfaces.push(
      { ...base, name: "vlan30", kind: "vlan", up: true, vlan: { parent: "lab0", id: 30 } },
      { ...base, name: "vlan40", kind: "vlan", up: false, vlan: { parent: "lab0", id: 40 } },
    );
    const wrapper = await render(VLANsView, "/vlans");
    try {
      const headers = wrapper.findAll("th").map(header => header.text());
      const adminIndex = headers.indexOf("Admin state");
      expect(adminIndex).toBe(2);
      const rows = wrapper.findAll("tbody tr");
      expect(rows[0]!.findAll("td")[adminIndex]!.get(".status-chip").text()).toBe("Up");
      expect(rows[0]!.findAll("td")[adminIndex]!.get(".status-chip").attributes("data-color")).toBe("success");
      expect(rows[1]!.findAll("td")[adminIndex]!.get(".status-chip").text()).toBe("Down");
      expect(rows[1]!.findAll("td")[adminIndex]!.get(".status-chip").attributes("data-color")).toBe("error");
      await rows[0]!.get('button[aria-label="Edit / stage"]').trigger("click");
      const editor = wrapper.get('[aria-label="VLAN editor"]');
      expect(editor.findAll("td")).toHaveLength(headers.length);
      const admin = editor.findAll("td")[adminIndex]!.get('input[type="checkbox"]');
      expect((admin.element as HTMLInputElement).checked).toBe(true);
      await admin.setValue(false);
      await editor.findAll("button").find(button => button.text() === "Save")!.trigger("click");
      expect(store.draft?.interfaces.find(link => link.name === "vlan30")?.up).toBe(false);
      const chip = wrapper.findAll("tbody tr")[0]!.findAll("td")[adminIndex]!.get(".status-chip");
      expect(chip.text()).toBe("Down");
      expect(chip.attributes("data-color")).toBe("error");
    } finally { wrapper.unmount(); }
  });
  it("offers only physical Ethernet interfaces as VLAN parents", async () => {
    const store = useControllerStore(), base = config().interfaces[0]!;
    store.draft = config();
    store.draft!.interfaces.push(
      { ...base, name: "eth0", kind: "ethernet" },
      { ...base, name: "vlan30", kind: "vlan", vlan: { parent: "eth0", id: 30 } },
      { ...base, name: "wg0", kind: "wireguard", wireguard: { key_ref: "key", listen_port: 51820, peers: [] } },
    );
    store.runtime.data!.parent_interfaces = [
      { name: "eth0", kind: "ethernet", available: true },
      { name: "eth1", kind: "ethernet", available: true },
      { name: "eth2", kind: "ethernet", available: false },
      { name: "lo", kind: "loopback", available: true },
      { name: "veth0", kind: "veth", available: true },
      { name: "runtime-vlan", kind: "vlan", available: true },
      { name: "unknown0", available: true },
      { name: "lab0", kind: "ethernet", available: true },
    ];
    const wrapper = await render(VLANsView, "/vlans");
    await wrapper.findAll("button").find(button => button.text() === "Add VLAN")!.trigger("click");
    const parent = wrapper.findAllComponents(FieldInput).find(field => field.props("field").key === "parent")!;
    expect(parent.props("field").choices).toEqual([
      { title: "eth0", value: "eth0" },
      { title: "eth1", value: "eth1" },
    ]);
    expect(parent.findAll("option").map(option => option.attributes("value"))).toEqual(["", "eth0", "eth1"]);
    wrapper.unmount();
  });
  it("keeps the global repair action only on service maintenance", async () => {
    for (const page of [DHCPRelayView, NTPView, SyslogView, VnStatView, SoftflowdView, GatewayMonitorsView]) {
      const wrapper = await render(page, "/services/test");
      expect(wrapper.findComponent(ServiceRepair).exists()).toBe(false);
      wrapper.unmount();
    }
    const wrapper = await render(ServiceMaintenanceView, "/services/maintenance");
    expect(wrapper.findAllComponents(ServiceRepair)).toHaveLength(1);
    expect(wrapper.text()).toContain("Reconcile all managed services");
  });
  it("edits VLAN behavior at its original shared-config index and retains immutable identity", async () => {
    const store = useControllerStore(), base = config().interfaces[0]!;
    const metadata = { display_name: "Guest network", description: "Saved VLAN notes" };
    store.state.data!.desired.interfaces.push({ ...base, name: "vlan30", kind: "vlan", addresses: ["2001:db8:30::1/64"], vlan: { parent: "lab0", id: 30 }, metadata });
    const wrapper = await render(VLANsView, "/vlans");
    await wrapper.get('button[aria-label="Edit / stage"]').trigger("click");
    const fields = wrapper.findAllComponents(FieldInput);
    expect(fields.map(field => field.props("field").key)).toEqual(["name", "id", "mtu", "parent", "addresses"]);
    expect(fields.filter(field => ["id", "parent"].includes(field.props("field").key)).every(field => field.props("field").disabled)).toBe(true);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(wrapper.findAll('tbody tr')).toHaveLength(1);
    expect(wrapper.text()).not.toContain("Saved VLAN notes");
    fields.find(field => field.props("field").key === "mtu")!.vm.$emit("update:modelValue", 1450);
    fields.find(field => field.props("field").key === "addresses")!.vm.$emit("update:modelValue", "10.30.0.1/24, 10.30.0.2/24");
    await flushPromises();
    await wrapper.findAll("button").find(button => button.text() === "Save")!.trigger("click");
    expect(store.draft?.interfaces[0]).toEqual(base);
    expect(store.draft?.interfaces[1]).toEqual({ ...store.state.data!.desired.interfaces[1], mtu: 1450, addresses: ["10.30.0.1/24", "10.30.0.2/24", "2001:db8:30::1/64"] });
  });
  it("keeps VLAN IPv4 validation inline without changing saved settings", async () => {
    const store = useControllerStore(), base = config().interfaces[0]!;
    store.state.data!.desired.interfaces.push({ ...base, name: "vlan30", kind: "vlan", addresses: ["2001:db8:30::1/64"], vlan: { parent: "lab0", id: 30 } });
    const wrapper = await render(VLANsView, "/vlans");
    await wrapper.get('button[aria-label="Edit / stage"]').trigger("click");
    const address = wrapper.findAllComponents(FieldInput).find(field => field.props("field").key === "addresses")!;
    expect(address.props("field").disabled).toBeFalsy();
    address.vm.$emit("update:modelValue", "invalid");
    await flushPromises();
    await wrapper.findAll("button").find(button => button.text() === "Save")!.trigger("click");
    expect(wrapper.get('[role="alert"]').text()).not.toBe("");
    expect(store.draft).toBeNull();
    address.vm.$emit("update:modelValue", "2001:db8::1/64");
    await flushPromises();
    await wrapper.findAll("button").find(button => button.text() === "Save")!.trigger("click");
    expect(wrapper.get('[role="alert"]').text()).toContain("Enter IPv4");
    address.vm.$emit("update:modelValue", "10.30.0.1/24");
    await flushPromises();
    await wrapper.findAll("button").find(button => button.text() === "Save")!.trigger("click");
    expect(store.draft?.dhcp_clients?.vlan30).toBeUndefined();
    expect(store.draft?.interfaces[1]!.addresses).toEqual(["10.30.0.1/24", "2001:db8:30::1/64"]);
    expect(store.state.data!.desired.interfaces[1]!.addresses).toEqual(["2001:db8:30::1/64"]);
    wrapper.unmount();
  });
  it("warns about VLAN deletion dependencies without silently removing them", async () => {
    const store = useControllerStore(), base = config().interfaces[0]!, submit = vi.spyOn(api, "submitPackage");
    store.state.data!.desired.interfaces.push(
      { ...base, name: "vlan30", kind: "vlan", addresses: [], vlan: { parent: "lab0", id: 30 } },
      { ...base, name: "vlan40", kind: "vlan", addresses: [], vlan: { parent: "vlan30", id: 40 } },
    );
    store.state.data!.desired.routes.push({ enabled: true, destination: "10.30.0.0/24", interface: "vlan30", table: 10000, metric: 1 });
    store.state.data!.desired.dns = { vlan30: { servers: ["192.0.2.53"], domains: [] } };
    const wrapper = await render(VLANsView, "/vlans");
    await wrapper.findAll("tbody tr").find(row => row.text().includes("vlan30"))!.get('button[aria-label="Delete"]').trigger("click");
    expect(wrapper.text()).toContain("Child VLAN vlan40");
    expect(wrapper.text()).toContain("Route 10.30.0.0/24");
    await wrapper.findAll("button").find(button => button.text() === "Stage deletion")!.trigger("click");
    expect(store.draft?.interfaces.map(link => link.name)).toEqual(["lab0", "vlan40"]);
    expect(store.draft?.routes).toEqual(store.state.data!.desired.routes);
    expect(store.draft?.dns?.vlan30).toBeUndefined();
    expect(store.validation.length).toBeGreaterThan(0);
    expect(store.state.data!.desired.interfaces).toHaveLength(3);
    expect(submit).not.toHaveBeenCalled();
  });
  it("protects unstaged inline VLAN input when adding again or cancelling", async () => {
    const wrapper = await render(VLANsView, "/vlans");
    const add = wrapper.findAll("button").find(button => button.text() === "Add VLAN")!;
    await add.trigger("click");
    wrapper.findAllComponents(FieldInput).find(field => field.props("field").key === "name")!.vm.$emit("update:modelValue", "vlan30");
    await flushPromises();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      await add.trigger("click");
      expect(confirm).toHaveBeenCalledOnce();
      expect(wrapper.findAllComponents(FieldInput).find(field => field.props("field").key === "name")!.props("modelValue")).toBe("vlan30");
      confirm.mockReturnValue(true);
      await wrapper.findAll("button").find(button => button.text() === "Cancel")!.trigger("click");
      expect(wrapper.find('[aria-label="VLAN editor"]').exists()).toBe(false);
      expect(useControllerStore().draft).toBeNull();
      expect(useControllerStore().editorDirty).toBe(false);
    } finally { confirm.mockRestore(); wrapper.unmount(); }
  });
  it("keeps WireGuard protocol settings on WireGuard while Interfaces preserves them", async () => {
    const store = useControllerStore();
    store.state.data!.desired.interfaces.push({ name: "wg0", kind: "wireguard", role: "wan", mtu: 1420, up: true, addresses: ["10.0.0.1/24"], dhcp_relay: { enabled: false, servers: [] }, wireguard: { key_ref: "tunnel-key", listen_port: 51820, peers: [] } });
    const wrapper = await render(InterfaceDetailView, "/interfaces/wg0", { name: "wg0" });
    expect(wrapper.get('button[aria-label="Edit tunnel interface wg0"]').attributes("to")).toBe("/tunnels");
    await wrapper.findAll("tbody tr").find(row => row.text().includes("wg0"))!.get('button[aria-label="Edit / stage"]').trigger("click");
    const fields = wrapper.findAllComponents(FieldInput);
    expect(fields.some(field => field.props("field").key === "wireguard")).toBe(false);
    expect(fields.some(field => field.props("field").key === "dhcp_relay")).toBe(false);
    fields.find(field => field.props("field").key === "mtu")!.vm.$emit("update:modelValue", 1450);
    await flushPromises();
    await wrapper.findAll("button").find(button => button.text() === "Save")!.trigger("click");
    expect(store.draft?.interfaces.find(link => link.kind === "wireguard")).toMatchObject({ mtu: 1450, wireguard: { key_ref: "tunnel-key", listen_port: 51820, peers: [] } });
  });
  it("adds a peer to a tunnel interface from the WireGuard page without touching other tunnel settings", async () => {
    const store = useControllerStore(), submit = vi.spyOn(api, "submitPackage");
    const tunnel = { name: "wg0", kind: "wireguard" as const, role: "wan" as const, mtu: 1420, up: true, addresses: ["10.0.0.1/24"], dhcp_relay: { enabled: false, servers: [] }, wireguard: { key_ref: "tunnel-key", listen_port: 51820, peers: [] } };
    store.state.data!.desired.interfaces.push(tunnel);
    store.state.data!.desired.dns = { wg0: { servers: ["192.0.2.53"], domains: [] } };
    const wrapper = await render(WireGuardView, "/wireguard");
    expect(wrapper.findAll("th").map(header => header.text())).toContain("Public key");
    expect(wrapper.findAll("th").map(header => header.text())).not.toContain("Listen port");
    await wrapper.findAll("button").find(button => button.text() === "Add peer")!.trigger("click");
    const field = (label: string) => wrapper.findAllComponents({ name: "VTextField" }).find(item => item.attributes("label") === label)!;
    const key = btoa("\x01".repeat(32));
    field("Public key").vm.$emit("update:modelValue", key);
    field("Allowed networks (comma separated)").vm.$emit("update:modelValue", "10.20.0.0/24, 10.30.0.0/24");
    await flushPromises(); await wrapper.get("form").trigger("submit");
    const staged = store.draft?.interfaces.find(link => link.name === "wg0");
    expect(staged).toEqual({ ...tunnel, wireguard: { ...tunnel.wireguard, peers: [{ public_key: key, allowed_ips: ["10.20.0.0/24", "10.30.0.0/24"], persistent_keepalive_seconds: 0, enabled: true }] } });
    expect(store.draft?.dns).toEqual(store.state.data!.desired.dns);
    expect(store.editorDirty).toBe(false); expect(submit).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it("creates a tunnel interface named tun_wg0 with no peers and keeps peers when editing it", async () => {
    const store = useControllerStore();
    const wrapper = await render(TunnelsView, "/tunnels");
    await wrapper.findAll("button").find(button => button.text() === "Add tunnel")!.trigger("click");
    expect(wrapper.findAllComponents({ name: "VTextField" }).find(item => item.attributes("label") === "Name")!.attributes("modelvalue")).toBe("tun_wg0");
    wrapper.findAllComponents({ name: "VTextField" }).find(item => item.attributes("label") === "Private Key")!.vm.$emit("update:modelValue", "tunnel-key");
    await flushPromises(); await wrapper.get("form").trigger("submit");
    expect(store.draft?.interfaces.find(link => link.name === "tun_wg0")).toMatchObject({ kind: "wireguard", role: "unassigned", mtu: 1420, up: true, wireguard: { key_ref: "tunnel-key", listen_port: 51820, peers: [] } });
    expect(wrapper.text()).toContain("tun_wg0");
    wrapper.unmount();
  });
  it("toggles WireGuard peers on and off, hides stats for disabled peers and rejects enabling a duplicate allowed network", async () => {
    const store = useControllerStore(), first = btoa("\x01".repeat(32)), spare = btoa("\x02".repeat(32));
    store.state.data!.desired.interfaces.push({ name: "wg0", kind: "wireguard", role: "wan", mtu: 1420, up: true, addresses: [], dhcp_relay: { enabled: false, servers: [] },
      wireguard: { key_ref: "k", listen_port: 51820, peers: [
        { public_key: first, allowed_ips: ["10.20.0.0/24"], persistent_keepalive_seconds: 25 },
        { public_key: spare, allowed_ips: ["10.20.0.0/24"], persistent_keepalive_seconds: 25, enabled: false },
      ] } });
    expect(validateConfig(store.state.data!.desired).filter(issue => issue.path.includes("peers"))).toEqual([]);
    store.runtime.data = { ...runtime(), wireguard: [{ interface: "wg0", public_key: "tunnel-public", listen_port: 51820, peers: [
      { public_key: first, endpoint: null, rx_bytes: "5", tx_bytes: "6", last_handshake_unix_seconds: 1792800000 },
      { public_key: spare, endpoint: null, rx_bytes: "7", tx_bytes: "8", last_handshake_unix_seconds: 1792800000 },
    ] }] };
    const wrapper = await render(WireGuardView, "/wireguard");
    const rows = () => wrapper.findAll("tbody tr");
    expect(rows()[1]!.classes()).toContain("peer-disabled"); expect(rows()[1]!.findAll(".status-chip")).toHaveLength(0);
    await rows()[0]!.get('input[type="checkbox"]').setValue(false);
    expect(store.draft?.interfaces.find(link => link.name === "wg0")).toMatchObject({ wireguard: { peers: [{ public_key: first, enabled: false }, { public_key: spare, enabled: false }] } });
    await rows()[1]!.get('input[type="checkbox"]').setValue(true);
    expect(store.draft?.interfaces.find(link => link.name === "wg0")).toMatchObject({ wireguard: { peers: [{ enabled: false }, { enabled: true }] } });
    await rows()[0]!.get('input[type="checkbox"]').setValue(true); await flushPromises();
    expect(wrapper.text()).toContain("Duplicate allowed network across enabled peers");
    expect(store.draft?.interfaces.find(link => link.name === "wg0")).toMatchObject({ wireguard: { peers: [{ enabled: false }, { enabled: true }] } });
    wrapper.unmount();
  });
  it("colors WireGuard handshakes by keepalive multiples, shows NEVER for epoch and counter changes, and keeps allowed networks in details", async () => {
    const store = useControllerStore(), key = btoa("\x01".repeat(32)), idle = btoa("\x02".repeat(32));
    store.state.data!.desired.interfaces.push({ name: "wg0", kind: "wireguard", role: "wan", mtu: 1420, up: true, addresses: [], dhcp_relay: { enabled: false, servers: [] },
      wireguard: { key_ref: "k", listen_port: 51820, peers: [
        { public_key: key, allowed_ips: ["10.20.0.0/24"], persistent_keepalive_seconds: 25 }, { public_key: idle, allowed_ips: ["10.30.0.0/24"], persistent_keepalive_seconds: 25 },
      ] } });
    const sample = (rx: string) => ({ ...runtime(), wireguard: [{ interface: "wg0", public_key: "tunnel-public", listen_port: 51820, peers: [
      { public_key: key, endpoint: "203.0.113.7:51820", rx_bytes: rx, tx_bytes: "9210", last_handshake_unix_seconds: 1792800000 },
      { public_key: idle, endpoint: null, rx_bytes: "0", tx_bytes: "0", last_handshake_unix_seconds: 0 },
    ] }] });
    store.runtime.data = sample("18432"); store.runtime.lastSuccess = (1792800000 + 60) * 1000;
    const wrapper = await render(WireGuardView, "/wireguard");
    const rows = () => wrapper.findAll("tbody tr");
    expect(wrapper.findAll("th").map(header => header.text())).not.toContain("Allowed networks");
    const chips = (row: number) => rows()[row]!.findAll(".status-chip").map(chip => [chip.text(), chip.attributes("data-color")]);
    expect(chips(0)[0]).toEqual(["60 seconds ago", "green"]);
    expect(rows()[0]!.get(".status-chip").attributes("title")).toContain("Green up to 5x, yellow up to 10x, orange up to 15x, red beyond.");
    expect(chips(1)[0]).toEqual(["NEVER", "red"]);
    expect(rows()[0]!.text()).toContain("18.43 KB"); expect(rows()[0]!.text()).toContain("203.0.113.7:51820");
    expect(chips(0)).toHaveLength(1);
    store.runtime.data = sample("19456"); store.runtime.lastSuccess = (1792800000 + 20) * 1000; await flushPromises();
    expect(chips(0)).toEqual([["20 seconds ago", "green"], ["+1.02 KB", "green"], ["+0 B", "default"]]);
    expect(rows()[0]!.text()).not.toContain("10.20.0.0/24");
    await rows()[0]!.get('button[aria-expanded="false"]').trigger("click");
    const details = wrapper.get(".peer-details").text();
    expect(details).toContain("tunnel-public"); expect(details).toContain("51820"); expect(details).toContain("10.20.0.0/24");
    await rows()[0]!.get('button[aria-expanded="true"]').trigger("click");
    for (const [age, color] of [[125, "green"], [126, "yellow"], [250, "yellow"], [251, "orange"], [375, "orange"], [376, "red"]] as const) {
      store.runtime.lastSuccess = (1792800000 + age) * 1000; await flushPromises();
      expect(chips(0)[0]?.[1], `handshake age ${age}s with 25s keepalive`).toBe(color);
      expect(chips(1)[0]).toEqual(["NEVER", "red"]);
    }
    wrapper.unmount();
  });  it("stages host-input rules separately while preserving forwarding and other settings", async () => {
    const store = useControllerStore(), submit = vi.spyOn(api, "submitPackage");
    store.state.data!.desired.firewall.input = { policy: "drop", interfaces: [{ interface: "lab0", rules: [{ protocol: "udp", destination_ports: [68], action: "accept" }] }] };
    const wrapper = await render(FirewallInputView, "/firewall/input");
    expect(wrapper.text()).toContain("established/related");
    expect(wrapper.find("tbody").text()).toContain("68");
    await wrapper.findAll("button").find(button => button.text() === "Edit input policy")!.trigger("click");
    wrapper.findAllComponents(FieldInput).find(field => field.props("field").key === "interfaces")!.vm.$emit("update:modelValue", [
      { interface: "lab0", rules: [{ protocol: "tcp", destination_ports: ["443", "80"], action: "accept" }, { action: "drop" }] },
    ]);
    await flushPromises();
    await wrapper.findAll("button").find(button => button.text() === "Save")!.trigger("click");
    expect(store.draft?.firewall.input?.interfaces[0]!.rules).toEqual([
      { protocol: "tcp", destination_ports: [443, 80], action: "accept" }, { action: "drop" },
    ]);
    expect(store.draft?.firewall.rules).toEqual(config().firewall.rules);
    expect(store.draft?.routes).toEqual(config().routes);
    expect(store.editorDirty).toBe(false); expect(submit).not.toHaveBeenCalled();
  });
  it("blocks unmanaged ingress input rules before staging", async () => {
    const store = useControllerStore();
    store.state.data!.desired.firewall.input = { policy: "drop", interfaces: [] };
    const wrapper = await render(FirewallInputView, "/firewall/input");
    await wrapper.findAll("button").find(button => button.text() === "Edit input policy")!.trigger("click");
    wrapper.findAllComponents(FieldInput).find(field => field.props("field").key === "interfaces")!.vm.$emit("update:modelValue", [{ interface: "missing0", rules: [] }]);
    await flushPromises();
    await wrapper.findAll("button").find(button => button.text() === "Save")!.trigger("click");
    expect(store.draft).toBeNull(); expect(wrapper.text()).toContain("unique managed ingress interface");
    expect(store.editorDirty).toBe(true);
  });
  it("warns when removing host-input protection from a package", () => {
    const before = config(), after = config(); before.firewall.input = { policy: "drop", interfaces: [] };
    const wrapper = mount(ConfigDiff, { props: { before, after }, global: { stubs } });
    expect(wrapper.text()).toContain("Removing input filtering removes host protection, including WAN protection");
  });
  it("keeps healthy dataset reads quiet while preserving errors", async () => {
    const store = useControllerStore(); store.state.stale = false; store.state.lastSuccess = Date.now();
    const wrapper = mount(DatasetStatus, { props: { query: store.state, label: "Configuration" }, global: { stubs } });
    expect(wrapper.text()).toBe("");
    store.state.error = "Read failed"; await flushPromises();
    expect(wrapper.text()).toContain("Read failed");
  });
  it("renders nested values as readable labeled fields instead of JSON", () => {
    const wrapper = mount(JsonPanel, { props: { label: "Settings", value: { enabled: false, addresses: ["172.16.10.2/24"], servers: [] } } });
    expect(wrapper.findAll("dt").map(field => field.text())).toEqual(["Enabled", "Addresses", "Servers"]);
    expect(wrapper.findAll("dd").map(field => field.text())).toEqual(["No", "172.16.10.2/24", "None"]);
    expect(wrapper.find("pre").exists()).toBe(false);
  });
  it("explicitly manages a discovered NIC without copying live addresses or writing", async () => {
    const store = useControllerStore(), submit = vi.spyOn(api, "submitPackage");
    const link = { name: "eth0", kind: "ethernet", index: 2, mac: "02:00:00:00:00:01", mtu: 1500, up: true, addresses: ["192.0.2.99/24"], ownership: "unmanaged" as const };
    vi.mocked(api.getDiscoveredInterfaces).mockResolvedValue([link, { ...link, name: "lo", kind: "loopback", ownership: "loopback" }]);
    const wrapper = await render(InterfacesView, "/interfaces");
    await flushPromises();
    expect(wrapper.findAll('button[aria-label="Manage this interface"]')).toHaveLength(1);
    await wrapper.get('button[aria-label="Manage this interface"]').trigger("click");
    const fields = wrapper.findAllComponents(FieldInput);
    expect(fields.find(field => field.props("field").key === "addresses")!.props("modelValue")).toBe("");
    expect(wrapper.getComponent(PhysicalInterfaceEditor).props("form").addresses).toEqual([]);
    expect((wrapper.get('select[aria-label="Role"]').element as HTMLSelectElement).value).toBe("unassigned");
    await wrapper.get('select[aria-label="IPv4 configuration"]').setValue("dhcp");
    await flushPromises();
    await wrapper.getComponent(PhysicalInterfaceEditor).get("form").trigger("submit");
    expect(store.draft?.interfaces.find(item => item.name === "eth0")).toMatchObject({ kind: "ethernet", role: "unassigned", addresses: [] });
    expect(store.draft?.dhcp_clients?.eth0).toMatchObject({ use_domains: "no", route_metric: 0 });
    expect(store.draft?.dns?.eth0).toBeUndefined();
    expect(store.state.data!.desired.interfaces).toHaveLength(1);
    expect(submit).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it("shows physical inventory without lo and never stages discovered DHCP addresses", async () => {
    const store = useControllerStore();
    store.state.data!.desired.interfaces[0] = { ...config().interfaces[0]!, kind: "ethernet", addresses: [], metadata: { display_name: "Office", description: "" } };
    store.state.data!.desired.dhcp_clients = { lab0: { client_id: "", hostname: "", route_metric: 0, use_mtu: false, use_domains: "no" } };
    const link = { name: "lab0", kind: "ethernet", index: 2, mac: null, mtu: 1500, up: true, addresses: ["192.0.2.99/24", "2001:db8::99/64"], ownership: "managed" as const };
    vi.mocked(api.getDiscoveredInterfaces).mockResolvedValue([
      link,
      { ...link, name: "lo", kind: "loopback", ownership: "loopback", addresses: ["127.0.0.1/8", "::1/128"] },
      { ...link, name: "spare0", ownership: "unmanaged", up: false, addresses: [] },
      { ...link, name: "br0", kind: "bridge", ownership: "unmanaged", addresses: ["198.51.100.1/24"] },
    ]);
    const wrapper = await render(InterfacesView, "/interfaces");
    expect(wrapper.find("select").exists()).toBe(false);
    expect(wrapper.find('[aria-label="Refresh interfaces"]').exists()).toBe(false);
    const headers = wrapper.findAll("th").map(header => header.text());
    const active = headers.indexOf("IPv4");
    expect(headers).toEqual(["Name", "Role", "Admin state", "MTU", "Mode", "IPv4", "IPv6", "Actions"]);
    const rows = wrapper.findAll("tbody tr"); expect(rows).toHaveLength(3);
    expect(rows[0]!.text()).toContain("Office"); expect(rows[0]!.text()).toContain("lab0");
    expect(rows[0]!.findAll("td")[active]!.text()).toContain("192.0.2.99/24");
    expect(rows[0]!.findAll("td")[active]!.text()).not.toContain("2001:db8::99/64");
    expect(rows[0]!.findAll(".status-chip").map(chip => [chip.text(), chip.attributes("data-color")])).toEqual([
      ["LAN", "info"], ["Up", "success"], ["DHCP", "primary"],
    ]);
    expect(wrapper.find("tbody").text()).not.toContain("127.0.0.1/8");
    expect(rows[1]!.text()).toContain("Down"); expect(rows[1]!.find('button[aria-label="Manage this interface"]').exists()).toBe(true);
    expect(rows[1]!.findAll(".status-chip").map(chip => [chip.text(), chip.attributes("data-color")])).toEqual([
      ["—", "default"], ["Down", "error"], ["—", "default"],
    ]);
    expect(rows[1]!.findAll("td")[active]!.text()).toContain("None");
    expect(rows[2]!.find("td").attributes("title")).toContain("Bridge"); expect(rows[2]!.find("button").exists()).toBe(false);
    await rows[0]!.trigger("click");
    const editor = wrapper.getComponent(PhysicalInterfaceEditor);
    expect(editor.props("form").addresses).toEqual([]);
    const address = editor.findAllComponents(FieldInput).find(field => field.props("field").key === "addresses")!;
    expect(address.props("modelValue")).toBe("192.0.2.99/24");
    expect(address.props("field").disabled).toBe(true);
    address.vm.$emit("update:modelValue", "198.51.100.2/24");
    await flushPromises();
    expect(editor.props("form").addresses).toEqual([]);
    editor.vm.$emit("change", "display_name", "Updated office"); await flushPromises();
    await editor.get("form").trigger("submit");
    expect(store.draft?.interfaces[0]!.addresses).toEqual([]);
    expect(store.draft?.interfaces[0]!.metadata).toEqual({ display_name: "Updated office", description: "" });
    expect(store.draft?.dhcp_clients?.lab0).toEqual(store.state.data!.desired.dhcp_clients.lab0);
    wrapper.unmount();
  });
  it("shows live addresses instead of configured static addresses and distinguishes interface role chips", async () => {
    const store = useControllerStore();
    store.state.data!.desired.interfaces[0]!.role = "wan";
    vi.mocked(api.getDiscoveredInterfaces).mockResolvedValue([{
      name: "lab0", kind: "dummy", index: 2, mac: null, mtu: 1500, up: true,
      addresses: ["192.0.2.99/24"], ownership: "managed",
    }]);
    const wrapper = await render(LoopbacksView, "/loopbacks");
    try {
      expect(wrapper.get("tbody").text()).toContain("192.0.2.99/24");
      expect(wrapper.get("tbody").text()).not.toContain("192.0.2.10/24");
      expect(wrapper.get("tbody").text()).not.toContain("2001:db8::10/64");
      expect(wrapper.findAll(".status-chip").find(chip => chip.text() === "WAN")!.attributes("data-color")).toBe("secondary");
      const draft = config(); draft.interfaces[0]!.role = "unassigned"; store.stage(draft);
      await flushPromises();
      expect(wrapper.findAll(".status-chip").find(chip => chip.text() === "Unassigned")!.attributes("data-color")).toBe("default");
      expect(store.draft!.interfaces[0]!.addresses).toEqual(config().interfaces[0]!.addresses);
    } finally { wrapper.unmount(); }
  });
  it("keeps discovered inventory visible without configuration or runtime and retains stale rows", async () => {
    const store = useControllerStore();
    store.state.data = null; store.state.error = "Configuration denied";
    store.runtime.data = null; store.runtime.error = "Runtime denied";
    vi.mocked(api.getDiscoveredInterfaces).mockResolvedValue([{ name: "lo", kind: "loopback", index: 1, mac: null, mtu: 65536, up: true, ownership: "loopback", addresses: ["127.0.0.1/8", "::1/128"] }]);
    const wrapper = await render(LoopbacksView, "/loopbacks");
    expect(wrapper.find("tbody").text()).toContain("::1/128");
    expect(wrapper.findAll("tbody tr")).toHaveLength(1);
    vi.mocked(api.getDiscoveredInterfaces).mockRejectedValue(new Error("Discovery failed"));
    await wrapper.getComponent(InterfaceInventory).vm.refresh(); await flushPromises();
    expect(wrapper.text()).toContain("inventory stale");
    expect(wrapper.find("tbody").text()).toContain("127.0.0.1/8");
    expect(wrapper.text()).not.toContain("No discovered interfaces match");
    wrapper.unmount();
  });
  it("preserves discovery errors without repeating DHCP lease diagnostics", async () => {
    const store = useControllerStore();
    store.state.data!.desired.dhcp_clients = { lab0: { client_id: "", hostname: "", route_metric: 0, use_mtu: false, use_domains: "no" } };
    store.runtime.data!.dhcp_clients = { leases: {}, errors: { lab0: "DHCP lease unavailable" } };
    vi.mocked(api.getDiscoveredInterfaces).mockRejectedValue(new Error("Discovery failed"));
    const wrapper = mount(InterfaceInventory, { global: { stubs } });
    await flushPromises();
    expect(wrapper.text()).toContain("Discovery failed");
    expect(wrapper.text()).not.toContain("DHCP lease unavailable");
    expect(wrapper.text()).not.toContain("No discovered interfaces.");
    expect(store.state.data!.desired.interfaces[0]!.addresses).toEqual(config().interfaces[0]!.addresses);
    wrapper.unmount();
  });
  it("adds, edits and deletes NTP servers inline, enabling the service whenever servers exist, without a network write", async () => {
    const store = useControllerStore(), submit = vi.spyOn(api, "submitPackage");
    const wrapper = await render(NTPView, "/services/ntp");
    const field = () => wrapper.findAllComponents({ name: "VTextField" }).find(item => item.attributes("aria-label") === "Host")!;
    const press = async (label: string) => { await wrapper.findAll("button").find(button => button.text() === label)!.trigger("click"); await flushPromises(); };
    expect(wrapper.text()).not.toContain("Labels"); expect(wrapper.text()).not.toContain("Display name");
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false); expect(wrapper.text()).not.toMatch(/Enabled|Disabled/);
    await press("Add NTP upstream server"); field().vm.$emit("update:modelValue", "clock.example"); await flushPromises(); await press("Save");
    expect(store.draft?.ntp).toEqual({ enabled: true, servers: ["clock.example"] });
    expect(store.draft?.interfaces).toEqual(config().interfaces); expect(store.draft?.syslog).toEqual(config().syslog);
    await wrapper.get('button[aria-label="Edit clock.example"]').trigger("click");
    field().vm.$emit("update:modelValue", "::1"); await flushPromises(); await press("Save");
    expect(store.draft?.ntp).toEqual({ enabled: true, servers: ["::1"] });
    await wrapper.get('button[aria-label="Delete ::1"]').trigger("click");
    expect(store.draft?.ntp).toEqual({ enabled: false, servers: [] });
    expect(submit).not.toHaveBeenCalled(); wrapper.unmount();
  });  it("blocks invalid syslog servers inline and stages valid ones with port and transport", async () => {
    const store = useControllerStore();
    const wrapper = await render(SyslogView, "/services/syslog");
    const field = () => wrapper.findAllComponents({ name: "VTextField" }).find(item => item.attributes("aria-label") === "Host")!;
    const press = async (label: string) => { await wrapper.findAll("button").find(button => button.text() === label)!.trigger("click"); await flushPromises(); };
    await press("Add remote syslog server"); field().vm.$emit("update:modelValue", "UPPER.example"); await flushPromises(); await press("Save");
    expect(store.draft).toBeNull(); expect(wrapper.text()).toContain("lowercase ASCII DNS");
    field().vm.$emit("update:modelValue", "logs.example"); await flushPromises(); await press("Save");
    expect(store.draft?.syslog).toEqual({ enabled: true, servers: [{ host: "logs.example", port: 514, transport: "udp" }] });
    expect(wrapper.find("tbody").text()).toContain("UDP"); expect(wrapper.text()).not.toContain("Operator prerequisites");
    wrapper.unmount();
  });  it("renders both vnStat scopes as diagnostic paths, not traffic history", async () => {
    const store = useControllerStore();
    store.runtime.data!.appliance_services[2] = { name: "vnstat-host", scope: "host", state: "simulated", pid: 11, database_directory: "/host-db" };
    store.runtime.data!.appliance_services[3] = { name: "vnstat-managed", scope: "managed", state: "unhealthy", pid: 12, database_directory: "/managed-db", error: "inventory failed" };
    const wrapper = await render(VnStatView, "/services/vnstat");
    expect(wrapper.find("tbody").text()).toContain("vnstat-host"); expect(wrapper.find("tbody").text()).toContain("vnstat-managed");
    expect(wrapper.text()).toContain("/host-db"); expect(wrapper.text()).toContain("/managed-db");
    expect(wrapper.text()).toContain("inventory failed"); expect(wrapper.text()).not.toContain("Operator prerequisites");
  });
  it("uses one monitor table with expandable active statistics and a single empty state", async () => {
    const store = useControllerStore();
    const wrapper = await render(GatewayMonitorsView, "/gateway-monitors");
    expect(wrapper.findAll("table")).toHaveLength(1);
    expect(wrapper.text()).toContain("No configured resources.");
    expect(wrapper.text()).not.toContain("No gateway monitor records available.");
    const sample = gatewayStatistics(); sample.collected_at = new Date().toISOString();
    vi.mocked(api.getGatewayStatistics).mockResolvedValue({ sample: statistics().sample, monitors: [sample] });
    store.stage({ ...config(), gateway_monitors: [monitor()] });
    await store.refreshGatewayStatistics(); await flushPromises();
    const toggle = wrapper.get('[aria-label="Live statistics for uplink"]');
    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(wrapper.find('[aria-label="uplink live statistics"]').exists()).toBe(false);
    await toggle.trigger("click");
    expect(wrapper.findAll("table")).toHaveLength(1);
    expect(wrapper.get('[aria-label="uplink live statistics"]').text()).toContain("Mean RTT");
    expect(wrapper.get('[aria-label="uplink live statistics"]').text()).toContain("unknown");
    expect(toggle.attributes("aria-expanded")).toBe("true");
    await toggle.trigger("click");
    expect(wrapper.find('[aria-label="uplink live statistics"]').exists()).toBe(false);
    expect(store.gatewayMonitoring).toBe(true);
    wrapper.unmount(); expect(store.gatewayMonitoring).toBe(false);
  });
  it("keeps missing gateway samples unknown and old cached health stale", async () => {
    const store = useControllerStore(), sample = gatewayStatistics();
    sample.collected_at = new Date(Date.now() - 10000).toISOString();
    vi.mocked(api.getGatewayStatistics).mockResolvedValue({ sample: statistics().sample, monitors: [sample] });
    store.state.data!.desired.gateway_monitors = [monitor(), { ...monitor(), name: "missing" }];
    const wrapper = mount(GatewayStatisticsPanel, { global: { stubs: { ...stubs, JsonPanel: false } } }); await flushPromises();
    expect(wrapper.text()).toContain("stale"); expect(wrapper.text()).toContain("unknown");
    expect(wrapper.text()).toContain("Unknown (no monitor sample)");
    expect(wrapper.text()).toContain("0 ms"); expect(wrapper.text()).toContain("1.25 ms");
    expect(store.gatewayMonitoring).toBe(true);
    wrapper.unmount(); expect(store.gatewayMonitoring).toBe(false);
  });
  it("retains monitoring errors without modifying the shared configuration", async () => {
    const store = useControllerStore(); store.draft = config();
    vi.mocked(api.getGatewayStatistics).mockRejectedValue(new Error("Gateway cache unavailable"));
    const wrapper = mount(GatewayStatisticsPanel, { global: { stubs } }); await flushPromises();
    expect(store.gatewayStatistics.error).toBe("Gateway cache unavailable");
    expect(store.gatewayStatistics.stale).toBe(true); expect(store.draft).toEqual(config());
    wrapper.unmount();
  });
  it("keeps measured gateway health tied to active settings rather than unsaved edits", async () => {
    const store = useControllerStore(), sample = gatewayStatistics();
    sample.collected_at = new Date().toISOString();
    store.state.data!.desired.gateway_monitors = [monitor()];
    store.draft = config(); store.draft.gateway_monitors = [{ ...monitor(), enabled: false }];
    vi.mocked(api.getGatewayStatistics).mockResolvedValue({ sample: statistics().sample, monitors: [sample] });
    const wrapper = mount(GatewayStatisticsPanel, { global: { stubs } }); await flushPromises();
    expect(wrapper.findAll("td").map(cell => cell.text())).toContain("up");
    expect(store.draft.gateway_monitors[0]!.enabled).toBe(false);
  });
  it("shows appliance risks in full-package diffs and all-service permissions during repair", async () => {
    const before = config(), after = config();
    after.ntp.enabled = true; after.syslog.enabled = true; after.vnstat.enabled = true; after.gateway_monitors = [monitor()];
    const diff = mount(ConfigDiff, { props: { before, after }, global: { stubs } });
    expect(diff.text()).toContain("past clock state"); expect(diff.text()).toContain("stop local system logging");
    const store = useControllerStore(), pending = transaction(); pending.candidate = after;
    store.transactions.data = { [pending.id]: pending };
    const wrapper = mount(ServiceRepair, { props: { service: "softflowd" }, global: { stubs } });
    await wrapper.findAll("button").find(button => button.text() === "Reconcile all managed services")!.trigger("click");
    for (const permission of ["gateway_monitors.write", "ntp.write", "syslog.write", "vnstat.write"]) expect(wrapper.text()).toContain(permission);
  });
  it("stages global ICMP from General settings in both firewall modes without adding implicit rows", async () => {
    const store = useControllerStore();
    for (const policyMode of [false, true]) {
      store.draft = null; store.baseline = null;
      store.state.data = state();
      if (policyMode) { store.state.data.desired.firewall.rules = []; store.state.data.desired.firewall.policies = { hosts: [], interfaces: [] }; }
      const firewall = await render(FirewallView, "/firewall");
      expect(firewall.text()).not.toContain("Allow all IPv4 ICMP");
      firewall.unmount();
      const wrapper = await render(SettingsView, "/settings/general");
      expect(wrapper.text()).not.toContain("Displayed committed ICMP exception");
      const toggle = wrapper.findAllComponents(stubs.VSwitch).find(item => item.attributes("id") === "general-icmp");
      expect(toggle).toBeDefined();
      toggle!.vm.$emit("update:modelValue", false);
      await wrapper.get("button").trigger("blur");
      await wrapper.get("form").trigger("submit");
      const staged = configSchema.parse(store.draft);
      expect(staged.firewall.allow_all_icmp).toBe(false);
      expect(staged.firewall.policies).toEqual(store.state.data.desired.firewall.policies);
      expect(staged.firewall.rules).toEqual(store.state.data.desired.firewall.rules);
      wrapper.unmount();
    }
  });
  it("preserves an existing shared draft when staging general settings", async () => {
    const store = useControllerStore(), draft = config();
    draft.routes[0]!.metric = 42;
    store.stage(draft);
    const submit = vi.spyOn(api, "submitPackage");
    const wrapper = await render(SettingsView, "/settings/general");
    await wrapper.findAllComponents(stubs.VSwitch).find(item => item.attributes("id") === "general-icmp")!.vm.$emit("update:modelValue", false);
    await wrapper.get("form").trigger("submit");
    expect(store.draft?.routes[0]?.metric).toBe(42);
    expect(store.draft?.firewall.allow_all_icmp).toBe(false);
    expect(store.state.data!.desired.firewall.allow_all_icmp).toBe(true);
    expect(submit).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it("disables general settings without configuration or while writes are frozen and surfaces staging errors", async () => {
    const store = useControllerStore();
    const wrapper = await render(SettingsView, "/settings/general");
    store.busy = true; await flushPromises();
    expect(wrapper.findComponent(stubs.VSwitch).props("disabled")).toBe(true);
    expect(wrapper.text()).toContain("frozen");
    store.busy = false;
    vi.spyOn(store, "stage").mockImplementation(() => { throw new Error("Unable to stage test setting"); });
    await flushPromises();
    await wrapper.get("form").trigger("submit");
    expect(wrapper.text()).toContain("Unable to stage test setting");
    store.state.data = null; await flushPromises();
    expect(wrapper.findComponent(stubs.VSwitch).props("disabled")).toBe(true);
    expect(wrapper.text()).not.toContain(store.readOnlyReason);
    wrapper.unmount();
  });
  it("saves the global IPv6 setting above ICMP and preserves other draft settings", async () => {
    const store = useControllerStore(), initial = config();
    initial.interfaces.forEach(link => { link.addresses = link.addresses.filter(address => !address.includes(":")); });
    store.state.data!.desired = initial;
    const draft = structuredClone(initial); draft.routes[0]!.metric = 42; store.stage(draft);
    const submit = vi.spyOn(api, "submitPackage");
    const wrapper = await render(SettingsView, "/settings/general");
    const toggles = wrapper.findAllComponents(stubs.VSwitch);
    expect(toggles.map(toggle => toggle.attributes("id"))).toEqual(["general-ipv6", "general-icmp"]);
    expect(wrapper.get('label[for="general-ipv6"]').text()).toBe("Enable IPv6");
    expect(wrapper.get('label[for="general-icmp"]').text()).toBe("Allow all IPv4 ICMP");
    expect(store.ipv6Enabled).toBe(true);
    toggles[0]!.vm.$emit("update:modelValue", false);
    await wrapper.get("form").trigger("submit");
    expect(store.draft?.ipv6_enabled).toBe(false); expect(store.ipv6Enabled).toBe(false);
    expect(store.draft?.routes[0]?.metric).toBe(42);
    expect(store.state.data!.desired.ipv6_enabled).toBeUndefined();
    expect(submit).not.toHaveBeenCalled();
    toggles[0]!.vm.$emit("update:modelValue", true);
    await wrapper.get("form").trigger("submit");
    expect(store.ipv6Enabled).toBe(true);
    wrapper.unmount();
  });
  it("places host name and time zone first in General settings and stages them with system.write", async () => {
    const store = useControllerStore();
    vi.spyOn(api, "getTimezones").mockResolvedValue({ timezones: ["America/New_York", "UTC"] });
    const wrapper = await render(SettingsView, "/settings/general");
    await flushPromises();
    const labels = wrapper.findAll("label.setting-name").map(label => label.text());
    expect(labels.slice(0, 3)).toEqual(["Host name", "Time zone", "Enable IPv6"]);
    const hostname = wrapper.findAllComponents({ name: "VTextField" }).find(input => input.attributes("id") === "general-hostname")!;
    hostname.vm.$emit("update:modelValue", "fw-1");
    wrapper.getComponent({ name: "VAutocomplete" }).vm.$emit("update:modelValue", "America/New_York");
    await wrapper.get("form").trigger("submit");
    expect(store.draft?.system).toEqual({ hostname: "fw-1", timezone: "America/New_York" });
    expect(store.state.data!.desired.system).toBeUndefined();
    expect(requiredPermissions(differences(store.state.data!.desired, store.draft!))).toContain("system.write");
    hostname.vm.$emit("update:modelValue", "Bad_Name");
    await wrapper.get("form").trigger("submit");
    expect(wrapper.text()).toContain("Host name must be");
    expect(store.draft?.system?.hostname).toBe("fw-1");
    wrapper.unmount();
  });
  it("keeps IPv6 runtime diagnostics out of general settings", async () => {
    const store = useControllerStore();
    const wrapper = await render(SettingsView, "/settings/general");
    expect(store.runtime.data).not.toBeNull();
    store.runtime.data!.ipv6 = {
      enabled: false, status: "measured", disable_ipv6: { all: "1", default: "1" }, drift: false,
    };
    await flushPromises();
    expect(wrapper.text()).not.toContain("Measured:");
    expect(wrapper.text()).not.toContain("Observed IPv6 controls");
    expect(wrapper.find('[aria-label="Refresh IPv6 runtime"]').exists()).toBe(false);
    expect(wrapper.find("details").exists()).toBe(false);
    expect(wrapper.findAllComponents(stubs.VSwitch)).toHaveLength(2);
    wrapper.unmount();
  });
  it("keeps IPv6 enabled when disabling would invalidate saved IPv6 settings", async () => {
    const store = useControllerStore(), before = structuredClone(store.state.data!.desired);
    const wrapper = await render(SettingsView, "/settings/general");
    wrapper.findAllComponents(stubs.VSwitch).find(item => item.attributes("id") === "general-ipv6")!.vm.$emit("update:modelValue", false);
    await wrapper.get("form").trigger("submit");
    expect(wrapper.text()).toContain("Remove IPv6 settings before disabling IPv6");
    expect(store.draft).toBeNull(); expect(store.ipv6Enabled).toBe(true);
    expect(store.state.data!.desired).toEqual(before);
    wrapper.unmount();
  });
  it("hides IPv6 columns and discovered addresses globally and restores them when enabled", async () => {
    const store = useControllerStore(), initial = config(), original = initial.interfaces[0]!;
    initial.ipv6_enabled = false;
    initial.interfaces = [{ ...original, kind: "ethernet", addresses: original.addresses.filter(address => !address.includes(":")) }];
    store.state.data!.desired = initial;
    vi.mocked(api.getDiscoveredInterfaces).mockResolvedValue([
      { name: original.name, kind: "ethernet", index: 2, mac: null, mtu: 1500, up: true, ownership: "managed", addresses: ["192.0.2.99/24", "fe80::1/64"] },
      { name: "lo", kind: "loopback", index: 1, mac: null, mtu: 65536, up: true, ownership: "loopback", addresses: ["127.0.0.1/8", "::1/128"] },
    ]);
    const physical = await render(InterfacesView, "/interfaces");
    expect(physical.findAll("th").map(header => header.text())).not.toContain("IPv6");
    await physical.get('[aria-label="Edit / stage"]').trigger("click");
    expect(physical.getComponent(PhysicalInterfaceEditor).findAllComponents(FieldInput).map(field => field.props("field").key)).not.toContain("ipv6_addresses");
    store.stage({ ...initial, ipv6_enabled: true }); await flushPromises();
    expect(physical.findAll("th").map(header => header.text())).toContain("IPv6");
    expect(physical.getComponent(PhysicalInterfaceEditor).findAllComponents(FieldInput).map(field => field.props("field").key)).toContain("ipv6_addresses");
    physical.unmount();
    store.draft = null;
    const loopbacks = await render(LoopbacksView, "/loopbacks");
    expect(loopbacks.text()).toContain("127.0.0.1/8"); expect(loopbacks.text()).not.toContain("::1/128");
    loopbacks.unmount();
  });
  it("shows physical interface roles without filters or an Add interface action", async () => {
    const store = useControllerStore(), initial = { ...config().interfaces[0]!, kind: "ethernet" as const };
    store.state.data!.desired.interfaces = [initial, { ...initial, name: "edge0", role: "wan" }];
    const wrapper = await render(InterfacesView, "/interfaces");
    expect(wrapper.text()).toContain("LAN"); expect(wrapper.text()).toContain("WAN");
    expect(wrapper.findAllComponents(stubs.VSelect).some(item => item.props("label") === "Role")).toBe(false);
    expect(wrapper.find("tbody").text()).toContain("edge0");
    expect(wrapper.find("tbody").text()).toContain("lab0");
    expect(wrapper.findAll("button").some(button => button.text() === "Add interface")).toBe(false);
  });
  it("keeps VLAN validation inline without requiring additional settings", async () => {
    const store = useControllerStore(), wrapper = await render(VLANsView, "/vlans");
    await wrapper.findAll("button").find(button => button.text() === "Add VLAN")!.trigger("click");
    expect(wrapper.findAllComponents(FieldInput).some(item => item.props("field").key === "role")).toBe(false);
    await wrapper.findAll("button").find(button => button.text() === "Save")!.trigger("click");
    expect(store.draft).toBeNull();
    expect(wrapper.find('tbody [role="alert"]').exists()).toBe(true);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(wrapper.findAllComponents(FieldInput).find(item => item.props("field").key === "name")!.props("errors")?.["editor.name"]).toBeDefined();
  });
  it("shows unsaved interfaces automatically without duplicate discovery, headers, or JSON", async () => {
    const store = useControllerStore(), draft = config();
    store.state.data!.desired.interfaces[0]!.kind = "ethernet";
    draft.interfaces[0]!.kind = "ethernet";
    draft.interfaces[0]!.addresses = ["10.10.0.1/24"];
    store.stage(draft);
    vi.mocked(api.getDiscoveredInterfaces).mockResolvedValue([{ name: "lab0", kind: "ethernet", index: 2, mac: null, mtu: 1500, up: true, addresses: ["192.0.2.10/24"], ownership: "managed" }]);
    const wrapper = await render(InterfacesView, "/interfaces"); await flushPromises();
    expect(wrapper.findAll("table")).toHaveLength(1);
    expect(wrapper.findAll("h1")).toHaveLength(0);
    const cells = wrapper.find("tbody tr").findAll("td"), headers = wrapper.findAll("th").map(header => header.text());
    expect(cells[headers.indexOf("IPv4")]!.text()).toContain("10.10.0.1/24");
    expect(headers).not.toContain("Active Addresses");
    expect(wrapper.text()).not.toContain("192.0.2.10/24");
    expect(wrapper.findAll("tbody tr")).toHaveLength(1);
    expect(wrapper.text()).not.toMatch(/Show staged draft|Start \/ show|Discovered interfaces|DHCPv4 leases|Full configured|Staged state/);
    expect(wrapper.find("tbody").text()).not.toContain("[");
    expect(wrapper.find("tbody").text()).not.toContain("{");
    await wrapper.get("tbody tr").trigger("click");
    expect(wrapper.getComponent(PhysicalInterfaceEditor).props("form").addresses).toEqual(["10.10.0.1/24"]);
  });
  it("uses the shared unsaved configuration automatically on other resource pages", async () => {
    const store = useControllerStore(), draft = config(); draft.routes[0]!.metric = 42;
    store.stage(draft);
    const wrapper = await render(RoutesView, "/routes");
    expect(wrapper.find("tbody").text()).toContain("42");
    expect(wrapper.text()).not.toMatch(/Show staged draft|Start \/ show|Full configured/);
  });
  it("formats collections as readable text rather than serialized JSON", () => {
    expect(displayResourceValue(["172.16.10.2/24"], "addresses")).toBe("172.16.10.2/24");
    expect(displayResourceValue([], "addresses")).toBe("None");
    expect(displayResourceValue({ enabled: false, servers: [] }, "dhcp_relay")).toBe("enabled: No; servers: None");
    expect(displayResourceValue("unassigned", "role")).toBe("Unassigned");
  });
  it("does not duplicate relay settings in the physical interface editor", async () => {
    useControllerStore().state.data!.desired.interfaces[0]!.kind = "ethernet";
    const wrapper = await render(InterfacesView, "/interfaces");
    await wrapper.get('button[aria-label="Edit / stage"]').trigger("click");
    expect(wrapper.text()).not.toContain("Selected DHCP relay address/subnet");
    expect(wrapper.findAllComponents(FieldInput).some(item => item.props("field").key === "dhcp_relay")).toBe(false);
  });
  it("highlights metadata-only role changes without needing expansion", () => {
    const before = config(), after = config(); after.interfaces[0]!.role = "wan";
    const wrapper = mount(ConfigDiff, { props: { before, after }, global: { stubs } });
    expect(wrapper.text()).toContain("Role LAN to WAN (metadata only)");
  });
  it.each([
    ["simulated", "Simulated"], ["running", "Running"],
    ["unavailable", "Unavailable"], ["disabled", "Disabled"], ["not_running", "Not running"],
    ["unhealthy", "Unhealthy"], ["exited", "Exited"], ["future", "Unknown (future)"],
  ])("labels %s relay state truthfully", (state, label) => {
    const wrapper = mount(RelayStatus, { props: { status: { interface: "lab0", state, pid: 123, error: "explicit error" } } });
    expect(wrapper.text()).toContain(label); expect(wrapper.attributes("title")).toContain("PID 123"); expect(wrapper.text()).toContain("explicit error");
  });
  it("does not synthesize a runtime state when status is missing", () => {
    expect(mount(RelayStatus).text()).toBe("Unknown");
  });
  it("keeps desired relay enabled distinct from failed observation/runtime errors", async () => {
    const store = useControllerStore();
    store.state.data!.desired.interfaces[0]!.dhcp_relay = { enabled: true, servers: ["198.51.100.1", "198.51.100.2"] };
    store.runtime.data!.error = "Observation failed";
    store.runtime.data!.dhcp_relay = [{ interface: "lab0", state: "exited", error: "child exited" }];
    const wrapper = await render(DHCPRelayView, "/services/dhcp-relay");
    expect(wrapper.text()).toContain("Observation failed"); expect(wrapper.text()).toContain("child exited");
    expect(wrapper.find("tbody").text()).toContain("Yes");
    expect(wrapper.find("tbody").text()).toContain("Exited");
    expect(wrapper.text()).toContain("198.51.100.1, 198.51.100.2");
    expect(store.state.data!.desired.interfaces[0]!.dhcp_relay.enabled).toBe(true);
  });
  it("edits DHCP relay only on its owning page and preserves the interface", async () => {
    const store = useControllerStore(), original = structuredClone(config()), submit = vi.spyOn(api, "submitPackage");
    const wrapper = await render(DHCPRelayView, "/services/dhcp-relay");
    await wrapper.get('button[aria-label="Edit DHCP relay lab0"]').trigger("click");
    const fields = wrapper.findAllComponents(FieldInput);
    fields.find(field => field.props("field").key === "enabled")!.vm.$emit("update:modelValue", true);
    fields.find(field => field.props("field").key === "servers")!.vm.$emit("update:modelValue", ["198.51.100.10", "198.51.100.20"]);
    await flushPromises();
    await wrapper.findAll("button").find(button => button.text() === "Save")!.trigger("click");
    expect(store.draft?.interfaces[0]).toEqual({ ...original.interfaces[0], dhcp_relay: { enabled: true, servers: ["198.51.100.10", "198.51.100.20"] } });
    expect(store.draft?.routes).toEqual(original.routes);
    expect(store.state.data!.desired.interfaces[0]!.dhcp_relay).toEqual(original.interfaces[0]!.dhcp_relay);
    expect(store.editorDirty).toBe(false); expect(submit).not.toHaveBeenCalled();
  });
  it("preserves relay settings when editing interface properties", async () => {
    const store = useControllerStore();
    store.state.data!.desired.interfaces[0]!.kind = "ethernet";
    store.state.data!.desired.interfaces[0]!.dhcp_relay = { enabled: true, servers: ["198.51.100.10"] };
    const wrapper = await render(InterfacesView, "/interfaces");
    await wrapper.get('button[aria-label="Edit / stage"]').trigger("click");
    wrapper.findAllComponents(FieldInput).find(field => field.props("field").key === "mtu")!.vm.$emit("update:modelValue", 1450);
    await flushPromises();
    await wrapper.getComponent(PhysicalInterfaceEditor).get("form").trigger("submit");
    expect(store.draft?.interfaces[0]!.dhcp_relay).toEqual({ enabled: true, servers: ["198.51.100.10"] });
  });
  it.each(["invalid-server", "missing-ipv4", "dhcp-client"])("rejects %s in the dedicated relay editor without staging", async scenario => {
    const store = useControllerStore();
    if (scenario !== "invalid-server") store.state.data!.desired.interfaces[0]!.addresses = [];
    if (scenario === "dhcp-client") store.state.data!.desired.dhcp_clients = { lab0: { client_id: "", hostname: "", route_metric: 0, use_mtu: false, use_domains: "no" } };
    const wrapper = await render(DHCPRelayView, "/services/dhcp-relay");
    await wrapper.get('button[aria-label="Edit DHCP relay lab0"]').trigger("click");
    const fields = wrapper.findAllComponents(FieldInput);
    fields.find(field => field.props("field").key === "enabled")!.vm.$emit("update:modelValue", true);
    fields.find(field => field.props("field").key === "servers")!.vm.$emit("update:modelValue", [scenario === "invalid-server" ? "127.0.0.1" : "198.51.100.10"]);
    await flushPromises();
    await wrapper.findAll("button").find(button => button.text() === "Save")!.trigger("click");
    expect(store.draft).toBeNull(); expect(store.editorDirty).toBe(true);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    expect(wrapper.get('[role="alert"]').text()).not.toBe("");
  });
  it("guards relay cancellation and never stages discarded input", async () => {
    const store = useControllerStore(), confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const wrapper = await render(DHCPRelayView, "/services/dhcp-relay");
    await wrapper.get('button[aria-label="Edit DHCP relay lab0"]').trigger("click");
    wrapper.findAllComponents(FieldInput).find(field => field.props("field").key === "servers")!.vm.$emit("update:modelValue", ["198.51.100.10"]);
    await flushPromises();
    const cancel = wrapper.findAll("button").find(button => button.text() === "Cancel")!;
    await cancel.trigger("click");
    expect(confirm).toHaveBeenCalledOnce(); expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    expect(store.editorDirty).toBe(true);
    confirm.mockReturnValue(true); await cancel.trigger("click");
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(store.draft).toBeNull(); expect(store.editorDirty).toBe(false);
    confirm.mockRestore();
  });
  it("blocks relay edits when the controller becomes read-only", async () => {
    const store = useControllerStore(), wrapper = await render(DHCPRelayView, "/services/dhcp-relay");
    await wrapper.get('button[aria-label="Edit DHCP relay lab0"]').trigger("click");
    store.connected = false; await flushPromises();
    expect(wrapper.findAll("button").find(button => button.text() === "Save")!.attributes("disabled")).toBeDefined();
    expect(wrapper.findAllComponents(FieldInput).every(field => field.props("field").disabled)).toBe(true);
    expect(store.draft).toBeNull();
  });
  it("requires explicit repair and shows permissions from pending settings, not draft", async () => {
    const store = useControllerStore(), pending = transaction();
    pending.candidate.softflowd[0]!.enabled = true; pending.candidate.interfaces[0]!.dhcp_relay.enabled = true;
    store.transactions.data = { [pending.id]: pending };
    store.draft = config();
    const repair = vi.spyOn(store, "reconcile").mockRejectedValue(new Error("HTTP 403: interfaces.write required"));
    const wrapper = mount(ServiceRepair, { props: { service: "dhcp-relay" }, global: { stubs } });
    expect(repair).not.toHaveBeenCalled();
    await wrapper.findAll("button").find(button => button.text() === "Reconcile all managed services")!.trigger("click");
    expect(wrapper.text()).toContain("softflowd.write");
    await wrapper.findAll("button").find(button => button.text() === "Reconcile all services")!.trigger("click"); await flushPromises();
    expect(repair).toHaveBeenCalledWith("dhcp-relay");
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true); expect(wrapper.text()).toContain("HTTP 403");
  });
});
