import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ConnectionStatus from "@/components/layout/ConnectionStatus.vue";
import ApplyConfigurationDialog from "@/components/feature/ApplyConfigurationDialog.vue";
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
function stageDraft(drop = false): void {
  const draft = config(); draft.routes[0]!.metric = 42;
  if (drop) draft.firewall.policy = "drop";
  useControllerStore().stage(draft);
}
function status() {
  return mount(ConnectionStatus, { global: { stubs: { ...stubs, ApplyConfigurationDialog: true }, directives: { tooltip: () => {} } } });
}
function saveDialog() {
  return mount(ApplyConfigurationDialog, { props: { modelValue: true }, global: { stubs } });
}
describe("navbar firewall status", () => {
  it("shows green connection status, revision navigation, and a working refresh icon", async () => {
    const store = useControllerStore(), refresh = vi.spyOn(store, "refresh").mockResolvedValue();
    const wrapper = status();
    expect(wrapper.get('[aria-label="Connected"]').attributes("color")).toBe("success");
    expect(wrapper.get('[aria-label="Committed revision 0"]').attributes("data-to")).toBe("/history/0");
    await wrapper.get('[aria-label="Refresh firewall state"]').trigger("click");
    expect(refresh).toHaveBeenCalledOnce();
    expect(wrapper.find('[aria-label="Save configuration"]').exists()).toBe(false);
  });
  it("reports unavailable observation separately from a healthy connection", () => {
    useControllerStore().state.error = "Read failed";
    expect(status().get('[aria-label="Observation unavailable"]').attributes("color")).toBe("warning");
  });
  it("refreshes monitored counters and gateway samples when explicitly requested", async () => {
    const store = useControllerStore(); store.monitoring = true; store.gatewayMonitoring = true;
    const refresh = vi.spyOn(store, "refresh").mockResolvedValue();
    const statistics = vi.spyOn(store, "refreshStatistics").mockResolvedValue();
    const gateways = vi.spyOn(store, "refreshGatewayStatistics").mockResolvedValue();
    const wrapper = status();
    await wrapper.get('[aria-label="Refresh firewall state"]').trigger("click"); await flushPromises();
    expect(refresh).toHaveBeenCalledOnce(); expect(statistics).toHaveBeenCalledOnce(); expect(gateways).toHaveBeenCalledOnce();
  });
  it("opens save review for a changed draft without immediately applying it", async () => {
    stageDraft();
    const apply = vi.spyOn(useControllerStore(), "apply"), wrapper = status();
    await wrapper.get('[aria-label="Save configuration"]').trigger("click");
    expect(wrapper.getComponent(ApplyConfigurationDialog).props("modelValue")).toBe(true);
    expect(apply).not.toHaveBeenCalled();
  });
});
describe("navbar save safety", () => {
  it("requires review acknowledgement before applying and navigates to the transaction", async () => {
    stageDraft();
    const pending = transaction(), apply = vi.spyOn(useControllerStore(), "apply").mockResolvedValue(pending);
    const wrapper = saveDialog();
    const action = wrapper.findAll("button").find(button => button.text() === "Apply provisionally")!;
    expect(action.attributes("disabled")).toBeDefined();
    await wrapper.get('input[type="checkbox"]').setValue(true);
    expect(action.attributes("disabled")).toBeUndefined();
    await action.trigger("click"); await flushPromises();
    expect(apply).toHaveBeenCalledWith(120, "");
    expect(push).toHaveBeenCalledWith(`/transactions/${pending.id}`);
  });
  it("does not save over unstaged form input", async () => {
    stageDraft();
    useControllerStore().editorDirty = true;
    const apply = vi.spyOn(useControllerStore(), "apply"), wrapper = saveDialog();
    await wrapper.get('input[type="checkbox"]').setValue(true);
    expect(wrapper.text()).toContain("unstaged form input");
    const action = wrapper.findAll("button").find(button => button.text() === "Apply provisionally")!;
    expect(action.attributes("disabled")).toBeDefined();
    await action.trigger("click");
    expect(apply).not.toHaveBeenCalled();
  });
  it("requires a separate acknowledgement for default-drop changes", async () => {
    stageDraft(true);
    const wrapper = saveDialog(), checkboxes = wrapper.findAll('input[type="checkbox"]');
    const action = wrapper.findAll("button").find(button => button.text() === "Apply provisionally")!;
    await checkboxes[0]!.setValue(true);
    expect(action.attributes("disabled")).toBeDefined();
    await checkboxes[1]!.setValue(true);
    expect(action.attributes("disabled")).toBeUndefined();
  });
});