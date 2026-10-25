import { mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import RemoteDnsView from "@/views/RemoteDnsView.vue";
import { useControllerStore } from "@/stores/controller";
import { cloneConfig } from "@/services/configuration";
import { state } from "../fixtures";

const box = { template: "<div><slot /></div>" };
function render() {
  return mount(RemoteDnsView, {
    global: {
      stubs: {
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
    expect(store.state.data!.desired).toEqual(before);
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
