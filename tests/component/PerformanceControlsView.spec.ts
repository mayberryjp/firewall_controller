import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PerformanceControlsView from "@/views/PerformanceControlsView.vue";
import { useControllerStore } from "@/stores/controller";
import * as api from "@/services/netcontrol";
import { ApiFailure } from "@/services/api";
import { cloneConfig } from "@/services/configuration";
import { interfaceCapabilitySnapshot, rpsDiagnostics, wireguardInterface, wireguardRpsDiagnostics } from "../diagnosticsFixtures";
import type { RpsDiagnostics } from "@/services/rps";
import { nicOffloadFeatures } from "@/services/tuning";
import { state, transaction } from "../fixtures";

const stubs = {
  VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
  VAlert: { template: "<div><slot /></div>" }, VTable: { template: "<table><slot /></table>" },
  VSwitch: { inheritAttrs: false, props: ["modelValue", "disabled", "label"], emits: ["update:modelValue"],
    template: '<label><input v-bind="$attrs" type="checkbox" :checked="modelValue" :disabled="disabled" @change="$emit(\'update:modelValue\', $event.target.checked)">{{ label }}</label>' },
  VTextField: { inheritAttrs: false, props: ["modelValue", "disabled", "errorMessages"], emits: ["update:modelValue"],
    template: '<div><input v-bind="$attrs" :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)"><span>{{ errorMessages }}</span></div>' },
  VSelect: { inheritAttrs: false, props: ["modelValue", "items", "disabled", "errorMessages"], emits: ["update:modelValue"],
    template: '<div><select v-bind="$attrs" :value="modelValue ?? \'\'" :disabled="disabled" @change="$emit(\'update:modelValue\', typeof items[0] === \'number\' ? Number($event.target.value) : $event.target.value)"><option value="">Select</option><option v-for="item in items" :key="typeof item === \'object\' ? item.value : item" :value="typeof item === \'object\' ? item.value : item" :disabled="typeof item === \'object\' && item.props?.disabled">{{ typeof item === \'object\' ? item.title : item }}</option></select><span>{{ errorMessages }}</span></div>' },
  RouterLink: { template: "<span><slot /></span>" },
  VChip: { template: "<span><slot /></span>" },
};
const render = (mode: "rps" | "offloads" = "rps") => mount(PerformanceControlsView, { props: { mode }, global: { stubs } });
const toggle = '[aria-label="Enable RPS for eno1/rx-0"]', mask = '[aria-label="CPU mask for eno1/rx-0"]';
const count = '[aria-label="CPU count for eno1/rx-0"]', advanced = '[aria-label="RPS Advanced CPU Mask"]';
beforeEach(() => {
  setActivePinia(createPinia());
  const store = useControllerStore(), saved = state();
  saved.desired.interfaces.push({ ...saved.desired.interfaces[0]!, name: "eno1", kind: "ethernet", role: "wan", addresses: [] });
  store.connected = true; store.state.data = saved; store.state.stale = false; store.state.lastSuccess = Date.now();
  vi.spyOn(api, "getRpsDiagnostics").mockResolvedValue(rpsDiagnostics());
  vi.spyOn(api, "getInterfaceCapabilities").mockResolvedValue(interfaceCapabilitySnapshot());
  vi.spyOn(api, "refreshInterfaceCapabilities").mockResolvedValue(interfaceCapabilitySnapshot());
  vi.spyOn(api, "submitPackage");
  vi.spyOn(window, "confirm").mockReturnValue(false);
});
afterEach(() => { vi.restoreAllMocks(); });

