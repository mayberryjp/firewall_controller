import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MDNSView from "@/views/MDNSView.vue";
import ConfigDiff from "@/components/feature/ConfigDiff.vue";
import { useControllerStore } from "@/stores/controller";
import { cloneConfig } from "@/services/configuration";
import { mdnsPresets } from "@/services/mdns";
import { mdnsSchema } from "@/types/domain";
import { mdnsStatus, state, transaction } from "../fixtures";

const box = { template: "<div><slot /></div>" };
const input = {
  props: ["modelValue", "label"], emits: ["update:modelValue"],
  template: '<label>{{ label }}<input :aria-label="label" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" /></label>',
};
const checkbox = {
  props: ["modelValue", "label"], emits: ["update:modelValue"],
  template: '<label><input type="checkbox" :aria-label="label" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />{{ label }}</label>',
};
const global = { stubs: {
  VAlert: box, VTable: { template: "<table><slot /></table>" }, VProgressLinear: true,
  VForm: { props: ["disabled"], emits: ["submit"], template: '<form @submit.prevent="$emit(\'submit\', $event)"><slot /></form>' },
  VBtn: { props: ["disabled", "type"], template: '<button :type="type || \'button\'" :disabled="disabled"><slot /></button>' },
  VMenu: { template: '<div><slot name="activator" :props="{}" /><slot /></div>' },
  VList: box,
  VListItem: {
    props: ["title", "subtitle", "disabled"],
    template: '<button :disabled="disabled" :aria-label="title">{{ title }}<span>{{ subtitle }}</span></button>',
  },
  VCheckbox: checkbox, VTextField: input,
  VTextarea: {
    props: ["modelValue", "label"], emits: ["update:modelValue"],
    template: '<label>{{ label }}<textarea :aria-label="label" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" /></label>',
  },
  VSelect: {
    props: { modelValue: {}, label: String, items: Array, multiple: Boolean }, emits: ["update:modelValue"],
    template: '<label>{{ label }}<select :aria-label="label" :multiple="multiple" :value="modelValue" @change="$emit(\'update:modelValue\', multiple ? Array.from($event.target.selectedOptions).map(option => option.value) : $event.target.value)"><option v-for="item in items" :key="item.value || item" :value="item.value || item">{{ item.title || item }}</option></select></label>',
  },
  ServiceRepair: true,
} };
async function click(wrapper: VueWrapper, label: string) {
  await wrapper.findAll("button").find(button => button.text() === label)!.trigger("click");
}
async function setServices(wrapper: VueWrapper, ...services: string[]) {
  for (const [index, service] of services.entries()) {
    if (!wrapper.find(`input[aria-label="Service ${index + 1}"]`).exists()) await click(wrapper, "Add service");
    await wrapper.get(`input[aria-label="Service ${index + 1}"]`).setValue(service);
  }
}
function observedUsage() {
  const store = useControllerStore(), settings = store.state.data!.desired.mdns!;
  settings.enabled = true; settings.ipv6 = false;
  settings.reflection.filters = ["_ipp._tcp.local.", "_http._tcp.local."];
  store.state.data = { ...store.state.data! };
  const sample = {
    ...mdnsStatus(), statistics_complete: true,
    filter_counters: [
      { filter: "_http._tcp.local.", matched_packets: "0", transmitted_packets: "0", last_used_at: null, last_transmitted_at: null },
      { filter: "_ipp._tcp.local.", matched_packets: "9007199254740993", transmitted_packets: "18446744073709551615", last_used_at: "2026-01-02T03:04:05.987+02:00", last_transmitted_at: "2026-01-02T03:04:05.987+02:00" },
    ],
  };
  store.mdnsStatus.data = { instances: [sample], error: "" };
  store.mdnsStatus.lastSuccess = Date.now(); store.mdnsStatus.stale = false;
  return sample;
}
beforeEach(() => {
  setActivePinia(createPinia());
  const store = useControllerStore(); store.connected = true; store.state.data = state();
  store.state.data.desired.interfaces = ["lan0", "lan1"].map(name => ({
    name, kind: "ethernet", role: "lan", up: true, mtu: 1500, addresses: [],
    dhcp_relay: { enabled: false, servers: [] },
  }));
  store.state.data.desired.mdns = mdnsSchema.parse({ interfaces: ["lan0", "lan1"], reflection: { enabled: true }, metadata: { display_name: "Discovery", description: "Keep me" } });
  vi.spyOn(store, "refreshMDNSStatus").mockResolvedValue();
});
afterEach(() => { useControllerStore().$dispose(); vi.useRealTimers(); });

