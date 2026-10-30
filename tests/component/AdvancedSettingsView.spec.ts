import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdvancedSettingsView from "@/views/AdvancedSettingsView.vue";
import { useControllerStore } from "@/stores/controller";
import { state, transaction } from "../fixtures";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));
const stubs = {
  VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
  VDialog: { name: "VDialog", props: ["modelValue"], emits: ["update:modelValue"], template: '<div v-if="modelValue" role="dialog"><slot /></div>' },
  VCard: { template: "<div><slot /></div>" },
  VCardTitle: { template: "<h2><slot /></h2>" },
  VCardText: { template: "<div><slot /></div>" },
  VCardActions: { template: "<div><slot /></div>" },
  VAlert: { template: '<div role="alert"><slot /></div>' },
  VCheckbox: {
    props: ["modelValue", "disabled"], emits: ["update:modelValue"],
    template: '<input type="checkbox" :checked="modelValue" :disabled="disabled" @change="$emit(\'update:modelValue\', $event.target.checked)">',
  },
  RouterLink: { template: "<a><slot /></a>" },
};

beforeEach(() => {
  setActivePinia(createPinia()); push.mockReset();
  const store = useControllerStore();
  store.connected = true;
  store.state.data = state(); store.state.stale = false; store.state.lastSuccess = Date.now();
  store.transactions.data = {}; store.transactions.stale = false;
  vi.spyOn(store, "deleteFirewallHostsAndRules").mockResolvedValue(transaction());
});
afterEach(() => { useControllerStore().$dispose(); vi.restoreAllMocks(); });

