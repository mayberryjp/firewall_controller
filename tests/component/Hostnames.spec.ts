import { defineComponent } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHostnames } from "@/composables/useHostnames";
import FirewallDropsView from "@/views/FirewallDropsView.vue";
import ConnectionsView from "@/views/ConnectionsView.vue";
import PossibleMissingRulesView from "@/views/PossibleMissingRulesView.vue";
import { getConnections, getFirewallDenyLog, deleteConnection } from "@/services/netcontrol";
import { useControllerStore } from "@/stores/controller";
import { cloneConfig } from "@/services/configuration";
import { getSandoDevices, type SandoDevice } from "@/services/sando";
import { connections, hostPolicyConfig, state } from "../fixtures";
import { firewallDenyPage } from "../firewallTelemetryFixtures";

vi.mock("@/services/netcontrol", async importOriginal => ({
  ...await importOriginal<typeof import("@/services/netcontrol")>(),
  getConnections: vi.fn(), getFirewallDenyLog: vi.fn(), deleteConnection: vi.fn(),
}));
vi.mock("@/services/sando", async importOriginal => ({
  ...await importOriginal<typeof import("@/services/sando")>(), getSandoDevices: vi.fn(),
}));
const inventory = (): SandoDevice[] => [
  { ip_address: "192.0.2.20", ip6_address: "2001:db8::20", local_description: " Living room tablet ", dns_hostname: "dns-tablet", dhcp_hostname: "dhcp-tablet" },
  { ip_address: "198.51.100.10", local_description: " Database server ", dns_hostname: "dns-server" },
];
function enableSando(): void {
  useControllerStore().state.data!.desired.sando = {
    api_url: "https://sando.example", sync_enabled: true, hosts_import: null, rules_import: null,
  };
}
const box = { template: "<div><slot /></div>" };
const stubs = {
  VTable: { template: "<table><slot /></table>" },
  VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
  VAlert: box, VCard: box, VCardText: box, VCardActions: box,
  VDialog: { props: ["modelValue"], template: '<div v-if="modelValue" role="dialog"><slot /></div>' },
  VChip: { template: "<span><slot /></span>" }, VIcon: true, VProgressLinear: true,
  VTextField: { props: ["modelValue", "label"], emits: ["update:modelValue"], template: '<input :aria-label="label" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />' },
  VSelect: { props: ["modelValue", "label", "items"], emits: ["update:modelValue"], template: '<select :aria-label="label" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="item in items" :key="item.value" :value="item.value">{{ item.title }}</option></select>' },
  VSwitch: { props: ["modelValue", "label"], emits: ["update:modelValue"], template: '<input type="checkbox" :aria-label="label" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />' },
};
const views = [
  { name: "Firewall drops", view: FirewallDropsView, source: '[data-label="Source / port"] .mono', destination: '[data-label="Destination / port"] .mono' },
  { name: "Connections", view: ConnectionsView, source: '.connection-row [data-label="Source"] .mono', destination: '.connection-row [data-label="Destination"] .mono' },
  { name: "Possible missing rules", view: PossibleMissingRulesView, source: '.missing-rule-row [data-label="Source"]', destination: '.missing-rule-row [data-label="Destination"]' },
];
let wrapper: ReturnType<typeof mount> | undefined;
beforeEach(() => {
  setActivePinia(createPinia()); vi.clearAllMocks();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const drops = firewallDenyPage(); drops.next_before_id = null;
  vi.spyOn(Date, "now").mockReturnValue(drops.records[0]!.timestamp_ms);
  const store = useControllerStore();
  store.connected = true; store.state.data = { ...state(), desired: hostPolicyConfig() };
  store.state.data.desired.firewall.policies!.hosts[0]!.name = "Sando";
  store.state.data.desired.firewall.policies!.hosts[1]!.metadata = { display_name: "Database", description: "Private notes" };
  const sample = connections();
  sample.connections[0]!.original.source = "192.0.2.20";
  sample.connections[0]!.original.destination = "198.51.100.10";
  vi.mocked(getFirewallDenyLog).mockResolvedValue(drops);
  vi.mocked(getConnections).mockResolvedValue(sample);
  vi.mocked(getSandoDevices).mockResolvedValue(inventory());
});
afterEach(() => { wrapper?.unmount(); wrapper = undefined; useControllerStore().$dispose(); vi.restoreAllMocks(); });

