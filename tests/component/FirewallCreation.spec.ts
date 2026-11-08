import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useResourceEditor } from "@/composables/useResourceEditor";
import { useControllerStore } from "@/stores/controller";
import { cloneConfig } from "@/services/configuration";
import { config, state } from "../fixtures";

const Editor = defineComponent({
  setup: () => useResourceEditor("firewall"),
  template: "<div />",
});
let wrapper: ReturnType<typeof mount<typeof Editor>>;
beforeEach(() => {
  setActivePinia(createPinia());
  const store = useControllerStore();
  store.connected = true; store.state.data = { ...state(), desired: config() };
  wrapper = mount(Editor);
});
afterEach(() => { wrapper.unmount(); useControllerStore().$dispose(); vi.restoreAllMocks(); });

describe("Legacy firewall rule creation", () => {
  it.each(["", "443, 8443"])("stages separate TCP and UDP rules with ports %s and preserves the shared draft", ports => {
    const store = useControllerStore(), before = cloneConfig(store.state.data!.desired);
    wrapper.vm.open();
    expect(wrapper.vm.fields.find(field => field.key === "protocol")!.choices!.map(choice => choice.title)).toContain("TCP & UDP");
    wrapper.vm.change("protocol", "tcp_udp");
    expect(wrapper.vm.fields.find(field => field.key === "destination_ports")!.disabled).toBe(false);
    wrapper.vm.change("destination_ports", ports);
    wrapper.vm.change("source", "192.0.2.0/24");
    wrapper.vm.change("destination", "198.51.100.0/24");
    wrapper.vm.change("action", "drop");
    wrapper.vm.change("metadata", { display_name: "Both", description: "Shared settings" });
    store.draft = cloneConfig(before);
    store.draft.firewall.allow_all_icmp = false;
    const stage = vi.spyOn(store, "stage");
    wrapper.vm.stageForm();
    expect(stage).toHaveBeenCalledOnce();
    expect(store.draft!.firewall.rules.slice(-2)).toEqual(["tcp", "udp"].map(protocol => ({
      origin: "manual", import_source: null, source: "192.0.2.0/24", destination: "198.51.100.0/24",
      protocol, action: "drop", metadata: { display_name: "Both", description: "Shared settings" },
      ...(ports ? { destination_ports: [443, 8443] } : {}),
    })));
    expect(store.state.data!.desired).toEqual(before);
    expect(store.draft!.firewall.allow_all_icmp).toBe(false);
    expect(wrapper.vm.dialog).toBe(false);
    wrapper.vm.open(store.draft!.firewall.rules.at(-2));
    expect(wrapper.vm.fields.find(field => field.key === "protocol")!.choices!.map(choice => choice.title)).not.toContain("TCP & UDP");
    wrapper.vm.change("destination_ports", "80");
    wrapper.vm.stageForm();
    expect(store.draft!.firewall.rules.at(-2)).toMatchObject({ protocol: "tcp", destination_ports: [80] });
    expect(store.draft!.firewall.rules.at(-1)).toMatchObject({ protocol: "udp" });
  });
  it("rejects invalid ports without staging either rule", () => {
    wrapper.vm.open();
    wrapper.vm.change("protocol", "tcp_udp");
    wrapper.vm.change("destination_ports", "443,443");
    wrapper.vm.stageForm();
    expect(wrapper.vm.formError).toContain("unique destination ports");
    expect(useControllerStore().draft).toBeNull();
    expect(wrapper.vm.dialog).toBe(true);
  });
  it("validates both rules against the expanded legacy limit atomically", () => {
    const store = useControllerStore();
    store.state.data!.desired.firewall.rules = Array.from({ length: 640 }, () => ({
      protocol: "tcp", action: "accept", destination_ports: Array.from({ length: 32 }, (_, index) => index + 1),
    }));
    store.state.data!.desired.firewall.rules[0]!.destination_ports!.pop();
    wrapper.vm.open();
    wrapper.vm.change("protocol", "tcp_udp");
    wrapper.vm.stageForm();
    expect(wrapper.vm.errors["firewall.rules"]).toContain("Legacy rules expand beyond 20480 entries");
    expect(store.draft).toBeNull();
    expect(store.state.data!.desired.firewall.rules).toHaveLength(640);
  });
});