describe("reviewed and staged RPS controls", () => {
  it.each(["rps", "offloads"] as const)("shows performance refresh and introductory guidance only on offloads (%s)", async mode => {
    const wrapper = render(mode);
    await flushPromises();
    expect(wrapper.findAll("button").some(button => button.text() === "Refresh performance state")).toBe(mode === "offloads");
    expect(wrapper.text().includes("Changes apply only through SAVE. RSS, XPS and XDP remain read-only.")).toBe(mode === "offloads");
    expect(api.getRpsDiagnostics).toHaveBeenCalledTimes(1);
  });

  it("requires an explicit whole-number CPU count, reviews selected CPUs and stages without a popup or network write", async () => {
    const store = useControllerStore(), original = JSON.stringify(store.state.data!.desired), wrapper = render();
    await flushPromises();
    expect(wrapper.get("h4").text()).toBe("RPS Advanced CPU Mask");
    expect(wrapper.get("#rps-advanced-mask-description").text()).toBe("to pin specific interfaces to specific CPUs");
    expect(wrapper.get(advanced).attributes("aria-describedby")).toBe("rps-advanced-mask-description");
    expect(wrapper.text()).not.toContain("Counts use the lowest-numbered online CPUs");
    expect(wrapper.get('button[type="submit"]').text()).toBe("STAGE CHANGES");
    expect(wrapper.findAll("thead th").map(header => header.text())).toEqual(["Queue", "Enable RPS", "CPU count"]);
    expect(wrapper.findAll("tbody tr").every(row => row.findAll("td").length === 2)).toBe(true);
    expect(wrapper.find('[aria-label^="Restore original RPS"]').exists()).toBe(false);
    expect(wrapper.get<HTMLInputElement>(toggle).element.checked).toBe(false);
    expect(wrapper.text()).toContain("Unmanaged");
    await wrapper.get(toggle).setValue(true);
    expect(wrapper.find(mask).exists()).toBe(false);
    expect(wrapper.get<HTMLSelectElement>(count).element.value).toBe("");
    expect(wrapper.findAll(`${count} option`).map(option => option.attributes("value"))).toEqual(["", "0", "1", "2", "3", "4"]);
    expect(wrapper.text()).toContain("Choose how many CPUs");
    await wrapper.get(count).setValue("2");
    expect(wrapper.text()).toContain("Selected CPUs: 0, 1");
    expect(store.editorDirty).toBe(true);
    expect(store.draft).toBeNull();
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(api.getRpsDiagnostics).toHaveBeenCalledTimes(2);
    expect(store.draft?.kernel?.rps).toEqual({ "eno1/rx-0": "3" });
    expect(store.draft?.kernel?.namespace).toEqual(store.state.data!.desired.kernel!.namespace);
    expect(JSON.stringify(store.state.data!.desired)).toBe(original);
    expect(store.editorDirty).toBe(false);
    expect(wrapper.text()).toContain("Performance changes staged");
    expect(window.confirm).not.toHaveBeenCalled();
    expect(api.submitPackage).not.toHaveBeenCalled();
    expect(api.getInterfaceCapabilities).not.toHaveBeenCalled();
    expect(wrapper.find('[aria-label="NIC offload configuration"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Manage RFS tables"]').exists()).toBe(false);
  });

  it("stages explicit disable while preserving unrelated RPS settings", async () => {
    const store = useControllerStore(), data = rpsDiagnostics();
    store.state.data!.desired.kernel!.rps = { "eno1/rx-0": "c", "eno1/rx-1": "1" };
    data.configured_rps = { ...store.state.data!.desired.kernel!.rps };
    vi.mocked(api.getRpsDiagnostics).mockResolvedValue(data);
    const wrapper = render(); await flushPromises();
    await wrapper.get(toggle).setValue(false);
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(store.draft?.kernel?.rps).toEqual({ "eno1/rx-0": "0", "eno1/rx-1": "1" });
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("preserves existing non-prefix masks when switching views or staging another feature", async () => {
    const store = useControllerStore(), data = rpsDiagnostics();
    store.state.data!.desired.kernel!.rps = { "eno1/rx-0": "c" };
    data.configured_rps = { "eno1/rx-0": "c" };
    data.interfaces![0]!.rx_queues!.push({ name: "rx-1", rps_cpus: "0" });
    vi.mocked(api.getRpsDiagnostics).mockResolvedValue(data);
    const wrapper = render(); await flushPromises();
    expect(wrapper.get<HTMLSelectElement>(count).element.value).toBe("2");
    expect(wrapper.text()).toContain("Selected CPUs: 2, 3");
    await wrapper.get(advanced).setValue(true);
    expect(wrapper.get<HTMLInputElement>(mask).element.value).toBe("c");
    await wrapper.get(advanced).setValue(false);
    expect(store.editorDirty).toBe(false);
    await wrapper.get('[aria-label="Enable RPS for eno1/rx-1"]').setValue(true);
    await wrapper.get('[aria-label="CPU count for eno1/rx-1"]').setValue("2");
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(store.draft?.kernel?.rps).toEqual({ "eno1/rx-0": "c", "eno1/rx-1": "3" });
    await wrapper.get(count).setValue("2");
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(store.draft?.kernel?.rps).toEqual({ "eno1/rx-0": "3", "eno1/rx-1": "3" });
  });

  it("supports advanced cross-word masks and whole-number selections on sparse online CPUs", async () => {
    const data = rpsDiagnostics(); data.sections.online_cpus.data = [32, 2, 0];
    vi.mocked(api.getRpsDiagnostics).mockResolvedValue(data);
    const wrapper = render(); await flushPromises();
    const chips = wrapper.get('[role="list"][aria-label="Online CPUs"]').findAll('[role="listitem"]');
    expect(chips.map(chip => chip.text())).toEqual(["CPU 0", "CPU 2", "CPU 32"]);
    expect(chips.every(chip => chip.attributes("prepend-icon") === "mdi-chip")).toBe(true);
    expect(wrapper.findAll(`${count} option`).map(option => option.attributes("value"))).toEqual(["", "0", "1", "2", "3"]);
    await wrapper.get(toggle).setValue(true);
    await wrapper.get(advanced).setValue(true);
    await wrapper.get(mask).setValue("1,00000004");
    await wrapper.get(advanced).setValue(false);
    expect(wrapper.get<HTMLSelectElement>(count).element.value).toBe("2");
    expect(wrapper.text()).toContain("Selected CPUs: 2, 32");
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(useControllerStore().draft?.kernel?.rps).toEqual({ "eno1/rx-0": "1,00000004" });
    await wrapper.get(count).setValue("3");
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(useControllerStore().draft?.kernel?.rps).toEqual({ "eno1/rx-0": "1,00000005" });
  });

  it("treats a zero CPU count as explicit disable rather than restore-original", async () => {
    const wrapper = render(); await flushPromises();
    await wrapper.get(toggle).setValue(true); await wrapper.get(count).setValue("0");
    expect(wrapper.get<HTMLInputElement>(toggle).element.checked).toBe(false);
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(useControllerStore().draft?.kernel?.rps).toEqual({ "eno1/rx-0": "0" });
  });

  it("shows all reported CPUs as read-only chips without changing tuning", async () => {
    const data = rpsDiagnostics();
    data.sections.online_cpus.data = Array.from({ length: 64 }, (_, cpu) => cpu);
    vi.mocked(api.getRpsDiagnostics).mockResolvedValue(data);
    const wrapper = render(); await flushPromises();
    const list = wrapper.get('[role="list"][aria-label="Online CPUs"]');
    const chips = list.findAll('[role="listitem"]');
    expect(chips).toHaveLength(64);
    expect(chips[0]!.text()).toBe("CPU 0");
    expect(chips[63]!.text()).toBe("CPU 63");
    expect(list.find("button, input, select").exists()).toBe(false);
    expect(useControllerStore().editorDirty).toBe(false);
    expect(useControllerStore().draft).toBeNull();
    expect(api.submitPackage).not.toHaveBeenCalled();
  });

  it.each(["0", "A", "00", "0x1", "10"])("blocks enabled mask %s without applying anything", async value => {
    const wrapper = render(); await flushPromises();
    await wrapper.get(advanced).setValue(true);
    await wrapper.get(toggle).setValue(true); await wrapper.get(mask).setValue(value);
    const stage = wrapper.findAll("button").find(button => button.text() === "STAGE CHANGES")!;
    expect(stage.attributes("disabled")).toBeDefined();
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(useControllerStore().draft).toBeNull();
    expect(wrapper.text()).toMatch(/canonical|selected CPU|not online/);
  });

  it("rechecks CPUs before staging and preserves input if a CPU goes offline", async () => {
    const changed = rpsDiagnostics(); changed.sections.online_cpus.data = [0, 1, 2];
    vi.mocked(api.getRpsDiagnostics).mockResolvedValueOnce(rpsDiagnostics()).mockResolvedValue(changed);
    const wrapper = render(); await flushPromises();
    await wrapper.get(toggle).setValue(true); await wrapper.get(count).setValue("4");
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(useControllerStore().draft).toBeNull();
    expect(wrapper.text()).toContain("CPUs not online: 3");
    expect(wrapper.findAll(`${count} option`).map(option => option.attributes("value"))).toEqual(["", "0", "1", "2", "3"]);
    await wrapper.get(advanced).setValue(true);
    expect(wrapper.get<HTMLInputElement>(mask).element.value).toBe("f");
    expect(wrapper.get(mask).attributes("disabled")).toBeUndefined();
  });

  it.each(["ownership", "simulator", "identity", "cpu-unavailable", "revision", "provisional", "applied-mismatch"] as const)("blocks staging for known %s prerequisites without pretending unknowns are available", async condition => {
    const data = rpsDiagnostics();
    if (condition === "ownership") data.tuning_available = false;
    if (condition === "simulator") data.sample.scope = "simulator";
    if (condition === "identity") data.sample.identity_stable = false;
    if (condition === "cpu-unavailable") data.sections.online_cpus = { status: "unavailable", data: null, error: "CPU probe failed" };
    if (condition === "revision") data.config_revision = "2026.10.29.2";
    if (condition === "provisional") data.transaction_id = "pending";
    if (condition === "applied-mismatch") data.configured_rps = { "eno1/rx-0": "c" };
    vi.mocked(api.getRpsDiagnostics).mockResolvedValue(data);
    const wrapper = render(); await flushPromises();
    if (condition === "simulator") expect(wrapper.find(toggle).exists()).toBe(false);
    else expect(wrapper.get(toggle).attributes("disabled")).toBeDefined();
    expect(useControllerStore().draft).toBeNull();
    expect(api.submitPackage).not.toHaveBeenCalled();
  });

  it("does not offer software, unmanaged or errored physical queues for tuning", async () => {
    const data = rpsDiagnostics();
    data.interfaces!.push({ ...data.interfaces![0]!, name: "virtual", physical: false });
    data.interfaces![0]!.errors = ["Queue read failed"];
    vi.mocked(api.getRpsDiagnostics).mockResolvedValue(data);
    const wrapper = render(); await flushPromises();
    expect(wrapper.find(toggle).exists()).toBe(false);
    expect(wrapper.text()).toContain("No managed Ethernet or WireGuard RX queues");
  });

  describe("WireGuard RPS", () => {
    const wgToggle = '[aria-label="Enable RPS for wg0/rx-0"]', wgCount = '[aria-label="CPU count for wg0/rx-0"]';
    function prepare() {
      const store = useControllerStore(), data = wireguardRpsDiagnostics();
      store.state.data!.desired.interfaces.push(wireguardInterface());
      vi.mocked(api.getRpsDiagnostics).mockResolvedValue(data);
      return { store, data };
    }
    it("uses live WireGuard queues without NIC inventory or RFS evidence, while keeping physical-only controls separate", async () => {
      const { store, data } = prepare();
      data.rfs = { status: "unavailable", sock_flow_entries: null, error: "RFS read failed" };
      const wrapper = render(); await flushPromises();
      expect(wrapper.get<HTMLInputElement>(wgToggle).element.checked).toBe(false);
      expect(wrapper.find('[aria-label="New WireGuard interface"]').exists()).toBe(false);
      await wrapper.get(wgToggle).setValue(true);
      expect(wrapper.get<HTMLSelectElement>(wgCount).element.value).toBe("");
      await wrapper.get(wgCount).setValue("2");
      await wrapper.get("form").trigger("submit"); await flushPromises();
      expect(store.draft?.kernel?.rps).toEqual({ "wg0/rx-0": "3" });
      expect(store.draft?.kernel?.rfs).toBeUndefined();
      expect(wrapper.find('[aria-label="Manage RFS for wg0/rx-0"]').exists()).toBe(false);
      expect(wrapper.find('[aria-label="Desired rx-checksum for wg0"]').exists()).toBe(false);
      expect(wrapper.text()).not.toContain("post-decryption RX processing, not crypto workers");
      expect(api.submitPackage).not.toHaveBeenCalled();
      expect(window.confirm).not.toHaveBeenCalled();
    });
    it("does not offer RFS configuration alongside WireGuard RPS", async () => {
      prepare();
      const wrapper = render(); await flushPromises();
      expect(wrapper.find('[aria-label="Manage RFS tables"]').exists()).toBe(false);
      expect(wrapper.find('[aria-label="RFS queue settings"]').exists()).toBe(false);
    });
    it("explicitly disables WireGuard RPS and preserves unseen queues and physical masks", async () => {
      const { store, data } = prepare();
      const settings = { "wg0/rx-0": "c", "wg0/rx-1": "2", "eno1/rx-1": "1" };
      store.state.data!.desired.kernel!.rps = settings; data.configured_rps = settings;
      const wrapper = render(); await flushPromises();
      await wrapper.get(wgToggle).setValue(false);
      await wrapper.get("form").trigger("submit"); await flushPromises();
      expect(store.draft?.kernel?.rps).toEqual({ ...settings, "wg0/rx-0": "0" });
    });
    it.each(["missing", "unmanaged", "error"] as const)("does not invent support for an existing WireGuard queue with %s evidence", async condition => {
      const { data } = prepare(), link = data.interfaces!.at(-1)!;
      if (condition === "missing") link.rx_queues = null;
      if (condition === "unmanaged") link.managed = false;
      if (condition === "error") { data.sample.status = "partial"; link.errors = ["WireGuard queue read failed"]; }
      const wrapper = render(); await flushPromises();
      expect(wrapper.find(wgToggle).exists()).toBe(false);
      expect(wrapper.find('[aria-label="New WireGuard interface"]').exists()).toBe(false);
      if (condition === "error") expect(wrapper.text()).toContain("WG0: WireGuard queue read failed");
    });
    it("allows explicit unverified queues for newly staged tunnels without guessing a queue or CPU mask", async () => {
      const store = useControllerStore(), candidate = cloneConfig(store.state.data!.desired);
      candidate.interfaces.push(wireguardInterface());
      store.stage(candidate);
      const wrapper = render(); await flushPromises();
      expect(wrapper.find(wgToggle).exists()).toBe(false);
      await wrapper.get('[aria-label="New WireGuard interface"]').setValue("wg0");
      await wrapper.get('[aria-label="New WireGuard RX queue"]').setValue("rx-00");
      const add = () => wrapper.findAll("button").find(button => button.text() === "Add WireGuard queue")!;
      await add().trigger("click");
      expect(wrapper.text()).toContain("canonical index");
      await wrapper.get('[aria-label="New WireGuard RX queue"]').setValue("rx-0");
      await add().trigger("click");
      expect(wrapper.text()).toContain("Queue support unverified until apply");
      expect(wrapper.get<HTMLInputElement>(wgToggle).element.checked).toBe(false);
      await wrapper.get(wgToggle).setValue(true);
      expect(wrapper.get<HTMLSelectElement>(wgCount).element.value).toBe("");
      await wrapper.get(wgCount).setValue("2");
      await wrapper.get("form").trigger("submit"); await flushPromises();
      expect(store.draft?.interfaces.find(link => link.name === "wg0")?.kind).toBe("wireguard");
      expect(store.draft?.kernel?.rps).toEqual({ "wg0/rx-0": "3" });
      expect(store.state.data!.desired.interfaces.some(link => link.name === "wg0")).toBe(false);
      expect(api.submitPackage).not.toHaveBeenCalled();
    });
    it.each(["queue", "cpu", "permission", "revision"] as const)("rechecks WireGuard %s prerequisites before staging and retains input on failure", async condition => {
      const { store, data } = prepare(), changed = structuredClone(data);
      if (condition === "queue") changed.interfaces!.at(-1)!.rx_queues = null;
      if (condition === "cpu") changed.sections.online_cpus.data = [0];
      if (condition === "revision") changed.config_revision = "2026.10.29.2";
      const read = vi.mocked(api.getRpsDiagnostics).mockResolvedValueOnce(data);
      if (condition === "permission") read.mockRejectedValue(new ApiFailure("HTTP 403: state.read required", 403));
      else read.mockResolvedValue(changed);
      const wrapper = render(); await flushPromises();
      await wrapper.get(wgToggle).setValue(true); await wrapper.get(wgCount).setValue("2");
      await wrapper.get("form").trigger("submit"); await flushPromises();
      expect(store.draft).toBeNull();
      if (condition === "cpu") {
        await wrapper.get(advanced).setValue(true);
        expect(wrapper.get<HTMLInputElement>('[aria-label="CPU mask for wg0/rx-0"]').element.value).toBe("3");
      } else expect(wrapper.get<HTMLSelectElement>(wgCount).element.value).toBe("2");
      expect(wrapper.text()).toMatch(/no longer|not online|HTTP 403|Configuration changed/);
      expect(api.submitPackage).not.toHaveBeenCalled();
    });
  });

  it("does not warn while pending, then shows a real failure without enabling controls or retrying", async () => {
    let reject!: (error: Error) => void;
    vi.mocked(api.getRpsDiagnostics).mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
    const wrapper = render();
    expect(wrapper.text()).toContain("Reading performance prerequisites");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("require native");
    reject(new ApiFailure("HTTP 403: state.read required", 403)); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("HTTP 403");
    expect(api.getRpsDiagnostics).toHaveBeenCalledTimes(1);
    expect(wrapper.find(toggle).exists()).toBe(false);
  });

  it("retains stale observations and local input after a failed read without allowing staging", async () => {
    vi.mocked(api.getRpsDiagnostics).mockResolvedValueOnce(rpsDiagnostics()).mockRejectedValue(new ApiFailure("HTTP 503: Probe failed", 503));
    const wrapper = render(); await flushPromises();
    await wrapper.get(toggle).setValue(true); await wrapper.get(count).setValue("2");
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("observations are stale");
    expect(wrapper.get(count).attributes("disabled")).toBeDefined();
    expect(wrapper.get<HTMLSelectElement>(count).element.value).toBe("2");
    expect(useControllerStore().draft).toBeNull();
  });

  it("clears forms on session change and ignores obsolete responses; aborts on unmount", async () => {
    let resolve!: (value: RpsDiagnostics) => void;
    vi.mocked(api.getRpsDiagnostics).mockReturnValueOnce(new Promise(done => { resolve = done; })).mockResolvedValue(rpsDiagnostics());
    const wrapper = render(), store = useControllerStore();
    const previous = vi.mocked(api.getRpsDiagnostics).mock.calls[0]![0]!;
    store.sessionVersion++; await flushPromises();
    expect(previous.aborted).toBe(true);
    const old = rpsDiagnostics(); old.tuning_available = false;
    resolve(old); await flushPromises();
    expect(wrapper.find(toggle).exists()).toBe(true);
    await wrapper.get(toggle).setValue(true); await wrapper.get(count).setValue("2");
    store.connected = false; await flushPromises();
    expect(wrapper.find(toggle).exists()).toBe(false);
    expect(store.editorDirty).toBe(false);
    wrapper.unmount();
  });

  it("disables edits while a configuration transaction is pending", async () => {
    const pending = transaction("pending_confirmation");
    useControllerStore().submitted = { id: pending.id, config: pending.candidate };
    const wrapper = render(); await flushPromises();
    expect(wrapper.get(toggle).attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("frozen");
  });

  it("keeps controls visible without host ownership and checks ownership again on revisit", async () => {
    const disabled = rpsDiagnostics(); disabled.tuning_available = false;
    vi.mocked(api.getRpsDiagnostics).mockResolvedValueOnce(disabled).mockResolvedValue(rpsDiagnostics());
    const wrapper = render(); await flushPromises();
    expect(wrapper.get(toggle).attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("does not hold exclusive host-tuning ownership");
    expect(wrapper.text()).not.toContain("--allow-host-tunables");
    expect(wrapper.text()).not.toContain("startup permission");
    wrapper.unmount();
    const revisited = render(); await flushPromises();
    expect(revisited.get(toggle).attributes("disabled")).toBeUndefined();
    expect(revisited.get<HTMLInputElement>(toggle).element.checked).toBe(false);
    expect(revisited.text()).not.toContain("--allow-host-tunables");
    expect(api.submitPackage).not.toHaveBeenCalled();
  });

  it("explains RPS using the capabilities guidance style without displaying its measurement timestamp", async () => {
    const store = useControllerStore();
    store.state.data!.desired.system = { hostname: "", domain: "", timezone: "Asia/Kolkata" };
    const wrapper = render(); await flushPromises();
    expect(wrapper.get("p.text-medium-emphasis").text()).toBe("Receive Packet Steering (RPS) distributes incoming packet processing across selected CPUs.");
    expect(wrapper.text()).not.toContain("Measured");
    expect(wrapper.find("time").exists()).toBe(false);
    store.draft = { ...store.state.data!.desired, system: { hostname: "", domain: "", timezone: "America/Los_Angeles" } };
    await flushPromises();
    expect(wrapper.find("time").exists()).toBe(false);
  });
  it("does not display a measurement timestamp or missing-time placeholder on RPS configuration", async () => {
    const data = rpsDiagnostics(); data.sample.collected_at = null;
    vi.mocked(api.getRpsDiagnostics).mockResolvedValue(data);
    const wrapper = render(); await flushPromises();
    expect(wrapper.text()).not.toContain("Measured");
    expect(wrapper.text()).not.toContain("Unavailable");
    expect(wrapper.find("time").exists()).toBe(false);
  });

  it("stages offloads and disable-only LRO without showing RPS or RFS editors", async () => {
    const snapshot = interfaceCapabilitySnapshot();
    snapshot.inventory.interfaces[0]!.capabilities.find(feature => feature.name === "ethtool:rx-lro")!.enabled = true;
    vi.mocked(api.getInterfaceCapabilities).mockResolvedValue(snapshot);
    const store = useControllerStore(), original = JSON.stringify(store.state.data!.desired), wrapper = render("offloads");
    await flushPromises();
    expect(wrapper.find(toggle).exists()).toBe(false);
    expect(wrapper.find('[aria-label="Manage RFS tables"]').exists()).toBe(false);
    await wrapper.get('[aria-label="Desired rx-checksum for eno1"]').setValue("disabled");
    const lro = wrapper.get<HTMLSelectElement>('[aria-label="Desired rx-lro for eno1"]');
    expect(lro.element.value).toBe("enabled");
    expect(lro.get('option[value="enabled"]').attributes("disabled")).toBeDefined();
    await wrapper.get('[aria-label="Desired rx-lro for eno1"]').setValue("disabled");
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(store.draft?.kernel).toMatchObject({
      offloads: { eno1: { "rx-checksum": false, "rx-lro": false } },
    });
    expect(JSON.stringify(store.state.data!.desired)).toBe(original);
    expect(store.editorDirty).toBe(false);
    expect(api.submitPackage).not.toHaveBeenCalled();
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it.each(["rps", "offloads"] as const)("preserves saved RFS and unrelated tuning when editing %s", async mode => {
    const store = useControllerStore(), data = rpsDiagnostics(), kernel = store.state.data!.desired.kernel!;
    kernel.rps = { "eno1/rx-0": "c", "eno1/rx-1": "1" };
    kernel.rfs = { sock_flow_entries: 4096, queues: { "eno1/rx-0": 1024, "eno1/rx-1": 1024 } };
    kernel.offloads = { eno1: { "rx-checksum": true } };
    data.configured_rps = { ...kernel.rps }; data.configured_rfs = kernel.rfs; data.configured_offloads = kernel.offloads;
    vi.mocked(api.getRpsDiagnostics).mockResolvedValue(data);
    const wrapper = render(mode); await flushPromises();
    expect(wrapper.find('[aria-label="Manage RFS tables"]').exists()).toBe(false);
    if (mode === "rps") await wrapper.get(count).setValue("3");
    else await wrapper.get('[aria-label="Desired rx-checksum for eno1"]').setValue("disabled");
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(store.draft?.kernel?.rfs).toEqual(kernel.rfs);
    if (mode === "rps") expect(store.draft?.kernel?.offloads).toEqual(kernel.offloads);
    else expect(store.draft?.kernel?.rps).toEqual(kernel.rps);
  });

  it("changes managed offloads between enabled and disabled without releasing unrelated settings", async () => {
    const store = useControllerStore(), data = rpsDiagnostics();
    store.state.data!.desired.kernel!.offloads = { eno1: { "rx-checksum": true, "rx-gro": true } };
    data.configured_offloads = store.state.data!.desired.kernel!.offloads;
    vi.mocked(api.getRpsDiagnostics).mockResolvedValue(data);
    const wrapper = render("offloads"); await flushPromises();
    await wrapper.get('[aria-label="Desired rx-checksum for eno1"]').setValue("disabled");
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(store.draft?.kernel?.offloads).toEqual({ eno1: { "rx-checksum": false, "rx-gro": true } });
    expect(wrapper.find('option[value="unmanaged"]').exists()).toBe(false);
    await wrapper.get('[aria-label="Desired rx-checksum for eno1"]').setValue("enabled");
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(store.draft?.kernel?.offloads).toEqual({ eno1: { "rx-checksum": true, "rx-gro": true } });
  });

  it("shows all reported settings for one interface without inventing missing settings or losing edits", async () => {
    const store = useControllerStore(), data = rpsDiagnostics(), snapshot = interfaceCapabilitySnapshot();
    for (const [offset, name] of ["eno2", "eno3"].entries()) {
      store.state.data!.desired.interfaces.push({ ...store.state.data!.desired.interfaces.at(-1)!, name });
      data.interfaces!.push({ ...data.interfaces![0]!, name, index: 4 + offset });
      snapshot.inventory.interfaces.push({
        ...snapshot.inventory.interfaces[0]!, name, index: 4 + offset,
        capabilities: name === "eno2" ? [{
          name: "ethtool:rx-gro", support: "supported", enabled: false, evidence: [], reason: null,
        }] : [],
      });
    }
    vi.mocked(api.getRpsDiagnostics).mockResolvedValue(data);
    vi.mocked(api.getInterfaceCapabilities).mockResolvedValue(snapshot);
    const wrapper = render("offloads"); await flushPromises();
    expect(wrapper.find("table").exists()).toBe(false);
    expect(wrapper.findAll(".setting-row")).toHaveLength(2);
    expect(wrapper.text()).toContain("Receive checksums");
    await wrapper.get('[aria-label="Desired rx-checksum for eno1"]').setValue("disabled");
    await wrapper.get('[aria-label="Offload interface"]').setValue("eno2");
    expect(wrapper.findAll(".setting-row")).toHaveLength(1);
    expect(wrapper.get('[aria-label="Desired rx-gro for eno2"]').attributes("disabled")).toBeUndefined();
    expect(wrapper.find('[aria-label="Desired rx-checksum for eno1"]').exists()).toBe(false);
    await wrapper.get('[aria-label="Desired rx-gro for eno2"]').setValue("enabled");
    await wrapper.get('[aria-label="Offload interface"]').setValue("eno3");
    expect(wrapper.text()).toContain("No configurable offloads were reported for ENO3");
    expect(wrapper.findAll(".setting-row")).toHaveLength(0);
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(store.draft?.kernel?.offloads).toEqual({ eno1: { "rx-checksum": false }, eno2: { "rx-gro": true } });
    expect(api.refreshInterfaceCapabilities).not.toHaveBeenCalled();
  });

  it("preserves both pages' staged changes and saved RFS when switching editor modes", async () => {
    const store = useControllerStore(), data = rpsDiagnostics(), kernel = store.state.data!.desired.kernel!;
    kernel.rps = { "eno1/rx-1": "1" };
    kernel.rfs = { sock_flow_entries: 4096, queues: { "eno1/rx-1": 1024 } };
    data.configured_rps = kernel.rps; data.configured_rfs = kernel.rfs;
    vi.mocked(api.getRpsDiagnostics).mockResolvedValue(data);
    const wrapper = render(); await flushPromises();
    await wrapper.get(toggle).setValue(true); await wrapper.get(count).setValue("2");
    await wrapper.get("form").trigger("submit"); await flushPromises();
    await wrapper.setProps({ mode: "offloads" }); await flushPromises();
    expect(wrapper.find(toggle).exists()).toBe(false);
    await wrapper.get('[aria-label="Desired rx-checksum for eno1"]').setValue("disabled");
    await wrapper.get("form").trigger("submit"); await flushPromises();
    await wrapper.setProps({ mode: "rps" }); await flushPromises();
    expect(wrapper.find('[aria-label="NIC offload configuration"]').exists()).toBe(false);
    expect(wrapper.get<HTMLSelectElement>(count).element.value).toBe("2");
    await wrapper.get(count).setValue("3");
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(store.draft?.kernel).toMatchObject({
      rps: { "eno1/rx-0": "7", "eno1/rx-1": "1" },
      rfs: kernel.rfs, offloads: { eno1: { "rx-checksum": false } },
    });
    expect(store.state.data!.desired.kernel).toEqual(kernel);
    expect(api.submitPackage).not.toHaveBeenCalled();
    expect(window.confirm).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("shows reported state in the dropdown and preserves edits when status is refreshed", async () => {
    const store = useControllerStore();
    store.state.data!.desired.system = { hostname: "", domain: "", timezone: "Asia/Kolkata" };
    const wrapper = render("offloads"); await flushPromises();
    expect(wrapper.find('[aria-label="Offload category"]').exists()).toBe(false);
    expect(wrapper.findAll("button").some(button => ["Status", "Configuration"].includes(button.text()))).toBe(false);
    const select = wrapper.get<HTMLSelectElement>('[aria-label="Desired rx-checksum for eno1"]');
    expect(select.element.value).toBe("enabled");
    expect(select.findAll("option").slice(1).map(option => option.text())).toEqual(["Enabled", "Disabled"]);
    expect(wrapper.find(".offload-status").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Cached:");
    expect(wrapper.text()).not.toContain("Original");
    expect(store.editorDirty).toBe(false);
    await select.setValue("disabled");
    expect(wrapper.findAll("button").some(button => button.text() === "STAGE CHANGES")).toBe(true);
    expect(wrapper.text()).toContain("Status collected (Asia/Kolkata)");
    expect(wrapper.get("time").text()).toBe("2026-11-04 10:40:00");
    expect(wrapper.get("time").attributes("datetime")).toBe("2026-11-04T05:10:00.123456Z");
    store.draft = cloneConfig(store.state.data!.desired);
    store.draft.system!.timezone = "Pacific/Auckland";
    await flushPromises();
    expect(wrapper.get("time").text()).toBe("2026-11-04 10:40:00");
    expect(wrapper.get<HTMLSelectElement>('[aria-label="Desired rx-checksum for eno1"]').element.value).toBe("disabled");
    const refreshed = interfaceCapabilitySnapshot();
    refreshed.inventory.interfaces[0]!.capabilities.find(feature => feature.name === "ethtool:rx-checksum")!.enabled = false;
    vi.mocked(api.refreshInterfaceCapabilities).mockResolvedValue(refreshed);
    await wrapper.findAll("button").find(button => button.text() === "Refresh capabilities")!.trigger("click");
    await flushPromises();
    expect(wrapper.get<HTMLSelectElement>('[aria-label="Desired rx-checksum for eno1"]').element.value).toBe("disabled");
    expect(store.editorDirty).toBe(true);
    expect(api.submitPackage).not.toHaveBeenCalled();
    expect(window.confirm).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("shows every allowlisted feature with state in the dropdown, detailed descriptions and technical names on hover", async () => {
    const snapshot = interfaceCapabilitySnapshot();
    snapshot.inventory.interfaces[0]!.capabilities = nicOffloadFeatures.map(feature => ({
      name: `ethtool:${feature}`, support: "supported", enabled: false, evidence: [], reason: null,
    }));
    vi.mocked(api.getInterfaceCapabilities).mockResolvedValue(snapshot);
    const wrapper = render("offloads"); await flushPromises();
    expect(wrapper.findAll(".setting-row")).toHaveLength(nicOffloadFeatures.length);
    expect(wrapper.findAll(".offload-status")).toHaveLength(0);
    for (const row of wrapper.findAll(".setting-row")) {
      expect(row.get<HTMLSelectElement>("select").element.value).toBe("disabled");
      expect(row.get(".setting-desc").text().split(/\.\s+/).length).toBeGreaterThan(1);
    }
    expect(wrapper.find('[aria-label="Offload category"]').exists()).toBe(false);
    const names = wrapper.findAll("label.setting-name").map(label => label.attributes("title")!);
    expect(names.sort()).toEqual([...nicOffloadFeatures].sort());
    expect(wrapper.find("table").exists()).toBe(false);
    expect(useControllerStore().editorDirty).toBe(false);
    wrapper.unmount();
  });

  it("does not manage displayed states automatically and cancels an unsubmitted edit when its reported value is reselected", async () => {
    const store = useControllerStore(), wrapper = render("offloads");
    await flushPromises();
    const select = wrapper.get<HTMLSelectElement>('[aria-label="Desired rx-checksum for eno1"]');
    expect(select.element.value).toBe("enabled");
    expect(store.editorDirty).toBe(false);
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(api.getRpsDiagnostics).toHaveBeenCalledTimes(1);
    expect(store.draft).toBeNull();
    await select.setValue("disabled");
    expect(store.editorDirty).toBe(true);
    await select.setValue("enabled");
    expect(store.editorDirty).toBe(false);
    await select.setValue("disabled");
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(store.draft?.kernel?.offloads).toEqual({ eno1: { "rx-checksum": false } });
    expect(store.state.data!.desired.kernel?.offloads).toBeUndefined();
    expect(api.submitPackage).not.toHaveBeenCalled();
  });

  it.each(["supported", "unsupported", "unknown"] as const)("does not invent an enabled state when %s evidence has no reported value", async support => {
    const snapshot = interfaceCapabilitySnapshot();
    const feature = snapshot.inventory.interfaces[0]!.capabilities.find(item => item.name === "ethtool:rx-checksum")!;
    feature.support = support; feature.enabled = null;
    vi.mocked(api.getInterfaceCapabilities).mockResolvedValue(snapshot);
    const wrapper = render("offloads"); await flushPromises();
    const select = wrapper.get<HTMLSelectElement>('[aria-label="Desired rx-checksum for eno1"]');
    expect(select.element.value).toBe("");
    expect(select.attributes("placeholder")).toBe(support === "unsupported" ? "Unsupported" : "Unknown");
    expect(select.element.disabled).toBe(support !== "supported");
    expect(useControllerStore().editorDirty).toBe(false);
    if (support === "supported") {
      await select.setValue("enabled");
      await wrapper.get("form").trigger("submit"); await flushPromises();
      expect(useControllerStore().draft?.kernel?.offloads).toEqual({ eno1: { "rx-checksum": true } });
    }
  });

  it.each(["success", "failure"] as const)("keeps initial pending-to-%s capability reads neutral", async outcome => {
    let resolve!: (value: ReturnType<typeof interfaceCapabilitySnapshot>) => void, reject!: (reason: Error) => void;
    vi.mocked(api.getInterfaceCapabilities).mockReturnValue(new Promise((done, fail) => { resolve = done; reject = fail; }));
    const wrapper = render("offloads"); await flushPromises();
    expect(wrapper.text()).toContain("Loading NIC capability evidence");
    expect(wrapper.text()).not.toContain("No allowlisted offload controls");
    expect(wrapper.text()).not.toContain("does not expose NIC offload controls");
    expect(wrapper.find('[aria-label="NIC offload configuration"]').exists()).toBe(false);
    expect(wrapper.findAll("button").find(button => button.text() === "STAGE CHANGES")!.attributes("disabled")).toBeDefined();
    if (outcome === "success") resolve(interfaceCapabilitySnapshot());
    else reject(new ApiFailure("Capability read failed", 503));
    await flushPromises();
    expect(wrapper.text()).not.toContain("Loading NIC capability evidence");
    if (outcome === "success") expect(wrapper.get('[aria-label="Desired rx-checksum for eno1"]').attributes("disabled")).toBeUndefined();
    else {
      expect(wrapper.get('[role="alert"]').text()).toContain("Capability read failed");
      expect(api.getInterfaceCapabilities).toHaveBeenCalledTimes(1);
    }
    expect(api.refreshInterfaceCapabilities).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it.each(["success", "failure"] as const)("keeps dependent pending-to-%s performance reads neutral on the offload page", async outcome => {
    let resolve!: (value: RpsDiagnostics) => void, reject!: (reason: Error) => void;
    vi.mocked(api.getRpsDiagnostics).mockReturnValue(new Promise((done, fail) => { resolve = done; reject = fail; }));
    const wrapper = render("offloads"); await flushPromises();
    expect(wrapper.text()).not.toContain("does not expose NIC offload controls");
    expect(wrapper.text()).not.toContain("No allowlisted offload controls");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    if (outcome === "success") resolve(rpsDiagnostics());
    else reject(new ApiFailure("Performance read failed", 503));
    await flushPromises();
    if (outcome === "success") expect(wrapper.get('[aria-label="Desired rx-checksum for eno1"]').attributes("disabled")).toBeUndefined();
    else expect(wrapper.get('[role="alert"]').text()).toContain("Performance read failed");
    expect(api.getRpsDiagnostics).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("does not require CPU or RFS evidence for an otherwise available NIC offload change", async () => {
    const data = rpsDiagnostics();
    data.sections.online_cpus = { status: "unavailable", data: null, error: "CPU read failed" };
    data.sample.identity_stable = false;
    data.rfs = { status: "unavailable", sock_flow_entries: null, error: "Global RFS read failed" };
    vi.mocked(api.getRpsDiagnostics).mockResolvedValue(data);
    const wrapper = render("offloads"); await flushPromises();
    expect(wrapper.find(toggle).exists()).toBe(false);
    expect(wrapper.find('[aria-label="Manage RFS tables"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("CPU read failed");
    expect(wrapper.text()).not.toContain("Global RFS read failed");
    expect(wrapper.get('[aria-label="Desired rx-checksum for eno1"]').attributes("disabled")).toBeUndefined();
    await wrapper.get('[aria-label="Desired rx-checksum for eno1"]').setValue("disabled");
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(useControllerStore().draft?.kernel?.offloads).toEqual({ eno1: { "rx-checksum": false } });
  });

  it.each(["stale", "identity", "unsupported", "fixed"] as const)("blocks offload changes using known %s evidence without hiding descriptions", async condition => {
    const store = useControllerStore(), data = rpsDiagnostics();
    store.state.data!.desired.kernel!.offloads = { eno1: { "rx-checksum": true } };
    data.configured_offloads = store.state.data!.desired.kernel!.offloads;
    vi.mocked(api.getRpsDiagnostics).mockResolvedValue(data);
    const snapshot = interfaceCapabilitySnapshot(), feature = snapshot.inventory.interfaces[0]!.capabilities.find(item => item.name === "ethtool:rx-checksum")!;
    if (condition === "identity") snapshot.inventory.interfaces[0]!.mac = "02:00:00:00:00:99";
    if (condition === "unsupported") feature.support = "unsupported";
    if (condition === "fixed") feature.evidence = ["ethtool feature bit 1; changeable=false; active=true"];
    vi.mocked(api.getInterfaceCapabilities).mockResolvedValue(snapshot);
    const wrapper = render("offloads");
    await flushPromises();
    if (condition === "stale") {
      vi.mocked(api.refreshInterfaceCapabilities).mockRejectedValue(new ApiFailure("HTTP 503: scan failed", 503));
      await wrapper.findAll("button").find(button => button.text() === "Refresh capabilities")!.trigger("click");
      await flushPromises();
    }
    const select = wrapper.get<HTMLSelectElement>('[aria-label="Desired rx-checksum for eno1"]');
    expect(select.attributes("disabled")).toBeDefined();
    expect(select.get('option[value="enabled"]').attributes("disabled")).toBeDefined();
    expect(select.get('option[value="disabled"]').attributes("disabled")).toBeDefined();
    expect(select.find('option[value="unmanaged"]').exists()).toBe(false);
    expect(wrapper.get(".setting-desc").text()).toContain("This detects packet corruption");
    if (condition === "fixed") {
      expect(select.element.value).toBe("enabled");
      expect(wrapper.get(".setting-desc").text()).toContain("fixed feature");
    }
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(store.draft).toBeNull();
    expect(store.state.data!.desired.kernel!.offloads).toEqual({ eno1: { "rx-checksum": true } });
  });

  it("keeps RPS usable on an older backend without inventing support for RFS or offloads", async () => {
    const data = rpsDiagnostics();
    delete data.configured_rfs; delete data.configured_offloads; delete data.rfs;
    vi.mocked(api.getRpsDiagnostics).mockResolvedValue(data);
    const wrapper = render(); await flushPromises();
    expect(wrapper.text()).not.toContain("does not expose");
    expect(wrapper.find('[aria-label="Manage RFS tables"]').exists()).toBe(false);
    expect(wrapper.get(toggle).attributes("disabled")).toBeUndefined();
  });

  it.each(["success", "failure"] as const)("does not show newer-feature availability warnings during initial pending-to-%s reads", async outcome => {
    let resolve!: (value: RpsDiagnostics) => void, reject!: (error: Error) => void;
    vi.mocked(api.getRpsDiagnostics).mockReturnValue(new Promise((done, fail) => { resolve = done; reject = fail; }));
    const wrapper = render();
    expect(wrapper.text()).not.toContain("does not expose");
    expect(wrapper.text()).not.toContain("could not be read");
    if (outcome === "success") resolve(rpsDiagnostics());
    else reject(new ApiFailure("HTTP 503: tuning evidence unavailable", 503));
    await flushPromises();
    if (outcome === "success") expect(wrapper.get(toggle).attributes("disabled")).toBeUndefined();
    else {
      expect(wrapper.text()).toContain("HTTP 503");
      expect(wrapper.find('[aria-label="Manage RFS tables"]').exists()).toBe(false);
    }
  });

  it.each(["rfs", "offloads"] as const)("rechecks applied %s settings before staging and preserves local input on mismatch", async feature => {
    const changed = rpsDiagnostics();
    if (feature === "rfs") changed.configured_rfs = { sock_flow_entries: 0, queues: {} };
    else changed.configured_offloads = { eno1: { "rx-checksum": false } };
    vi.mocked(api.getRpsDiagnostics).mockResolvedValueOnce(rpsDiagnostics()).mockResolvedValue(changed);
    const wrapper = render("offloads"); await flushPromises();
    await wrapper.get('[aria-label="Desired rx-checksum for eno1"]').setValue("disabled");
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(wrapper.text()).toContain("differ from committed state");
    expect(wrapper.get<HTMLSelectElement>('[aria-label="Desired rx-checksum for eno1"]').element.value).toBe("disabled");
    expect(useControllerStore().draft).toBeNull();
    expect(api.submitPackage).not.toHaveBeenCalled();
  });
});