describe("mDNS / Discovery", () => {
  it("joins exact counters by canonical filter, shows current-run zeroes and formats last used in the saved timezone", async () => {
    const store = useControllerStore();
    store.state.data!.desired.system = { hostname: "", domain: "", timezone: "America/Los_Angeles" };
    const sample = observedUsage(), original = structuredClone(sample);
    const wrapper = mount(MDNSView, { global });
    const ipp = wrapper.get('[aria-label="Usage for service 1"]'), http = wrapper.get('[aria-label="Usage for service 2"]');
    expect(ipp.text()).toContain("Matched: 9007199254740993");
    expect(ipp.text()).toContain("Forwarded: 18446744073709551615");
    expect(ipp.text()).toContain("Last used (America/Los_Angeles): 2026-01-01 17:04:05");
    expect(http.text()).toContain("Matched: 0"); expect(http.text()).toContain("Not yet observed");
    store.stage(cloneConfig(store.state.data!.desired));
    store.draft!.system!.timezone = "Asia/Kolkata";
    await flushPromises();
    expect(ipp.text()).toContain("2026-01-01 17:04:05");
    store.state.data = { ...store.state.data!, desired: { ...store.state.data!.desired, system: { ...store.state.data!.desired.system!, timezone: "Asia/Kolkata" } } };
    await flushPromises();
    expect(ipp.text()).toContain("Last used (Asia/Kolkata): 2026-01-02 06:34:05");
    expect(sample).toEqual(original);
    expect(wrapper.text()).toContain("zero is not lifetime non-use");
    wrapper.unmount();
  });
  it("never attaches applied counters to renamed services or changed links and preserves deletes in the normal draft", async () => {
    const store = useControllerStore(); observedUsage();
    const wrapper = mount(MDNSView, { global });
    await wrapper.get('input[aria-label="Service 1"]').setValue(" _IPP._TCP ");
    expect(wrapper.get('[aria-label="Usage for service 1"]').text()).toContain("9007199254740993");
    await wrapper.get('input[aria-label="Service 1"]').setValue("_googlecast._tcp");
    expect(wrapper.get('[aria-label="Usage for service 1"]').text()).toBe("Not applied");
    expect(wrapper.get('[aria-label="Usage for service 2"]').text()).toContain("Matched: 0");
    await wrapper.get('select[aria-label="LAN links"]').setValue(["lan0"]);
    expect(wrapper.get('[aria-label="Usage for service 2"]').text()).toBe("Not applied");
    await click(wrapper, "Cancel edits");
    await wrapper.get('[aria-label="Delete service 2"]').trigger("click");
    await wrapper.get("form").trigger("submit");
    expect(store.draft!.mdns!.reflection.filters).toEqual(["_ipp._tcp.local."]);
    expect(store.state.data!.desired.mdns!.reflection.filters).toHaveLength(2);
    wrapper.unmount();
  });
  it.each(["success", "failure"])("shows neutral pending usage then a real %s without discarding edits", async outcome => {
    const store = useControllerStore(), sample = observedUsage();
    store.mdnsStatus.data = null; store.mdnsStatus.lastSuccess = null; store.mdnsStatus.loading = true;
    const wrapper = mount(MDNSView, { global });
    const entry = wrapper.get('[aria-label="Usage for service 1"]');
    expect(entry.text()).toBe("Loading");
    expect(wrapper.text()).not.toContain("Unavailable");
    await setServices(wrapper, "_ipp._tcp");
    store.mdnsStatus.loading = false;
    if (outcome === "success") {
      store.mdnsStatus.data = { instances: [sample], error: "" };
      store.mdnsStatus.lastSuccess = Date.now(); store.mdnsStatus.stale = false;
    } else {
      store.mdnsStatus.error = "HTTP 503: usage read failed"; store.mdnsStatus.stale = true;
    }
    await flushPromises();
    expect(entry.text()).toContain(outcome === "success" ? "9007199254740993" : "Unavailable");
    if (outcome === "failure") expect(wrapper.text()).toContain("HTTP 503: usage read failed");
    expect(store.editorDirty).toBe(true); expect(store.readOnlyReason).toBe("");
    wrapper.unmount();
  });
  it.each([
    ["simulated", "Simulated (unmeasured)"], ["disabled", "Disabled (unmeasured)"],
    ["stopped", "Stopped (unmeasured)"], ["error", "Unavailable"],
  ] as const)("does not present %s values as measured inactivity", (state, expected) => {
    observedUsage(); const store = useControllerStore();
    store.mdnsStatus.data!.instances[0]!.state = state;
    const wrapper = mount(MDNSView, { global });
    expect(wrapper.get('[aria-label="Usage for service 1"]').text()).toBe(expected);
    wrapper.unmount();
  });
  it("expires stale usage, surfaces worker failures and shows reset counters after a fresh worker sample", async () => {
    vi.useFakeTimers(); const sample = observedUsage(), store = useControllerStore();
    const wrapper = mount(MDNSView, { global });
    await vi.advanceTimersByTimeAsync(15001);
    expect(wrapper.get('[aria-label="Usage for service 1"]').text()).toBe("Stale");
    store.mdnsStatus.data = { instances: [{ ...sample, error: "Bind failed", retrying: true }], error: "" };
    store.mdnsStatus.lastSuccess = Date.now();
    await flushPromises();
    expect(wrapper.text()).toContain("Bind failed");
    expect(wrapper.get('[aria-label="Usage for service 1"]').text()).toBe("Unavailable");
    store.mdnsStatus.data = { instances: [{ ...sample, started_at: "2026-11-01T23:00:00Z", filter_counters: sample.filter_counters.map(row => ({
      ...row, matched_packets: "0", transmitted_packets: "0", last_used_at: null, last_transmitted_at: null,
    })) }], error: "" };
    await flushPromises();
    expect(wrapper.get('[aria-label="Usage for service 1"]').text()).toContain("Matched: 0");
    expect(wrapper.get('[aria-label="Usage for service 1"]').text()).toContain("Not yet observed");
    wrapper.unmount();
  });
  it("does not measure reflection-off or retrying samples, and rejects counters from different applied membership", async () => {
    const sample = observedUsage(), store = useControllerStore();
    const wrapper = mount(MDNSView, { global });
    const entry = wrapper.get('[aria-label="Usage for service 1"]');
    store.mdnsStatus.data = { instances: [{ ...sample, reflection_enabled: false }], error: "" };
    await flushPromises();
    expect(entry.text()).toBe("Disabled (unmeasured)");
    store.mdnsStatus.data = { instances: [{ ...sample, retrying: true }], error: "" };
    await flushPromises();
    expect(entry.text()).toBe("Retrying (unmeasured)");
    store.mdnsStatus.data = { instances: [{ ...sample, filter_counters: sample.filter_counters.slice(1) }], error: "" };
    await flushPromises();
    expect(entry.text()).toBe("Not applied");
    wrapper.unmount();
  });
  it("invalidates usage on applied replacement and joins fresh provisional counters without borrowing removed entry counts", async () => {
    const sample = observedUsage(), store = useControllerStore();
    const wrapper = mount(MDNSView, { global });
    const pending = transaction();
    pending.candidate = cloneConfig(store.state.data!.desired);
    pending.candidate.mdns!.reflection.filters = ["_googlecast._tcp.local."];
    store.state.data = { ...store.state.data!, active_transaction: pending };
    await flushPromises();
    expect(wrapper.get<HTMLInputElement>('input[aria-label="Service 1"]').element.value).toBe("_googlecast._tcp.local.");
    expect(wrapper.get('[aria-label="Usage for service 1"]').text()).toBe("Stale");
    store.mdnsStatus.data = { instances: [sample], error: "" };
    store.mdnsStatus.stale = false; store.mdnsStatus.lastSuccess = Date.now();
    await flushPromises();
    expect(wrapper.get('[aria-label="Usage for service 1"]').text()).toBe("Not applied");
    store.mdnsStatus.data = { instances: [{ ...sample, filter_counters: [{
      filter: "_googlecast._tcp.local.", matched_packets: "3", transmitted_packets: "6", last_used_at: null, last_transmitted_at: null,
    }] }], error: "" };
    await flushPromises();
    expect(wrapper.get('[aria-label="Usage for service 1"]').text()).toContain("Matched: 3");
    wrapper.unmount();
  });
  it("adds presets only to unsent edits, preserves custom entries and stages through the shared draft without popups", async () => {
    const store = useControllerStore(), desired = cloneConfig(store.state.data!.desired);
    store.stage(desired); store.draft!.ntp = { enabled: true, servers: ["time.example.com"] };
    const stage = vi.spyOn(store, "stage"), apply = vi.spyOn(store, "apply");
    const confirm = vi.spyOn(window, "confirm"), alert = vi.spyOn(window, "alert");
    const wrapper = mount(MDNSView, { global });
    await setServices(wrapper, "_custom._udp");
    for (const preset of mdnsPresets) {
      const button = wrapper.get(`button[aria-label="${preset.title}"]`);
      expect(button.text()).toContain(preset.value);
      await button.trigger("click");
      expect(button.attributes("disabled")).toBeDefined();
    }
    expect(wrapper.findAll('input[aria-label^="Service "]')).toHaveLength(14);
    expect(store.editorDirty).toBe(true); expect(stage).not.toHaveBeenCalled();
    expect(store.draft!.mdns).toEqual(desired.mdns);
    await wrapper.get("form").trigger("submit");
    expect(stage).toHaveBeenCalledTimes(1); expect(apply).not.toHaveBeenCalled();
    expect(store.draft!.mdns!.reflection.filters).toEqual(["_custom._udp.local.", ...mdnsPresets.map(preset => preset.value)].sort());
    expect(store.draft!.ntp.servers).toEqual(["time.example.com"]);
    expect(store.draft!.mdns!.metadata).toEqual(desired.mdns!.metadata);
    expect(cloneConfig(store.state.data!.desired)).toEqual(desired);
    expect(confirm).not.toHaveBeenCalled(); expect(alert).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it("disables shorthand-equivalent presets and restores availability after deletion or cancel", async () => {
    const store = useControllerStore(), wrapper = mount(MDNSView, { global });
    const http = wrapper.get('button[aria-label="HTTP"]');
    for (const entry of [" _HTTP._TCP ", "_http._tcp.LOCAL", "_http._tcp.local."]) {
      await setServices(wrapper, entry);
      expect(http.attributes("disabled")).toBeDefined();
      await http.trigger("click");
      expect(wrapper.findAll('input[aria-label^="Service "]')).toHaveLength(1);
    }
    await wrapper.get('[aria-label="Delete service 1"]').trigger("click");
    expect(http.attributes("disabled")).toBeUndefined();
    await http.trigger("click");
    expect(wrapper.get<HTMLInputElement>('input[aria-label="Service 1"]').element.value).toBe("_http._tcp.local.");
    await click(wrapper, "Cancel edits");
    expect(wrapper.findAll('input[aria-label^="Service "]')).toHaveLength(0);
    expect(http.attributes("disabled")).toBeUndefined();
    expect(store.editorDirty).toBe(false); expect(store.draft).toBeNull();
    wrapper.unmount();
  });
  it("disables presets at the 64-filter limit", () => {
    const store = useControllerStore();
    store.state.data!.desired.mdns!.reflection.filters = Array.from({ length: 64 }, (_, index) => `_custom${index}._tcp.local.`);
    const wrapper = mount(MDNSView, { global });
    expect(wrapper.findAll("button").find(button => button.text() === "Presets")!.attributes("disabled")).toBeDefined();
    for (const preset of mdnsPresets) expect(wrapper.get(`button[aria-label="${preset.title}"]`).attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });
  it.each(["success", "failure"])("keeps presets disabled during initialization and handles pending-to-%s reads", async outcome => {
    const store = useControllerStore(), loaded = store.state.data;
    store.state.data = null; store.state.loading = true;
    const wrapper = mount(MDNSView, { global });
    const googleCast = wrapper.get('button[aria-label="Google Cast"]');
    expect(googleCast.attributes("disabled")).toBeDefined();
    expect(wrapper.text()).not.toContain("unavailable");
    expect(wrapper.text()).not.toContain("unsupported");
    await googleCast.trigger("click");
    expect(store.editorDirty).toBe(false);
    store.state.loading = false;
    if (outcome === "success") store.state.data = loaded;
    else store.state.error = "HTTP 503: configuration read failed";
    await flushPromises();
    if (outcome === "success") {
      expect(googleCast.attributes("disabled")).toBeUndefined();
      await googleCast.trigger("click");
      expect(wrapper.get<HTMLInputElement>('input[aria-label="Service 1"]').element.value).toBe("_googlecast._tcp.local.");
      expect(store.editorDirty).toBe(true);
    } else {
      expect(googleCast.attributes("disabled")).toBeDefined();
      expect(wrapper.text()).toContain("HTTP 503: configuration read failed");
      expect(store.editorDirty).toBe(false);
    }
    wrapper.unmount();
  });
  it("colors service trash icons red", async () => {
    const wrapper = mount(MDNSView, { global });
    await setServices(wrapper, "_ipp._tcp", "_googlecast._tcp");
    const buttons = wrapper.findAll('button[icon="mdi-delete"]');
    expect(buttons).toHaveLength(2);
    for (const button of buttons) expect(button.attributes("color")).toBe("error");
  });
  it("offers and stages VLANs attached to LAN parents without requiring their own LAN role", async () => {
    const store = useControllerStore();
    store.state.data!.desired.interfaces.push({
      ...store.state.data!.desired.interfaces[0]!, name: "vlan10", kind: "vlan", role: "unassigned", vlan: { parent: "lan0", id: 10 },
    });
    const wrapper = mount(MDNSView, { global });
    expect(wrapper.get('select[aria-label="LAN links"]').findAll("option").map(option => option.text())).toContain("VLAN10");
    await wrapper.get('select[aria-label="LAN links"]').setValue(["lan0", "vlan10"]);
    await setServices(wrapper, "_ipp._tcp");
    await wrapper.get("form").trigger("submit");
    expect(store.draft, wrapper.text()).not.toBeNull();
    expect(store.draft!.mdns!.interfaces).toEqual(["lan0", "vlan10"]);
  });
  it("keeps runtime diagnostics off the configuration page and retains unsaved edits", async () => {
    const store = useControllerStore();
    const sample = { ...mdnsStatus(), state: "error" as const, retrying: true, restart_count: 2, last_error: "Link down" };
    store.mdnsStatus.data = { instances: [sample], error: "" };
    store.mdnsStatus.stale = true;
    const wrapper = mount(MDNSView, { global });
    expect(wrapper.get("form > div:last-child").findAll("button").map(button => button.text())).toEqual([
      "Add service", "Presets", ...mdnsPresets.map(preset => `${preset.title}${preset.value}`), "Stage changes", "Cancel edits",
    ]);
    await setServices(wrapper, "printer.local.");
    expect(store.refreshMDNSStatus).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).not.toContain("Applied discovery status");
    expect(wrapper.text()).not.toContain("membership:");
    expect(wrapper.text()).not.toContain("Applied families:");
    expect(wrapper.text()).not.toContain("Applied reflection:");
    expect(wrapper.text()).not.toContain("Applied publishing:");
    expect(wrapper.text()).not.toContain("Traffic counters");
    expect(wrapper.text()).not.toContain("Started (UTC)");
    expect(wrapper.find("table").exists()).toBe(false);
    expect(wrapper.find("service-repair-stub").exists()).toBe(false);
    store.mdnsStatus.data = { instances: [{ ...sample, state: "running", retrying: false }], error: "" };
    await flushPromises();
    expect(wrapper.text()).not.toContain("Recovering");
    expect(wrapper.get<HTMLInputElement>('input[aria-label="Service 1"]').element.value).toBe("printer.local.");
    expect(store.editorDirty).toBe(true); expect(store.readOnlyReason).toBe("");
    wrapper.unmount();
  });
  it("stages the full shared draft, normalizes filters and retains metadata without a backend write or popup", async () => {
    const store = useControllerStore(), desired = cloneConfig(store.state.data!.desired);
    store.stage(desired); store.draft!.ntp = { enabled: true, servers: ["time.example.com"] };
    const stage = vi.spyOn(store, "stage"), apply = vi.spyOn(store, "apply");
    const confirm = vi.spyOn(window, "confirm"), alert = vi.spyOn(window, "alert");
    const wrapper = mount(MDNSView, { global });
    await setServices(wrapper, "_IPP._TCP", "printer.local");
    expect(store.editorDirty).toBe(true);
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(stage).toHaveBeenCalledTimes(1); expect(apply).not.toHaveBeenCalled();
    expect(store.draft!.mdns).toMatchObject({ enabled: true, metadata: desired.mdns!.metadata, reflection: { filters: ["_ipp._tcp.local.", "printer.local."] } });
    expect(store.draft!.ntp.servers).toEqual(["time.example.com"]);
    expect(cloneConfig(store.state.data!.desired)).toEqual(desired); expect(store.editorDirty).toBe(false);
    expect(confirm).not.toHaveBeenCalled(); expect(alert).not.toHaveBeenCalled();
  });
  it("stages exact instances with service shorthand without stripping instance labels", async () => {
    const store = useControllerStore(), wrapper = mount(MDNSView, { global });
    await setServices(wrapper, "_googlecast._tcp", "_udp._govee-lan._udp.local.", "_ipp._tcp.local");
    await wrapper.get("form").trigger("submit");
    expect(store.draft, wrapper.text()).not.toBeNull();
    expect(store.draft!.mdns!.reflection.filters).toEqual(["_googlecast._tcp.local.", "_ipp._tcp.local.", "_udp._govee-lan._udp.local."]);
    expect(store.editorDirty).toBe(false);
  });
  it("rejects duplicate shorthand filters inline without losing edits or locking configuration", async () => {
    const store = useControllerStore(), wrapper = mount(MDNSView, { global });
    await setServices(wrapper, "_http._tcp", "_HTTP._TCP.local");
    await wrapper.get("form").trigger("submit");
    expect(wrapper.text()).toContain("unique filters (case-insensitive)");
    expect(store.draft).toBeNull(); expect(store.editorDirty).toBe(true);
    expect(store.readOnlyReason).toBe("");
    expect(wrapper.get<HTMLInputElement>('input[aria-label="Service 1"]').element.value).toBe("_http._tcp");
    expect(wrapper.get<HTMLInputElement>('input[aria-label="Service 2"]').element.value).toBe("_HTTP._TCP.local");
  });
  it("retains input on validation or permission errors and cancel restores shared settings", async () => {
    const store = useControllerStore(), wrapper = mount(MDNSView, { global });
    await setServices(wrapper, "*.local.");
    await wrapper.get("form").trigger("submit");
    expect(wrapper.text()).toContain("no patterns"); expect(store.draft).toBeNull(); expect(store.editorDirty).toBe(true);
    await setServices(wrapper, "printer.local.");
    vi.spyOn(store, "stage").mockImplementation(() => { throw new Error("HTTP 403: mdns.write required"); });
    await wrapper.get("form").trigger("submit");
    expect(wrapper.text()).toContain("mdns.write required");
    expect(wrapper.get<HTMLInputElement>('input[aria-label="Service 1"]').element.value).toBe("printer.local.");
    await click(wrapper, "Cancel edits"); expect(store.editorDirty).toBe(false);
  });
  it("uses global IPv6, fixes allow-list reflection, and disables an empty service list", async () => {
    const store = useControllerStore(); store.state.data!.desired.ipv6_enabled = false;
    store.state.data!.desired.mdns!.interface_mode = "deny";
    store.state.data!.desired.mdns!.interfaces = [];
    store.state.data!.desired.mdns!.ipv4 = false;
    store.state.data!.desired.mdns!.publishing = { ...store.state.data!.desired.mdns!.publishing, addresses: true, aaaa_on_ipv4: true };
    const wrapper = mount(MDNSView, { global });
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(0);
    expect(wrapper.find('select[aria-label="Interface selection mode"]').exists()).toBe(false);
    await setServices(wrapper, "_googlecast._tcp");
    await wrapper.get("form").trigger("submit");
    expect(store.draft!.mdns).toMatchObject({ enabled: true, interface_mode: "allow", interfaces: ["lan0", "lan1"], ipv4: true, ipv6: false, reflection: { enabled: true, filters: ["_googlecast._tcp.local."] }, publishing: { enabled: false } });
    await wrapper.get('[aria-label="Delete service 1"]').trigger("click");
    await wrapper.get("form").trigger("submit");
    expect(store.draft!.mdns).toMatchObject({ enabled: false, reflection: { enabled: true, filters: [] } });
  });
  it("loads pending configuration without displaying runtime counters or membership summaries", () => {
    const store = useControllerStore(), pending = transaction();
    pending.candidate = cloneConfig(store.state.data!.desired);
    pending.candidate.mdns!.interfaces = ["lan1"]; pending.candidate.mdns!.reflection.enabled = false;
    store.transactions.data = { [pending.id]: pending };
    const row = mdnsStatus(), original = structuredClone(row);
    store.mdnsStatus.data = { instances: [row], error: "" }; store.mdnsStatus.stale = false;
    const wrapper = mount(MDNSView, { global });
    expect(wrapper.get('select[aria-label="LAN links"]').findAll("option:checked").map(option => option.element.getAttribute("value"))).toEqual(["lan1"]);
    expect(wrapper.text()).not.toContain("membership:");
    expect(wrapper.text()).not.toContain("9007199254740993"); expect(wrapper.text()).not.toContain("18446744073709551615");
    expect(wrapper.text()).not.toContain("Statistics are incomplete");
    expect(store.mdnsStatus.data.instances[0]).toEqual(original);
  });
  it("shows usage request failures without showing unrelated diagnostics or blocking configuration edits", async () => {
    const store = useControllerStore(), row = { ...mdnsStatus(), state: "error" as const, error: "UDP 5353 is owned", started_at: null, collected_at: "invalid" };
    store.mdnsStatus.data = { instances: [row], error: "" }; store.mdnsStatus.error = "HTTP 503: status unavailable";
    store.mdnsStatus.incompatible = true; store.mdnsStatus.stale = true;
    store.runtime.error = "Incompatible API response: appliance_services.4: Invalid specialized service status";
    store.runtime.incompatible = true; store.runtime.stale = true;
    const wrapper = mount(MDNSView, { global });
    expect(store.readOnlyReason).toBe("");
    expect(wrapper.text()).toContain("UDP 5353 is owned");
    expect(wrapper.find('[title*="UDP 5353 is owned"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("HTTP 503");
    expect(wrapper.text()).not.toContain("Invalid timestamp");
    expect(wrapper.text()).not.toContain("Stale last-known state");
    expect(wrapper.findAll("button").find(button => button.text() === "Stage changes")!.attributes("disabled")).toBeUndefined();
    await setServices(wrapper, "_http._tcp");
    await wrapper.get("form").trigger("submit");
    expect(store.draft!.mdns!.reflection.filters).toEqual(["_http._tcp.local."]);
  });
  it("does not overwrite concurrent mDNS changes and cleans dirty state on unmount", async () => {
    const store = useControllerStore(), wrapper = mount(MDNSView, { global });
    await setServices(wrapper, "_http._tcp");
    store.state.data!.desired.mdns!.metadata!.description = "Someone else's note";
    await wrapper.get("form").trigger("submit");
    expect(wrapper.text()).toContain("changed while editing"); expect(store.draft).toBeNull();
    wrapper.unmount(); expect(store.editorDirty).toBe(false);
  });
  it("shows deny-mode expansion in SAVE even when only interface configuration changed", () => {
    const store = useControllerStore(), before = cloneConfig(store.state.data!.desired);
    before.mdns!.interface_mode = "deny"; before.mdns!.interfaces = [];
    const after = cloneConfig(before);
    after.interfaces.push({ ...after.interfaces[0]!, name: "lan2" });
    const wrapper = mount(ConfigDiff, { props: { before, after }, global });
    expect(wrapper.text()).toContain("mDNS deny-mode membership expands to: lan2");
  });
});
