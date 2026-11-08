import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ConntrackTuningView from "@/views/ConntrackTuningView.vue";
import { getKernelTunables, getKernelTunablesCatalog } from "@/services/netcontrol";
import { useControllerStore } from "@/stores/controller";
import { cloneConfig } from "@/services/configuration";
import { conntrackCatalog, conntrackSnapshot } from "../conntrackFixtures";
import { state } from "../fixtures";

vi.mock("@/services/netcontrol", async importOriginal => ({
  ...await importOriginal<typeof import("@/services/netcontrol")>(),
  getKernelTunablesCatalog: vi.fn(), getKernelTunables: vi.fn(),
}));
const stubs = {
  VBtn: { props: ["disabled", "type"], template: '<button :disabled="disabled" :type="type || \'button\'"><slot /></button>' },
  VAlert: { template: "<div><slot /></div>" },
  VDivider: true,
  RouterLink: { props: ["to"], template: '<a :href="to"><slot /></a>' },
  VTextField: {
    props: ["modelValue", "id", "ariaLabel", "ariaDescribedby", "disabled", "errorMessages"], emits: ["update:modelValue"],
    template: '<div><input :id="id" :aria-label="ariaLabel" :aria-describedby="ariaDescribedby" :disabled="disabled" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" /><span>{{ errorMessages }}</span></div>',
  },
};
let wrapper: ReturnType<typeof mount> | undefined;
const maxName = "net.netfilter.nf_conntrack_max";
beforeEach(() => {
  setActivePinia(createPinia()); vi.clearAllMocks();
  const store = useControllerStore();
  store.connected = true; store.state.data = state(); store.state.stale = false; store.state.lastSuccess = Date.now();
  store.transactions.data = {}; store.transactions.stale = false;
  vi.mocked(getKernelTunablesCatalog).mockResolvedValue(conntrackCatalog());
  vi.mocked(getKernelTunables).mockResolvedValue(conntrackSnapshot());
});
afterEach(() => { wrapper?.unmount(); wrapper = undefined; useControllerStore().$dispose(); vi.restoreAllMocks(); });
const start = async () => {
  wrapper = mount(ConntrackTuningView, { global: { stubs } }); await flushPromises();
};
const capacity = () => wrapper!.get<HTMLInputElement>('[aria-label="Maximum connections (entries)"]');
const stageButton = () => wrapper!.get('button[type="submit"]');

