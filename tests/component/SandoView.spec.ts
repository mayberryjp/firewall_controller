import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SandoView from "@/views/SandoView.vue";
import ConnectionStatus from "@/components/layout/ConnectionStatus.vue";
import { useControllerStore } from "@/stores/controller";
import * as sando from "@/services/sando";
import { state } from "../fixtures";
import { sandoSchema } from "@/services/sandoState";
import { cloneConfig } from "@/services/configuration";

const field = {
  props: ["modelValue", "disabled", "label"], emits: ["update:modelValue"],
  template: '<input :aria-label="label" :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)" />',
};
const stubs = {
  VTextField: field, VSelect: field,
  VSwitch: {
    props: ["modelValue", "disabled", "label"], emits: ["update:modelValue"],
    template: '<input type="checkbox" role="switch" :aria-label="label" :checked="modelValue" :disabled="disabled" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
  },
  VCheckbox: {
    props: ["modelValue", "disabled", "label"], emits: ["update:modelValue"],
    template: '<input type="checkbox" :aria-label="label" :checked="modelValue" :disabled="disabled" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
  },
  VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
  VAlert: { template: '<div role="alert"><slot /></div>' },
  VTable: { template: "<table><slot /></table>" },
  VChip: { template: "<span><slot /></span>" },
};
let wrapper: ReturnType<typeof mount>;
const devices = [{ ip_address: "192.0.2.20", dhcp_hostname: "desk", icon: "Computer", tags: "trusted" }];
const connections = [{ ignorelist_id: "one", src_ip: "192.0.2.20", dst_ip: "198.51.100.40", protocol: 6, dst_port: 443 }];
const button = (text: string) => wrapper.findAll("button").find(value => value.text() === text)!;
async function prepare() {
  await wrapper.get('input[aria-label="Sando API endpoint"]').setValue("https://sando.example");
  await wrapper.get('input[aria-label="Use host/interface policy mode with stateful return traffic instead of legacy forwarding mode"]').setValue(true);
}
beforeEach(() => {
  setActivePinia(createPinia()); localStorage.clear();
  const store = useControllerStore();
  store.connected = true; store.state.data = state();
  store.state.data.desired.firewall.rules = [];
  store.state.data.desired.sando = sandoSchema.parse({});
  store.state.stale = false; store.state.lastSuccess = Date.now();
  vi.spyOn(sando, "getSandoDevices").mockResolvedValue(devices);
  vi.spyOn(sando, "getSandoConnections").mockResolvedValue(connections);
});
afterEach(() => { wrapper?.unmount(); useControllerStore().$dispose(); vi.restoreAllMocks(); localStorage.clear(); });

