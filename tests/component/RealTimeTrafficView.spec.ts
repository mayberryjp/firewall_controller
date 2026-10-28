import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApexOptions } from "apexcharts";
import RealTimeTrafficView from "@/views/RealTimeTrafficView.vue";
import { useControllerStore } from "@/stores/controller";
import { trafficHistoryLimit } from "@/services/traffic";
import { statistics, trafficStatistics } from "../fixtures";

vi.mock("vue3-apexcharts", () => ({ default: {
  name: "TrafficChart", props: ["options", "series", "height"], template: '<div class="apex-chart-stub" />',
} }));
const select = { props: ["modelValue", "items"], emits: ["update:modelValue"], template: "<div />" };
function render() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:pathMatch(.*)*", component: RealTimeTrafficView }] });
  return mount(RealTimeTrafficView, { global: { plugins: [router], stubs: { VSelect: select, VProgressLinear: true } } });
}
let wrapper: ReturnType<typeof render>;
beforeEach(() => {
  setActivePinia(createPinia());
  const store = useControllerStore();
  store.connected = true;
  vi.spyOn(store, "refreshStatistics").mockResolvedValue();
});
afterEach(() => { wrapper?.unmount(); });
async function sample(seconds: number, increment = 0n) {
  const store = useControllerStore();
  store.statistics.data = trafficStatistics(seconds, increment);
  store.statistics.stale = false; store.statistics.error = null;
  await flushPromises();
}
function charts() { return wrapper.findAllComponents({ name: "TrafficChart" }); }