describe("conntrack settings page", () => {
  it("loads nine catalog-driven controls, explains scopes and distinguishes runtime values without guessed defaults", async () => {
    const sample = conntrackSnapshot();
    sample.configured.host[maxName] = "2048";
    sample.effective.host[maxName] = "3072";
    sample.observed.host[maxName] = "4096";
    sample.captured_original.host[maxName] = "8192";
    vi.mocked(getKernelTunables).mockResolvedValue(sample);
    await start();
    expect(wrapper!.findAll("input")).toHaveLength(9);
    expect(wrapper!.get(".settings-head").text()).toBe("Setting");
    expect(wrapper!.findAll(".setting-row")).toHaveLength(9);
    expect(wrapper!.findAll(".setting-control .setting-field")).toHaveLength(9);
    for (const row of wrapper!.findAll(".setting-row")) {
      expect(row.get(".setting-name").attributes("for")).toBe(row.get("input").attributes("id"));
      expect(row.get("input").attributes("aria-describedby")).toBe(row.get("p.setting-desc").attributes("id"));
      expect(row.get(".setting-field").attributes("variant")).toBeUndefined();
      expect(row.get(".setting-field").attributes("placeholder")).toBe("Unmanaged");
    }
    expect(stageButton().text()).toBe("Save");
    expect(stageButton().attributes("prepend-icon")).toBe("mdi-content-save-outline");
    expect(capacity().element.value).toBe("");
    const values = wrapper!.get(`[data-tunable="${maxName}"]`).findAll("dd").map(value => value.text());
    expect(values).toEqual(["2048", "3072", "4096", "8192"]);
    expect(wrapper!.text()).toContain("kernel.host.write");
    expect(wrapper!.text()).toContain("kernel.namespace.write");
    expect(wrapper!.text()).toContain("Not captured");
    expect(wrapper!.text()).toContain("Unavailable");
    expect(wrapper!.text()).toContain("synthetic");
    expect(wrapper!.text()).toContain("cannot recover expired flows");
    expect(stageButton().attributes("disabled")).toBeDefined();
    expect(useControllerStore().draft).toBeNull();
  });
  it("stages canonical strings in the full shared draft, retaining unrelated keys and configuration without applying", async () => {
    const store = useControllerStore();
    const current = cloneConfig(store.state.data!.desired);
    current.kernel = { host: { "net.core.rmem_max": "65536" }, namespace: { "net.core.somaxconn": "128" }, rps: {} };
    store.state.data = { ...store.state.data!, desired: cloneConfig(current) };
    current.ntp.enabled = true;
    current.ntp.servers = ["192.0.2.1"];
    store.stage(current);
    const apply = vi.spyOn(store, "apply");
    await start();
    await capacity().setValue("2048");
    await wrapper!.get('[aria-label="UDP unreplied timeout (seconds)"]').setValue("30");
    expect(store.editorDirty).toBe(true);
    await wrapper!.get("form").trigger("submit");
    expect(store.draft?.kernel).toEqual({
      host: { "net.core.rmem_max": "65536", [maxName]: "2048" },
      namespace: { "net.core.somaxconn": "128", "net.netfilter.nf_conntrack_udp_timeout": "30" }, rps: {},
    });
    expect(store.draft?.ntp.enabled).toBe(true);
    expect(store.validation).toEqual([]);
    expect(store.editorDirty).toBe(false);
    expect(wrapper!.text()).toContain("changes staged");
    expect(apply).not.toHaveBeenCalled();
  });
  it("clears ownership rather than writing a captured original or zero", async () => {
    const store = useControllerStore(), desired = cloneConfig(store.state.data!.desired);
    desired.kernel = { host: { [maxName]: "2048" }, namespace: {} };
    store.state.data = { ...store.state.data!, desired };
    const sample = conntrackSnapshot(); sample.captured_original.host[maxName] = "8192";
    vi.mocked(getKernelTunables).mockResolvedValue(sample);
    await start();
    expect(capacity().element.value).toBe("2048");
    await capacity().setValue("");
    await wrapper!.get("form").trigger("submit");
    expect(store.draft?.kernel?.host).toEqual({});
    expect(store.validation).toEqual([]);
  });
  it.each(["0", "01", "+2048", "2048 ", "16777217"])("rejects invalid input %s inline without staging", async value => {
    await start(); await capacity().setValue(value);
    expect(stageButton().attributes("disabled")).toBeDefined();
    await wrapper!.get("form").trigger("submit");
    expect(wrapper!.find('[role="alert"]').exists()).toBe(true);
    expect(capacity().element.value).toBe(value);
    expect(useControllerStore().draft).toBeNull();
  });
  it("keeps initial dependent reads neutral, then enables controls on success", async () => {
    let resolve!: (value: ReturnType<typeof conntrackSnapshot>) => void;
    vi.mocked(getKernelTunables).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    wrapper = mount(ConntrackTuningView, { global: { stubs } }); await flushPromises();
    expect(wrapper.text()).toContain("Loading conntrack settings");
    expect(wrapper.text()).not.toContain("does not support");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(stageButton().attributes("disabled")).toBeDefined();
    expect(capacity().attributes("disabled")).toBeDefined();
    resolve(conntrackSnapshot()); await flushPromises();
    expect(wrapper.text()).not.toContain("Loading conntrack settings");
    expect(capacity().attributes("disabled")).toBeUndefined();
  });
  it("shows genuine pending-to-failure errors without an unsupported warning, then recovers", async () => {
    let reject!: (error: Error) => void;
    vi.mocked(getKernelTunablesCatalog).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    wrapper = mount(ConntrackTuningView, { global: { stubs } }); await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    reject(new Error("Missing state.read permission")); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("Missing state.read permission");
    expect(wrapper.text()).not.toContain("does not support");
    expect(stageButton().attributes("disabled")).toBeDefined();
    await wrapper.findAll("button").find(button => button.text() === "Reload settings")!.trigger("click"); await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(capacity().attributes("disabled")).toBeUndefined();
  });
  it("establishes unsupported capability only from a successful catalog read", async () => {
    vi.mocked(getKernelTunablesCatalog).mockResolvedValue([]);
    await start();
    expect(wrapper!.text()).toContain("does not support conntrack tuning");
    expect(wrapper!.findAll("input")).toHaveLength(0);
    expect(stageButton().attributes("disabled")).toBeDefined();
  });
  it("retains typed edits on failed reads and detects conflicting kernel changes", async () => {
    await start(); await capacity().setValue("2048");
    vi.mocked(getKernelTunables).mockRejectedValueOnce(new Error("Procfs unavailable"));
    await wrapper!.findAll("button").find(button => button.text() === "Reload settings")!.trigger("click"); await flushPromises();
    expect(wrapper!.get('[role="alert"]').text()).toContain("Procfs unavailable");
    expect(capacity().element.value).toBe("2048");
    expect(stageButton().attributes("disabled")).toBeDefined();
    const store = useControllerStore(), desired = cloneConfig(store.state.data!.desired);
    desired.kernel = { host: { [maxName]: "4096" }, namespace: {} };
    store.state.data = { ...store.state.data!, desired };
    await flushPromises();
    expect(wrapper!.text()).toContain("Kernel settings changed");
    expect(capacity().element.value).toBe("2048");
    await wrapper!.findAll("button").find(button => button.text() === "Reset edits")!.trigger("click");
    expect(capacity().element.value).toBe("4096");
    expect(store.editorDirty).toBe(false);
  });
  it("blocks stale catalogs, active transactions and stale state while preserving edits", async () => {
    await start(); await capacity().setValue("2048");
    const store = useControllerStore();
    store.state.stale = true; await flushPromises();
    expect(stageButton().attributes("disabled")).toBeDefined();
    expect(wrapper!.text()).toContain("stale");
    store.state.stale = false;
    store.kernelCatalog.stale = true; await flushPromises();
    expect(stageButton().attributes("disabled")).toBeDefined();
    expect(store.supportedKernelCatalog).toEqual([]);
    expect(store.draft).toBeNull();
  });
});
