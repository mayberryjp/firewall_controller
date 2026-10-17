import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ResourceView from "@/views/ResourceView.vue";
import DHCPRelayView from "@/views/DHCPRelayView.vue";
import RelayStatus from "@/components/feature/RelayStatus.vue";
import ServiceRepair from "@/components/feature/ServiceRepair.vue";
import FieldInput from "@/components/base/FieldInput.vue";
import ConfigDiff from "@/components/feature/ConfigDiff.vue";
import { useControllerStore } from "@/stores/controller";
import { configSchema } from "@/types/domain";
import { config, state, runtime, transaction } from "../fixtures";
import type { Component } from "vue";

const box = { template: "<div><slot /></div>" };
const stubs = {
  VAlert: box, VCard: box, VCardText: box, VCardActions: box, VTable: { template: "<table><slot /></table>" },
  VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
  VSwitch: { props: ["modelValue", "label", "disabled"], emits: ["update:modelValue"], template: '<label>{{ label }}<input type="checkbox" :checked="modelValue" :disabled="disabled" @change="$emit(\'update:modelValue\', $event.target.checked)"></label>' },
  VDialog: { props: ["modelValue"], template: '<div v-if="modelValue" role="dialog"><slot /></div>' },
  VSelect: { props: ["modelValue", "label", "items", "disabled"], emits: ["update:modelValue"], template: '<label>{{ label }}<select :disabled="disabled" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option value="">Select</option><option v-for="item in items" :key="item.value ?? item" :value="item.value ?? item">{{ item.title ?? item }}</option></select></label>' },
  VTextField: true, VTextarea: true, VCheckbox: true, VExpansionPanels: box, VExpansionPanel: box, VExpansionPanelTitle: box, VExpansionPanelText: box,
  DatasetStatus: true, JsonPanel: true,
};
beforeEach(() => {
  setActivePinia(createPinia());
  const store = useControllerStore();
  store.connected = true; store.state.data = state(); store.runtime.data = runtime();
});
async function render(component: Component, path: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:pathMatch(.*)*", component }] });
  await router.push(path); await router.isReady();
  return mount(component, { global: { plugins: [router], stubs } });
}
describe("October 17 frontend workflows", () => {
  it("stages explicit false in both firewall modes without adding implicit rows", async () => {
    const store = useControllerStore();
    for (const policyMode of [false, true]) {
      store.draft = null; store.baseline = null;
      store.state.data = state();
      if (policyMode) { store.state.data.desired.firewall.rules = []; store.state.data.desired.firewall.policies = { hosts: [], interfaces: [] }; }
      const wrapper = await render(ResourceView, "/firewall");
      expect(wrapper.text()).toContain("protocol 58 is unchanged");
      const toggle = wrapper.findAllComponents(stubs.VSwitch).find(item => item.props("label") === "Draft allow all IPv4 ICMP");
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
  it("shows and filters labeled roles, and requires explicit create selection", async () => {
    const store = useControllerStore(), initial = config().interfaces[0]!;
    store.state.data!.desired.interfaces.push({ ...initial, name: "edge0", role: "wan" });
    const wrapper = await render(ResourceView, "/interfaces");
    expect(wrapper.text()).toContain("LAN"); expect(wrapper.text()).toContain("WAN");
    const filter = wrapper.findAllComponents(stubs.VSelect).find(item => item.props("label") === "Role")!;
    filter.vm.$emit("update:modelValue", "WAN"); await flushPromises();
    expect(wrapper.find("tbody").text()).toContain("edge0");
    expect(wrapper.find("tbody").text()).not.toContain("lab0");
    await wrapper.findAll("button").find(button => button.text() === "Add interface")!.trigger("click");
    const role = wrapper.findAllComponents(FieldInput).find(item => item.props("field").key === "role")!;
    expect(role.props("modelValue")).toBeUndefined();
    await wrapper.findAll("button").find(button => button.text() === "Stage changes")!.trigger("click");
    expect(store.draft).toBeNull(); expect(wrapper.text()).toContain("editor.role");
  });
  it("shows selected relay prefix and shared-process disruption in the interface editor", async () => {
    const wrapper = await render(ResourceView, "/interfaces");
    await wrapper.findAll("button").find(button => button.text() === "Edit / stage")!.trigger("click");
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
    ["simulated", "Simulated; no real relay activity"], ["running", "lease delivery not verified"],
    ["unavailable", "Unavailable"], ["disabled", "Disabled"], ["not_running", "Not running"],
    ["unhealthy", "Unhealthy"], ["exited", "Exited"], ["future", "Unknown (future)"],
  ])("labels %s relay state truthfully", (state, label) => {
    const wrapper = mount(RelayStatus, { props: { status: { interface: "lab0", state, pid: 123, error: "explicit error" } } });
    expect(wrapper.text()).toContain(label); expect(wrapper.text()).toContain("PID 123"); expect(wrapper.text()).toContain("explicit error");
  });
  it("does not synthesize a runtime state when status is missing", () => {
    expect(mount(RelayStatus).text()).toContain("Unknown (no runtime data)");
  });
  it("keeps desired relay enabled distinct from failed observation/runtime errors", async () => {
    const store = useControllerStore();
    store.state.data!.desired.interfaces[0]!.dhcp_relay = { enabled: true, servers: ["198.51.100.1", "198.51.100.2"] };
    store.runtime.data!.error = "Observation failed";
    store.runtime.data!.dhcp_relay = [{ interface: "lab0", state: "exited", error: "child exited" }];
    const wrapper = await render(DHCPRelayView, "/services/dhcp-relay");
    expect(wrapper.text()).toContain("Observation failed"); expect(wrapper.text()).toContain("child exited");
    expect(wrapper.find("tbody").text()).toContain("true");
    expect(wrapper.find("tbody").text()).toContain("No");
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