describe("Real Time Traffic", () => {
  it("honors interface deep links and updates when the route changes", async () => {
    wrapper = render();
    await wrapper.vm.$router.push("/diagnostics/traffic?interface=eth1");
    await sample(0); await sample(3, 300n);
    expect(charts()[0]!.props("series").map((item: { name: string }) => item.name)).toEqual(["eth1"]);
    await wrapper.vm.$router.push("/diagnostics/traffic?interface=eth0"); await flushPromises();
    expect(charts()[0]!.props("series").map((item: { name: string }) => item.name)).toEqual(["eth0"]);
    await wrapper.vm.$router.push("/diagnostics/traffic"); await flushPromises();
    expect(charts()[0]!.props("series")).toHaveLength(2);
  });
  it("keeps an accessible page label without a large page heading", () => {
    wrapper = render();
    expect(wrapper.find('section[aria-label="Real Time Traffic"]').exists()).toBe(true);
    expect(wrapper.find("h1").exists()).toBe(false);
  });
  it("defaults to both live charts with one combined inbound/outbound line per interface", async () => {
    wrapper = render();
    expect(useControllerStore().refreshStatistics).toHaveBeenCalledTimes(1);
    expect(wrapper.findAllComponents(select).map(control => control.props("modelValue"))).toEqual(["", "both"]);
    await sample(0); await sample(3, 300n);
    expect(charts()).toHaveLength(2);
    expect(charts().map(chart => chart.props("height"))).toEqual(["220", "220"]);
    expect(charts()[0]!.props("series")).toEqual([
      { name: "eth0", data: [{ x: Date.parse(trafficStatistics().sample.collected_at), y: null }, { x: Date.parse(trafficStatistics(3).sample.collected_at), y: 300 }] },
      { name: "eth1", data: [{ x: Date.parse(trafficStatistics().sample.collected_at), y: null }, { x: Date.parse(trafficStatistics(3).sample.collected_at), y: 600 }] },
    ]);
    expect(charts()[1]!.props("series")[0].data.at(-1).y).toBe(700);
    expect(charts()[1]!.props("series")[1].data.at(-1).y).toBe(1400);
  });
  it("drills into one interface without discarding history and switches graph visibility", async () => {
    wrapper = render(); await sample(0); await sample(3, 300n);
    const controls = wrapper.findAllComponents(select);
    expect(controls[0]!.props("items")).toEqual([
      { title: "All interfaces", value: "" }, { title: "eth0", value: "eth0" }, { title: "eth1", value: "eth1" },
    ]);
    const allColors = charts()[0]!.props("options").colors;
    controls[0]!.vm.$emit("update:modelValue", "eth1"); await flushPromises();
    expect(charts()[0]!.props("series")).toHaveLength(1);
    expect(charts()[0]!.props("series")[0].name).toBe("eth1");
    expect(charts()[0]!.props("series")[0].data.at(-1).y).toBe(600);
    expect(charts()[1]!.props("series")[0].data.at(-1).y).toBe(1400);
    expect(charts()[0]!.props("options").colors).toEqual([allColors[1]]);
    expect(charts()[0]!.props("options").legend.showForSingleSeries).toBe(true);
    controls[1]!.vm.$emit("update:modelValue", "packets"); await flushPromises();
    expect(charts()).toHaveLength(1);
    expect(wrapper.text()).toContain("Packets"); expect(wrapper.text()).not.toContain("Bytes");
    controls[1]!.vm.$emit("update:modelValue", "bytes"); await flushPromises();
    expect(wrapper.text()).toContain("Bytes"); expect(wrapper.text()).not.toContain("Packets");
    controls[0]!.vm.$emit("update:modelValue", ""); await flushPromises();
    expect(charts()[0]!.props("series")[0].data.at(-1).y).toBe(300);
  });
  it("keeps appending fresh bytes and packets when collection start timestamps change on every poll", async () => {
    wrapper = render();
    await sample(0); await sample(3, 300n); await sample(6, 900n);
    for (const chart of charts()) {
      expect(chart.props("series")[0].data).toHaveLength(3);
      expect(chart.props("series")[1].data).toHaveLength(3);
    }
    expect(charts()[0]!.props("series")[0].data.map((point: { y: number | null }) => point.y)).toEqual([null, 300, 600]);
    expect(charts()[0]!.props("series")[1].data.map((point: { y: number | null }) => point.y)).toEqual([null, 600, 1200]);
    expect(charts()[1]!.props("series")[0].data.map((point: { y: number | null }) => point.y)).toEqual([null, 700, 1400]);
    expect(charts()[1]!.props("series")[1].data.map((point: { y: number | null }) => point.y)).toEqual([null, 1400, 2800]);
    expect(wrapper.text()).not.toContain("Waiting for two comparable");
  });
  it("bounds session history to the latest 120 polls", async () => {
    wrapper = render();
    for (let index = 0; index <= trafficHistoryLimit + 5; index++) await sample(index * 3, BigInt(index * 300));
    const points = charts()[0]!.props("series")[0].data;
    expect(points).toHaveLength(trafficHistoryLimit);
    expect(points[0].x).toBe(Date.parse(trafficStatistics(18).sample.collected_at));
  });
  it("surfaces API errors and requires a fresh baseline after failure", async () => {
    wrapper = render(); await sample(0); await sample(3, 300n);
    const store = useControllerStore();
    store.statistics.error = "Statistics request failed"; store.statistics.stale = true;
    await flushPromises();
    expect(wrapper.text()).toContain("Statistics request failed");
    await sample(6, 900n);
    expect(charts()[0]!.props("series")[0].data.at(-1).y).toBeNull();
    await sample(9, 1200n);
    expect(charts()[0]!.props("series")[0].data.at(-1).y).toBe(300);
  });
  it("keeps unavailable interfaces explicit rather than silently switching to all", async () => {
    wrapper = render(); await sample(0);
    wrapper.findAllComponents(select)[0]!.vm.$emit("update:modelValue", "eth1");
    const next = trafficStatistics(3, 300n); next.interfaces.pop();
    useControllerStore().statistics.data = next; await flushPromises();
    expect(wrapper.text()).toContain("Interface eth1 is no longer available");
    expect(charts()[0]!.props("series")[0].data.at(-1).y).toBeNull();
  });
  it("never displays simulated counter deltas as measured traffic", async () => {
    wrapper = render();
    const store = useControllerStore();
    store.statistics.data = statistics(); store.statistics.stale = false; await flushPromises();
    expect(wrapper.text()).toContain("Live traffic is unavailable for simulated counters");
    expect(charts()[0]!.props("series")[0].data).toEqual([]);
  });
  it("surfaces per-interface counter failures without changing the watched interface", async () => {
    wrapper = render(); await sample(0); await sample(3, 300n);
    wrapper.findAllComponents(select)[0]!.vm.$emit("update:modelValue", "eth1");
    const next = trafficStatistics(6, 600n);
    next.interfaces[1]!.error = "Counter read failed";
    useControllerStore().statistics.data = next; await flushPromises();
    expect(wrapper.text()).toContain("eth1: Counter read failed");
    expect(charts()[0]!.props("series")[0].data.at(-1).y).toBeNull();
  });
  it.each(["missing", "reset"] as const)("leaves a gap for a %s direction without hiding other interfaces", async condition => {
    wrapper = render(); await sample(0);
    const next = trafficStatistics(3, 300n);
    if (condition === "missing") delete next.interfaces[0]!.counters!.tx_bytes;
    else next.interfaces[0]!.counters!.tx_bytes = "1";
    useControllerStore().statistics.data = next; await flushPromises();
    expect(charts()[0]!.props("series")[0].data.at(-1).y).toBeNull();
    expect(charts()[0]!.props("series")[1].data.at(-1).y).toBe(600);
    expect(charts()[1]!.props("series")[0].data.at(-1).y).toBe(700);
    expect(charts()[1]!.props("series")[1].data.at(-1).y).toBe(1400);
  });
  it("adds a line for each available interface and shows measured idle traffic as zero", async () => {
    wrapper = render();
    const store = useControllerStore();
    for (const seconds of [0, 3]) {
      const next = trafficStatistics(seconds);
      next.interfaces.push({ ...next.interfaces[0]!, name: "eth2", index: 3 });
      store.statistics.data = next; store.statistics.stale = false; await flushPromises();
    }
    for (const chart of charts()) {
      expect(chart.props("series").map((line: { name: string }) => line.name)).toEqual(["eth0", "eth1", "eth2"]);
      for (const line of chart.props("series")) expect(line.data.at(-1).y).toBe(0);
      expect(new Set(chart.props("options").colors).size).toBe(3);
    }
  });
  it("requires a fresh baseline after the page is hidden and does not average across the pause", async () => {
    wrapper = render(); await sample(0); await sample(3, 300n);
    document.dispatchEvent(new Event("visibilitychange"));
    await sample(30, 6000n);
    expect(charts()[0]!.props("series")[0].data.at(-1).y).toBeNull();
    await sample(33, 6300n);
    expect(charts()[0]!.props("series")[0].data.at(-1).y).toBe(300);
  });
  it("clears history on disconnect and on a new measurement scope", async () => {
    wrapper = render(); await sample(0); await sample(3, 300n);
    const store = useControllerStore();
    const next = trafficStatistics(6, 600n); next.sample.scope = "other-device";
    store.statistics.data = next; await flushPromises();
    expect(charts()[0]!.props("series")[0].data).toEqual([{ x: Date.parse(next.sample.collected_at), y: null }]);
    store.connected = false; await flushPromises();
    expect(charts()[0]!.props("series")[0].data).toEqual([]);
  });
  it("formats chart axes and tooltips in UTC seconds, preserving fractional sample precision", async () => {
    wrapper = render(); await sample(0);
    const options: ApexOptions = charts()[0]!.props("options");
    const timestamp = Date.parse("2026-01-02T03:04:05.987+02:00");
    expect(options.xaxis?.title?.text).toBe("Time (UTC)");
    expect(options.xaxis?.labels?.formatter?.("ignored", timestamp)).toBe("2026-01-02 01:04:05");
    expect(options.xaxis?.labels?.formatter?.("invalid")).toBe("Invalid timestamp");
    expect(options.tooltip?.x?.formatter?.(timestamp)).toBe("2026-01-02 01:04:05 UTC");
    expect(charts()[0]!.props("series")[0].data[0].x).toBe(Date.parse("2026-10-27T12:00:00.123Z"));
  });
});