describe.each(views)("$name hostname displays", ({ view, source, destination }) => {
  it("uses local descriptions instead of DNS or imported host names without changing telemetry", async () => {
    enableSando();
    const sample = await getConnections({ limit: 100 }), before = JSON.stringify(sample);
    wrapper = mount(view, { global: { stubs } }); await flushPromises();
    expect(wrapper.get(source).text()).toBe("LIVING ROOM TABLET (192.0.2.20)");
    expect(wrapper.get(destination).text()).toBe("DATABASE SERVER (198.51.100.10)");
    expect(wrapper.text()).not.toContain("DNS-TABLET");
    expect(JSON.stringify(sample)).toBe(before);
    expect(getSandoDevices).toHaveBeenCalledWith("https://sando.example", expect.any(AbortSignal));
    expect(useControllerStore().draft).toBeNull();
  });
  it("keeps inventory devices without descriptions IP-only rather than using DNS names", async () => {
    enableSando();
    vi.mocked(getSandoDevices).mockResolvedValue(inventory().map(device => ({ ...device, local_description: " " })));
    wrapper = mount(view, { global: { stubs } }); await flushPromises();
    expect(wrapper.get(source).text()).toBe("192.0.2.20");
    expect(wrapper.get(destination).text()).toBe("198.51.100.10");
  });
  it.each(["success", "failure"])("keeps pending inventory neutral and handles %s inline", async outcome => {
    enableSando();
    let resolve!: (devices: SandoDevice[]) => void, reject!: (error: Error) => void;
    vi.mocked(getSandoDevices).mockReturnValue(new Promise((yes, no) => { resolve = yes; reject = no; }));
    wrapper = mount(view, { global: { stubs } }); await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    if (outcome === "success") resolve(inventory());
    else reject(new Error("Unable to load host descriptions from Sando."));
    await flushPromises();
    if (outcome === "success") {
      expect(wrapper.get(source).text()).toBe("LIVING ROOM TABLET (192.0.2.20)");
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    } else {
      expect(wrapper.get('[role="alert"]').text()).toContain("Unable to load host descriptions from Sando.");
      expect(wrapper.find(source).exists()).toBe(true);
    }
  });
  it("shows saved host names and display labels while preserving telemetry and ports", async () => {
    const drops = firewallDenyPage(), sample = await getConnections({ limit: 100 });
    const before = JSON.stringify(sample);
    wrapper = mount(view, { global: { stubs } }); await flushPromises();
    expect(wrapper.get(source).text()).toBe("SANDO (192.0.2.20)");
    expect(wrapper.get(destination).text()).toBe("DATABASE (198.51.100.10)");
    expect(wrapper.text()).not.toContain("Private notes");
    expect(JSON.stringify(sample)).toBe(before);
    expect(drops.records[0]!.source).toBe("192.0.2.20");
    expect(useControllerStore().draft).toBeNull();
  });
  it("keeps unknown endpoints IP-only and updates when saved hosts change, not from drafts", async () => {
    const store = useControllerStore();
    store.state.data!.desired.firewall.policies!.hosts = [];
    wrapper = mount(view, { global: { stubs } }); await flushPromises();
    expect(wrapper.get(source).text()).toBe("192.0.2.20");
    expect(wrapper.get(destination).text()).toBe("198.51.100.10");
    store.draft = cloneConfig(hostPolicyConfig());
    store.draft.firewall.policies!.hosts[0]!.name = "Unsaved";
    await flushPromises();
    expect(wrapper.get(source).text()).toBe("192.0.2.20");
    store.state.data = { ...store.state.data!, desired: cloneConfig(hostPolicyConfig()) };
    await flushPromises();
    expect(wrapper.get(source).text()).toBe("WORKSTATION (192.0.2.20)");
    expect(wrapper.get(destination).text()).toBe("SERVER (198.51.100.10)");
  });
  it("keeps initial configuration loading neutral and adds names after it loads", async () => {
    const store = useControllerStore();
    store.state.data = null; store.state.loading = true;
    wrapper = mount(view, { global: { stubs } }); await flushPromises();
    expect(wrapper.get(source).text()).toBe("192.0.2.20");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    store.state.data = { ...state(), desired: hostPolicyConfig() }; store.state.loading = false;
    await flushPromises();
    expect(wrapper.get(source).text()).toBe("WORKSTATION (192.0.2.20)");
  });
});

