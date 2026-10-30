import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FirewallView from "@/views/FirewallView.vue";
import { useControllerStore } from "@/stores/controller";
import { cloneConfig } from "@/services/configuration";
import { config, hostPolicyConfig, state, transaction } from "../fixtures";
import * as sando from "@/services/sando";

const stubs = {
  VSelect: {
    props: ["modelValue", "label", "items", "disabled"], emits: ["update:modelValue"],
    template: '<label>{{ label }}<select :aria-label="label" :disabled="disabled" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="item in items" :key="item.value ?? item" :value="item.value ?? item">{{ item.title ?? item }}</option></select></label>',
  },
  VTable: { template: "<table><slot /></table>" }, VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
  VAlert: { template: "<div><slot /></div>" }, VProgressLinear: true,
  VChip: { name: "VChip", props: ["color", "prependIcon", "variant", "size"], template: "<span><slot /></span>" },
  VIcon: true,
  VTextField: { props: ["modelValue", "label"], emits: ["update:modelValue"], template: '<input :aria-label="label" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />' },
  ResourceEditorDialog: true, ResourceDeleteDialog: true, ResourceRuntime: true,
};
let wrapper: ReturnType<typeof mount>;
beforeEach(() => {
  setActivePinia(createPinia());
  const store = useControllerStore();
  store.connected = true; store.state.data = { ...state(), desired: hostPolicyConfig() };
  store.state.stale = false; store.state.lastSuccess = Date.now();
});
afterEach(() => { wrapper?.unmount(); useControllerStore().$dispose(); vi.restoreAllMocks(); });
const rows = () => wrapper.findAll(".host-rule").map(row => row.findAll(".rule-value:not(.rule-value--ingress)").map(value => value.text()));
const button = (text: string) => wrapper.findAll("button").find(button => button.text() === text)!;
describe("PROTECTED HOSTS host navigation", () => {
  it.each(["192.0.2.40", "2001:db8::40"])("stages and selects a manually added host at %s without applying", async address => {
    const store = useControllerStore(), before = cloneConfig(store.state.data!.desired);
    wrapper = mount(FirewallView, { global: { stubs } });
    await wrapper.get("input").setValue("not found");
    await button("Add host").trigger("click");
    expect(store.draft).toBeNull();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    await wrapper.get('input[aria-label="IP address"]').setValue(` ${address} `);
    expect(store.editorDirty).toBe(true);
    await wrapper.get('form[aria-label="Add forwarding host"]').trigger("submit");
    expect(store.draft!.firewall.policies!.hosts).toHaveLength(4);
    expect(store.draft!.firewall.policies!.hosts.at(-1)).toEqual({
      id: `host_${address.replace(/[:.]/g, "_")}`, name: address, addresses: [address], policy: "drop", rules: [],
    });
    expect(wrapper.get('[aria-current="true"]').text()).toBe(address.toUpperCase());
    expect(wrapper.findAll(".host-link")).toHaveLength(4);
    expect(rows()).toEqual([["Default", "Any", "Any", "Any", "Any", "drop"]]);
    expect(store.editorDirty).toBe(false);
    expect(store.state.data!.desired).toEqual(before);
  });
  it("can cancel a host row without staging and clears dirty state when unmounted", async () => {
    const store = useControllerStore(), stage = vi.spyOn(store, "stage");
    wrapper = mount(FirewallView, { global: { stubs } });
    await button("Add host").trigger("click");
    await wrapper.get('input[aria-label="IP address"]').setValue("192.0.2.40");
    await button("Cancel").trigger("click");
    expect(store.editorDirty).toBe(false);
    expect(stage).not.toHaveBeenCalled();
    expect(wrapper.find("form").exists()).toBe(false);
    await button("Add host").trigger("click");
    await wrapper.get('input[aria-label="IP address"]').setValue("192.0.2.41");
    wrapper.unmount();
    expect(store.editorDirty).toBe(false);
  });
  it.each([
    ["", "Use an IP"],
    ["not-an-ip", "Use an IP"],
    ["192.0.2.40/24", "Use an IP"],
    ["127.0.0.1", "unicast host IP"],
    ["2001:0db8::40", "Use canonical address"],
    ["192.0.2.20", "already belongs to a host"],
  ])("rejects invalid or duplicate address %s inline", async (address, message) => {
    const store = useControllerStore(), stage = vi.spyOn(store, "stage");
    wrapper = mount(FirewallView, { global: { stubs } });
    await button("Add host").trigger("click");
    await wrapper.get('input[aria-label="IP address"]').setValue(address);
    await wrapper.get("form").trigger("submit");
    expect(wrapper.get('[role="alert"]').text()).toContain(message);
    expect(stage).not.toHaveBeenCalled();
    expect(wrapper.get('input[aria-label="IP address"]').element).toHaveProperty("value", address);
  });
  it("uses the latest shared draft, preserves edits, and supports an explicit accept default and colliding ID", async () => {
    const store = useControllerStore();
    store.draft = cloneConfig(hostPolicyConfig());
    store.draft.firewall.policies!.hosts[0]!.policy = "accept";
    store.draft.firewall.policies!.hosts[0]!.id = "host_192_0_2_40";
    wrapper = mount(FirewallView, { global: { stubs } });
    await button("Add host").trigger("click");
    await wrapper.get('input[aria-label="IP address"]').setValue("192.0.2.40");
    await wrapper.get('select[aria-label="Default action"]').setValue("accept");
    store.draft.firewall.policies!.hosts[1]!.policy = "drop";
    await wrapper.get("form").trigger("submit");
    expect(store.draft.firewall.policies!.hosts[0]!.policy).toBe("accept");
    expect(store.draft.firewall.policies!.hosts[1]!.policy).toBe("drop");
    expect(store.draft.firewall.policies!.hosts.at(-1)).toMatchObject({ id: "host_192_0_2_40_2", policy: "accept" });
  });
  it("adds the first host to an empty policy list", async () => {
    const store = useControllerStore();
    store.state.data!.desired.firewall.policies!.hosts = [];
    wrapper = mount(FirewallView, { global: { stubs } });
    await button("Add host").trigger("click");
    await wrapper.get('input[aria-label="IP address"]').setValue("192.0.2.40");
    await wrapper.get("form").trigger("submit");
    expect(wrapper.get('[aria-current="true"]').text()).toBe("192.0.2.40");
    expect(rows().at(-1)?.at(-1)).toBe("drop");
  });
  it("rejects disabled IPv6, host limits, and staging failures inline", async () => {
    const store = useControllerStore();
    store.state.data!.desired.ipv6_enabled = false;
    wrapper = mount(FirewallView, { global: { stubs } });
    await button("Add host").trigger("click");
    await wrapper.get('input[aria-label="IP address"]').setValue("2001:db8::40");
    await wrapper.get("form").trigger("submit");
    expect(wrapper.get('[role="alert"]').text()).toContain("IPv6 is disabled");
    store.state.data!.desired.firewall.policies!.hosts = Array.from({ length: 128 }, (_, index) => ({
      id: `h_${index}`, name: `Host ${index}`, addresses: [`198.51.100.${index + 1}`], policy: "drop", rules: [],
    }));
    await wrapper.get('input[aria-label="IP address"]').setValue("192.0.2.40");
    await wrapper.get("form").trigger("submit");
    expect(wrapper.get('[role="alert"]').text()).toContain("At most 128 hosts");
    store.state.data!.desired.firewall.policies!.hosts = [];
    vi.spyOn(store, "stage").mockImplementation(() => { throw new Error("Cannot stage now"); });
    await wrapper.get("form").trigger("submit");
    expect(wrapper.get('[role="alert"]').text()).toBe("Cannot stage now");
    expect(store.draft).toBeNull();
    expect(store.editorDirty).toBe(true);
  });
  it("disables host additions while read-only or another editor has unsaved changes", async () => {
    const store = useControllerStore();
    wrapper = mount(FirewallView, { global: { stubs } });
    store.editorDirty = true; await flushPromises();
    expect(button("Add host").attributes("disabled")).toBeDefined();
    store.editorDirty = false;
    store.busy = true; await flushPromises();
    expect(button("Add host").attributes("disabled")).toBeDefined();
    store.busy = false; await flushPromises();
    await button("Add host").trigger("click");
    await wrapper.get('input[aria-label="IP address"]').setValue("192.0.2.40");
    store.busy = true; await flushPromises();
    await wrapper.get("form").trigger("submit");
    expect(wrapper.get('[role="alert"]').text()).toContain("frozen");
    expect(store.draft).toBeNull();
  });
  it("uses labeled action, protocol, port and egress chips without disguising wildcard or default rules", async () => {
    wrapper = mount(FirewallView, { global: { stubs } });
    await wrapper.findAll(".host-link")[2]!.trigger("click");
    expect(wrapper.get('table[aria-label="Host rules"]').findAll("thead th").map(heading => heading.text())).toEqual(["Order", "Ingress", "Destination", "Protocol", "Port", "Egress", "Action", "Actions", "Origin", "Packets", "Bytes"]);
    const rules = wrapper.findAll(".host-rule");
    expect(rules.map(row => row.attributes("data-action"))).toEqual(["accept", "drop", "accept", "drop"]);
    expect(rules[0]!.findAllComponents({ name: "VChip" }).map((chip: VueWrapper) => [chip.text(), chip.props()])).toEqual([
      ["TCP", expect.objectContaining({ color: "info", prependIcon: undefined })],
      ["443, 8443", expect.objectContaining({ color: undefined, prependIcon: undefined })],
      ["lab0", expect.objectContaining({ color: "primary", prependIcon: "mdi-lan-connect" })],
      ["accept", expect.objectContaining({ color: "success", prependIcon: "mdi-check-circle-outline" })],
    ]);
    expect(rules[1]!.findAllComponents({ name: "VChip" }).map((chip: VueWrapper) => [chip.text(), chip.props()])).toEqual([
      ["UDP", expect.objectContaining({ color: "secondary" })],
      ["53", expect.objectContaining({ color: undefined })],
      ["drop", expect.objectContaining({ color: "error", prependIcon: "mdi-close-circle-outline" })],
    ]);
    expect(rules[2]!.findAll(".rule-value--any")).toHaveLength(5);
    expect(rules[2]!.findAllComponents({ name: "VChip" })).toHaveLength(1);
    expect(rules[3]!.classes()).toContain("host-rule--default");
    expect(rules[3]!.get(".rule-value--order").text()).toBe("Default");
    expect(rules[3]!.getComponent(stubs.VChip).props("prependIcon")).toBe("mdi-close-circle-outline");
    expect(useControllerStore().draft).toBeNull();
  });
  it("shows sorted uppercase host navigation followed by ordered outbound rules and the host default", async () => {
    wrapper = mount(FirewallView, { global: { stubs } });
    expect(wrapper.get("section").attributes("aria-label")).toBe("PROTECTED HOSTS");
    expect(wrapper.findAll(".host-link").map(host => host.text())).toEqual(["PHONE", "SERVER", "WORKSTATION"]);
    await wrapper.findAll(".host-link")[2]!.trigger("click");
    expect(rows()).toEqual([
      ["1", "Server", "TCP", "443, 8443", "lab0", "accept"],
      ["2", "198.51.100.0/24", "UDP", "53", "Any", "drop"],
      ["3", "Any", "Any", "Any", "Any", "accept"],
      ["Default", "Any", "Any", "Any", "Any", "drop"],
    ]);
    expect(wrapper.findAll("table").map(table => table.attributes("aria-label"))).toEqual(["Host rules"]);
    expect(wrapper.find("select").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Default policy");
    expect(wrapper.get(".rule-section--user").text()).not.toContain("203.0.113.99");
    expect(wrapper.get(".rule-section--interfaces").text()).toContain("203.0.113.99");
    expect(wrapper.text()).not.toContain("Host/interface policy mode is active");
    expect(wrapper.find("pre").exists()).toBe(false);
  });
  it("switches hosts without changing configuration and includes hosts with only a default policy", async () => {
    const store = useControllerStore(), before = cloneConfig(store.state.data!.desired), stage = vi.spyOn(store, "stage");
    wrapper = mount(FirewallView, { global: { stubs } });
    await wrapper.findAll(".host-link")[1]!.trigger("click"); await flushPromises();
    expect(rows()).toEqual([["Default", "Any", "Any", "Any", "Any", "accept"]]);
    await wrapper.findAll(".host-link")[0]!.trigger("click"); await flushPromises();
    expect(rows()[0]).toEqual(["1", "2001:db8::/64", "UDP", "5353", "Any", "accept"]);
    expect(stage).not.toHaveBeenCalled(); expect(store.draft).toBeNull();
    expect(store.editorDirty).toBe(false); expect(cloneConfig(store.state.data!.desired)).toEqual(before);
  });
  it("retains selection through refreshes and recovers when the selected host or every host is removed", async () => {
    const store = useControllerStore();
    wrapper = mount(FirewallView, { global: { stubs } });
    await wrapper.findAll(".host-link")[0]!.trigger("click");
    const refreshed = hostPolicyConfig(); refreshed.firewall.policies!.hosts[2]!.policy = "accept";
    refreshed.firewall.policies!.hosts[2]!.name = "Renamed phone";
    refreshed.firewall.policies!.hosts.reverse();
    store.state.data = { ...state(), desired: refreshed }; await flushPromises();
    expect(wrapper.get('[aria-current="true"]').text()).toBe("RENAMED PHONE");
    expect(rows().at(-1)?.at(-1)).toBe("accept");
    const removed = cloneConfig(refreshed); removed.firewall.policies!.hosts = removed.firewall.policies!.hosts.filter(host => host.id !== "phone");
    store.state.data = { ...state(), desired: removed }; await flushPromises();
    expect(wrapper.get('[aria-current="true"]').text()).toBe("SERVER");
    store.state.data = { ...state(), desired: { ...removed, firewall: { ...removed.firewall, policies: { hosts: [], interfaces: [] } } } };
    await flushPromises();
    expect(wrapper.text()).toContain("No hosts with policies.");
    expect(wrapper.findAll(".host-link")).toHaveLength(0); expect(wrapper.find("table").exists()).toBe(false);
  });
  it("uses the current shared draft and pending candidate rather than stale committed rules", async () => {
    const store = useControllerStore();
    const pending = transaction(); pending.candidate = hostPolicyConfig(); pending.candidate.firewall.policies!.hosts[0]!.rules = [];
    store.state.data!.active_transaction = pending;
    wrapper = mount(FirewallView, { global: { stubs } });
    await wrapper.findAll(".host-link")[2]!.trigger("click");
    expect(rows()).toHaveLength(1);
    store.draft = cloneConfig(pending.candidate); store.draft.firewall.policies!.hosts[0]!.policy = "accept";
    await flushPromises();
    expect(rows()).toEqual([["Default", "Any", "Any", "Any", "Any", "accept"]]);
  });
  it("uses Sando descriptions and device types, searches without changing selection, and does not stage metadata", async () => {
    const store = useControllerStore();
    store.state.data!.desired.sando = { api_url: "https://sando.example", sync_enabled: true, hosts_import: null, rules_import: null };
    vi.spyOn(sando, "getSandoDevices").mockResolvedValue([
      sando.sandoDeviceSchema.parse({ ip_address: "192.0.2.20", local_description: "Unifi", device_type: "wifi_ap", icon: "WIFI_ACCESS_POINT", threat_score: 0 }),
      sando.sandoDeviceSchema.parse({ ip_address: "198.51.100.10", local_description: "Alpha", icon: "Server" }),
    ]);
    const stage = vi.spyOn(store, "stage");
    wrapper = mount(FirewallView, { global: { stubs } }); await flushPromises();
    expect(wrapper.findAll(".host-info").map(host => host.text())).toEqual(["ALPHA", "PHONE", "UNIFI"]);
    expect(wrapper.findAll(".device-icon").map(icon => icon.attributes("data-device-icon"))).toEqual(["SERVER", "DEFAULT", "WIFI_ACCESS_POINT"]);
    expect(wrapper.findAll(".host-link").map(host => host.attributes("title"))).toEqual(["ALPHA (198.51.100.10)", "PHONE (192.0.2.30)", "UNIFI (192.0.2.20)"]);
    expect(wrapper.find(".host-link small").exists()).toBe(false);
    await wrapper.get("input").setValue("wifi_ap");
    expect(wrapper.findAll(".host-link")).toHaveLength(1);
    await wrapper.get(".host-link").trigger("click");
    expect(rows()).toHaveLength(4);
    await wrapper.get("input").setValue("192.0.2.30");
    expect(wrapper.get(".host-link").text()).toBe("PHONE");
    expect(wrapper.get("h2").text()).toBe("UNIFI (192.0.2.20)");
    await wrapper.get("input").setValue("not found");
    expect(wrapper.text()).toContain("No matching hosts.");
    expect(stage).not.toHaveBeenCalled(); expect(store.draft).toBeNull();
  });
  it("shows an inline inventory error and keeps configured hosts usable", async () => {
    useControllerStore().state.data!.desired.sando = { api_url: "https://sando.example", sync_enabled: true, hosts_import: null, rules_import: null };
    vi.spyOn(sando, "getSandoDevices").mockRejectedValue(new Error("Sando unavailable"));
    wrapper = mount(FirewallView, { global: { stubs } }); await flushPromises();
    expect(wrapper.text()).toContain("Sando unavailable");
    expect(wrapper.findAll(".host-link")).toHaveLength(3);
    expect(rows()).toHaveLength(2);
  });
  it("uses only committed sync settings and discards an in-flight metadata result after disabling", async () => {
    const store = useControllerStore();
    store.state.data!.desired.sando = { api_url: "https://sando.example", sync_enabled: false, hosts_import: null, rules_import: null };
    let finish!: (devices: sando.SandoDevice[]) => void;
    let signal: AbortSignal | undefined;
    const inventory = vi.spyOn(sando, "getSandoDevices").mockImplementation((_endpoint, requestSignal) => {
      signal = requestSignal;
      return new Promise(resolve => { finish = resolve; });
    });
    wrapper = mount(FirewallView, { global: { stubs } }); await flushPromises();
    expect(inventory).not.toHaveBeenCalled();
    store.draft = cloneConfig(store.state.data!.desired);
    store.draft.sando!.sync_enabled = true;
    await flushPromises();
    expect(inventory).not.toHaveBeenCalled();
    store.state.data = { ...store.state.data!, desired: { ...store.state.data!.desired, sando: {
      ...store.state.data!.desired.sando!, sync_enabled: true,
    } } };
    await flushPromises();
    expect(inventory).toHaveBeenCalledOnce();
    expect(inventory.mock.calls[0]![0]).toBe("https://sando.example");
    store.draft.sando!.sync_enabled = false;
    store.draft.sando!.api_url = "https://other.example";
    await flushPromises();
    expect(signal?.aborted).toBe(false);
    expect(inventory).toHaveBeenCalledOnce();
    store.state.data = { ...store.state.data!, desired: { ...store.state.data!.desired, sando: {
      ...store.state.data!.desired.sando!, sync_enabled: false,
    } } };
    await flushPromises();
    expect(signal?.aborted).toBe(true);
    finish([sando.sandoDeviceSchema.parse({ ip_address: "192.0.2.20", local_description: "Obsolete", threat_score: 9 })]);
    await flushPromises();
    expect(wrapper.findAll(".host-link")).toHaveLength(3);
    expect(wrapper.text()).not.toContain("OBSOLETE");
    expect(wrapper.text()).not.toContain("Unable to load host descriptions");
  });
  it("keeps the existing legacy forwarding editor when no host-policy configuration exists", () => {
    useControllerStore().state.data = { ...state(), desired: config() };
    wrapper = mount(FirewallView, { global: { stubs: { ...stubs, ResourceTable: true } } });
    expect(wrapper.findAll("button").map(button => button.text())).toEqual(["Add rule", "Save"]);
    expect(wrapper.findAll("select")).toHaveLength(1); expect(wrapper.text()).toContain("Default policy");
    expect(wrapper.findComponent({ name: "ResourceTable" }).exists()).toBe(true);
  });
});
