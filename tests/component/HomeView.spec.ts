import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ConnectView from "@/views/ConnectView.vue";
import HomeView from "@/views/HomeView.vue";
import FieldInput from "@/components/base/FieldInput.vue";
import { useControllerStore } from "@/stores/controller";
import * as registry from "@/services/registry";
import { state, statistics, monitor, gatewayStatistics } from "../fixtures";
vi.mock("vue-router", () => ({ useRouter: () => ({ replace: vi.fn() }), useRoute: () => ({ query: {} }) }));
beforeEach(() => {
  setActivePinia(createPinia());
  vi.spyOn(registry, "restoreRegistrySession").mockResolvedValue(false);
});
describe("connection and editor contracts", () => {
  it("shows the registry sign-in form without architecture boilerplate", () => {
    const wrapper = mount(ConnectView, { global: {
      stubs: { VAlert: true, VCard: { template: "<div><slot /></div>" }, VForm: { template: "<form><slot /></form>" }, VTextField: true, VBtn: true },
    } });
    expect(wrapper.get("h1").text()).toBe("Connect to a firewall");
    expect(wrapper.find("form").exists()).toBe(true);
    expect(wrapper.find("v-text-field-stub").attributes("label")).toBe("Registry admin password");
    expect(wrapper.text()).not.toContain("Device records and encrypted firewall keys");
    expect(useControllerStore().connected).toBe(false);
  });
  it("shows and hides the registry password without changing its value", async () => {
    const wrapper = mount(ConnectView, { global: {
      stubs: {
        VAlert: true,
        VCard: { template: "<div><slot /></div>" },
        VForm: { template: "<form><slot /></form>" },
        VTextField: {
          props: ["modelValue", "type"],
          emits: ["update:modelValue"],
          template: '<div><input :type="type" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" /><slot name="append-inner" /></div>',
        },
        VBtn: { template: "<button><slot /></button>" },
      },
    } });
    const input = wrapper.get("input");
    await input.setValue("test-password");
    expect(input.attributes("type")).toBe("password");
    await wrapper.get('button[aria-label="Show password"]').trigger("click");
    expect(input.attributes("type")).toBe("text");
    expect(input.element.value).toBe("test-password");
    await wrapper.get('button[aria-label="Hide password"]').trigger("click");
    expect(input.attributes("type")).toBe("password");
    expect(input.element.value).toBe("test-password");
  });
  it("splits address lines into separate values without rewriting host bits", async () => {
    const wrapper = mount(FieldInput, {
      props: { field: { key: "addresses", label: "Addresses", kind: "lines" }, modelValue: [], path: "editor.addresses" },
      global: { stubs: { VTextarea: { props: ["modelValue"], emits: ["update:modelValue"], template: '<textarea @input="$emit(\'update:modelValue\', $event.target.value)" />' } } },
    });
    await wrapper.get("textarea").setValue("192.0.2.10/24\n2001:db8::10/64");
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([["192.0.2.10/24", "2001:db8::10/64"]]);
  });
});

describe("compact overview dashboard", () => {
  beforeEach(() => {
    const store = useControllerStore();
    store.state.data = state(); store.state.stale = false;
    store.statistics.data = statistics(); store.statistics.stale = false;
    store.gatewayStatistics.data = { sample: statistics().sample, monitors: [] }; store.gatewayStatistics.stale = false;
    vi.spyOn(store, "refreshStatistics").mockResolvedValue();
    vi.spyOn(store, "refreshGatewayStatistics").mockResolvedValue();
  });
  function dashboard() {
    return mount(HomeView, { global: { stubs: {
      VCard: { props: ["tag"], template: '<component :is="tag || \'div\'"><slot /></component>' },
      VTable: { template: "<div><table><slot /></table></div>" },
      VBtn: { template: "<a><slot /></a>" },
      RouterLink: { template: "<a><slot /></a>" },
    } } });
  }
  it("shows only the four compact widgets, preserves exact counters, and subscribes to live reads", () => {
    const store = useControllerStore(), wrapper = dashboard();
    expect(wrapper.findAll("h2").map(heading => heading.text())).toEqual(["Interfaces", "Gateways", "WireGuard", "Interface counters"]);
    expect(wrapper.text()).toContain("18446744073709551615");
    expect(wrapper.text()).not.toMatch(/Recent transactions|Recent committed revisions|Expected live versus observed|Isolated lab control plane/);
    expect(store.refreshStatistics).toHaveBeenCalledOnce(); expect(store.refreshGatewayStatistics).toHaveBeenCalledOnce();
    expect(store.gatewayMonitoring).toBe(true);
    wrapper.unmount(); expect(store.gatewayMonitoring).toBe(false);
  });
  it("does not report simulated interfaces as live links", () => {
    const wrapper = dashboard().get('[aria-label="Interfaces"]');
    expect(wrapper.text()).toContain("Simulated");
    expect(wrapper.text()).not.toContain("Up");
  });
  it("shows WireGuard link state and configured peers without claiming handshake health", () => {
    const store = useControllerStore();
    store.state.data!.desired.interfaces.push({
      name: "wg0", kind: "wireguard", role: "wan", mtu: 1420, up: true, addresses: [], dhcp_relay: { enabled: false, servers: [] },
      wireguard: { key_ref: "wg-key", listen_port: 51820, peers: [{ public_key: "peer-key", allowed_ips: ["10.0.0.0/24"], persistent_keepalive_seconds: 25 }] },
    });
    store.statistics.data!.sample.status = "available";
    store.statistics.data!.interfaces.push({ name: "wg0", kind: "wireguard", ownership: "managed", mtu: 1420, admin_up: true, oper_state: "UP", status: "available", counters: null });
    const widget = dashboard().get('[aria-label="WireGuard"]');
    expect(widget.text()).toContain("wg0"); expect(widget.text()).toContain("Up");
    expect(widget.text()).toContain("Configured peers"); expect(widget.text()).toContain("51820");
    expect(widget.text()).not.toMatch(/Active peers|Connected/);
  });
  it("does not present stale interface or gateway data as healthy", async () => {
    const store = useControllerStore();
    store.state.data!.desired.gateway_monitors = [monitor()];
    store.gatewayStatistics.data!.monitors = [gatewayStatistics()];
    const wrapper = dashboard();
    expect(wrapper.get('[aria-label="Gateways"]').text()).toContain("Online");
    expect(wrapper.get('[aria-label="Gateways"]').text()).toContain("1.25 ms");
    store.gatewayStatistics.stale = true;
    store.statistics.stale = true;
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[aria-label="Gateways"]').text()).toContain("Unknown");
    expect(wrapper.get('[aria-label="Gateways"]').text()).not.toContain("Online");
    expect(wrapper.get('[aria-label="Interfaces"]').text()).toContain("Unknown");
    expect(wrapper.get('[aria-label="Interface counters"]').text()).toContain("Stale");
  });
  it("keeps missing counters unavailable rather than fabricating zeroes", () => {
    useControllerStore().statistics.data!.interfaces[0]!.counters = null;
    const widget = dashboard().get('[aria-label="Interface counters"]');
    expect(widget.text()).toContain("Unavailable");
    expect(widget.findAll("td").every(cell => cell.text() === "Unavailable")).toBe(true);
  });
});
