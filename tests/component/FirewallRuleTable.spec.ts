import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FirewallRuleTable from "@/components/feature/FirewallRuleTable.vue";
import FieldInput from "@/components/base/FieldInput.vue";
import { useControllerStore } from "@/stores/controller";
import { cloneConfig } from "@/services/configuration";
import { hostPolicyConfig, state } from "../fixtures";
import { dragRule } from "../dragRule";

const stubs = {
  VTable: { template: "<table><slot /></table>" },
  VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
  VAlert: { template: '<div role="alert"><slot /></div>' },
  VIcon: true, VChip: { template: "<span><slot /></span>" },
  VTextField: { props: ["modelValue", "label", "disabled"], emits: ["update:modelValue"], template: '<input :aria-label="label" :disabled="disabled" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />' },
  VSelect: {
    props: ["modelValue", "label", "items", "disabled"], emits: ["update:modelValue"],
    template: '<select :aria-label="label" :disabled="disabled" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="item in items" :key="item.value" :value="item.value">{{ item.title }}</option></select>',
  },
};
let wrapper: ReturnType<typeof mount>;
beforeEach(() => {
  setActivePinia(createPinia());
  const store = useControllerStore(), desired = hostPolicyConfig();
  desired.firewall.policies!.hosts[2]!.addresses.push("2001:db8::30");
  desired.firewall.input = { policy: "drop", interfaces: [{ interface: "lab0", rules: [
    { destination: "192.0.2.0/24", action: "accept", metadata: { display_name: "Local", description: "Keep me" } },
    { action: "drop" },
  ] }] };
  store.connected = true; store.state.data = { ...state(), desired };
});
afterEach(() => { wrapper?.unmount(); useControllerStore().$dispose(); vi.restoreAllMocks(); });
function render(scope: "host" | "interface" | "input", owner = scope === "host" ? "desk" : "lab0"): void {
  wrapper = mount(FirewallRuleTable, { props: { scope, owner }, global: { stubs } });
}
async function click(label: string): Promise<void> {
  await wrapper.get(`button[aria-label="${label}"]`).trigger("click");
}
async function change(key: string, value: unknown): Promise<void> {
  wrapper.findAllComponents(FieldInput).find(field => field.props("field").key === key)!.vm.$emit("update:modelValue", value);
  await flushPromises();
}
function entries(scope: "host" | "interface" | "input") {
  const firewall = useControllerStore().draft!.firewall;
  return scope === "host" ? firewall.policies!.hosts[0]!.rules : scope === "interface" ? firewall.policies!.interfaces[0]!.rules : firewall.input!.interfaces[0]!.rules;
}

