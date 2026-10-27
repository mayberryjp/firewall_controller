import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MDNSView from "@/views/MDNSView.vue";
import ConfigDiff from "@/components/feature/ConfigDiff.vue";
import { useControllerStore } from "@/stores/controller";
import { cloneConfig } from "@/services/configuration";
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
  VCheckbox: checkbox, VTextField: input,
  VTextarea: {
    props: ["modelValue", "label"], emits: ["update:modelValue"],
    template: '<label>{{ label }}<textarea :aria-label="label" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" /></label>',
  },
  VSelect: {
    props: ["modelValue", "label", "items", "multiple"], emits: ["update:modelValue"],
    template: '<label>{{ label }}<select :aria-label="label" :multiple="multiple" :value="modelValue" @change="$emit(\'update:modelValue\', multiple ? Array.from($event.target.selectedOptions).map(option => option.value) : $event.target.value)"><option v-for="item in items" :key="item.value || item" :value="item.value || item">{{ item.title || item }}</option></select></label>',
  },
  ServiceRepair: true,
} };
async function click(wrapper: VueWrapper, label: string) {
  await wrapper.findAll("button").find(button => button.text() === label)!.trigger("click");
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

describe("mDNS / Discovery", () => {
  it("stages the full shared draft, normalizes filters and retains metadata without a backend write or popup", async () => {
    const store = useControllerStore(), desired = cloneConfig(store.state.data!.desired);
    store.stage(desired); store.draft!.ntp = { enabled: true, servers: ["time.example.com"] };
    const stage = vi.spyOn(store, "stage"), apply = vi.spyOn(store, "apply");
    const confirm = vi.spyOn(window, "confirm"), alert = vi.spyOn(window, "alert");
    const wrapper = mount(MDNSView, { global });
    await wrapper.get('input[aria-label="Enable mDNS"]').setValue(true);
    await wrapper.get('textarea[aria-label="Discovery filters"]').setValue("_IPP._TCP.LOCAL.\nprinter.local.");
    expect(store.editorDirty).toBe(true);
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(stage).toHaveBeenCalledTimes(1); expect(apply).not.toHaveBeenCalled();
    expect(store.draft!.mdns).toMatchObject({ enabled: true, metadata: desired.mdns!.metadata, reflection: { filters: ["_ipp._tcp.local.", "printer.local."] } });
    expect(store.draft!.ntp.servers).toEqual(["time.example.com"]);
    expect(store.state.data!.desired).toEqual(desired); expect(store.editorDirty).toBe(false);
    expect(confirm).not.toHaveBeenCalled(); expect(alert).not.toHaveBeenCalled();
  });
  it("retains input on validation or permission errors and cancel restores shared settings", async () => {
    const store = useControllerStore(), wrapper = mount(MDNSView, { global });
    await wrapper.get('textarea[aria-label="Discovery filters"]').setValue("*.local.");
    await wrapper.get("form").trigger("submit");
    expect(wrapper.text()).toContain("no patterns"); expect(store.draft).toBeNull(); expect(store.editorDirty).toBe(true);
    await wrapper.get('textarea[aria-label="Discovery filters"]').setValue("printer.local.");
    vi.spyOn(store, "stage").mockImplementation(() => { throw new Error("HTTP 403: mdns.write required"); });
    await wrapper.get("form").trigger("submit");
    expect(wrapper.text()).toContain("mdns.write required");
    expect(wrapper.get<HTMLTextAreaElement>('textarea[aria-label="Discovery filters"]').element.value).toBe("printer.local.");
    await click(wrapper, "Cancel edits"); expect(store.editorDirty).toBe(false);
  });
  it("preserves disabled IPv6/publishing preferences and shows global suppression", async () => {
    const store = useControllerStore(); store.state.data!.desired.ipv6_enabled = false;
    store.state.data!.desired.mdns!.publishing = { ...store.state.data!.desired.mdns!.publishing, addresses: true, aaaa_on_ipv4: true };
    const wrapper = mount(MDNSView, { global });
    expect(wrapper.text()).toContain("all local AAAA publishing are suppressed");
    await wrapper.get("form").trigger("submit");
    expect(store.draft!.mdns!.ipv6).toBe(true); expect(store.draft!.mdns!.publishing.aaaa_on_ipv4).toBe(true);
    expect(store.draft!.mdns!.enabled).toBe(false);
  });
  it("separates draft, pending configured and applied membership, preserving exact counters and UTC times", async () => {
    const store = useControllerStore(), pending = transaction();
    pending.candidate = cloneConfig(store.state.data!.desired);
    pending.candidate.mdns!.interfaces = ["lan1"]; pending.candidate.mdns!.reflection.enabled = false;
    store.transactions.data = { [pending.id]: pending };
    const row = mdnsStatus(), original = structuredClone(row);
    store.mdnsStatus.data = { instances: [row], error: "" }; store.mdnsStatus.stale = false;
    const wrapper = mount(MDNSView, { global });
    expect(wrapper.text()).toContain("Pending-confirmation configured membership: lan1");
    expect(wrapper.text()).toContain("Applied membership: lan0, lan1");
    expect(wrapper.text()).toContain("(provisional)");
    expect(wrapper.text()).toContain("9007199254740993"); expect(wrapper.text()).toContain("18446744073709551615");
    expect(wrapper.text()).toContain("2026-10-25 12:00:00"); expect(wrapper.text()).toContain("2026-10-25 12:00:01");
    expect(wrapper.text()).toContain("Started (UTC)"); expect(wrapper.text()).not.toContain(row.started_at);
    expect(wrapper.text()).toContain("Statistics are incomplete"); expect(wrapper.text()).toContain("receive_loss_accounting_unavailable");
    expect(store.mdnsStatus.data.instances[0]).toEqual(original);
  });
  it("keeps status failures local and edits usable, with missing/invalid timestamp indicators", async () => {
    const store = useControllerStore(), row = { ...mdnsStatus(), state: "error" as const, error: "UDP 5353 is owned", started_at: null, collected_at: "invalid" };
    store.mdnsStatus.data = { instances: [row], error: "" }; store.mdnsStatus.error = "HTTP 503: status unavailable";
    const wrapper = mount(MDNSView, { global });
    expect(wrapper.text()).toContain("UDP 5353 is owned"); expect(wrapper.text()).toContain("HTTP 503");
    expect(wrapper.text()).toContain("Unavailable"); expect(wrapper.text()).toContain("Invalid timestamp");
    expect(wrapper.text()).toContain("Stale last-known state");
    expect(wrapper.findAll("button").find(button => button.text() === "Stage settings")!.attributes("disabled")).toBeUndefined();
    await wrapper.get('textarea[aria-label="Description"]').setValue("New note");
    await wrapper.get("form").trigger("submit");
    expect(store.draft!.mdns!.metadata!.description).toBe("New note");
  });
  it("does not overwrite concurrent mDNS changes and cleans dirty state on unmount", async () => {
    const store = useControllerStore(), wrapper = mount(MDNSView, { global });
    await wrapper.get('textarea[aria-label="Description"]').setValue("My note");
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