describe("Advanced settings combined deletion", () => {
  it("keeps the bulk deletion trash icon red rather than white on a filled button", () => {
    const wrapper = mount(AdvancedSettingsView, { global: { stubs } });
    const button = wrapper.get('button[prepend-icon="mdi-delete-forever"]');
    expect(button.attributes("color")).toBe("error");
    expect(button.attributes("variant")).toBe("tonal");
  });
  it.each(["state", "transactions"] as const)("keeps deletion disabled without a warning while initial %s loads", async key => {
    const store = useControllerStore(), query = store[key];
    query.data = null; query.lastSuccess = null; query.stale = true; query.loading = true;
    const wrapper = mount(AdvancedSettingsView, { global: { stubs } });
    try {
      expect(wrapper.get("button").attributes("disabled")).toBeDefined();
      expect(wrapper.find("#advanced-blocked").exists()).toBe(false);
      expect(wrapper.get("button").attributes("aria-describedby")).toBeUndefined();
      expect(store.firewallDeletionBlockedReason).toBeTruthy();
      if (key === "state") store.state.data = state();
      else store.transactions.data = {};
      query.lastSuccess = Date.now(); query.stale = false; query.loading = false;
      await flushPromises();
      expect(wrapper.get("button").attributes("disabled")).toBeUndefined();
      expect(wrapper.find("#advanced-blocked").exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });
  it.each(["state", "transactions"] as const)("retains real initial %s errors, including during retries", async key => {
    const store = useControllerStore(), query = store[key];
    query.data = null; query.lastSuccess = null; query.stale = true; query.loading = true;
    const wrapper = mount(AdvancedSettingsView, { global: { stubs } });
    try {
      query.error = "Permission denied"; query.loading = false; await flushPromises();
      expect(wrapper.get("#advanced-blocked").text()).toContain("unavailable");
      expect(wrapper.get("button").attributes("disabled")).toBeDefined();
      query.loading = true; await flushPromises();
      expect(wrapper.get("#advanced-blocked").text()).toContain("unavailable");
    } finally { wrapper.unmount(); }
  });
  it("does not suppress stale previously loaded transaction state", () => {
    const store = useControllerStore();
    store.transactions.stale = true; store.transactions.lastSuccess = Date.now();
    const wrapper = mount(AdvancedSettingsView, { global: { stubs } });
    try {
      expect(wrapper.get("#advanced-blocked").text()).toContain("unavailable");
      expect(wrapper.get("button").attributes("disabled")).toBeDefined();
    } finally { wrapper.unmount(); }
  });
  it("previews the exact removed and preserved scope without an API write", async () => {
    const wrapper = mount(AdvancedSettingsView, { global: { stubs } });
    try {
      expect(wrapper.findAll("button").map(button => button.text())).toEqual(["Delete all firewall hosts and forwarding rules"]);
      await wrapper.get("button").trigger("click");
      const dialog = wrapper.get('[role="dialog"]');
      expect(dialog.text()).toContain("All legacy and interface forwarding rules");
      expect(dialog.text()).toContain("NAT, management input rules");
      expect(dialog.text()).toContain("Keeping a Drop default can stop forwarding");
      expect(dialog.text()).toContain("can broaden access");
      expect(dialog.text()).toContain("does not guarantee remote connectivity");
      expect(dialog.text()).toContain("120 seconds");
      expect(dialog.get(".confirm-delete").attributes("disabled")).toBeDefined();
      expect(useControllerStore().deleteFirewallHostsAndRules).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); }
  });
  it("requires acknowledgement and opens the ordinary transaction detail after provisional apply", async () => {
    const wrapper = mount(AdvancedSettingsView, { global: { stubs } });
    try {
      await wrapper.get("button").trigger("click");
      await wrapper.get('input[type="checkbox"]').setValue(true);
      expect(wrapper.get(".confirm-delete").attributes("disabled")).toBeUndefined();
      await wrapper.get(".confirm-delete").trigger("click"); await flushPromises();
      expect(useControllerStore().deleteFirewallHostsAndRules).toHaveBeenCalledExactlyOnceWith(
        state().revision, 120, "Clear reviewed firewall hosts and forwarding rules",
      );
      expect(push).toHaveBeenCalledExactlyOnceWith({ name: "transaction-detail", params: { id: "tx-test" } });
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });
  it("clears acknowledgement when cancelling and reopening", async () => {
    const wrapper = mount(AdvancedSettingsView, { global: { stubs } });
    try {
      await wrapper.get("button").trigger("click");
      await wrapper.get('input[type="checkbox"]').setValue(true);
      await wrapper.findAll("button").find(button => button.text() === "Cancel")!.trigger("click");
      await wrapper.get("button").trigger("click");
      expect(wrapper.get(".confirm-delete").attributes("disabled")).toBeDefined();
      expect(useControllerStore().deleteFirewallHostsAndRules).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); }
  });
  it("blocks deletion while there are local changes", () => {
    const store = useControllerStore(); store.editorDirty = true;
    const wrapper = mount(AdvancedSettingsView, { global: { stubs } });
    try {
      expect(wrapper.get("button").attributes("disabled")).toBeDefined();
      expect(wrapper.text()).toContain("Save or discard local changes");
    } finally { wrapper.unmount(); }
  });
  it("shows failed submissions inline without claiming success or navigating", async () => {
    vi.mocked(useControllerStore().deleteFirewallHostsAndRules).mockRejectedValue(new Error("Missing firewall.write permission"));
    const wrapper = mount(AdvancedSettingsView, { global: { stubs } });
    try {
      await wrapper.get("button").trigger("click");
      await wrapper.get('input[type="checkbox"]').setValue(true);
      await wrapper.get(".confirm-delete").trigger("click"); await flushPromises();
      expect(wrapper.get('[role="dialog"]').text()).toContain("Missing firewall.write permission");
      expect(push).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); }
  });
  it("locks acknowledgement and cancellation throughout preflight and submission", async () => {
    let finish!: (value: ReturnType<typeof transaction>) => void;
    vi.mocked(useControllerStore().deleteFirewallHostsAndRules).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const wrapper = mount(AdvancedSettingsView, { global: { stubs } });
    try {
      await wrapper.get("button").trigger("click");
      await wrapper.get('input[type="checkbox"]').setValue(true);
      await wrapper.get(".confirm-delete").trigger("click");
      expect(wrapper.get(".confirm-delete").attributes("disabled")).toBeDefined();
      expect(wrapper.get('input[type="checkbox"]').attributes("disabled")).toBeDefined();
      expect(wrapper.findAll("button").find(button => button.text() === "Cancel")!.attributes("disabled")).toBeDefined();
      finish(transaction()); await flushPromises();
    } finally { wrapper.unmount(); }
  });
});
