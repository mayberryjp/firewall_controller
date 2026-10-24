import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import InterfacesView from "@/views/InterfacesView.vue";
import RoutesView from "@/views/RoutesView.vue";
import FirewallView from "@/views/FirewallView.vue";
import FirewallInputView from "@/views/FirewallInputView.vue";
import DHCPRelayView from "@/views/DHCPRelayView.vue";
import RelayStatus from "@/components/feature/RelayStatus.vue";
import ServiceRepair from "@/components/feature/ServiceRepair.vue";
import FieldInput from "@/components/base/FieldInput.vue";
import ConfigDiff from "@/components/feature/ConfigDiff.vue";
import NTPView from "@/views/NTPView.vue";
import SyslogView from "@/views/SyslogView.vue";
import VnStatView from "@/views/VnStatView.vue";
import GatewayStatisticsPanel from "@/components/feature/GatewayStatisticsPanel.vue";
import InterfaceInventory from "@/components/feature/InterfaceInventory.vue";
import DatasetStatus from "@/components/base/DatasetStatus.vue";
import JsonPanel from "@/components/base/JsonPanel.vue";
import * as api from "@/services/netcontrol";
import { useControllerStore } from "@/stores/controller";
import { configSchema } from "@/types/domain";
import { displayResourceValue } from "@/services/resourceCollections";
import { config, state, runtime, transaction, gatewayStatistics, monitor, statistics } from "../fixtures";
import type { Component } from "vue";

