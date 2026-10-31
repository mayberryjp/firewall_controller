import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OverviewInterfaces from "@/components/feature/OverviewInterfaces.vue";
import OverviewCounters from "@/components/feature/OverviewCounters.vue";
import { useControllerStore } from "@/stores/controller";
import * as netcontrol from "@/services/netcontrol";
import { state, statistics } from "../fixtures";

const stubs = {
  VCard: { template: "<section><slot /></section>" },
  VTable: { template: "<table><slot /></table>" },
  VChip: { template: "<span><slot /></span>" },
  VBtn: true,
  RouterLink: { props: ["to"], template: '<a :data-to="JSON.stringify(to)"><slot /></a>' },
};

beforeEach(() => {
  setActivePinia(createPinia());
  const store = useControllerStore();
  store.state.data = state();
  store.statistics.data = statistics();
  vi.spyOn(netcontrol, "getDiscoveredInterfaces").mockResolvedValue([]);
});

describe.each([
  { name: "status", component: OverviewInterfaces },
  { name: "counters", component: OverviewCounters },
])("overview interface identity in $name", ({ component }) => {
  it.each(["lan", "wan", "unassigned"] as const)("shows the applied display name and %s role without adding columns", async role => {
    const store = useControllerStore();
    const link = store.state.data!.desired.interfaces[0]!;
    link.metadata = { display_name: "Office network ".repeat(9), description: "Not the display name" };
    link.role = role;
    store.draft = state().desired;
    store.draft.interfaces[0]!.metadata = { display_name: "Unsaved name", description: "" };
    const wrapper = mount(component, { global: { stubs } });
    await flushPromises();
    expect(wrapper.get(".interface-name").text()).toBe(link.name);
    expect(wrapper.get(".interface-name").attributes("title")).toBe(link.name);
    expect(wrapper.get(".interface-description").text()).toBe(link.metadata.display_name.trim());
    expect(wrapper.get(".interface-description").attributes("title")).toBe(link.metadata.display_name);
    expect(wrapper.get(".interface-role").text()).toBe(role === "unassigned" ? "Unassigned" : role.toUpperCase());
    expect(wrapper.text()).not.toContain("Unsaved name");
    expect(wrapper.text()).not.toContain("Not the display name");
    expect(wrapper.findAll("thead th")).toHaveLength(component === OverviewInterfaces ? 5 : 7);
    if (component === OverviewCounters) {
      expect(JSON.parse(wrapper.get("tbody a").attributes("data-to")!)).toEqual({
        path: "/diagnostics/traffic", query: { interface: link.name },
      });
    }
    store.state.data = {
      ...store.state.data!,
      desired: {
        ...store.state.data!.desired,
        interfaces: [{ ...link, metadata: { ...link.metadata, display_name: "Updated name" } }],
      },
    };
    await flushPromises();
    expect(wrapper.get(".interface-description").text()).toBe("Updated name");
    wrapper.unmount();
  });

  it("preserves observed interfaces without inventing configuration metadata", async () => {
    useControllerStore().state.data!.desired.interfaces = [];
    const wrapper = mount(component, { global: { stubs } });
    await flushPromises();
    expect(wrapper.get(".interface-name").text()).toBe("lab0");
    expect(wrapper.find(".interface-role").exists()).toBe(false);
    expect(wrapper.find(".interface-description").exists()).toBe(false);
    wrapper.unmount();
  });

  it.each([
    { up: true, addresses: ["127.0.0.1/8", "::1/128"] },
    { up: false, addresses: ["127.0.0.1/8"] },
    { up: true, addresses: [] },
    { up: false, addresses: [] },
  ])("shows fixed loopback identity with $up admin state and $addresses", async ({ up, addresses }) => {
    const store = useControllerStore();
    store.state.data!.desired.interfaces = [];
    store.statistics.data!.interfaces = [{
      ...store.statistics.data!.interfaces[0]!, name: "kernel0", kind: "loopback", ownership: "loopback", admin_up: up,
    }];
    vi.mocked(netcontrol.getDiscoveredInterfaces).mockResolvedValue([{
      name: "kernel0", kind: "loopback", ownership: "loopback", index: 1, mac: null, mtu: 65536, up, addresses,
      role: "loopback", addressing_type: "static",
    }]);
    const wrapper = mount(component, { global: { stubs } });
    await flushPromises();
    expect(wrapper.get(".interface-name").text()).toBe("kernel0");
    expect(wrapper.get(".interface-role").text()).toBe("Loopback");
    expect(wrapper.find(".interface-description").exists()).toBe(false);
    if (component === OverviewInterfaces) expect(wrapper.findAll("tbody td").at(-1)!.text()).toBe("Static");
    expect(wrapper.find("select, input").exists()).toBe(false);
    expect(store.draft).toBeNull();
    wrapper.unmount();
  });

  it("does not infer a loopback role from a misleading interface name", async () => {
    const store = useControllerStore();
    store.state.data!.desired.interfaces = [];
    store.statistics.data!.interfaces[0] = {
      ...store.statistics.data!.interfaces[0]!, name: "lo-test0", kind: "ethernet", ownership: "unmanaged",
    };
    vi.mocked(netcontrol.getDiscoveredInterfaces).mockResolvedValue([{
      name: "lo-test0", kind: "ethernet", ownership: "unmanaged", index: 3, mac: null, mtu: 1500, up: true,
      addresses: ["192.0.2.10/24"], role: null, addressing_type: null,
    }]);
    const wrapper = mount(component, { global: { stubs } });
    await flushPromises();
    expect(wrapper.get(".interface-name").text()).toBe("lo-test0");
    expect(wrapper.find(".interface-role").exists()).toBe(false);
    if (component === OverviewInterfaces) expect(wrapper.findAll("tbody td").at(-1)!.text()).toBe("-");
    wrapper.unmount();
  });

  it("does not reserve a description line when no display name is configured", async () => {
    const wrapper = mount(component, { global: { stubs } });
    await flushPromises();
    expect(wrapper.get(".interface-role").text()).toBe("LAN");
    expect(wrapper.find(".interface-description").exists()).toBe(false);
    wrapper.unmount();
  });
});
