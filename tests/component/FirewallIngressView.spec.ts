import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FirewallIngressView from "@/views/FirewallIngressView.vue";
import { useControllerStore } from "@/stores/controller";
import { cloneConfig } from "@/services/configuration";
import { config, hostPolicyConfig, state, transaction } from "../fixtures";

const stubs = {
  VSelect: {
    props: ["modelValue", "label", "items", "disabled"], emits: ["update:modelValue"],
    template: '<label>{{ label }}<select :aria-label="label" :disabled="disabled" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="item in items" :key="item.value" :value="item.value">{{ item.title }}</option></select></label>',
  },
  VTable: { template: "<table><slot /></table>" },
  VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
  VIcon: true, VChip: { template: "<span><slot /></span>" },
  VAlert: { template: "<div><slot /></div>" }, VProgressLinear: true,
};
let wrapper: ReturnType<typeof mount>;
beforeEach(() => {
  setActivePinia(createPinia());
  const store = useControllerStore();
  store.connected = true; store.state.data = { ...state(), desired: hostPolicyConfig() };
  store.state.stale = false; store.state.lastSuccess = Date.now();
});
afterEach(() => { wrapper?.unmount(); useControllerStore().$dispose(); vi.restoreAllMocks(); });
const mountPage = () => { wrapper = mount(FirewallIngressView, { global: { stubs } }); };
const rows = () => wrapper.findAll(".host-rule").map(row => row.findAll(".rule-value").map(value => value.text()));

describe("Interface ingress", () => {
  it("labels managed interfaces by identity and display name while retaining policy-only names", async () => {
    const store = useControllerStore();
    store.state.data!.desired.interfaces[0]!.metadata = { display_name: "LAN", description: "Internal network notes" };
    store.state.data!.desired.firewall.policies!.interfaces.push({ interface: "missing0", rules: [] });
    const stage = vi.spyOn(store, "stage");
    mountPage();
    expect(wrapper.findAll("option").map(option => [option.text(), option.attributes("value")]))
      .toEqual([["lab0 (LAN)", "lab0"], ["missing0", "missing0"]]);
    await wrapper.get("select").setValue("missing0");
    store.draft = cloneConfig(store.state.data!.desired);
    store.draft.interfaces[0]!.metadata!.display_name = "Office";
    await flushPromises();
    expect(wrapper.findAll("option")[0]!.text()).toBe("lab0 (Office)");
    expect((wrapper.get("select").element as HTMLSelectElement).value).toBe("missing0");
    expect(stage).not.toHaveBeenCalled();
  });

  it("shows an interface selector followed by only its ordered ingress overrides", () => {
    const policies = useControllerStore().state.data!.desired.firewall.policies!;
    policies.interfaces[0]!.rules.push(
      { destination_host: "server", protocol: "tcp", destination_ports: [443, 8443], out_interface: "wan0", action: "accept" },
      { action: "drop" },
      { destination_host: "missing", protocol: "udp", destination_ports: [53], action: "accept" },
    );
    mountPage();
    expect(wrapper.get("section").attributes("aria-label")).toBe("INTERFACE RULES");
    expect(wrapper.get("select").attributes("aria-label")).toBe("Interface");
    expect(wrapper.findAll("option").map(option => option.text())).toEqual(["lab0"]);
    expect(rows()).toEqual([
      ["1", "203.0.113.99/32", "Any", "Any", "Any", "drop"],
      ["2", "Server", "TCP", "443, 8443", "wan0", "accept"],
      ["3", "Any", "Any", "Any", "Any", "drop"],
      ["4", "Unknown host (missing)", "UDP", "53", "Any", "accept"],
    ]);
    expect(wrapper.findAll("table").map(table => table.attributes("aria-label"))).toEqual(["Interface rules"]);
    expect(wrapper.findAll("button").some(button => button.text() === "Add rule")).toBe(true);
    expect(wrapper.get(".rule-section--user").text()).not.toContain("Default");
    expect(wrapper.text()).not.toContain("198.51.100.0/24");
  });

  it("switches interfaces including empty policies without staging or mutating configuration", async () => {
    const store = useControllerStore();
    store.state.data!.desired.firewall.policies!.interfaces.push({ interface: "wan0", rules: [] });
    const before = cloneConfig(store.state.data!.desired), stage = vi.spyOn(store, "stage");
    mountPage();
    expect(wrapper.findAll("option").map(option => option.text())).toEqual(["lab0", "wan0"]);
    await wrapper.get("select").setValue("wan0");
    expect(wrapper.text()).toContain("No explicit ingress rules for this interface.");
    expect(wrapper.get('table[aria-label="Interface rules"]').findAll("thead th")).toHaveLength(10);
    expect(stage).not.toHaveBeenCalled(); expect(store.draft).toBeNull();
    expect(store.editorDirty).toBe(false); expect(cloneConfig(store.state.data!.desired)).toEqual(before);
  });

  it("retains selection through refreshes and recovers after selected or all interfaces are removed", async () => {
    const store = useControllerStore();
    store.state.data!.desired.firewall.policies!.interfaces.push({ interface: "wan0", rules: [] });
    mountPage();
    await wrapper.get("select").setValue("wan0");
    const refreshed = cloneConfig(store.state.data!.desired);
    refreshed.firewall.policies!.interfaces[1]!.rules = [{ action: "accept" }];
    store.state.data = { ...state(), desired: refreshed }; await flushPromises();
    expect((wrapper.get("select").element as HTMLSelectElement).value).toBe("wan0");
    expect(rows()).toEqual([["1", "Any", "Any", "Any", "Any", "accept"]]);
    const removed = cloneConfig(refreshed); removed.firewall.policies!.interfaces.pop();
    store.state.data = { ...state(), desired: removed }; await flushPromises();
    expect((wrapper.get("select").element as HTMLSelectElement).value).toBe("lab0");
    const empty = cloneConfig(removed); empty.firewall.policies!.interfaces = [];
    store.state.data = { ...state(), desired: empty }; await flushPromises();
    expect(wrapper.text()).toContain("No explicit ingress rules for this interface.");
    expect(wrapper.get("select").attributes("disabled")).toBeUndefined();
    expect(wrapper.find("table").exists()).toBe(true);
  });

  it("uses the shared draft before pending candidates and committed configuration", async () => {
    const store = useControllerStore(), pending = transaction();
    pending.candidate = hostPolicyConfig();
    pending.candidate.firewall.policies!.interfaces[0]!.rules = [{ action: "accept" }];
    store.state.data!.active_transaction = pending;
    mountPage();
    expect(rows()).toEqual([["1", "Any", "Any", "Any", "Any", "accept"]]);
    store.draft = cloneConfig(pending.candidate);
    store.draft.firewall.policies!.interfaces[0]!.rules = [{ protocol: "udp", action: "drop" }];
    await flushPromises();
    expect(rows()).toEqual([["1", "Any", "UDP", "Any", "Any", "drop"]]);
  });

  it("handles absent policy configuration without showing legacy or host-input rules", () => {
    const desired = config();
    desired.firewall.input = { policy: "drop", interfaces: [{ interface: "lab0", rules: [{ action: "accept" }] }] };
    useControllerStore().state.data = { ...state(), desired };
    mountPage();
    expect(wrapper.text()).toContain("No interface ingress policies configured.");
    expect(wrapper.get("select").attributes("disabled")).toBeDefined();
    expect(wrapper.find("table").exists()).toBe(false);
  });
});