describe("one-time Sando imports", () => {
  it("shows the latest import in the saved system timezone and follows staged toggle changes", async () => {
    const store = useControllerStore();
    store.state.data!.desired.system = { hostname: "", domain: "", timezone: "America/Los_Angeles" };
    const report = {
      source_url: "https://sando.example", import_count: 1,
      status: "succeeded", imported_count: 1, skipped_count: 0,
    };
    store.state.data!.desired.sando = sandoSchema.parse({
      api_url: "https://sando.example", sync_enabled: true,
      hosts_import: { ...report, last_import_at: "2026-10-30T14:00:00.123Z" },
      rules_import: { ...report, last_import_at: "2026-10-30T12:30:08.722-07:00" },
    });
    wrapper = mount(SandoView, { global: { stubs } });
    const chip = () => wrapper.find('[aria-label="Last Sando import"]');
    expect(chip().text()).toBe("Last import (America/Los_Angeles): 2026-10-30 12:30:08");
    expect(chip().element.parentElement).toBe(wrapper.get('[role="switch"]').element.parentElement);
    await wrapper.get('[role="switch"]').setValue(false); await flushPromises();
    expect(chip().exists()).toBe(false);
    store.discardDraft(); await flushPromises();
    expect(chip().text()).toBe("Last import (America/Los_Angeles): 2026-10-30 12:30:08");
    const candidate = cloneConfig(store.state.data!.desired);
    candidate.system!.timezone = "Asia/Kolkata";
    store.stage(candidate); await flushPromises();
    expect(chip().text()).toBe("Last import (America/Los_Angeles): 2026-10-30 12:30:08");
    store.discardDraft();
    store.state.data!.desired.sando!.hosts_import!.last_import_at = "2026-10-31T01:02:03.999Z";
    store.state.data = { ...store.state.data!, desired: cloneConfig(store.state.data!.desired) };
    await flushPromises();
    expect(chip().text()).toBe("Last import (America/Los_Angeles): 2026-10-30 18:02:03");
    store.state.data = { ...store.state.data!, desired: candidate };
    await flushPromises();
    expect(chip().text()).toBe("Last import (Asia/Kolkata): 2026-10-31 01:00:08");
  });
  it("shows an explicit missing-import indicator only when sync is enabled", async () => {
    const store = useControllerStore();
    store.state.data!.desired.sando = sandoSchema.parse({ api_url: "https://sando.example" });
    wrapper = mount(SandoView, { global: { stubs } });
    expect(wrapper.find('[aria-label="Last Sando import"]').exists()).toBe(false);
    await wrapper.get('[role="switch"]').setValue(true); await flushPromises();
    expect(wrapper.get('[aria-label="Last Sando import"]').text()).toBe("Last import (UTC): No imports yet");
  });
  it("preserves an invalid timestamp indicator", () => {
    const store = useControllerStore();
    store.state.data!.desired.sando = sandoSchema.parse({
      api_url: "https://sando.example", sync_enabled: true,
      hosts_import: {
        source_url: "https://sando.example", import_count: 1, last_import_at: "2026-10-30T14:00:00Z",
        status: "succeeded", imported_count: 1, skipped_count: 0,
      },
    });
    store.state.data!.desired.sando!.hosts_import!.last_import_at = "invalid";
    wrapper = mount(SandoView, { global: { stubs } });
    expect(wrapper.get('[aria-label="Last Sando import"]').text()).toBe("Last import (UTC): Invalid timestamp");
  });
  it.each([true, false])("stages automatic sync %s without importing, applying or changing other settings", async enabled => {
    const store = useControllerStore();
    store.state.data!.desired.sando = sandoSchema.parse({ api_url: "https://sando.example", sync_enabled: !enabled });
    store.state.data!.desired.firewall.rules = state().desired.firewall.rules;
    const before = cloneConfig(store.state.data!.desired), apply = vi.spyOn(store, "apply");
    wrapper = mount(SandoView, { global: { stubs } });
    await wrapper.get('[role="switch"]').setValue(enabled); await flushPromises();
    expect(store.draft).toEqual({ ...before, sando: { ...before.sando, sync_enabled: enabled } });
    expect(cloneConfig(store.state.data!.desired)).toEqual(before);
    expect(sando.getSandoDevices).not.toHaveBeenCalled();
    expect(sando.getSandoConnections).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(store.editorDirty).toBe(false);
    store.discardDraft(); await flushPromises();
    expect(wrapper.get('[role="switch"]').element).toHaveProperty("checked", !enabled);
  });
  it("rejects enabling sync without a saved source and prevents clearing an enabled source", async () => {
    const store = useControllerStore();
    wrapper = mount(SandoView, { global: { stubs } });
    await wrapper.get('[role="switch"]').setValue(true); await flushPromises();
    expect(store.draft).toBeNull();
    expect(wrapper.text()).toContain("Save a Sando API endpoint");
    expect(wrapper.get('[role="switch"]').element).toHaveProperty("checked", false);
    await wrapper.get('input[aria-label="Sando API endpoint"]').setValue("https://sando.example");
    await button("Save endpoint").trigger("click"); await flushPromises();
    await wrapper.get('[role="switch"]').setValue(true); await flushPromises();
    expect(store.draft!.sando!.sync_enabled).toBe(true);
    await wrapper.get('input[aria-label="Sando API endpoint"]').setValue("");
    await button("Save endpoint").trigger("click"); await flushPromises();
    expect(store.draft!.sando).toMatchObject({ api_url: "https://sando.example", sync_enabled: true });
    expect(wrapper.text()).toContain("Save a Sando API endpoint");
    expect(store.editorDirty).toBe(true);
  });
  it("disables sync settings while writes are frozen", () => {
    useControllerStore().busy = true;
    wrapper = mount(SandoView, { global: { stubs } });
    expect(wrapper.get('[role="switch"]').attributes("disabled")).toBeDefined();
  });
  it("automatically stages imported rules and enables SAVE without another review or applying", async () => {
    const store = useControllerStore();
    const apply = vi.spyOn(store, "apply");
    wrapper = mount({
      components: { SandoView, ConnectionStatus },
      template: "<ConnectionStatus /><SandoView />",
    }, { global: { stubs } });
    await prepare();
    await button("Import rules").trigger("click"); await flushPromises();
    const save = () => wrapper.get('[aria-label="Save configuration"]');
    expect(store.draft!.firewall.policies!.hosts[0]!.rules).toHaveLength(1);
    expect(store.editorDirty).toBe(false);
    expect(store.canApply).toBe(true);
    expect(save().attributes("disabled")).toBeUndefined();
    expect(wrapper.find('[aria-label="Review Sando replacement"]').exists()).toBe(false);
    expect(wrapper.findAll("button").map(value => value.text())).not.toContain("Stage reviewed import");
    expect(store.state.data!.desired.firewall.policies).toBeUndefined();
    expect(store.draft!.sando!.sync_enabled).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });
  it("discards automatically staged imports with the shared draft without changing confirmed reports", async () => {
    const store = useControllerStore();
    wrapper = mount(SandoView, { global: { stubs } }); await prepare();
    await button("Save endpoint").trigger("click"); await flushPromises();
    const before = cloneConfig(store.state.data!.desired);
    await button("Import rules").trigger("click"); await flushPromises();
    expect(store.draft!.sando!.rules_import).toMatchObject({ imported_count: 1 });
    expect(store.editorDirty).toBe(false);
    store.discardDraft(); await flushPromises();
    expect(store.draft).toBeNull();
    expect(cloneConfig(store.state.data!.desired)).toEqual(before);
    expect(store.editorDirty).toBe(false);
  });
  it("automatically stages a genuinely empty source removing only old Sando-owned rules", async () => {
    const store = useControllerStore();
    store.state.data!.desired.firewall.policies = { interfaces: [], hosts: [{
      id: "desk", name: "Desk", addresses: ["192.0.2.20"], policy: "drop",
      rules: [{ origin: "import", import_source: "sando", action: "accept" }, { action: "drop" }],
    }] };
    vi.mocked(sando.getSandoDevices).mockResolvedValue([]);
    vi.mocked(sando.getSandoConnections).mockResolvedValue([]);
    wrapper = mount(SandoView, { global: { stubs } });
    await wrapper.get('input[aria-label="Sando API endpoint"]').setValue("https://new-sando.example");
    await button("Import rules").trigger("click"); await flushPromises();
    expect(store.draft!.firewall.policies!.hosts[0]!.rules).toEqual([{ action: "drop" }]);
    expect(store.draft!.firewall.policies!.hosts[0]!.policy).toBe("drop");
    expect(store.draft!.sando!.rules_import).toMatchObject({ imported_count: 0, skipped_count: 0, status: "succeeded", source_url: "https://new-sando.example" });
    expect(store.state.data!.desired.firewall.policies!.hosts[0]!.rules).toHaveLength(2);
    expect(store.editorDirty).toBe(false);
  });
  it("keeps the initial page focused on controls without empty reports or explanatory clutter", () => {
    wrapper = mount(SandoView, { global: { stubs } });
    expect(wrapper.findAll("button").map(value => value.text())).toEqual(["Save endpoint", "Import hosts", "Import rules"]);
    expect(wrapper.findAll("h2")).toHaveLength(0);
    expect(wrapper.findAll("p")).toHaveLength(0);
    expect(wrapper.findAll('[role="alert"]')).toHaveLength(0);
    expect(wrapper.get('input[aria-label="Sando API endpoint"]').attributes("hint")).toBeUndefined();
    expect(wrapper.get('input[aria-label="New host default policy"]').attributes("hint")).toBeUndefined();
  });
  it("stages partial reports from the confirmed counter and preserves them across retries", async () => {
    const store = useControllerStore();
    store.state.data!.desired.sando!.hosts_import = {
      source_url: "https://old.example", import_count: 7, last_import_at: "2026-10-29T00:00:00Z",
      status: "succeeded", imported_count: 2, skipped_count: 0,
    };
    vi.mocked(sando.getSandoDevices).mockResolvedValue([...devices, { ip_address: "*" }]);
    wrapper = mount(SandoView, { global: { stubs } }); await prepare();
    await button("Import hosts").trigger("click"); await flushPromises();
    expect(store.draft!.sando!.hosts_import).toMatchObject({ import_count: 8, imported_count: 1, skipped_count: 1, status: "partial" });
    expect(store.state.data!.desired.sando!.hosts_import!.import_count).toBe(7);
    await button("Import hosts").trigger("click"); await flushPromises();
    expect(store.draft!.sando!.hosts_import).toMatchObject({ import_count: 8, imported_count: 1, skipped_count: 1 });
  });
  it("does not replace confirmed reports for all-invalid or failed attempts", async () => {
    const store = useControllerStore();
    const report = { source_url: "https://old.example", import_count: 3, last_import_at: "2026-10-29T00:00:00Z",
      status: "succeeded" as const, imported_count: 2, skipped_count: 0 };
    store.state.data!.desired.sando!.hosts_import = report;
    vi.mocked(sando.getSandoDevices).mockResolvedValue([{ ip_address: "*" }]);
    wrapper = mount(SandoView, { global: { stubs } }); await prepare();
    await button("Import hosts").trigger("click"); await flushPromises();
    expect(store.draft).toBeNull(); expect(store.state.data!.desired.sando!.hosts_import).toEqual(report);
    vi.mocked(sando.getSandoDevices).mockRejectedValue(new Error("Sando unavailable"));
    await button("Import hosts").trigger("click"); await flushPromises();
    expect(wrapper.text()).toContain("Sando unavailable");
    expect(store.draft).toBeNull(); expect(store.state.data!.desired.sando!.hosts_import).toEqual(report);
  });
  it("keeps reports staged through repeated imports and discards them with the firewall draft", async () => {
    const store = useControllerStore(); wrapper = mount(SandoView, { global: { stubs } }); await prepare();
    await button("Import hosts").trigger("click"); await flushPromises();
    const first = { ...store.draft!.sando!.hosts_import! };
    await button("Import hosts").trigger("click"); await flushPromises();
    expect(store.draft!.sando!.hosts_import).toEqual(first);
    expect(store.draft!.firewall.policies!.hosts[0]!.policy).toBe("drop");
    expect(wrapper.text()).not.toContain("Pending SAVE:");
    expect(wrapper.text()).not.toContain("No confirmed import recorded");
    expect(wrapper.findAll("h2")).toHaveLength(0);
    store.discardDraft(); await flushPromises();
    expect(store.draft).toBeNull();
    expect(wrapper.text()).not.toContain("Pending SAVE:");
    expect(wrapper.findAll("h2")).toHaveLength(0);
  });
  it("hides confirmed and staged report details while preserving provenance in configuration", async () => {
    const store = useControllerStore();
    const report = { source_url: "https://old.example/proxy", import_count: 7, last_import_at: "2026-10-30T01:02:03.123456789Z",
      status: "partial" as const, imported_count: 3, skipped_count: 2 };
    store.state.data!.desired.sando = { api_url: "https://sando.example", sync_enabled: false, hosts_import: report, rules_import: report };
    wrapper = mount(SandoView, { global: { stubs } });
    expect(wrapper.findAll("h2")).toHaveLength(0);
    expect(wrapper.findAll("p")).toHaveLength(0);
    expect(wrapper.text()).not.toContain("Last confirmed import");
    expect(wrapper.text()).not.toContain("2026-10-30");
    await wrapper.get('input[aria-label="Sando API endpoint"]').setValue("");
    await button("Save endpoint").trigger("click"); await flushPromises();
    expect(store.draft!.sando!.hosts_import).toEqual(report);
    expect(store.draft!.sando!.rules_import).toEqual(report);
    expect(store.draft!.sando!.api_url).toBe("");
    expect(wrapper.findAll("h2")).toHaveLength(0);
    expect(wrapper.findAll("p")).toHaveLength(0);
    expect(wrapper.text()).not.toContain("partial: 3 imported; 2 skipped");
    expect(wrapper.text()).not.toContain("https://old.example/proxy");
    expect(wrapper.text()).not.toContain("Confirmed operations");
    expect(store.diff.map(change => change.area)).toEqual(["sando"]);
  });
  it("does not claim persistence support on a legacy backend", () => {
    delete useControllerStore().state.data!.desired.sando;
    wrapper = mount(SandoView, { global: { stubs } });
    expect(wrapper.text()).toContain("backend does not support saved Sando");
    expect(button("Save endpoint").attributes("disabled")).toBeDefined();
  });
  it("requires inline policy-mode acknowledgement and stages hosts without applying or fetching connections", async () => {
    wrapper = mount(SandoView, { global: { stubs } });
    expect(button("Import hosts").attributes("disabled")).toBeDefined();
    await prepare();
    await wrapper.get('input[aria-label="New host default policy"]').setValue("drop");
    const store = useControllerStore(), apply = vi.spyOn(store, "apply");
    await button("Import hosts").trigger("click"); await flushPromises();
    expect(sando.getSandoConnections).not.toHaveBeenCalled();
    expect(store.draft!.firewall.policies!.hosts[0]).toMatchObject({ name: "desk", policy: "drop", rules: [] });
    expect(store.state.data!.desired.firewall.policies).toBeUndefined();
    expect(wrapper.text()).toContain("1 hosts and 0 rules staged");
    expect(wrapper.find("table").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Imported Sando inventory");
    expect(store.draft!.sando!.hosts_import).toMatchObject({ import_count: 1, imported_count: 1, source_url: "https://sando.example" });
    expect(store.draft!.sando!.sync_enabled).toBe(false);
    expect(store.state.data!.desired.sando!.hosts_import).toBeNull();
    expect(localStorage.getItem("firewall-controller:sando")).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });
  it("imports rules and missing hosts, reports unsupported candidates and skips repeat imports", async () => {
    vi.mocked(sando.getSandoConnections).mockResolvedValue([...connections, { ...connections[0]!, ignorelist_id: "icmp", protocol: 1 }]);
    wrapper = mount(SandoView, { global: { stubs } }); await prepare();
    await button("Import rules").trigger("click"); await flushPromises();
    expect(useControllerStore().draft!.firewall.policies!.hosts[0]!.rules).toHaveLength(1);
    expect(useControllerStore().draft!.sando!.rules_import).toMatchObject({ status: "partial", imported_count: 1, skipped_count: 1 });
    expect(useControllerStore().editorDirty).toBe(false);
    expect(wrapper.text()).toContain("1 hosts and 1 rules staged");
    expect(wrapper.text()).toContain("icmp: ICMP and ICMPv6 must not specify destination ports");
    await button("Import rules").trigger("click"); await flushPromises();
    expect(wrapper.text()).toContain("0 hosts and 1 rules staged");
    expect(wrapper.text()).toContain("1 previous Sando rules replaced");
  });
  it("preserves the latest draft edits made while requests are in flight", async () => {
    let resolve!: (value: typeof devices) => void;
    vi.mocked(sando.getSandoDevices).mockReturnValue(new Promise(done => { resolve = done; }));
    wrapper = mount(SandoView, { global: { stubs } }); await prepare();
    await button("Import rules").trigger("click");
    expect(button("Import hosts").attributes("disabled")).toBeDefined();
    const store = useControllerStore();
    const latest = structuredClone(store.state.data!.desired);
    latest.ntp = { enabled: true, servers: ["192.0.2.123"] };
    store.stage(latest);
    resolve(devices); await flushPromises();
    expect(store.draft!.ntp).toEqual(latest.ntp);
    expect(store.draft!.firewall.policies!.hosts).toHaveLength(1);
  });
  it("retains the current endpoint and rules when the saved source changes during acquisition", async () => {
    let resolve!: (value: typeof devices) => void;
    vi.mocked(sando.getSandoDevices).mockReturnValue(new Promise(done => { resolve = done; }));
    wrapper = mount(SandoView, { global: { stubs } }); await prepare();
    await button("Save endpoint").trigger("click"); await flushPromises();
    await button("Import rules").trigger("click");
    const store = useControllerStore();
    const latest = cloneConfig(store.draft!);
    latest.sando!.api_url = "https://other.example";
    store.stage(latest);
    resolve(devices); await flushPromises();
    expect(cloneConfig(store.draft!)).toEqual(latest);
    expect(wrapper.text()).toContain("The saved Sando endpoint changed while fetching");
    expect(wrapper.text()).not.toContain("Stage reviewed import");
    expect(store.editorDirty).toBe(false);
  });
  it("does not stage into a different firewall after connection changes", async () => {
    let resolve!: (value: typeof devices) => void;
    vi.mocked(sando.getSandoDevices).mockReturnValue(new Promise(done => { resolve = done; }));
    wrapper = mount(SandoView, { global: { stubs } }); await prepare();
    await button("Import hosts").trigger("click");
    useControllerStore().sessionVersion++;
    await flushPromises();
    resolve(devices); await flushPromises();
    expect(useControllerStore().draft).toBeNull();
    expect(wrapper.text()).toContain("firewall connection changed");
  });
  it("displays failures inline and preserves draft and saved inventory", async () => {
    vi.mocked(sando.getSandoConnections).mockRejectedValue(new Error("Sando returned HTTP 503"));
    wrapper = mount(SandoView, { global: { stubs } }); await prepare();
    await button("Import rules").trigger("click"); await flushPromises();
    expect(wrapper.text()).toContain("Sando returned HTTP 503");
    expect(useControllerStore().draft).toBeNull();
    expect(useControllerStore().state.data!.desired.sando!.rules_import).toBeNull();
    expect(wrapper.text()).not.toContain("rules staged");
  });
  it("keeps the actionable cancellation message when a real aborted read rejects", async () => {
    vi.mocked(sando.getSandoDevices).mockImplementation((_endpoint, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    wrapper = mount(SandoView, { global: { stubs } }); await prepare();
    await button("Import hosts").trigger("click");
    useControllerStore().sessionVersion++;
    await flushPromises();
    expect(wrapper.text()).toContain("Sando import canceled because the firewall connection changed");
    expect(wrapper.text()).not.toContain("rules staged");
    expect(useControllerStore().draft).toBeNull();
  });
  it("prevents legacy and frozen-draft imports before making requests", async () => {
    const store = useControllerStore();
    store.state.data!.desired.firewall.rules = [{ action: "accept" }];
    wrapper = mount(SandoView, { global: { stubs } });
    expect(wrapper.text()).toContain("Remove legacy forwarding rules");
    expect(button("Import hosts").attributes("disabled")).toBeDefined();
    expect(sando.getSandoDevices).not.toHaveBeenCalled();
    store.state.data!.desired.firewall.rules = [];
    store.busy = true; await flushPromises();
    expect(wrapper.text()).toContain("frozen");
  });
  it("retains configuration on validation failures and does not depend on browser storage", async () => {
    vi.mocked(sando.getSandoDevices).mockResolvedValue(Array.from({ length: 129 }, (_, index) => ({
      ip_address: `10.0.0.${index + 1}`, dhcp_hostname: `Host ${index}`,
    })));
    wrapper = mount(SandoView, { global: { stubs } }); await prepare();
    await button("Import hosts").trigger("click"); await flushPromises();
    expect(wrapper.text()).toContain("At most 128 hosts");
    expect(useControllerStore().draft).toBeNull();
    vi.mocked(sando.getSandoDevices).mockResolvedValue(devices);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota exceeded"); });
    await button("Import hosts").trigger("click"); await flushPromises();
    expect(wrapper.text()).not.toContain("quota exceeded");
    expect(useControllerStore().draft!.sando!.hosts_import!.import_count).toBe(1);
  });
  it("reads appliance settings and stages endpoint changes without clearing confirmed reports", async () => {
    const store = useControllerStore();
    store.state.data!.desired.sando!.api_url = "https://sando.example";
    wrapper = mount(SandoView, { global: { stubs } });
    expect(wrapper.get('input[aria-label="Sando API endpoint"]').element).toHaveProperty("value", "https://sando.example");
    await wrapper.get('input[aria-label="Sando API endpoint"]').setValue("https://other.example");
    await button("Save endpoint").trigger("click"); await flushPromises();
    expect(store.draft!.sando).toMatchObject({ api_url: "https://other.example", hosts_import: null, rules_import: null });
    expect(store.state.data!.desired.sando!.api_url).toBe("https://sando.example");
    expect(wrapper.text()).not.toContain("desk");
  });
});
