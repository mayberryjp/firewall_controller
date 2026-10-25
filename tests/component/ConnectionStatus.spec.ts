import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ConnectionStatus from "@/components/layout/ConnectionStatus.vue";
import ConnectionBubble from "@/components/layout/ConnectionBubble.vue";
import ApplyConfigurationDialog from "@/components/feature/ApplyConfigurationDialog.vue";
import SafetyBanner from "@/components/layout/SafetyBanner.vue";
import TransactionActions from "@/components/feature/TransactionActions.vue";
import { useControllerStore } from "@/stores/controller";
import { config, state, transaction } from "../fixtures";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));
const box = { template: "<div><slot /></div>" };
const stubs = {
  VIcon: { template: "<span />" },
  VBtn: { props: ["disabled", "to"], template: '<button :disabled="disabled" :data-to="to"><slot /></button>' },
  VDialog: { props: ["modelValue"], template: '<div v-if="modelValue" role="dialog"><slot /></div>' },
  VCard: box, VCardText: box, VCardActions: box, VAlert: box,
  VMenu: { template: '<div><slot name="activator" :props="{}" /><slot /></div>' },
  VList: box, VListItem: { props: ["title", "disabled"], template: '<button :disabled="disabled">{{ title }}</button>' },
  VCheckbox: {
    props: ["modelValue", "label"], emits: ["update:modelValue"],
    template: '<label>{{ label }}<input type="checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" /></label>',
  },
  VTextField: true, ConfigDiff: true,
};
beforeEach(() => {
  setActivePinia(createPinia()); push.mockReset();
  const store = useControllerStore();
  store.connected = true; store.state.data = state(); store.state.stale = false; store.state.lastSuccess = Date.now();
  store.transactions.data = {}; store.transactions.stale = false;
});
function stageDraft(drop = false, inputDrop = false): void {
  const draft = config(); draft.routes[0]!.metric = 42;
  if (drop) draft.firewall.policy = "drop";
  if (inputDrop) draft.firewall.input = { policy: "drop", interfaces: [] };
  useControllerStore().stage(draft);
}
function status() {
  return mount(ConnectionStatus, { global: { stubs: { ...stubs, ApplyConfigurationDialog: true }, directives: { tooltip: () => {} } } });
}
function saveDialog() {
  return mount(ApplyConfigurationDialog, { props: { modelValue: true }, global: { stubs } });
}
describe("navbar firewall status", () => {
  it("keeps initial and slow discovery off the page", async () => {
    const store = useControllerStore();
    for (const query of [store.state, store.transactions]) {
      query.data = null; query.lastSuccess = null; query.stale = true; query.loading = true;
    }
    const wrapper = mount(SafetyBanner, { global: { stubs } });
    expect(wrapper.find('[aria-label="Global safety state"]').exists()).toBe(false);
    expect(store.canApply).toBe(false);
    store.state.delayed = true; await flushPromises();
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Global safety state"]').exists()).toBe(false);
    expect(wrapper.findComponent({ name: "VAlert" }).exists()).toBe(false);
    expect(wrapper.find("details").exists()).toBe(false);
    store.state.delayed = false; store.state.stale = false; store.transactions.stale = false;
    await flushPromises();
    expect(wrapper.find('[aria-label="Global safety state"]').exists()).toBe(false);
    wrapper.unmount();
  });
  it("moves failed discovery into the connection bubble without weakening write protection", async () => {
    const store = useControllerStore();
    store.state.error = "Observation read failed"; store.state.stale = true;
    store.transactions.error = "Commit discovery failed"; store.transactions.stale = true;
    const refresh = vi.spyOn(store, "refresh").mockResolvedValue();
    const wrapper = mount(SafetyBanner, { global: { stubs } });
    const bubble = mount(ConnectionBubble, { global: { stubs, directives: { tooltip: () => {} } } });
    expect(wrapper.find('[aria-label="Global safety state"]').exists()).toBe(false);
    expect(bubble.get(".connection-bubble").text()).toBe("Read failed");
    expect(bubble.get(".connection-bubble").classes()).toContain("connection-bubble--expanded");
    expect(bubble.text()).toContain("Observation read failed"); expect(bubble.text()).toContain("Commit discovery failed");
    expect(store.canApply).toBe(false);
    await bubble.findAll("button").find(button => button.text() === "Retry")!.trigger("click");
    expect(refresh).toHaveBeenCalledOnce();
    wrapper.unmount(); bubble.unmount();
  });
  it("keeps accessible labels without native titles duplicating the Vuetify tooltips", () => {
    stageDraft();
    const wrapper = status();
    for (const label of ["Committed revision 0", "Save configuration"]) {
      expect(wrapper.get(`[aria-label="${label}"]`).attributes("title")).toBeUndefined();
    }
  });
  it("shows green connection status and revision navigation without a refresh icon", () => {
    const store = useControllerStore(), refresh = vi.spyOn(store, "refresh").mockResolvedValue();
    const wrapper = status();
    expect(wrapper.find('[aria-label="Connected"]').exists()).toBe(false);
    expect(wrapper.get('[aria-label="Committed revision 0"]').attributes("data-to")).toBe("/config");
    expect(wrapper.get('[aria-label="Committed revision 0"]').text()).toBe("Config r0");
    expect(wrapper.find('[aria-label="Refresh firewall state"]').exists()).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
    expect(wrapper.find('[aria-label="Save configuration"]').exists()).toBe(false);
  });
  it("reports unavailable observation separately from a healthy connection", () => {
    useControllerStore().state.error = "Read failed";
    const wrapper = mount(ConnectionBubble, { global: { stubs, directives: { tooltip: () => {} } } });
    expect(wrapper.get('[aria-label="Read failed"]').attributes("color")).toBe("warning");
  });
  it("keeps connection state and disconnect outside the navbar", async () => {
    const tooltip = vi.fn<(element: Element, binding: { value: string }) => void>();
    const wrapper = mount(ConnectionBubble, { global: { stubs, directives: { tooltip } } });
    expect(wrapper.get(".connection-bubble").attributes("aria-label")).toBe("Connected");
    expect(wrapper.get(".connection-bubble").attributes("color")).toBe("success");
    expect(wrapper.get(".connection-bubble").text()).toBe("");
    expect(wrapper.get(".connection-bubble").attributes("icon")).toBe("mdi-lan-connect");
    expect(wrapper.get('.connection-bubble [aria-hidden="true"]').attributes("icon")).toBe("mdi-lan-connect");
    expect(tooltip.mock.calls[0]![1].value).toBe("Connected");
    await wrapper.findAll("button").find(button => button.text() === "Disconnect")!.trigger("click");
    expect(wrapper.emitted("disconnect")).toHaveLength(1);
    const store = useControllerStore();
    store.state.stale = true; await flushPromises();
    expect(wrapper.get(".connection-bubble").attributes("color")).toBe("warning");
    expect(wrapper.get(".connection-bubble").attributes("aria-label")).toBe("Stale");
    store.connected = false; await flushPromises();
    expect(wrapper.get(".connection-bubble").attributes("aria-label")).toBe("Offline");
    expect(wrapper.get(".connection-bubble").attributes("color")).toBe("error");
    expect(wrapper.get(".connection-bubble").attributes("prepend-icon")).toBe("mdi-lan-disconnect");
    expect(wrapper.get(".connection-bubble").text()).toBe("Offline");
    expect(tooltip.mock.calls.at(-1)![1].value).toBe("Offline");
    expect(wrapper.findAll("button").some(button => button.text() === "Disconnect")).toBe(false);
  });
  it("does not trigger monitoring reads from the navbar", () => {
    const store = useControllerStore(); store.monitoring = true; store.gatewayMonitoring = true;
    const refresh = vi.spyOn(store, "refresh").mockResolvedValue();
    const statistics = vi.spyOn(store, "refreshStatistics").mockResolvedValue();
    const gateways = vi.spyOn(store, "refreshGatewayStatistics").mockResolvedValue();
    const wrapper = status();
    expect(wrapper.find('[aria-label="Refresh firewall state"]').exists()).toBe(false);
    expect(refresh).not.toHaveBeenCalled(); expect(statistics).not.toHaveBeenCalled(); expect(gateways).not.toHaveBeenCalled();
  });
  it("routes saving to the single review page without mounting another configuration dialog", async () => {
    stageDraft();
    const apply = vi.spyOn(useControllerStore(), "apply"), wrapper = status();
    expect(wrapper.get('[aria-label="Save configuration"]').text()).toBe("Save");
    expect(wrapper.get('[aria-label="Save configuration"]').attributes("prepend-icon")).toBe("mdi-content-save-outline");
    await wrapper.get('[aria-label="Save configuration"]').trigger("click");
    expect(wrapper.get('[aria-label="Save configuration"]').attributes("data-to")).toBe("/config/changes");
    expect(wrapper.findComponent(ApplyConfigurationDialog).exists()).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });
  it("does not navigate away from unstaged form input through Save", () => {
    stageDraft(); useControllerStore().editorDirty = true;
    expect(status().get('[aria-label="Save configuration"]').attributes("disabled")).toBeDefined();
  });
});
describe("shared save safety", () => {
  it("does not display a separate pending-confirmation banner but retains recovery failures", async () => {
    const store = useControllerStore(), pending = transaction(); store.transactions.data = { [pending.id]: pending };
    store.notice = "Server reports pending_confirmation; only committed is a durable revision.";
    const wrapper = mount(SafetyBanner, { global: { stubs: { ...stubs, JsonPanel: true } } });
    expect(wrapper.findComponent(TransactionActions).exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Server reports pending_confirmation");
    store.transactions.data = { [pending.id]: { ...pending, status: "recovery_failed" } }; await flushPromises();
    expect(wrapper.text()).toContain("Critical: recovery failed"); expect(wrapper.findComponent(TransactionActions).exists()).toBe(true);
    wrapper.unmount();
  });
  it("reads delayed push progress in the open dialog and stops on close", async () => {
    vi.useFakeTimers();
    const store = useControllerStore(), pending = transaction(); stageDraft();
    vi.spyOn(store, "apply").mockResolvedValue({ ...pending, status: "applying" });
    const read = vi.spyOn(store, "readTransaction").mockResolvedValue(pending);
    const wrapper = saveDialog();
    try {
      await wrapper.findAll("button").find(button => button.text() === "Push changes")!.trigger("click"); await flushPromises();
      expect(wrapper.text()).toContain("applying");
      await vi.advanceTimersByTimeAsync(2000); await flushPromises();
      expect(read).toHaveBeenCalledWith(pending.id);
      expect(wrapper.findAll("button").some(button => button.text() === "Confirm changes")).toBe(true);
      await wrapper.findAll("button").find(button => button.text() === "Close")!.trigger("click"); await flushPromises();
      const count = read.mock.calls.length;
      await vi.advanceTimersByTimeAsync(10000); expect(read).toHaveBeenCalledTimes(count);
    } finally { wrapper.unmount(); vi.useRealTimers(); }
  });
  it("shows the same specific blocker as the review page", () => {
    stageDraft(); useControllerStore().state.data!.drift = true;
    const wrapper = saveDialog();
    expect(wrapper.text()).toContain(`Push blocked: ${useControllerStore().applyBlockedReason}`);
    expect(wrapper.text()).toContain("Modeled drift");
  });
  it("pushes and confirms in the same dialog without another popup or connectivity attestation", async () => {
    stageDraft();
    const pending = transaction(), store = useControllerStore();
    const apply = vi.spyOn(store, "apply").mockResolvedValue(pending);
    const confirm = vi.spyOn(store, "lifecycle").mockResolvedValue({ ...pending, status: "committed" });
    const wrapper = saveDialog();
    const action = wrapper.findAll("button").find(button => button.text() === "Push changes")!;
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false);
    expect(apply).not.toHaveBeenCalled();
    expect(action.attributes("disabled")).toBeUndefined();
    await action.trigger("click"); await flushPromises();
    expect(apply).toHaveBeenCalledWith(120, "");
    expect(push).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled();
    expect(wrapper.findAll('[role="dialog"]')).toHaveLength(1);
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false);
    const confirmation = wrapper.findAll("button").find(button => button.text() === "Confirm changes")!;
    await confirmation.trigger("click"); await flushPromises();
    expect(confirm).toHaveBeenCalledWith(pending.id, "confirm");
    expect(wrapper.text()).toContain("Changes confirmed.");
    expect(wrapper.findAll('[role="dialog"]')).toHaveLength(1);
    await wrapper.findAll("button").find(button => button.text() === "Done")!.trigger("click"); await flushPromises();
    expect(push).toHaveBeenCalledWith(`/config/commits/${pending.id}`);
    wrapper.unmount();
  });
  it("does not save over unstaged form input", async () => {
    stageDraft();
    useControllerStore().editorDirty = true;
    const apply = vi.spyOn(useControllerStore(), "apply"), wrapper = saveDialog();
    expect(wrapper.text()).toContain("unstaged form input");
    const action = wrapper.findAll("button").find(button => button.text() === "Push changes")!;
    expect(action.attributes("disabled")).toBeDefined();
    await action.trigger("click");
    expect(apply).not.toHaveBeenCalled();
  });
  it.each(["forwarding", "input"])("does not show a generic warning for %s default-drop settings", async scope => {
    stageDraft(scope === "forwarding", scope === "input");
    const apply = vi.spyOn(useControllerStore(), "apply").mockResolvedValue(transaction());
    const wrapper = saveDialog();
    const action = wrapper.findAll("button").find(button => button.text() === "Push changes")!;
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("These drop rules may block access to the firewall.");
    expect(action.attributes("disabled")).toBeUndefined();
    expect(apply).not.toHaveBeenCalled();
    await action.trigger("click"); await flushPromises();
    expect(apply).toHaveBeenCalledWith(120, "");
  });
});