describe("shared hostname formatting", () => {
  const Names = defineComponent({ setup: useHostnames, template: "<div />" });
  it("matches equivalent IPv6 spellings, preserves the original IP, and avoids IP-only duplicate labels", () => {
    const store = useControllerStore(), config = store.state.data!.desired;
    config.firewall.policies!.hosts[0]!.addresses.push("2001:db8::20");
    config.firewall.policies!.hosts[1]!.name = "198.51.100.10";
    delete config.firewall.policies!.hosts[1]!.metadata;
    const names = mount(Names);
    try {
      expect(names.vm.formatHostAddress("2001:0db8:0:0:0:0:0:20")).toBe("SANDO (2001:0db8:0:0:0:0:0:20)");
      expect(names.vm.formatHostAddress("198.51.100.10")).toBe("198.51.100.10");
      expect(names.vm.formatHostAddress("203.0.113.9")).toBe("203.0.113.9");
    } finally { names.unmount(); }
  });
  it("uses local descriptions for equivalent IPv6 addresses and inventory devices outside host policies", async () => {
    enableSando();
    vi.mocked(getSandoDevices).mockResolvedValue([
      ...inventory(), { ip_address: "203.0.113.9", local_description: "Printer" },
    ]);
    const names = mount(Names); wrapper = names; await flushPromises();
    expect(names.vm.formatHostAddress("2001:0db8:0:0:0:0:0:20")).toBe("LIVING ROOM TABLET (2001:0db8:0:0:0:0:0:20)");
    expect(names.vm.formatHostAddress("203.0.113.9")).toBe("PRINTER (203.0.113.9)");
  });
  it("ignores draft endpoints and discards inventory results from a previous session", async () => {
    enableSando();
    const store = useControllerStore();
    let resolve!: (devices: SandoDevice[]) => void;
    vi.mocked(getSandoDevices).mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
    const names = mount(Names); wrapper = names;
    store.draft = cloneConfig(store.state.data!.desired);
    store.draft.sando!.api_url = "https://unsaved.example";
    await flushPromises();
    expect(getSandoDevices).toHaveBeenCalledTimes(1);
    const signal = vi.mocked(getSandoDevices).mock.calls[0]![1];
    store.sessionVersion++;
    vi.mocked(getSandoDevices).mockResolvedValue([]);
    await flushPromises();
    expect(signal.aborted).toBe(true);
    resolve(inventory()); await flushPromises();
    expect(names.vm.formatHostAddress("192.0.2.20")).toBe("SANDO (192.0.2.20)");
  });
  it("uses local descriptions in connection deletion review while preserving the selected identity", async () => {
    enableSando();
    wrapper = mount(ConnectionsView, { global: { stubs } }); await flushPromises();
    await wrapper.get('[aria-label="Delete connection 42"]').trigger("click");
    expect(wrapper.get('[role="dialog"]').text()).toContain("LIVING ROOM TABLET (192.0.2.20) to DATABASE SERVER (198.51.100.10)");
    expect(deleteConnection).not.toHaveBeenCalled();
  });
  it("labels the appliance's own IPv4 and IPv6 addresses with its hostname", () => {
    const config = useControllerStore().state.data!.desired;
    config.system = { hostname: "Firewall", domain: "", timezone: "" };
    const names = mount(Names);
    try {
      expect(names.vm.formatHostAddress("192.0.2.10")).toBe("FIREWALL (192.0.2.10)");
      expect(names.vm.formatHostAddress("2001:db8::10")).toBe("FIREWALL (2001:db8::10)");
    } finally { names.unmount(); }
  });
  it("uses the same named endpoints in connection deletion review without changing the selected identity", async () => {
    wrapper = mount(ConnectionsView, { global: { stubs } }); await flushPromises();
    await wrapper.get('[aria-label="Delete connection 42"]').trigger("click");
    expect(wrapper.get('[role="dialog"]').text()).toContain("SANDO (192.0.2.20) to DATABASE (198.51.100.10)");
    expect(deleteConnection).not.toHaveBeenCalled();
  });
});
