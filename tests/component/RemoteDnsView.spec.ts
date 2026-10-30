import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RemoteDnsView from "@/views/RemoteDnsView.vue";
import { useControllerStore } from "@/stores/controller";
import { cloneConfig } from "@/services/configuration";
import { state } from "../fixtures";
import * as api from "@/services/netcontrol";
import { dnsResponse } from "../diagnosticsFixtures";

const box = { template: "<div><slot /></div>" };
function render(stubLookups = true) {
  return mount(RemoteDnsView, {
    global: {
      stubs: {
        DNSLookup: stubLookups,
        VAlert: box,
        VTable: { template: "<table><slot /></table>" },
        VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
        VTextField: {
          props: ["modelValue", "disabled"],
          emits: ["update:modelValue"],
          template: '<input :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)" />',
        },
      },
    },
  });
}
async function click(wrapper: VueWrapper, label: string) {
  await wrapper.findAll("button").find(button => button.text() === label)!.trigger("click");
}
async function add(wrapper: VueWrapper, server: string) {
  await click(wrapper, "Add DNS server");
  await wrapper.get("input").setValue(server);
  await click(wrapper, "Save");
}

beforeEach(() => {
  setActivePinia(createPinia());
  const store = useControllerStore();
  store.connected = true;
  store.state.data = state();
  const desired = store.state.data.desired;
  const lan = desired.interfaces[0]!;
  desired.interfaces.push(
    { ...lan, name: "wan0", kind: "ethernet", role: "wan", up: false },
    { ...lan, name: "vlan10", kind: "vlan", role: "lan", vlan: { parent: "wan0", id: 10 } },
    { ...lan, name: "spare0", role: "unassigned" },
  );
  desired.dns = {
    lab0: { servers: ["192.0.2.53"], domains: [{ name: "example.com", route_only: false }] },
    spare0: { servers: ["192.0.2.54"], domains: [] },
  };
});