const box = { template: "<div><slot /></div>" };
const stubs = {
  VAlert: box, VCard: box, VCardText: box, VCardActions: box, VTable: { template: "<table><slot /></table>" },
  VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
  VSwitch: { props: ["modelValue", "label", "disabled"], emits: ["update:modelValue"], template: '<label>{{ label }}<input type="checkbox" :checked="modelValue" :disabled="disabled" @change="$emit(\'update:modelValue\', $event.target.checked)"></label>' },
  VDialog: { props: ["modelValue"], template: '<div v-if="modelValue" role="dialog"><slot /></div>' },
  VSelect: { props: ["modelValue", "label", "items", "disabled"], emits: ["update:modelValue"], template: '<label>{{ label }}<select :disabled="disabled" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option value="">Select</option><option v-for="item in items" :key="item.value ?? item" :value="item.value ?? item">{{ item.title ?? item }}</option></select></label>' },
  VTextField: true, VTextarea: true, VCheckbox: true, VExpansionPanels: box, VExpansionPanel: box, VExpansionPanelTitle: box, VExpansionPanelText: box,
  DatasetStatus: true, JsonPanel: true, VProgressLinear: true,
};
beforeEach(() => {
  setActivePinia(createPinia());
  const store = useControllerStore();
  store.connected = true; store.state.data = state(); store.runtime.data = runtime();
  vi.spyOn(api, "getGatewayStatistics").mockResolvedValue({ sample: statistics().sample, monitors: [] });
  vi.spyOn(api, "getDiscoveredInterfaces").mockResolvedValue([]);
});
async function render(component: Component, path: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:pathMatch(.*)*", component }] });
  await router.push(path); await router.isReady();
  return mount(component, { global: { plugins: [router], stubs } });
}
describe("October 17 frontend workflows", () => {
  it("stages host-input rules separately while preserving forwarding and other settings", async () => {
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
    await wrapper.findAll("button").find(button => button.text() === "Stage changes")!.trigger("click");
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
    await wrapper.findAll("button").find(button => button.text() === "Stage changes")!.trigger("click");
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
    expect(wrapper.findAll("button").filter(button => button.text() === "Manage this interface")).toHaveLength(1);
    await wrapper.findAll("button").find(button => button.text() === "Manage this interface")!.trigger("click");
    const fields = wrapper.findAllComponents(FieldInput);
    expect(fields.find(field => field.props("field").key === "addresses")!.props("modelValue")).toEqual([]);
    expect(fields.find(field => field.props("field").key === "role")!.props("modelValue")).toBeUndefined();
    fields.find(field => field.props("field").key === "role")!.vm.$emit("update:modelValue", "unassigned");
    fields.find(field => field.props("field").key === "address_mode")!.vm.$emit("update:modelValue", "dhcp");
    fields.find(field => field.props("field").key === "resolver_enabled")!.vm.$emit("update:modelValue", true);
    fields.find(field => field.props("field").key === "resolver")!.vm.$emit("update:modelValue", { servers: ["192.0.2.53"], domains: [{ name: ".", route_only: true }] });
    await flushPromises();
    await wrapper.findAll("button").find(button => button.text() === "Stage changes")!.trigger("click");
    expect(store.draft?.interfaces.find(item => item.name === "eth0")).toMatchObject({ kind: "ethernet", role: "unassigned", addresses: [] });
    expect(store.draft?.dhcp_clients?.eth0).toMatchObject({ use_domains: "no", route_metric: 0 });
    expect(store.draft?.dns?.eth0?.servers).toEqual(["192.0.2.53"]);
    expect(store.state.data!.desired.interfaces).toHaveLength(1);
    expect(submit).not.toHaveBeenCalled();
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
  it("stages NTP retained servers into the shared draft without a network write", async () => {
    const store = useControllerStore(), submit = vi.spyOn(api, "submitPackage");
    const wrapper = await render(NTPView, "/services/ntp");
    expect(wrapper.text()).not.toContain("Operator prerequisites");
    const fields = wrapper.findAllComponents(FieldInput);
    fields.find(item => item.props("field").key === "enabled")!.vm.$emit("update:modelValue", true);
    fields.find(item => item.props("field").key === "servers")!.vm.$emit("update:modelValue", ["clock.example", "::1"]);
    await flushPromises();
    await wrapper.findAll("button").find(button => button.text() === "Stage service changes")!.trigger("click");
    expect(store.draft?.ntp).toEqual({ enabled: true, servers: ["clock.example", "::1"] });
    expect(store.draft?.interfaces).toEqual(config().interfaces);
    expect(store.draft?.syslog).toEqual(config().syslog);
    expect(store.editorDirty).toBe(false); expect(submit).not.toHaveBeenCalled();
  });
  it("blocks invalid disabled syslog destinations and explains local logging risk", async () => {
    const store = useControllerStore();
    const wrapper = await render(SyslogView, "/services/syslog");
    expect(wrapper.text()).not.toContain("Operator prerequisites");
    wrapper.findAllComponents(FieldInput).find(item => item.props("field").key === "servers")!.vm.$emit("update:modelValue", [{ host: "UPPER.example", transport: "tls", port: 6514 }]);
    await flushPromises();
    await wrapper.findAll("button").find(button => button.text() === "Stage service changes")!.trigger("click");
    expect(store.draft).toBeNull(); expect(wrapper.text()).toContain("lowercase ASCII DNS");
  });
  it("renders both vnStat scopes as diagnostic paths, not traffic history", async () => {
    const store = useControllerStore();
    store.runtime.data!.appliance_services[2] = { name: "vnstat-host", scope: "host", state: "simulated", pid: 11, database_directory: "/host-db" };
    store.runtime.data!.appliance_services[3] = { name: "vnstat-managed", scope: "managed", state: "unhealthy", pid: 12, database_directory: "/managed-db", error: "inventory failed" };
    const wrapper = await render(VnStatView, "/services/vnstat");
    expect(wrapper.find("tbody").text()).toContain("vnstat-host"); expect(wrapper.find("tbody").text()).toContain("vnstat-managed");
    expect(wrapper.text()).toContain("/host-db"); expect(wrapper.text()).toContain("/managed-db");
    expect(wrapper.text()).toContain("inventory failed"); expect(wrapper.text()).not.toContain("Operator prerequisites");
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
  it("stages explicit false in both firewall modes without adding implicit rows", async () => {
    const store = useControllerStore();
    for (const policyMode of [false, true]) {
      store.draft = null; store.baseline = null;
      store.state.data = state();
      if (policyMode) { store.state.data.desired.firewall.rules = []; store.state.data.desired.firewall.policies = { hosts: [], interfaces: [] }; }
      const wrapper = await render(FirewallView, "/firewall");
      expect(wrapper.text()).not.toContain("Displayed committed ICMP exception");
      const toggle = wrapper.findAllComponents(stubs.VSwitch).find(item => item.props("label") === "Allow all IPv4 ICMP");
      expect(toggle).toBeDefined();
      toggle!.vm.$emit("update:modelValue", false);
      await wrapper.get("button").trigger("blur");
      await wrapper.findAll("button").find(button => button.text() === "Stage ICMP change")!.trigger("click");
      const staged = configSchema.parse(store.draft);
      expect(staged.firewall.allow_all_icmp).toBe(false);
      expect(staged.firewall.policies).toEqual(store.state.data.desired.firewall.policies);
      expect(staged.firewall.rules).toEqual(store.state.data.desired.firewall.rules);
      wrapper.unmount();
    }
  });
  it("shows all labeled roles without filters and requires explicit create selection", async () => {
    const store = useControllerStore(), initial = config().interfaces[0]!;
    store.state.data!.desired.interfaces.push({ ...initial, name: "edge0", role: "wan" });
    const wrapper = await render(InterfacesView, "/interfaces");
    expect(wrapper.text()).toContain("LAN"); expect(wrapper.text()).toContain("WAN");
    expect(wrapper.findAllComponents(stubs.VSelect).some(item => item.props("label") === "Role")).toBe(false);
    expect(wrapper.find("tbody").text()).toContain("edge0");
    expect(wrapper.find("tbody").text()).toContain("lab0");
    await wrapper.findAll("button").find(button => button.text() === "Add interface")!.trigger("click");
    const role = wrapper.findAllComponents(FieldInput).find(item => item.props("field").key === "role")!;
    expect(role.props("modelValue")).toBeUndefined();
    await wrapper.findAll("button").find(button => button.text() === "Stage changes")!.trigger("click");
    expect(store.draft).toBeNull(); expect(wrapper.text()).toContain("editor.role");
  });
  it("shows unsaved interfaces automatically without duplicate discovery, headers, or JSON", async () => {
    const store = useControllerStore(), draft = config();
    draft.interfaces[0]!.addresses = ["10.10.0.1/24"];
    store.stage(draft);
    vi.mocked(api.getDiscoveredInterfaces).mockResolvedValue([{ name: "lab0", kind: "dummy", index: 2, mac: null, mtu: 1500, up: true, addresses: ["192.0.2.10/24"], ownership: "managed" }]);
    const wrapper = await render(InterfacesView, "/interfaces"); await flushPromises();
    expect(wrapper.findAll("table")).toHaveLength(1);
    expect(wrapper.findAll("h1")).toHaveLength(0);
    expect(wrapper.find("tbody").text()).toContain("10.10.0.1/24");
    expect(wrapper.find("tbody").text()).not.toContain("192.0.2.10/24");
    expect(wrapper.find("tbody").text()).toContain("Unsaved");
    expect(wrapper.findAll("tbody tr")).toHaveLength(1);
    expect(wrapper.text()).not.toMatch(/Show staged draft|Start \/ show|Discovered interfaces|DHCPv4 leases|Full configured|Staged state/);
    expect(wrapper.find("tbody").text()).not.toContain("[");
    expect(wrapper.find("tbody").text()).not.toContain("{");
  });
  it("uses the shared unsaved configuration automatically on other resource pages", async () => {
    const store = useControllerStore(), draft = config(); draft.routes[0]!.metric = 42;
    store.stage(draft);
    const wrapper = await render(RoutesView, "/routes");
    expect(wrapper.find("tbody").text()).toContain("42");
    expect(wrapper.find("tbody").text()).toContain("Unsaved");
    expect(wrapper.text()).not.toMatch(/Show staged draft|Start \/ show|Full configured/);
  });
  it("formats collections as readable text rather than serialized JSON", () => {
    expect(displayResourceValue(["172.16.10.2/24"], "addresses")).toBe("172.16.10.2/24");
    expect(displayResourceValue([], "addresses")).toBe("None");
    expect(displayResourceValue({ enabled: false, servers: [] }, "dhcp_relay")).toBe("enabled: No; servers: None");
    expect(displayResourceValue("unassigned", "role")).toBe("Unassigned");
  });
  it("shows selected relay prefix and shared-process disruption in the interface editor", async () => {
    const wrapper = await render(InterfacesView, "/interfaces");
    await wrapper.get('button[aria-label="Edit / stage"]').trigger("click");
    expect(wrapper.text()).toContain("Selected DHCP relay address/subnet: 192.0.2.10/24");
    expect(wrapper.text()).toContain("restart the shared relay process");
    expect(wrapper.findAllComponents(FieldInput).some(item => item.props("field").key === "dhcp_relay")).toBe(true);
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
