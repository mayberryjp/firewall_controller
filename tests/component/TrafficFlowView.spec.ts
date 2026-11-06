import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TrafficFlowView from "@/views/TrafficFlowView.vue";
import { useControllerStore } from "@/stores/controller";
import type { Statistics } from "@/types/domain";
import { state, transaction } from "../fixtures";
import { trafficFlowCapabilities, trafficFlowConfig, trafficFlowStatistics } from "../trafficFlowFixtures";
import * as netcontrol from "@/services/netcontrol";

const stubs = {
  VBtn: { template: '<button><slot /></button>' },
  VProgressLinear: true,
  RouterLink: { props: ["to"], template: '<a><slot /></a>' },
};
const render = () => mount(TrafficFlowView, { global: { stubs } });
let wrapper: ReturnType<typeof render>;
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  setActivePinia(createPinia());
  const store = useControllerStore();
  store.connected = true;
  store.state.data = { ...state(), desired: trafficFlowConfig() };
  store.state.stale = false; store.state.lastSuccess = Date.now();
  vi.spyOn(store, "refreshState").mockResolvedValue();
  vi.spyOn(store, "refreshStatistics").mockResolvedValue();
  vi.spyOn(store, "refreshHostHealth").mockResolvedValue();
  vi.spyOn(netcontrol, "getInterfaceCapabilities").mockResolvedValue(null);
});
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function publish(seconds = 0, increment = 0n, change?: (data: Statistics) => void) {
  const store = useControllerStore(), data = trafficFlowStatistics(seconds, increment);
  change?.(data);
  store.statistics.data = data; store.statistics.stale = false;
  store.statistics.error = null; store.statistics.lastSuccess = Date.now();
  await flushPromises();
}

