import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BGPView from "@/views/BGPView.vue";
import DNATView from "@/views/DNATView.vue";
import OverviewBGP from "@/components/feature/OverviewBGP.vue";
import { useControllerStore } from "@/stores/controller";
import * as api from "@/services/netcontrol";
import { ApiFailure } from "@/services/api";
import { bgpConfig, bgpStatus, bgpRoutes, dnatRule } from "../bgpFixtures";
import { state } from "../fixtures";

const field = {
  props: ["modelValue", "disabled", "label"], emits: ["update:modelValue"],
  template: '<input :aria-label="label" :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)" />',
};
const stubs = {
  VTable: { template: "<table><slot /></table>" },
  VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
  VTextField: field, VTextarea: field, VSelect: field,
  VSwitch: { props: ["modelValue", "label", "disabled"], emits: ["update:modelValue"], template: '<input type="checkbox" :aria-label="label" :checked="modelValue" :disabled="disabled" @change="$emit(\'update:modelValue\', $event.target.checked)" />' },
  VChip: { props: ["color"], template: '<span class="chip" :data-color="color"><slot /></span>' },
  DatasetStatus: true, OverviewWidget: { template: "<section><slot /></section>" },
};
let wrapper: ReturnType<typeof mount>;
beforeEach(() => {
  setActivePinia(createPinia());
  const store = useControllerStore();
  store.connected = true; store.state.data = { ...state(), desired: bgpConfig(), observed: bgpConfig() };
  store.state.stale = false; store.state.lastSuccess = Date.now();
  vi.spyOn(api, "getBGPStatus").mockResolvedValue(bgpStatus());
  vi.spyOn(api, "getBGPRoutes").mockResolvedValue(bgpRoutes());
});
afterEach(() => { wrapper?.unmount(); useControllerStore().$dispose(); vi.useRealTimers(); });
const button = (text: string) => wrapper.findAll("button").find(row => row.text() === text)!;
const input = (label: string) => wrapper.get(`input[aria-label="${label}"]`);
describe("focused inline BGP and DNAT management", () => {
  it("shows a colored peer status and keeps learned routes read-only and installed distinct from selected", async () => {
    const store = useControllerStore(), before = JSON.stringify(store.state.data!.desired);
    wrapper = mount(BGPView, { global: { stubs } }); await flushPromises();
    expect(wrapper.find(".chip").text()).toBe("Established");
    expect(wrapper.find(".chip").attributes("data-color")).toBe("success");
    expect(wrapper.text()).toContain("connected_or_static_route");
    expect(wrapper.findAll("table")[1]!.text()).toContain("YesNo");
    expect(JSON.stringify(store.state.data!.desired)).toBe(before);
    expect(store.draft).toBeNull(); expect(store.editorDirty).toBe(false);
  });
  it("adds, edits, and deletes peers inline without popup confirmations and preserves settings", async () => {
    const store = useControllerStore(), confirm = vi.spyOn(window, "confirm");
    wrapper = mount(BGPView, { global: { stubs } }); await flushPromises();
    await button("Add BGP peer").trigger("click");
    await input("Peer name").setValue("second"); await input("Peer address").setValue("192.0.2.3");
    await input("Peer interface").setValue("lab0"); await input("Local address").setValue("192.0.2.10");
    expect(store.editorDirty).toBe(true);
    await button("Save peer").trigger("click"); await flushPromises();
    expect(store.draft!.bgp!.neighbors).toHaveLength(2); expect(store.editorDirty).toBe(false);
    expect(store.draft!.bgp!.keepalive_seconds).toBe(30);
    await wrapper.get('[aria-label="Edit BGP peer second"]').trigger("click");
    await input("Remote ASN").setValue("65003"); await button("Save peer").trigger("click"); await flushPromises();
    expect(store.draft!.bgp!.neighbors.find(peer => peer.name === "second")!.remote_asn).toBe(65003);
    await wrapper.get('[aria-label="Delete BGP peer second"]').trigger("click"); await flushPromises();
    expect(store.draft!.bgp!.neighbors).toHaveLength(1);
    expect(store.draft!.firewall.nat.masquerade).toEqual(bgpConfig().firewall.nat.masquerade);
    expect(confirm).not.toHaveBeenCalled();
  });
  it("stages the first peer together with the identity and enable switch without requiring an invalid intermediate draft", async () => {
    const store = useControllerStore(); delete store.state.data!.desired.bgp;
    wrapper = mount(BGPView, { global: { stubs } }); await flushPromises();
    expect(store.editorDirty).toBe(false);
    await input("Local ASN").setValue("65001"); await input("Router ID").setValue("192.0.2.10"); await input("BGP enabled").setValue(true);
    await button("Add BGP peer").trigger("click");
    await input("Peer name").setValue("first"); await input("Peer address").setValue("192.0.2.2");
    await input("Peer interface").setValue("lab0"); await input("Local address").setValue("192.0.2.10");
    await button("Save peer").trigger("click"); await flushPromises();
    expect(store.draft!.bgp).toMatchObject({ enabled: true, local_asn: 65001, neighbors: [{ name: "first" }] });
    expect(store.validation).toEqual([]); expect(store.editorDirty).toBe(false);
  });
  it("validates invalid peers inline and retains unstaged form input across failed status polling", async () => {
    const store = useControllerStore();
    wrapper = mount(BGPView, { global: { stubs } }); await flushPromises();
    await wrapper.get('[aria-label="Edit BGP peer remote"]').trigger("click");
    await input("Remote ASN").setValue("23456"); await button("Save peer").trigger("click"); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("ASN");
    vi.mocked(api.getBGPStatus).mockRejectedValue(new ApiFailure("BGP unavailable", 503));
    await store.refreshBGPStatus();
    expect(input("Remote ASN").element).toHaveProperty("value", "23456"); expect(store.editorDirty).toBe(true); expect(store.draft).toBeNull();
    await button("Cancel").trigger("click"); expect(store.editorDirty).toBe(false);
  });
  it("stages identity and on/off settings directly and cancels unstaged settings without affecting the draft", async () => {
    const store = useControllerStore(), confirm = vi.spyOn(window, "confirm");
    wrapper = mount(BGPView, { global: { stubs } }); await flushPromises();
    await input("BGP enabled").setValue(false); await button("Save BGP settings").trigger("click"); await flushPromises();
    expect(store.draft!.bgp!.enabled).toBe(false); expect(store.editorDirty).toBe(false);
    await input("Local ASN").setValue("65004"); expect(store.editorDirty).toBe(true);
    await button("Cancel").trigger("click"); expect(store.draft!.bgp!.local_asn).toBe(65001);
    expect(store.editorDirty).toBe(false); expect(confirm).not.toHaveBeenCalled();
  });
  it("adds, edits, reorders and deletes DNAT rules without touching masquerade or BGP", async () => {
    const store = useControllerStore(), confirm = vi.spyOn(window, "confirm");
    store.state.data!.desired.firewall.nat.destination_rewrite = [dnatRule()];
    wrapper = mount(DNATView, { global: { stubs } });
    await button("Add DNAT rule").trigger("click");
    for (const [label, value] of [["WAN", "wan0"], ["Protocol", "tcp"], ["Target LAN", "lab0"], ["Target address", "192.0.2.53"]]) await input(label!).setValue(value);
    await button("Save").trigger("click"); await flushPromises();
    expect(store.draft!.firewall.nat.destination_rewrite).toHaveLength(2); expect(store.editorDirty).toBe(false);
    await wrapper.get('[aria-label="Edit DNAT rule 2"]').trigger("click");
    await input("Port").setValue("5353"); await button("Save").trigger("click"); await flushPromises();
    expect(store.draft!.firewall.nat.destination_rewrite![1]!.destination_port).toBe(5353);
    await wrapper.get('[aria-label="Move DNAT rule 2 up"]').trigger("click"); await flushPromises();
    expect(store.draft!.firewall.nat.destination_rewrite![0]!.destination_port).toBe(5353);
    await wrapper.get('[aria-label="Delete DNAT rule 1"]').trigger("click"); await flushPromises();
    expect(store.draft!.firewall.nat.destination_rewrite).toEqual([dnatRule()]);
    expect(store.draft!.bgp).toEqual(bgpConfig().bgp);
    expect(store.draft!.firewall.nat.masquerade).toEqual(bgpConfig().firewall.nat.masquerade);
    expect(confirm).not.toHaveBeenCalled();
  });
  it("rejects DNAT targeting the router inline, while retaining the editor and dirty protection", async () => {
    const store = useControllerStore();
    wrapper = mount(DNATView, { global: { stubs } }); await button("Add DNAT rule").trigger("click");
    for (const [label, value] of [["WAN", "wan0"], ["Protocol", "udp"], ["Target LAN", "lab0"], ["Target address", "192.0.2.10"]]) await input(label!).setValue(value);
    await button("Save").trigger("click"); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("not a firewall address");
    expect(store.editorDirty).toBe(true); expect(store.draft).toBeNull();
  });
  it("does not enable the DNAT editor on older backend reads", () => {
    delete useControllerStore().state.data!.desired.firewall.nat.destination_rewrite;
    wrapper = mount(DNATView, { global: { stubs } });
    expect(button("Add DNAT rule").element).toHaveProperty("disabled", true);
    expect(wrapper.text()).toContain("Deploy a backend");
  });
  it("renders applied peers in the overview, not draft peers, and goes neutral on expiry", async () => {
    vi.useFakeTimers();
    const store = useControllerStore();
    wrapper = mount(OverviewBGP, { global: { stubs } }); await flushPromises();
    expect(store.bgpMonitoring).toBe(true); expect(wrapper.get(".chip").text()).toBe("Established");
    store.stage(store.state.data!.desired);
    store.draft!.bgp!.neighbors[0]!.name = "draft-only";
    await flushPromises(); expect(wrapper.text()).not.toContain("draft-only");
    await vi.advanceTimersByTimeAsync(15001);
    expect(wrapper.get(".chip").text()).toBe("Unknown"); expect(wrapper.get(".chip").attributes("data-color")).toBe("default");
    wrapper.unmount(); expect(store.bgpMonitoring).toBe(false);
  });
  it("deduplicates unsupported reads and does not lock unrelated configuration", async () => {
    const store = useControllerStore();
    vi.mocked(api.getBGPStatus).mockRejectedValue(new ApiFailure("BGP endpoint unavailable", 404));
    await Promise.all([store.refreshBGPStatus(), store.refreshBGPStatus()]);
    await store.refreshBGPStatus();
    expect(api.getBGPStatus).toHaveBeenCalledOnce(); expect(store.bgpUnsupported).toBe(true);
    expect(store.readOnlyReason).toBe(""); expect(store.bgpStatus.error).toContain("unavailable");
  });
});
