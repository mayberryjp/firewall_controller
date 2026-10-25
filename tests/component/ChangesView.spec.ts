import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ChangesView from "@/views/ChangesView.vue";
import ConfigDiff from "@/components/feature/ConfigDiff.vue";
import ApplyConfigurationDialog from "@/components/feature/ApplyConfigurationDialog.vue";
import { useControllerStore } from "@/stores/controller";
import * as api from "@/services/netcontrol";
import { cloneConfig } from "@/services/configuration";
import { config, runtime, state, transaction } from "../fixtures";

vi.mock("@/services/netcontrol", () => ({
  getState: vi.fn(), getRuntime: vi.fn(), getTransactions: vi.fn(),
}));
beforeEach(() => {
  setActivePinia(createPinia()); vi.resetAllMocks();
  vi.mocked(api.getState).mockResolvedValue(state());
  vi.mocked(api.getRuntime).mockResolvedValue(runtime());
  vi.mocked(api.getTransactions).mockResolvedValue({});
  const store = useControllerStore();
  store.connected = true; store.state.data = state(); store.state.stale = false;
  store.state.lastSuccess = Date.now();
  store.transactions.data = {}; store.transactions.stale = false;
  const draft = config(); draft.routes[0]!.metric = 42; store.stage(draft);
});
function review() {
  return mount(ChangesView, { global: { stubs: {
    VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
    VDialog: true, VAlert: { template: "<div><slot /></div>" }, VTextarea: true,
    VBtnToggle: { name: "VBtnToggle", props: ["modelValue"], template: "<div><slot /></div>" },
    ConfigDiff: true, ApplyConfigurationDialog: true, RouterLink: true,
  } } });
}
function button(wrapper: ReturnType<typeof review>, text: string) {
  return wrapper.findAll("button").find(item => item.text() === text || item.attributes("aria-label") === text)!;
}
describe("commit and push checks", () => {
  it("checks aged reads on commit and push without discarding or submitting the draft", async () => {
    const store = useControllerStore();
    store.state.lastSuccess = Date.now() - 20_001;
    const draft = cloneConfig(store.draft!), baseline = cloneConfig(store.baseline!);
    const wrapper = review();
    expect(wrapper.get('[role="status"]').text()).toContain("checked before pushing");
    expect(button(wrapper, "Commit & push").attributes("disabled")).toBeUndefined();
    expect(wrapper.find('[aria-label="Refresh state"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Export draft config"]').exists()).toBe(false);
    expect(wrapper.find('input[type="file"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Import configuration");
    await button(wrapper, "Commit & push").trigger("click"); await flushPromises();
    expect(api.getState).toHaveBeenCalledOnce();
    expect(api.getTransactions).toHaveBeenCalledOnce();
    expect(wrapper.findComponent(ApplyConfigurationDialog).props("modelValue")).toBe(true);
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(store.draft).toEqual(draft); expect(store.baseline).toEqual(baseline);
    expect(store.baseRevision).toBe("0"); expect(store.submitted).toBeNull();
  });
  it.each(["state", "transactions"] as const)("reports a failed %s refresh instead of enabling apply", async dataset => {
    const store = useControllerStore(), wrapper = review();
    vi.mocked(dataset === "state" ? api.getState : api.getTransactions).mockRejectedValue(new Error("Backend observation failed"));
    await button(wrapper, "Commit & push").trigger("click"); await flushPromises();
    expect(wrapper.get('[role="status"]').text()).toContain("Backend observation failed");
    expect(wrapper.findComponent(ApplyConfigurationDialog).props("modelValue")).toBe(false);
    expect(store.draft?.routes[0]?.metric).toBe(42);
  });
  it("keeps drift blocked after a successful refresh and explains that refresh cannot repair it", async () => {
    vi.mocked(api.getState).mockResolvedValue({ ...state(), drift: true });
    const wrapper = review();
    await button(wrapper, "Commit & push").trigger("click"); await flushPromises();
    expect(wrapper.get('[role="status"]').text()).toContain("Modeled drift");
    expect(wrapper.get('[role="status"]').text()).toContain("refreshing does not repair drift");
    expect(wrapper.findComponent(ApplyConfigurationDialog).props("modelValue")).toBe(false);
  });
  it("identifies the active transaction instead of recommending a refresh as a repair", () => {
    const pending = transaction();
    useControllerStore().transactions.data = { [pending.id]: pending };
    const wrapper = review();
    expect(wrapper.get('[role="status"]').text()).toContain(`${pending.id} (${pending.status})`);
    expect(wrapper.findComponent(ApplyConfigurationDialog).props("modelValue")).toBe(false);
  });
  it("retains the old base and requires explicit comparison/restart after a revision change", async () => {
    const latest = { ...state(), revision: "1" }; latest.desired.interfaces[0]!.mtu = 1400;
    vi.mocked(api.getState).mockResolvedValue(latest);
    const wrapper = review();
    await button(wrapper, "Commit & push").trigger("click"); await flushPromises();
    expect(wrapper.get('[role="status"]').text()).toContain("Draft base revision 0 differs from committed revision 1");
    expect(wrapper.findComponent(ApplyConfigurationDialog).props("modelValue")).toBe(false);
    expect(useControllerStore().baseRevision).toBe("0");
    expect(useControllerStore().draft?.routes[0]?.metric).toBe(42);
    expect(wrapper.findAllComponents(ConfigDiff)).toHaveLength(1);
    expect(wrapper.findComponent(ConfigDiff).props("before")).toEqual(useControllerStore().baseline);
    wrapper.findComponent({ name: "VBtnToggle" }).vm.$emit("update:modelValue", "latest"); await flushPromises();
    expect(wrapper.findAllComponents(ConfigDiff)).toHaveLength(1);
    expect(wrapper.findComponent(ConfigDiff).props("before")).toEqual(latest.desired);
  });
});

describe("unified configuration diff", () => {
  function diff(before = config(), after = config()) {
    return mount(ConfigDiff, { props: { before, after }, global: { stubs: { VAlert: true, ApplianceWarnings: true } } });
  }
  it("shows changed lines immediately with context and old/new line numbers", () => {
    const before = config(), after = config(); after.interfaces[0]!.mtu = 1400;
    const wrapper = diff(before, after);
    expect(wrapper.findAll(".diff-file")).toHaveLength(1);
    expect(wrapper.get(".deletion .line-code").text()).toContain('"mtu": 1500');
    expect(wrapper.get(".addition .line-code").text()).toContain('"mtu": 1400');
    expect(wrapper.get(".deletion .line-sign").text()).toBe("-");
    expect(wrapper.get(".addition .line-sign").text()).toBe("+");
    const removedNumbers = wrapper.get(".deletion").findAll(".line-number").map(cell => cell.text());
    const addedNumbers = wrapper.get(".addition").findAll(".line-number").map(cell => cell.text());
    expect(removedNumbers[0]).not.toBe(""); expect(removedNumbers[1]).toBe("");
    expect(addedNumbers[0]).toBe(""); expect(addedNumbers[1]).toBe(removedNumbers[0]);
    expect(wrapper.findAll(".context").length).toBeGreaterThan(0);
    expect(wrapper.find("v-expansion-panels").exists()).toBe(false);
    expect(wrapper.find("details table").exists()).toBe(false);
  });
  it("renders complete additions and deletions without inventing null config lines", () => {
    const before = config(), after = config();
    after.interfaces = []; after.routes = [];
    const removed = diff(before, after);
    expect(removed.findAll(".deletion").length).toBeGreaterThan(0);
    expect(removed.findAll(".line-code").some(line => line.text() === "null")).toBe(false);
    const added = diff(after, before);
    expect(added.findAll(".addition").length).toBeGreaterThan(0);
    expect(added.findAll(".line-code").some(line => line.text() === "null")).toBe(false);
  });
  it("shows an empty state for semantically unchanged configuration", () => {
    const wrapper = diff();
    expect(wrapper.text()).toContain("No semantic changes."); expect(wrapper.find("table").exists()).toBe(false);
  });
});