describe("Inline firewall rules", () => {
  it.each(["host", "interface", "input"] as const)("colors %s trash icons red", scope => {
    render(scope);
    const icons = wrapper.findAll('v-icon-stub[icon="mdi-delete"]');
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) expect(icon.attributes("color")).toBe("error");
  });
  it.each([
    ["host", "icmp"], ["host", "icmpv6"], ["interface", "icmp"], ["interface", "icmpv6"], ["input", "icmp"], ["input", "icmpv6"],
  ] as const)("stages %s %s rules with cleared disabled ports and inline precedence guidance", async (scope, protocol) => {
    const store = useControllerStore();
    store.state.data!.desired.firewall.policies!.hosts[0]!.addresses.push("2001:db8::20");
    render(scope);
    await wrapper.findAll("button").find(button => button.text() === "Add rule")!.trigger("click");
    await change("protocol", "tcp"); await change("ports", "443, 8443");
    await change("protocol", protocol); await change("action", "drop");
    const fields = wrapper.findAllComponents(FieldInput);
    expect(fields.find(field => field.props("field").key === "protocol")!.props("field").choices!.map(choice => choice.title)).toEqual(["Any", "TCP", "UDP", "ICMP", "ICMPv6"]);
    expect(fields.find(field => field.props("field").key === "ports")!.props("field").disabled).toBe(true);
    expect(fields.find(field => field.props("field").key === "ports")!.props("modelValue")).toBe("");
    expect(wrapper.get(".rule-editor").text()).toContain(protocol === "icmp" ? "global IPv4 ICMP exception" : "neighbor discovery");
    await wrapper.get("form").trigger("submit");
    expect(entries(scope).at(-1)).toEqual({ origin: "manual", import_source: null, protocol, action: "drop" });
    expect(wrapper.find(".rule-editor").exists()).toBe(false);
    expect(wrapper.findAll(".host-rule").at(scope === "host" ? -2 : -1)!.text()).toContain(protocol === "icmp" ? "ICMP" : "ICMPv6");
  });
  it.each(["host", "interface", "input"] as const)("displays and preserves imported ownership when editing %s rules", async scope => {
    const store = useControllerStore(), firewall = store.state.data!.desired.firewall;
    const rules = scope === "host" ? firewall.policies!.hosts[0]!.rules : scope === "interface" ? firewall.policies!.interfaces[0]!.rules : firewall.input!.interfaces[0]!.rules;
    Object.assign(rules[0]!, { origin: "import", import_source: "other_provider" });
    render(scope);
    expect(wrapper.findAll(".host-rule .rule-origin")[0]!.text()).toBe("Import: other_provider");
    await click("Edit rule 1"); await change("action", "drop"); await wrapper.get("form").trigger("submit");
    expect(entries(scope)[0]).toMatchObject({ origin: "import", import_source: "other_provider", action: "drop" });
    expect(rules[0]!.origin).toBe("import");
  });
  it.each(["host", "interface"] as const)("labels %s egress choices without changing staged interface names", async scope => {
    const store = useControllerStore();
    store.state.data!.desired.interfaces[0]!.metadata = { display_name: "LAN", description: "Internal network notes" };
    render(scope);
    await wrapper.findAll("button").find(button => button.text() === "Add rule")!.trigger("click");
    const select = wrapper.findAllComponents(FieldInput).find(field => field.props("field").key === "out_interface")!.get("select");
    expect(select.findAll("option").map(option => [option.text(), option.attributes("value")]))
      .toEqual([["Any", ""], ["lab0 (LAN)", "lab0"]]);
    store.draft = cloneConfig(store.state.data!.desired);
    store.draft.interfaces[0]!.metadata!.display_name = "Office";
    await flushPromises();
    expect(select.findAll("option")[1]!.text()).toBe("lab0 (Office)");
    await select.setValue("lab0");
    await wrapper.get("form").trigger("submit");
    expect(entries(scope).at(-1)).toEqual({ origin: "manual", import_source: null, out_interface: "lab0", action: "accept" });
  });

  it.each(["host", "interface", "input"] as const)("creates, edits and deletes %s rules only in the shared draft", async scope => {
    const store = useControllerStore(), before = cloneConfig(store.state.data!.desired);
    render(scope);
    const original = scope === "host" ? before.firewall.policies!.hosts[0]!.rules : scope === "interface" ? before.firewall.policies!.interfaces[0]!.rules : before.firewall.input!.interfaces[0]!.rules;
    await wrapper.findAll("button").find(button => button.text() === "Add rule")!.trigger("click");
    expect(wrapper.find(".rule-editor").exists()).toBe(true);
    expect(wrapper.find("dialog").exists()).toBe(false);
    await change("destination", "198.51.100.0/24");
    await change("protocol", "tcp"); await change("ports", "443, 8443"); await change("action", "drop");
    expect(store.editorDirty).toBe(true);
    await wrapper.get("form").trigger("submit");
    expect(entries(scope).at(-1)).toEqual({ origin: "manual", import_source: null, destination: "198.51.100.0/24", protocol: "tcp", destination_ports: [443, 8443], action: "drop" });
    expect(entries(scope)).toHaveLength(original.length + 1);
    expect(store.editorDirty).toBe(false);
    await click(`Edit rule ${original.length + 1}`);
    await change("action", "accept"); await wrapper.get("form").trigger("submit");
    expect(entries(scope).at(-1)!.action).toBe("accept");
    await click(`Delete rule ${original.length + 1}`);
    expect(entries(scope)).toEqual(original);
    expect(cloneConfig(store.state.data!.desired)).toEqual(before);
    expect(store.draft!.routes).toEqual(before.routes);
    expect(store.draft!.firewall.nat).toEqual(before.firewall.nat);
    if (scope === "input") expect(store.draft!.firewall.policies).toEqual(before.firewall.policies);
    else expect(store.draft!.firewall.input).toEqual(before.firewall.input);
  });

  it.each(["host", "interface", "input"] as const)("drags %s rules in evaluation order without arrow buttons", async scope => {
    const store = useControllerStore();
    store.state.data!.desired.firewall.policies!.interfaces[0]!.rules.push({ action: "accept" });
    render(scope);
    const before = cloneConfig(store.state.data!.desired), firewall = before.firewall;
    const original = scope === "host" ? firewall.policies!.hosts[0]!.rules : scope === "interface" ? firewall.policies!.interfaces[0]!.rules : firewall.input!.interfaces[0]!.rules;
    const handle = wrapper.get('[aria-label="Drag rule 1"]');
    const originalPoint = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
    Object.defineProperty(handle.element, "setPointerCapture", { value: vi.fn(), configurable: true });
    Object.defineProperty(document, "elementFromPoint", { value: () => wrapper.get('[data-rule-index="1"]').element, configurable: true });
    try {
      await handle.trigger("pointerdown", { pointerType: "mouse", pointerId: 1, button: 0 });
      await handle.trigger("pointermove", { pointerType: "mouse", clientX: 10, clientY: 10 });
      await handle.trigger("pointerup", { pointerType: "mouse", pointerId: 1 });
    } finally {
      if (originalPoint) Object.defineProperty(document, "elementFromPoint", originalPoint);
      else Reflect.deleteProperty(document, "elementFromPoint");
    }
    expect(entries(scope).slice(0, 2)).toEqual([original[1], original[0]]);
    expect(wrapper.find('button[aria-label^="Move rule"]').exists()).toBe(false);
    await dragRule(wrapper.get('[aria-label="Drag rule 2"]'), wrapper.get('[data-rule-index="0"]').element);
    expect(entries(scope)).toEqual(original);
    if (scope === "host") {
      expect(wrapper.findAll(".host-rule").at(-1)!.classes()).toContain("host-rule--default");
      expect(wrapper.findAll(".drag-handle")).toHaveLength(original.length);
    }
  });

  it("supports touch dragging within the current table", async () => {
    render("input");
    const handle = wrapper.get('[aria-label="Drag rule 1"]');
    const target = wrapper.get('[data-rule-index="1"]').element;
    Object.defineProperty(handle.element, "setPointerCapture", { value: vi.fn(), configurable: true });
    const original = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
    Object.defineProperty(document, "elementFromPoint", { value: vi.fn(() => target), configurable: true });
    try {
      await handle.trigger("pointerdown", { pointerType: "touch", pointerId: 1, button: 0 });
      await handle.trigger("pointermove", { pointerType: "touch", clientX: 10, clientY: 10 });
      await handle.trigger("pointerup", { pointerType: "touch", pointerId: 1 });
    } finally {
      if (original) Object.defineProperty(document, "elementFromPoint", original);
      else Reflect.deleteProperty(document, "elementFromPoint");
    }
    expect(entries("input").map(rule => rule.action)).toEqual(["drop", "accept"]);
  });

  it("edits host default action without moving or deleting the final default rule", async () => {
    render("host");
    await click("Edit default action"); await change("action", "accept");
    await wrapper.get("form").trigger("submit");
    expect(useControllerStore().draft!.firewall.policies!.hosts[0]!.policy).toBe("accept");
    expect(entries("host")).toHaveLength(3);
    expect(wrapper.get(".host-rule--default").text()).toContain("Default");
    expect(wrapper.get(".system-rule--default").text()).toContain("Global");
  });

  it("cancels dragging without a draft and refuses to reorder a refreshed group", async () => {
    const store = useControllerStore();
    render("input");
    const handle = wrapper.get('[aria-label="Drag rule 1"]');
    Object.defineProperty(handle.element, "setPointerCapture", { value: vi.fn(), configurable: true });
    await handle.trigger("pointerdown", { pointerType: "mouse", pointerId: 1, button: 0 });
    await handle.trigger("pointercancel", { pointerType: "mouse", pointerId: 1 });
    await handle.trigger("pointerup", { pointerType: "mouse", pointerId: 1 });
    expect(store.draft).toBeNull();
    await handle.trigger("pointerdown", { pointerType: "mouse", pointerId: 1, button: 0 });
    store.state.data!.desired.firewall.input!.interfaces[0]!.rules.reverse();
    await handle.trigger("pointerup", { pointerType: "mouse", pointerId: 1 });
    expect(store.draft).toBeNull();
    expect(wrapper.text()).toContain("changed while dragging");
  });

  it("preserves annotations on edit and cancels without staging", async () => {
    render("input");
    await click("Edit rule 1"); await change("action", "drop");
    await wrapper.get("form").trigger("submit");
    expect(entries("input")[0]!.metadata).toEqual({ display_name: "Local", description: "Keep me" });
    const before = cloneConfig(useControllerStore().draft!);
    await click("Edit rule 1"); await change("action", "accept");
    await wrapper.findAll("button").find(button => button.text() === "Cancel")!.trigger("click");
    expect(cloneConfig(useControllerStore().draft!)).toEqual(before);
    expect(useControllerStore().editorDirty).toBe(false);
  });

  it.each(["abc", "0", "65536", "443, 443", "1.5"])("rejects invalid destination ports %s inline", async ports => {
    render("input"); await click("Edit rule 1");
    await change("protocol", "tcp"); await change("ports", ports);
    await wrapper.get("form").trigger("submit");
    expect(useControllerStore().draft).toBeNull();
    expect(wrapper.get('[role="alert"]').text()).not.toBe("");
    expect(useControllerStore().editorDirty).toBe(true);
  });

  it("requires TCP or UDP when ports are specified", async () => {
    render("input"); await click("Edit rule 1"); await change("ports", "443");
    await wrapper.get("form").trigger("submit");
    expect(wrapper.text()).toContain("Destination ports require TCP or UDP");
    expect(useControllerStore().draft).toBeNull();
  });

  it("creates an ingress group when adding its first rule and rejects unmanaged interfaces", async () => {
    const store = useControllerStore();
    store.state.data!.desired.firewall.input!.interfaces = [];
    render("input");
    await wrapper.findAll("button").find(button => button.text() === "Add rule")!.trigger("click");
    await wrapper.get("form").trigger("submit");
    expect(entries("input")).toEqual([{ origin: "manual", import_source: null, action: "accept" }]);
    wrapper.unmount(); store.discardDraft();
    render("input", "missing0");
    await wrapper.findAll("button").find(button => button.text() === "Add rule")!.trigger("click");
    await wrapper.get("form").trigger("submit");
    expect(store.draft).toBeNull();
    expect(wrapper.text()).toContain("unique managed ingress interface");
  });

  it("does not overwrite rules changed during an inline edit", async () => {
    const store = useControllerStore();
    render("host"); await click("Edit rule 1"); await change("action", "drop");
    store.state.data!.desired.firewall.policies!.hosts[0]!.rules.reverse();
    await wrapper.get("form").trigger("submit");
    expect(store.draft).toBeNull(); expect(wrapper.text()).toContain("changed while editing");
  });

  it("disables all mutations when writes are frozen, including an already-open form", async () => {
    const store = useControllerStore();
    render("input"); await click("Edit rule 1"); await change("action", "drop");
    store.busy = true; await flushPromises();
    await wrapper.get("form").trigger("submit");
    expect(store.draft).toBeNull(); expect(wrapper.text()).toContain("frozen");
    expect(wrapper.findAll("input, select").every(field => field.attributes("disabled") !== undefined)).toBe(true);
  });
});
