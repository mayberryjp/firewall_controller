import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BGPView from "@/views/BGPView.vue";
import BGPRoutesView from "@/views/BGPRoutesView.vue";
import DNATView from "@/views/DNATView.vue";
import OverviewBGP from "@/components/feature/OverviewBGP.vue";
import { useControllerStore } from "@/stores/controller";
import * as api from "@/services/netcontrol";
import { ApiFailure } from "@/services/api";
import { bgpConfig, bgpStatus, bgpRoutes, bgpAdvertisedRoutes, dnatRule } from "../bgpFixtures";
import { state } from "../fixtures";
import { dragRule } from "../dragRule";

const field = {
  props: ["modelValue", "disabled", "label", "items"], emits: ["update:modelValue"],
  template: '<input :aria-label="label" :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)" />',
};
const stubs = {
  VTable: { template: "<table><slot /></table>" },
  VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
  VTextField: field, VTextarea: field, VSelect: field,
  VTabs: { props: ["modelValue"], emits: ["update:modelValue"], template: '<div><slot /><button @click="$emit(\'update:modelValue\', \'advertised\')">Show advertised routes</button><button @click="$emit(\'update:modelValue\', \'received\')">Show received routes</button></div>' },
  VTab: { template: "<span><slot /></span>" },
  VDivider: true,
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
  vi.spyOn(api, "getBGPAdvertisedRoutes").mockResolvedValue(bgpAdvertisedRoutes());
});
afterEach(() => { wrapper?.unmount(); useControllerStore().$dispose(); vi.useRealTimers(); });
const button = (text: string) => wrapper.findAll("button").find(row => row.text() === text)!;
const input = (label: string) => wrapper.get(`input[aria-label="${label}"]`);
describe("focused inline BGP and DNAT management", () => {
  it("shows observed process status independently of draft settings and neutralizes stale status", async () => {
    const store = useControllerStore();
    wrapper = mount(BGPView, { global: { stubs } }); await flushPromises();
    const chip = () => wrapper.get('[aria-label="BGP process status"]');
    expect(chip().text()).toBe("Running"); expect(chip().attributes("data-color")).toBe("success");
    await input("BGP enabled").setValue(false);
    expect(chip().text()).toBe("Running");
    store.bgpStatus.data = { ...bgpStatus(), state: "stopped" }; await flushPromises();
    expect(chip().text()).toBe("Stopped"); expect(chip().attributes("data-color")).toBe("default");
    store.bgpStatus.data = { ...bgpStatus(), error: "Worker unavailable" }; await flushPromises();
    expect(chip().text()).toBe("Error");
    store.bgpStatus.stale = true; await flushPromises();
    expect(chip().text()).toBe("Unknown"); expect(chip().attributes("data-color")).toBe("default");
  });
  it("shows peer status and counts separately from process settings and route details", async () => {
    const store = useControllerStore(), before = JSON.stringify(store.state.data!.desired);
    const observed = bgpStatus();
    observed.neighbors = observed.neighbors?.map(peer => ({ ...peer, rejected_prefixes: 10, remote_router_id: "192.168.4.4", negotiated_hold_seconds: 90 }));
    vi.mocked(api.getBGPStatus).mockResolvedValue(observed);
    wrapper = mount(BGPView, { props: { mode: "peers" }, global: { stubs } }); await flushPromises();
    expect(wrapper.find(".chip").text()).toBe("Established");
    expect(wrapper.find(".chip").attributes("data-color")).toBe("success");
    expect(wrapper.find('input[aria-label="Local ASN"]').exists()).toBe(false);
    expect(wrapper.findAll("tbody td").slice(6, 8).map(cell => cell.text())).toEqual(["2", "1"]);
    expect(wrapper.findAll("thead th").slice(8).map(cell => cell.text())).toEqual(["Rejected prefixes", "Actions"]);
    expect(wrapper.findAll("tbody td")[8]!.text()).toBe("10");
    store.bgpStatus.data = { ...observed, neighbors: observed.neighbors?.map(peer => ({ ...peer, rejected_prefixes: 0, remote_router_id: null, negotiated_hold_seconds: null })) };
    await flushPromises();
    expect(wrapper.findAll("tbody td")[8]!.text()).toBe("0");
    expect(wrapper.text()).not.toContain("connected_or_static_route");
    store.bgpStatus.stale = true;
    await flushPromises();
    expect(wrapper.findAll("tbody td").slice(6, 8).map(cell => cell.text())).toEqual(["Unknown", "Unknown"]);
    expect(wrapper.findAll("tbody td")[8]!.text()).toBe("Unknown");
    wrapper.unmount();
    wrapper = mount(BGPRoutesView, { global: { stubs } }); await flushPromises();
    expect(wrapper.findAll("thead th").map(cell => cell.text())).toEqual(["Prefix", "Peer", "Interface", "Next hop", "AS path", "Selected", "Installed"]);
    expect(wrapper.text()).not.toContain("connected_or_static_route");
    expect(wrapper.find("table").text()).toContain("YesNo");
    expect(api.getBGPAdvertisedRoutes).not.toHaveBeenCalled();
    await button("Show advertised routes").trigger("click"); await flushPromises();
    expect(api.getBGPAdvertisedRoutes).toHaveBeenCalledOnce();
    expect(store.bgpRouteDirection).toBe("advertised");
    expect(wrapper.findAll("thead th").map(cell => cell.text())).toEqual(["Prefix", "Peer", "Interface", "Next hop"]);
    expect(wrapper.findAll("tbody tr")).toHaveLength(2);
    expect(wrapper.text()).not.toContain("connected_or_static_route");
    await input("Neighbor").setValue("second");
    expect(wrapper.findAll("tbody tr")).toHaveLength(1);
    expect(wrapper.find("tbody").text()).toContain("second");
    expect(JSON.stringify(store.state.data!.desired)).toBe(before);
    expect(store.draft).toBeNull(); expect(store.editorDirty).toBe(false);
  });
  it("clears advertised inventory on withdrawal, expiry and worker failure without affecting received routes", async () => {
    vi.useFakeTimers();
    const store = useControllerStore();
    wrapper = mount(BGPRoutesView, { global: { stubs } }); await flushPromises();
    await button("Show advertised routes").trigger("click"); await flushPromises();
    expect(wrapper.findAll("tbody tr")).toHaveLength(2);
    vi.mocked(api.getBGPAdvertisedRoutes).mockResolvedValue({ ...bgpAdvertisedRoutes(), routes: [] });
    await store.refreshBGPAdvertisedRoutes(); await flushPromises();
    expect(wrapper.text()).toContain("No advertised BGP routes.");
    vi.mocked(api.getBGPAdvertisedRoutes).mockResolvedValue(bgpAdvertisedRoutes());
    await store.refreshBGPAdvertisedRoutes(); await flushPromises();
    await vi.advanceTimersByTimeAsync(15001);
    expect(wrapper.text()).toContain("Advertised BGP routes unavailable.");
    expect(wrapper.text()).not.toContain("203.0.113.0/24");
    vi.mocked(api.getBGPAdvertisedRoutes).mockResolvedValue({ ...bgpAdvertisedRoutes(), state: "stopped" });
    await store.refreshBGPAdvertisedRoutes(); await flushPromises();
    expect(wrapper.text()).not.toContain("203.0.113.0/24");
    vi.mocked(api.getBGPAdvertisedRoutes).mockRejectedValue(new ApiFailure("Advertised endpoint unavailable", 404));
    await store.refreshBGPAdvertisedRoutes(); await flushPromises();
    expect(store.bgpAdvertisedRoutes.error).toContain("unavailable");
    expect(store.bgpUnsupported).toBe(false); expect(store.readOnlyReason).toBe("");
    await button("Show received routes").trigger("click"); await flushPromises();
    expect(wrapper.text()).not.toContain("connected_or_static_route");
    expect(store.bgpRouteDirection).toBe("received");
    store.disconnect();
    expect(store.bgpAdvertisedRoutes.data).toBeNull();
  });
  it("adds, edits, and deletes peers inline without popup confirmations and preserves settings", async () => {
    const store = useControllerStore(), confirm = vi.spyOn(window, "confirm");
    const metadata = { display_name: "Transit", description: "Preserve existing labels" };
    store.state.data!.desired.bgp!.neighbors[0]!.metadata = metadata;
    store.state.data!.desired.bgp!.neighbors[0]!.accept_default = true;
    wrapper = mount(BGPView, { props: { mode: "peers" }, global: { stubs } }); await flushPromises();
    await button("Add BGP peer").trigger("click");
    expect(wrapper.find("details").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Accept default route");
    expect(wrapper.find('input[aria-label="Display name"]').exists()).toBe(false);
    await input("Peer name").setValue("second"); await input("Peer address").setValue("192.0.2.3");
    await input("Peer interface").setValue("lab0"); await input("Local address").setValue("192.0.2.10");
    expect(store.editorDirty).toBe(true);
    await button("Save peer").trigger("click"); await flushPromises();
    expect(store.draft!.bgp!.neighbors).toHaveLength(2); expect(store.editorDirty).toBe(false);
    expect(store.draft!.bgp!.neighbors.find(peer => peer.name === "second")!.accept_default).toBe(false);
    expect(store.draft!.bgp!.keepalive_seconds).toBe(30);
    await wrapper.get('[aria-label="Edit BGP peer remote"]').trigger("click");
    expect(wrapper.find("details").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Accept default route");
    await input("Remote ASN").setValue("65003"); await button("Save peer").trigger("click"); await flushPromises();
    expect(store.draft!.bgp!.neighbors.find(peer => peer.name === "remote")!.remote_asn).toBe(65003);
    expect(store.draft!.bgp!.neighbors.find(peer => peer.name === "remote")!.accept_default).toBe(false);
    expect(store.draft!.bgp!.neighbors.find(peer => peer.name === "remote")!.metadata).toEqual(metadata);
    await wrapper.get('[aria-label="Delete BGP peer second"]').trigger("click"); await flushPromises();
    expect(store.draft!.bgp!.neighbors).toHaveLength(1);
    expect(store.draft!.firewall.nat.masquerade).toEqual(bgpConfig().firewall.nat.masquerade);
    expect(confirm).not.toHaveBeenCalled();
  });
  it("stages process identity, then the first peer, before enabling the process", async () => {
    const store = useControllerStore(); delete store.state.data!.desired.bgp;
    wrapper = mount(BGPView, { global: { stubs } }); await flushPromises();
    expect(store.editorDirty).toBe(false);
    expect(wrapper.findAll("table")).toHaveLength(0);
    expect(wrapper.findAll("details")).toHaveLength(0);
    expect(input("Keepalive (seconds)").element).toHaveProperty("value", "30");
    expect(input("BGP enabled").attributes("color")).toBe("primary");
    await input("Local ASN").setValue("65001"); await input("Router ID").setValue("192.0.2.10");
    await button("Save BGP settings").trigger("click"); await flushPromises();
    expect(store.draft!.bgp!.enabled).toBe(false);
    wrapper.unmount();
    wrapper = mount(BGPView, { props: { mode: "peers" }, global: { stubs } }); await flushPromises();
    await button("Add BGP peer").trigger("click");
    await input("Peer name").setValue("first"); await input("Peer address").setValue("192.0.2.2");
    await input("Peer interface").setValue("lab0"); await input("Local address").setValue("192.0.2.10");
    await button("Save peer").trigger("click"); await flushPromises();
    expect(store.draft!.bgp!.neighbors[0]!.name).toBe("first");
    wrapper.unmount();
    wrapper = mount(BGPView, { global: { stubs } }); await flushPromises();
    await input("BGP enabled").setValue(true);
    await button("Save BGP settings").trigger("click"); await flushPromises();
    expect(store.draft!.bgp).toMatchObject({ enabled: true, local_asn: 65001, neighbors: [{ name: "first" }] });
    expect(store.validation).toEqual([]); expect(store.editorDirty).toBe(false);
  });
  it("validates invalid peers inline and retains unstaged form input across failed status polling", async () => {
    const store = useControllerStore();
    wrapper = mount(BGPView, { props: { mode: "peers" }, global: { stubs } }); await flushPromises();
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
    expect(wrapper.findAll(".setting-row").map(row => row.get("label").text())).toEqual([
      "BGP enabled", "Local ASN", "Router ID", "Keepalive (seconds)", "Hold (seconds)", "Maximum prefixes",
    ]);
    expect(wrapper.findAll(".setting-row").every(row => row.findAll("input").length === 1)).toBe(true);
    await input("BGP enabled").setValue(false); await button("Save BGP settings").trigger("click"); await flushPromises();
    expect(store.draft!.bgp!.enabled).toBe(false); expect(store.editorDirty).toBe(false);
    await input("Local ASN").setValue("65004"); expect(store.editorDirty).toBe(true);
    await button("Cancel").trigger("click"); expect(store.draft!.bgp!.local_asn).toBe(65001);
    expect(store.editorDirty).toBe(false); expect(confirm).not.toHaveBeenCalled();
  });
  it("adds, edits, reorders and deletes DNAT rules without touching masquerade or BGP", async () => {
    const store = useControllerStore(), confirm = vi.spyOn(window, "confirm");
    const original = { ...dnatRule(), metadata: { display_name: "DNS", description: "Existing metadata" } };
    store.state.data!.desired.firewall.nat.destination_rewrite = [original];
    store.state.data!.desired.interfaces.push(
      { ...store.state.data!.desired.interfaces[0]!, name: "wan0.20", role: "lan", kind: "vlan", vlan: { parent: "wan0", id: 20 }, addresses: ["192.0.3.1/24"] },
      { ...store.state.data!.desired.interfaces[0]!, name: "wan0.30", role: "wan", kind: "vlan", vlan: { parent: "wan0", id: 30 }, addresses: ["192.0.4.1/24"] },
      { ...store.state.data!.desired.interfaces[0]!, name: "wan0.40", role: "unassigned", kind: "vlan", vlan: { parent: "wan0", id: 40 }, addresses: ["192.0.5.1/24"] },
    );
    wrapper = mount(DNATView, { global: { stubs } });
    await wrapper.get('[aria-label="Edit DNAT rule 1"]').trigger("click");
    expect(wrapper.find("details").exists()).toBe(false);
    expect(wrapper.find('input[aria-label="Display name"]').exists()).toBe(false);
    expect(wrapper.find('input[aria-label="Description"]').exists()).toBe(false);
    await input("Port").setValue("54");
    await button("Save").trigger("click"); await flushPromises();
    expect(store.draft!.firewall.nat.destination_rewrite![0]!.metadata).toEqual(original.metadata);
    await button("Add DNAT rule").trigger("click");
    expect((wrapper.getComponent('input[aria-label="Target interface"]') as VueWrapper).props()).toMatchObject({ items: expect.arrayContaining([expect.objectContaining({ value: "wan0.20" })]) });
    expect((wrapper.getComponent('input[aria-label="Target interface"]') as VueWrapper).props()).not.toMatchObject({ items: expect.arrayContaining([expect.objectContaining({ value: "wan0.30" })]) });
    expect((wrapper.getComponent('input[aria-label="Target interface"]') as VueWrapper).props()).not.toMatchObject({ items: expect.arrayContaining([expect.objectContaining({ value: "wan0.40" })]) });
    for (const [label, value] of [["WAN", "wan0"], ["Protocol", "tcp"], ["Target interface", "wan0.20"], ["Target address", "192.0.3.53"]]) await input(label!).setValue(value);
    await button("Save").trigger("click"); await flushPromises();
    expect(store.draft!.firewall.nat.destination_rewrite).toHaveLength(2); expect(store.editorDirty).toBe(false);
    expect(store.draft!.firewall.nat.destination_rewrite![1]).toMatchObject({ target_interface: "wan0.20", target_address: "192.0.3.53" });
    await wrapper.get('[aria-label="Edit DNAT rule 2"]').trigger("click");
    await input("Port").setValue("5353"); await button("Save").trigger("click"); await flushPromises();
    expect(store.draft!.firewall.nat.destination_rewrite![1]!.destination_port).toBe(5353);
    expect(wrapper.find('button[aria-label^="Move DNAT rule"]').exists()).toBe(false);
    await dragRule(wrapper.get('[aria-label="Drag DNAT rule 2"]'), wrapper.get('[data-rule-index="0"]').element, "touch");
    await flushPromises();
    expect(store.draft!.firewall.nat.destination_rewrite![0]!.destination_port).toBe(5353);
    await wrapper.get('[aria-label="Delete DNAT rule 1"]').trigger("click"); await flushPromises();
    expect(store.draft!.firewall.nat.destination_rewrite).toEqual([{ ...original, destination_port: 54 }]);
    expect(store.draft!.bgp).toEqual(bgpConfig().bgp);
    expect(store.draft!.firewall.nat.masquerade).toEqual(bgpConfig().firewall.nat.masquerade);
    expect(confirm).not.toHaveBeenCalled();
  });
  it("rejects DNAT targeting the router inline, while retaining the editor and dirty protection", async () => {
    const store = useControllerStore();
    wrapper = mount(DNATView, { global: { stubs } }); await button("Add DNAT rule").trigger("click");
    for (const [label, value] of [["WAN", "wan0"], ["Protocol", "udp"], ["Target interface", "lab0"], ["Target address", "192.0.2.10"]]) await input(label!).setValue(value);
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