describe("Traffic flow appliance view", () => {
  it.each([
    ["firewall", "example.test", "firewall.example.test"],
    ["firewall", "", "firewall"],
    ["", "", "Firewall appliance"],
  ])("shows hostname %s and domain %s beside the pause control as %s", async (hostname, domain, expected) => {
    const store = useControllerStore(), desired = trafficFlowConfig();
    desired.system = { hostname, domain, timezone: "UTC" };
    store.state.data = { ...state(), desired };
    wrapper = render(); await flushPromises();
    expect(wrapper.get(".appliance-name").text()).toBe(expected);
    expect(wrapper.find('[aria-label="Pause animation"]').exists()).toBe(true);
  });
  it("keeps pending link speeds neutral and applies independent directional utilization after loading", async () => {
    const snapshot = trafficFlowCapabilities(100);
    let resolve!: (value: typeof snapshot) => void;
    vi.mocked(netcontrol.getInterfaceCapabilities).mockReturnValue(new Promise(done => { resolve = done; }));
    wrapper = render(); await publish(); await publish(3, 3000000n);
    const rx = wrapper.get<SVGElement>('[data-interface="wan0"][data-counter="rx_bytes"]');
    const tx = wrapper.get<SVGElement>('[data-interface="wan0"][data-counter="tx_bytes"]');
    expect(rx.element.style.animationDuration).toBe("6s");
    expect(wrapper.text()).not.toContain("Could not read interface link speeds");
    resolve(snapshot); await flushPromises();
    expect(Number.parseFloat(rx.element.style.animationDuration)).toBeLessThan(Number.parseFloat(tx.element.style.animationDuration));
    expect(Number.parseFloat(rx.element.style.animationDuration)).toBeLessThan(6);
    const lowUsageDuration = rx.element.style.animationDuration;
    await publish(6, 60000000n);
    expect(Number.parseFloat(rx.element.style.animationDuration)).toBeCloseTo(0.65);
    await publish(9, 63000000n);
    expect(rx.element.style.animationDuration).toBe(lowUsageDuration);
    expect(netcontrol.getInterfaceCapabilities).toHaveBeenCalledTimes(1);
  });
  it("shows a real link-speed read failure only after pending initialization completes", async () => {
    let reject!: (error: Error) => void;
    vi.mocked(netcontrol.getInterfaceCapabilities).mockReturnValue(new Promise((_, fail) => { reject = fail; }));
    wrapper = render(); await publish(); await publish(3, 3000000n);
    expect(wrapper.text()).not.toContain("Could not read interface link speeds");
    reject(new Error("Access denied")); await flushPromises();
    expect(wrapper.text()).toContain("Could not read interface link speeds. Access denied");
    expect(wrapper.get<SVGElement>('[data-interface="wan0"][data-counter="rx_bytes"]').element.style.animationDuration).toBe("6s");
    expect(wrapper.findAll(".flow-stream.is-moving")).toHaveLength(8);
  });
  it("places WAN above the appliance and LAN below, streaming both measured directions with exact interface counters", async () => {
    wrapper = render(); await publish(); await publish(3, 3000000n);
    expect(wrapper.find('[aria-label="WAN interfaces"] [aria-label="wan0 interface counters"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="LAN interfaces"]').findAll("article")).toHaveLength(3);
    expect(wrapper.get('[aria-label="wan0 interface counters"] .node-role').text()).toBe("WAN");
    expect(wrapper.get('[aria-label="LAN interfaces"]').findAll("article .node-role").map(label => label.text())).toEqual(["LAN", "LAN", "LAN"]);
    expect(wrapper.find(".zone-heading").exists()).toBe(false);
    expect(wrapper.text()).not.toMatch(/EXTERNAL|INTERNAL/);
    const board = wrapper.get(".flow-board").element;
    expect(wrapper.find(".overview-dashboard").exists()).toBe(false);
    expect(wrapper.find('[aria-label="Customize layout"]').exists()).toBe(false);
    expect([...board.children].map(element => element.classList.contains("appliance") ? "appliance" : element.getAttribute("aria-label"))).toEqual(["WAN interfaces", "appliance", "LAN interfaces"]);
    expect(wrapper.get('[aria-label="wan0 interface counters"] [data-rate="rx"]').text()).toBe("8 Mb/s");
    expect(wrapper.get('[aria-label="wan0 interface counters"] [data-rate="tx"]').text()).toBe("4 Mb/s");
    expect(wrapper.findAll(".flow-stream.is-moving")).toHaveLength(8);
    expect(wrapper.get('[data-interface="wan0"][data-direction="southbound"]').attributes("data-counter")).toBe("rx_bytes");
    expect(wrapper.get('[data-interface="wan0"][data-direction="northbound"]').attributes("data-counter")).toBe("tx_bytes");
    expect(wrapper.get('[data-interface="lab0"][data-direction="southbound"]').attributes("data-counter")).toBe("tx_bytes");
    expect(wrapper.get('[data-interface="lab0"][data-direction="northbound"]').attributes("data-counter")).toBe("rx_bytes");
    expect(wrapper.get("linearGradient").attributes("gradientUnits")).toBe("userSpaceOnUse");
    expect(wrapper.text()).toContain("edge-fw-01");
    const logo = wrapper.get(".appliance-logo");
    expect(logo.attributes("stroke")).toBe("#D5FF38");
    expect(logo.attributes("transform")).toBe("translate(80 111)");
    expect(logo.findAll("circle")).toHaveLength(2);
    expect(wrapper.get(".appliance svg").text()).toContain("MODAN");
    expect(wrapper.get(".appliance svg").text()).not.toContain("FIREWALL");
    expect(wrapper.get(".appliance svg").text()).toContain("KNOW YOUR NETWORK");
    expect(wrapper.get(".appliance svg").text()).not.toContain("TRAFFIC GATEWAY");
    expect(wrapper.get(".appliance").findComponent({ name: "HostPerformanceStrip" }).exists()).toBe(true);
    expect(wrapper.find(".appliance svg [aria-label='Host performance']").exists()).toBe(false);
    expect(wrapper.find('.appliance svg rect[width="22"][height="25"]').exists()).toBe(false);
    expect(wrapper.find('.appliance svg path[d="M 4 5 h 14 v 11 h -4 v 4 h -6 v -4 h -4 Z"]').exists()).toBe(false);
    expect(wrapper.find('path[d="M 121 51 l 13 -7 l 13 7 v 12 l -13 7 l -13 -7 Z"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("1 TB");
    expect(wrapper.text()).toContain("1,000 pps");
  });
  it("never animates a first sample, simulated data or measured zero", async () => {
    wrapper = render(); await publish();
    expect(wrapper.text()).not.toContain("two comparable traffic samples");
    expect(wrapper.find(".flow-notice").exists()).toBe(false);
    expect(wrapper.findAll(".flow-stream")).toHaveLength(0);
    await publish(3);
    expect(wrapper.text()).toContain("0 b/s");
    expect(wrapper.findAll(".flow-stream")).toHaveLength(0);
    await publish(6, 3000000n, data => { data.sample.status = "simulated"; });
    expect(wrapper.text()).toContain("Simulated counters");
    expect(wrapper.findAll(".flow-stream")).toHaveLength(0);
    expect(wrapper.get('[aria-label="wan0 interface counters"] [data-rate="rx"]').text()).toBe("Unavailable");
  });
  it.each(["success", "failure"] as const)("uses neutral initial loading feedback through pending-to-%s", async outcome => {
    const store = useControllerStore();
    store.state.data = null; store.state.lastSuccess = null; store.state.loading = true;
    store.statistics.loading = true;
    wrapper = render();
    expect(wrapper.text()).toContain("Loading your traffic map");
    expect(wrapper.text()).not.toContain("unavailable");
    expect(wrapper.text()).not.toContain("No WAN");
    store.state.data = { ...state(), desired: trafficFlowConfig() }; store.state.loading = false;
    await flushPromises();
    expect(wrapper.text()).toContain("Loading your traffic map");
    if (outcome === "success") {
      await publish();
      expect(wrapper.text()).not.toContain("Loading your traffic map");
      expect(wrapper.text()).not.toContain("two comparable traffic samples");
      expect(wrapper.find(".flow-notice").exists()).toBe(false);
    } else {
      store.statistics.error = "HTTP 403: state.read required"; store.statistics.loading = false;
      await flushPromises();
      expect(wrapper.text()).toContain("HTTP 403");
    }
    expect(wrapper.findAll(".flow-stream")).toHaveLength(0);
  });
  it("stops movement on stale or failed reads, retains previous evidence, then waits for a new baseline", async () => {
    const store = useControllerStore();
    wrapper = render(); await publish(); await publish(3, 3000000n);
    store.statistics.delayed = true; await flushPromises();
    expect(wrapper.findAll(".flow-stream.is-moving")).toHaveLength(0);
    store.statistics.delayed = false;
    store.statistics.stale = true; store.statistics.error = "HTTP 503: counters failed";
    await flushPromises();
    expect(wrapper.findAll(".flow-stream.is-moving")).toHaveLength(0);
    expect(wrapper.get('[aria-label="wan0 interface counters"] [data-rate="rx"]').text()).toBe("8 Mb/s");
    expect(wrapper.text()).toContain("Showing previously loaded data");
    await publish(6, 6000000n);
    expect(wrapper.findAll(".flow-stream")).toHaveLength(0);
    await publish(9, 9000000n);
    expect(wrapper.findAll(".flow-stream.is-moving")).toHaveLength(8);
    store.state.stale = true; await flushPromises();
    expect(wrapper.findAll(".flow-stream.is-moving")).toHaveLength(0);
  });
  it("does not keep saying loading after the interface-role read has failed", async () => {
    const store = useControllerStore();
    store.state.data = null; store.state.lastSuccess = null;
    wrapper = render(); await publish();
    expect(wrapper.text()).toContain("Loading your traffic map");
    store.state.error = "HTTP 403: configuration read denied";
    await flushPromises();
    expect(wrapper.text()).toContain("Interface roles: HTTP 403");
    expect(wrapper.text()).not.toContain("Loading your traffic map");
    expect(wrapper.findAll(".flow-stream")).toHaveLength(0);
  });
  it("keeps a failed interface explicit without hiding valid traffic on other links", async () => {
    wrapper = render(); await publish();
    await publish(3, 3000000n, data => { data.sample.status = "partial"; data.interfaces[0]!.error = "Interface read failed"; });
    expect(wrapper.get('[aria-label="wan0 interface counters"]').text()).toContain("Interface read failed");
    expect(wrapper.findAll('[data-interface="wan0"].flow-stream')).toHaveLength(0);
    expect(wrapper.findAll(".flow-stream.is-moving")).toHaveLength(6);
  });
  it("breaks rates for resets, scope changes, timestamp regressions and replaced interface identities", async () => {
    wrapper = render(); await publish(); await publish(3, 3000000n);
    await publish(6, 100n);
    expect(wrapper.findAll(".flow-stream")).toHaveLength(0);
    await publish(9, 3000100n, data => { data.sample.scope = "new-scope"; });
    expect(wrapper.findAll(".flow-stream")).toHaveLength(0);
    await publish(12, 6000100n, data => { data.sample.scope = "new-scope"; });
    expect(wrapper.findAll(".flow-stream.is-moving")).toHaveLength(8);
    await publish(11, 9000100n, data => { data.sample.scope = "new-scope"; });
    expect(wrapper.findAll(".flow-stream")).toHaveLength(0);
    await publish(15, 12000100n, data => { data.sample.scope = "new-scope"; data.interfaces[0]!.index = 99; });
    expect(wrapper.findAll('[data-interface="wan0"].flow-stream')).toHaveLength(0);
    expect(wrapper.findAll(".flow-stream.is-moving")).toHaveLength(6);
  });
  it("provides pause/resume and resets comparisons across hidden tabs", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    wrapper = render(); await publish(); await publish(3, 3000000n);
    await wrapper.get('[aria-label="Pause animation"]').trigger("click");
    expect(wrapper.findAll(".flow-stream.is-moving")).toHaveLength(0);
    await wrapper.get('[aria-label="Resume animation"]').trigger("click");
    expect(wrapper.findAll(".flow-stream.is-moving")).toHaveLength(8);
    visibility.mockReturnValue("hidden"); document.dispatchEvent(new Event("visibilitychange")); await flushPromises();
    expect(wrapper.findAll(".flow-stream.is-moving")).toHaveLength(0);
    visibility.mockReturnValue("visible"); document.dispatchEvent(new Event("visibilitychange"));
    await publish(9, 9000000n);
    expect(wrapper.findAll(".flow-stream")).toHaveLength(0);
    await publish(12, 12000000n);
    expect(wrapper.findAll(".flow-stream.is-moving")).toHaveLength(8);
  });
  it("clears the previous device's roles, counters and timestamp when sessions change", async () => {
    const store = useControllerStore();
    wrapper = render(); await publish(); await publish(3, 3000000n);
    store.sessionVersion++; await flushPromises();
    expect(wrapper.findAll("article")).toHaveLength(0);
    expect(wrapper.find("time").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("edge-fw-01");
    store.state.data = { ...state(), desired: trafficFlowConfig() };
    await publish(6, 6000000n);
    expect(wrapper.findAll(".flow-stream")).toHaveLength(0);
    await publish(9, 9000000n);
    expect(wrapper.findAll(".flow-stream.is-moving")).toHaveLength(8);
    store.connected = false; await flushPromises();
    expect(wrapper.findAll("article")).toHaveLength(0);
  });
  it("uses applied state rather than drafts, without the removed headings or footer", async () => {
    const store = useControllerStore();
    wrapper = render(); await publish(); await publish(3, 3000000n);
    const draft = trafficFlowConfig(); draft.interfaces[0]!.role = "lan";
    draft.system!.timezone = "America/Los_Angeles"; store.draft = draft;
    await flushPromises();
    expect(wrapper.get('[aria-label="WAN interfaces"]').text()).toContain("wan0");
    expect(wrapper.get('[aria-label="wan0 interface counters"] .node-role').text()).toBe("WAN");
    expect(wrapper.find("footer").exists()).toBe(false);
    expect(wrapper.find("h1").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("NETWORK IN MOTION");
    expect(wrapper.find('[aria-label="Host performance"]').exists()).toBe(true);
    const pending = transaction("pending_confirmation"); pending.candidate = draft;
    store.state.data = { ...store.state.data!, active_transaction: pending };
    await flushPromises();
    expect(wrapper.get('[aria-label="WAN interfaces"]').findAll("article")).toHaveLength(0);
    expect(wrapper.get('[aria-label="LAN interfaces"]').findAll("article")).toHaveLength(4);
    expect(wrapper.get('[aria-label="wan0 interface counters"] .node-role').text()).toBe("LAN");
  });
  it("does not recenter the user's map pan on every statistics update", async () => {
    wrapper = render(); await publish();
    const viewport = wrapper.get<HTMLElement>(".flow-viewport").element;
    viewport.scrollLeft = 37;
    await publish(3, 3000000n);
    expect(viewport.scrollLeft).toBe(37);
  });
  it("explains unassigned interfaces without inventing LAN links or making writes", async () => {
    const store = useControllerStore(), desired = trafficFlowConfig();
    desired.interfaces.forEach(item => { item.role = "unassigned"; });
    store.state.data = { ...state(), desired };
    wrapper = render(); await publish();
    expect(wrapper.findAll("article")).toHaveLength(0);
    expect(wrapper.text()).toContain("Assign WAN or LAN roles");
    expect(wrapper.find("footer").exists()).toBe(false);
    expect(store.draft).toBeNull();
    expect(store.refreshState).toHaveBeenCalledTimes(1);
    expect(store.refreshStatistics).toHaveBeenCalledTimes(1);
  });
  it("removes disabled/down interfaces, restores recovered links and keeps failed reads explicit", async () => {
    const store = useControllerStore(), desired = trafficFlowConfig();
    desired.interfaces[2]!.up = false;
    store.state.data = { ...state(), desired };
    wrapper = render();
    await publish(0, 0n, data => { data.interfaces[0]!.oper_state = "DOWN"; });
    expect(wrapper.findAll("article")).toHaveLength(2);
    expect(wrapper.find('[aria-label="wan0 interface counters"]').exists()).toBe(false);
    await publish(3, 3000000n);
    expect(wrapper.findAll("article")).toHaveLength(3);
    await publish(6, 6000000n, data => {
      data.interfaces[0]!.oper_state = "DOWN"; data.interfaces[0]!.error = "Link read failed";
    });
    expect(wrapper.get('[aria-label="wan0 interface counters"]').text()).toContain("Link read failed");
    expect(store.draft).toBeNull();
  });
});
