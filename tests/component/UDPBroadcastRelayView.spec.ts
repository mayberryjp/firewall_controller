import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import UDPBroadcastRelayView from "@/views/UDPBroadcastRelayView.vue";
import { useControllerStore } from "@/stores/controller";
import { state, udpRelayStatus } from "../fixtures";

const box = { template: "<div><slot /></div>" };
const global = { stubs: {
  VAlert: box, VProgressLinear: true, VTable: { template: "<table><slot /></table>" },
  VBtn: { props: ["disabled", "type"], template: '<button :type="type || \'button\'" :disabled="disabled"><slot /></button>' },
  VMenu: { template: '<div><slot name="activator" :props="{}" /><slot /></div>' },
  VList: box, VListItem: true, VSwitch: true, VDialog: { template: "<div />" },
  VCard: box, VCardText: box, VCardActions: box,
  VTextField: {
    props: ["modelValue", "label"], emits: ["update:modelValue"],
    template: '<label>{{ label }}<input :aria-label="label" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" /></label>',
  },
  VSelect: true,
} };

beforeEach(() => {
  setActivePinia(createPinia());
  const store = useControllerStore(), sample = udpRelayStatus();
  store.connected = true; store.state.data = state();
  store.state.data.desired.interfaces = sample.interfaces.map(name => ({
    name, kind: "ethernet", role: "lan", up: true, mtu: 1500,
    addresses: ["192.168.1.1/24"], dhcp_relay: { enabled: false, servers: [] },
  }));
  store.state.data.desired.udp_broadcast_relay = {
    enabled: true,
    instances: [1, 2].map(id => ({
      id, enabled: true, port: id === 1 ? 4001 : 3610, interfaces: sample.interfaces,
      multicast_address: sample.multicast_address, source: sample.source,
    })),
  };
  store.state.data = { ...store.state.data };
  store.udpRelayStatus.data = { instances: [
    { ...sample, instance_id: 2, port: 3610, received_packets: "0", transmitted_packets: "0" },
    sample,
  ], error: "" };
  store.udpRelayStatus.lastSuccess = Date.now(); store.udpRelayStatus.stale = false;
  vi.spyOn(store, "refreshUDPRelayStatus").mockResolvedValue();
});
afterEach(() => { useControllerStore().$dispose(); vi.useRealTimers(); });

describe("UDP relay entry usage", () => {
  it("joins by instance ID and renders exact received/forwarded counts without inventing last-used timestamps", () => {
    const wrapper = mount(UDPBroadcastRelayView, { global });
    const first = wrapper.get('[aria-label="Usage for relay 1"]'), second = wrapper.get('[aria-label="Usage for relay 2"]');
    expect(first.text()).toContain("Received: 9007199254740993");
    expect(first.text()).toContain("Forwarded: 18446744073709551615");
    expect(second.text()).toContain("Received: 0"); expect(second.text()).toContain("Forwarded: 0");
    expect(wrapper.text()).not.toContain("Last used");
    expect(wrapper.text()).toContain("Receive loss is unknown");
    expect(wrapper.text()).toContain("zero is not lifetime non-use");
    wrapper.unmount();
  });
  it("does not attribute old counters to changed draft configuration and allows removing entries through staging", async () => {
    const store = useControllerStore(), wrapper = mount(UDPBroadcastRelayView, { global });
    const stage = vi.spyOn(store, "stage"), apply = vi.spyOn(store, "apply");
    const confirm = vi.spyOn(window, "confirm"), alert = vi.spyOn(window, "alert");
    await wrapper.get('[aria-label="Edit relay 1"]').trigger("click");
    await wrapper.get('input[aria-label="UDP port"]').setValue("4002");
    await wrapper.get("form").trigger("submit");
    expect(wrapper.get('[aria-label="Usage for relay 1"]').text()).toContain("Not applied");
    expect(wrapper.get('[aria-label="Usage for relay 2"]').text()).toContain("Received: 0");
    await wrapper.get('[aria-label="Delete relay 2"]').trigger("click");
    expect(stage).toHaveBeenCalledTimes(2); expect(apply).not.toHaveBeenCalled();
    expect(store.draft!.udp_broadcast_relay!.instances.map(row => row.id)).toEqual([1]);
    expect(store.state.data!.desired.udp_broadcast_relay!.instances).toHaveLength(2);
    expect(confirm).not.toHaveBeenCalled(); expect(alert).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it.each(["success", "failure"])("shows neutral initial pending usage, then %s while retaining edits", async outcome => {
    const store = useControllerStore(), sample = store.udpRelayStatus.data;
    store.udpRelayStatus.data = null; store.udpRelayStatus.lastSuccess = null; store.udpRelayStatus.loading = true;
    const wrapper = mount(UDPBroadcastRelayView, { global });
    expect(wrapper.get('[aria-label="Usage for relay 1"]').text()).toContain("Loading");
    expect(wrapper.text()).not.toContain("Unavailable");
    await wrapper.get('[aria-label="Edit relay 1"]').trigger("click");
    await wrapper.get('input[aria-label="Display name"]').setValue("Discovery");
    store.udpRelayStatus.loading = false;
    if (outcome === "success") {
      store.udpRelayStatus.data = sample; store.udpRelayStatus.lastSuccess = Date.now(); store.udpRelayStatus.stale = false;
    } else {
      store.udpRelayStatus.error = "HTTP 503: relay read failed"; store.udpRelayStatus.stale = true;
    }
    await flushPromises();
    expect(wrapper.get('[aria-label="Usage for relay 1"]').text()).toContain(outcome === "success" ? "9007199254740993" : "Unavailable");
    if (outcome === "failure") expect(wrapper.text()).toContain("HTTP 503: relay read failed");
    expect(store.editorDirty).toBe(true); expect(store.readOnlyReason).toBe("");
    wrapper.unmount();
  });
  it.each([
    ["simulated", "Simulated (unmeasured)"], ["disabled", "Disabled (unmeasured)"],
    ["stopped", "Stopped (unmeasured)"], ["error", "Unavailable"],
  ])("does not present %s values as measured inactivity", (state, expected) => {
    const store = useControllerStore();
    store.udpRelayStatus.data!.instances[1]!.state = state;
    const wrapper = mount(UDPBroadcastRelayView, { global });
    expect(wrapper.get('[aria-label="Usage for relay 1"]').text()).toContain(expected);
    wrapper.unmount();
  });
  it("expires old samples and shows current socket reset counts after recovery", async () => {
    vi.useFakeTimers();
    const store = useControllerStore(); store.udpRelayStatus.lastSuccess = null; store.udpRelayStatus.lastSuccess = Date.now();
    const wrapper = mount(UDPBroadcastRelayView, { global });
    await vi.advanceTimersByTimeAsync(15001);
    expect(wrapper.get('[aria-label="Usage for relay 1"]').text()).toContain("Stale");
    const sample = udpRelayStatus();
    store.udpRelayStatus.data = { instances: [{ ...sample, state: "error", error: "Bind failed", retrying: true }], error: "" };
    store.udpRelayStatus.lastSuccess = Date.now();
    await flushPromises();
    expect(wrapper.text()).toContain("Relay 1: Bind failed");
    expect(wrapper.get('[aria-label="Usage for relay 1"]').text()).toContain("Unavailable");
    store.udpRelayStatus.data = { instances: [{ ...sample, started_at: "2026-11-01T23:00:00Z", received_packets: "0", transmitted_packets: "0" }], error: "" };
    await flushPromises();
    expect(wrapper.get('[aria-label="Usage for relay 1"]').text()).toContain("Received: 0");
    wrapper.unmount();
  });
});