describe("Remote DNS", () => {
  it("keeps independent domain inputs, RTTs and answers in each server row", async () => {
    const store = useControllerStore();
    store.state.data!.desired.dns!.lab0!.servers.push("1.1.1.1");
    const lookup = vi.spyOn(api, "lookupDNS").mockImplementation(async input => ({
      ...dnsResponse(), server: input.server!, hostname: input.hostname,
      rtt_ms: input.server === "1.1.1.1" ? 25 : 12.5,
      addresses: input.server === "1.1.1.1" ? ["198.51.100.9"] : ["192.0.2.7"],
    }));
    const wrapper = render(false);
    try {
      expect(wrapper.findAll("th").map(cell => cell.text())).toEqual(["Server", "Domain", "Test", "RTT", "Result", "Actions"]);
      expect(wrapper.findAll("tbody tr")).toHaveLength(2);
      for (const row of wrapper.findAll("tbody tr")) {
        expect(row.findAll("td")).toHaveLength(6);
        expect(row.findAll("td")[5]!.classes()).toContain("column-actions");
      }
      await wrapper.get('[aria-label="Domain for 192.0.2.53"]').setValue("first.test");
      await wrapper.get('[aria-label="Domain for 1.1.1.1"]').setValue("second.test");
      await wrapper.get('button[aria-label="Test DNS 192.0.2.53"]').trigger("click"); await flushPromises();
      expect(wrapper.get('[aria-label="RTT for 192.0.2.53"]').text()).toBe("13 ms");
      expect(wrapper.get('[aria-label="Result for 192.0.2.53"]').text()).toBe("192.0.2.7");
      expect(wrapper.get('[aria-label="Result for 1.1.1.1"]').text()).toBe("\u2014");
      expect(wrapper.get('[aria-label="RTT for 1.1.1.1"]').text()).not.toContain("13 ms");
      await wrapper.get('button[aria-label="Test DNS 1.1.1.1"]').trigger("click"); await flushPromises();
      expect(wrapper.get('[aria-label="RTT for 1.1.1.1"]').text()).toBe("25 ms");
      expect(wrapper.get('[aria-label="Result for 1.1.1.1"]').text()).toBe("198.51.100.9");
      expect(wrapper.get('[aria-label="Result for 192.0.2.53"]').text()).toBe("192.0.2.7");
      expect(lookup).toHaveBeenNthCalledWith(2, expect.objectContaining({ server: "1.1.1.1", hostname: "second.test" }), expect.any(AbortSignal));
      expect(store.draft).toBeNull(); expect(store.editorDirty).toBe(false);
    } finally { wrapper.unmount(); lookup.mockRestore(); }
  });
  it.each([true, false])("preserves the DHCP DNS override (%s) while editing remote servers", async override_dhcp_dns => {
    const store = useControllerStore();
    store.state.data!.desired.dns!.lab0!.override_dhcp_dns = override_dhcp_dns;
    const wrapper = render();
    try {
      await add(wrapper, "1.1.1.1");
      expect(store.draft!.dns!.lab0!.override_dhcp_dns).toBe(override_dhcp_dns);
      expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });
  it("stages every LAN/WAN interface, including down links and VLANs, preserving the shared draft and other settings", async () => {
    const store = useControllerStore();
    const desired = store.state.data!.desired;
    store.stage(desired);
    store.draft!.ntp = { enabled: true, servers: ["time.example.com"] };
    const before = cloneConfig(desired);
    const wrapper = render();
    expect(wrapper.find("input").exists()).toBe(false);
    expect(wrapper.find("textarea").exists()).toBe(false);
    expect(store.draft!.dns).toEqual(before.dns);
    await add(wrapper, "1.1.1.1");
    await add(wrapper, "2606:4700:4700::1111");
    for (const name of ["lab0", "wan0", "vlan10"]) {
      expect(store.draft!.dns![name]!.servers).toEqual(["192.0.2.53", "1.1.1.1", "2606:4700:4700::1111"]);
    }
    expect(store.draft!.dns!.lab0!.domains).toEqual(before.dns!.lab0!.domains);
    expect(store.draft!.dns!.spare0).toEqual(before.dns!.spare0);
    expect(store.draft!.ntp.servers).toEqual(["time.example.com"]);
    expect(cloneConfig(store.state.data!.desired)).toEqual(before);
    expect(store.editorDirty).toBe(false);
    expect(wrapper.find("input").exists()).toBe(false);
    wrapper.unmount();
  });

  it("edits and deletes servers inline while preserving domains", async () => {
    const store = useControllerStore();
    for (const link of store.state.data!.desired.interfaces.filter(link => link.role !== "unassigned")) {
      store.state.data!.desired.dns![link.name] = { servers: ["1.1.1.1"], domains: [{ name: ".", route_only: true }] };
    }
    const wrapper = render();
    expect(wrapper.findAll("tbody tr")).toHaveLength(1);
    await wrapper.get('button[aria-label="Edit 1.1.1.1"]').trigger("click");
    expect(wrapper.get("input").element.value).toBe("1.1.1.1");
    await wrapper.get("input").setValue("9.9.9.9");
    await click(wrapper, "Save");
    for (const name of ["lab0", "wan0", "vlan10"]) {
      expect(store.draft!.dns![name]!.servers).toEqual(["9.9.9.9"]);
    }
    await wrapper.get('button[aria-label="Delete 9.9.9.9"]').trigger("click");
    for (const name of ["lab0", "wan0", "vlan10"]) {
      expect(store.draft!.dns![name]).toEqual({ servers: [], domains: [{ name: ".", route_only: true }] });
    }
    expect(store.draft!.dns!.spare0!.servers).toEqual(["192.0.2.54"]);
    expect(wrapper.text()).toContain("No servers.");
    wrapper.unmount();
  });

  it.each([
    ["resolver.example.com", "IP"],
    ["192.0.2.53", "unique DNS servers"],
    ["", "IP"],
  ])("rejects invalid server input %s without staging", async (input, message) => {
    const store = useControllerStore();
    const wrapper = render();
    await add(wrapper, input);
    expect(store.draft).toBeNull();
    expect(wrapper.text()).toContain(message);
    expect(wrapper.find("input").exists()).toBe(true);
    wrapper.unmount();
    expect(store.editorDirty).toBe(false);
  });

  it("limits the combined LAN/WAN list to eight servers", async () => {
    const store = useControllerStore();
    store.state.data!.desired.dns!.lab0!.servers = Array.from({ length: 8 }, (_, index) => `192.0.2.${index + 1}`);
    const wrapper = render();
    await add(wrapper, "1.1.1.1");
    expect(store.draft).toBeNull();
    expect(wrapper.text()).toContain("at most 8");
    wrapper.unmount();
  });

  it("cancels inline input without staging", async () => {
    const store = useControllerStore();
    const wrapper = render();
    await click(wrapper, "Add DNS server");
    await wrapper.get("input").setValue("1.1.1.1");
    expect(store.editorDirty).toBe(true);
    await click(wrapper, "Cancel");
    expect(store.editorDirty).toBe(false);
    expect(store.draft).toBeNull();
    expect(wrapper.find("input").exists()).toBe(false);
    wrapper.unmount();
  });

  it("rejects IPv6 DNS when IPv6 is disabled", async () => {
    const store = useControllerStore();
    store.state.data!.desired.ipv6_enabled = false;
    const wrapper = render();
    await add(wrapper, "2606:4700:4700::1111");
    expect(store.draft).toBeNull();
    expect(wrapper.text()).toContain("IPv6");
    wrapper.unmount();
  });

  it("disables adding without LAN/WAN interfaces", () => {
    const store = useControllerStore();
    store.state.data!.desired.interfaces.forEach(link => { link.role = "unassigned"; });
    const wrapper = render();
    expect(wrapper.get("button").element.disabled).toBe(true);
    expect(store.draft).toBeNull();
    expect(wrapper.text()).toContain("Configure an interface with the LAN or WAN role");
    wrapper.unmount();
  });

  it("blocks changes when configuration is unavailable", () => {
    const store = useControllerStore();
    store.state.data = null;
    const wrapper = render();
    expect(wrapper.get("button").element.disabled).toBe(true);
    expect(store.draft).toBeNull();
    wrapper.unmount();
  });
});
