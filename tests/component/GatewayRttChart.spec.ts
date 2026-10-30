import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApexOptions } from "apexcharts";
import GatewayRttChart from "@/components/feature/GatewayRttChart.vue";
import GatewayMonitorsView from "@/views/GatewayMonitorsView.vue";
import { useControllerStore } from "@/stores/controller";
import type { GatewayStatistics } from "@/types/domain";
import { gatewayStatistics, monitor, state } from "../fixtures";

vi.mock("vue3-apexcharts", () => ({ default: {
  name: "RttChart", props: ["options", "series", "height"], template: '<div class="apex-chart-stub" />',
} }));
const stubs = {
  VCard: { template: "<section><slot /></section>" },
  ResourcePage: { template: '<table aria-label="Monitor table" />' },
};
let wrapper: ReturnType<typeof mount>;
const start = Date.parse("2026-10-28T04:49:23.456789Z");
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(start);
  setActivePinia(createPinia());
  const store = useControllerStore();
  store.connected = true; store.state.data = state();
  store.state.data.desired.gateway_monitors = [monitor(), { ...monitor(), name: "backup" }];
  store.gatewayStatistics.stale = false;
});
afterEach(() => { wrapper?.unmount(); vi.useRealTimers(); });
function render() { wrapper = mount(GatewayRttChart, { global: { stubs } }); }
function chart() { return wrapper.getComponent({ name: "RttChart" }); }
async function sample(index = 0, overrides: Partial<GatewayStatistics> = {}) {
  const time = start + index * 3000;
  vi.setSystemTime(time);
  useControllerStore().gatewayStatistics.data = {
    sample: { scope: "host", status: "available", started_at: null, collected_at: new Date(time).toISOString() },
    monitors: [
      { ...gatewayStatistics(), name: "backup", rtt_avg_ms: 10, ...overrides },
      { ...gatewayStatistics(), rtt_avg_ms: index, ...overrides },
    ],
  };
  await flushPromises();
}

describe("Gateway Mean RTT chart", () => {
  it("sits above the monitor table and plots every monitor, including zero RTT", async () => {
    await sample();
    wrapper = mount(GatewayMonitorsView, { global: { stubs } });
    expect(wrapper.get('[aria-label="Gateway Mean RTT"]').element.compareDocumentPosition(wrapper.get("table").element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(chart().props("series")).toEqual([
      { name: "backup", data: [{ x: start, y: 10 }] },
      { name: "uplink", data: [{ x: start, y: 0 }] },
    ]);
    await sample(1);
    expect(chart().props("series")[1].data).toEqual([{ x: start, y: 0 }, { x: start + 3000, y: 1 }]);
    expect(chart().props("options").yaxis.title.text).toBe("Mean RTT (ms)");
    expect(chart().props("height")).toBe("200");
  });
  it("formats fractional-second timestamps in UTC and RTT values in milliseconds", async () => {
    await sample(); render();
    const options = chart().props("options") as ApexOptions;
    expect(options.xaxis!.labels!.formatter!("", start)).toBe("2026-10-28 04:49:23");
    expect(options.tooltip!.x!.formatter!(start)).toBe("2026-10-28 04:49:23 UTC");
    expect(options.tooltip!.y).toMatchObject({ formatter: expect.any(Function) });
    const tooltip = chart().props("options").tooltip;
    expect(tooltip.y.formatter(1.25)).toBe("1.25 ms");
    expect(tooltip.y.formatter(null)).toBe("Unavailable");
  });
  it("updates chart titles, axes and tooltips when the saved timezone changes without shifting sample instants", async () => {
    await sample(); render();
    const store = useControllerStore();
    store.state.data = { ...store.state.data!, desired: {
      ...store.state.data!.desired, system: { hostname: "", domain: "", timezone: "America/Los_Angeles" },
    } };
    await flushPromises();
    const options = chart().props("options") as ApexOptions;
    expect(options.xaxis!.title!.text).toBe("Time (America/Los_Angeles)");
    expect(options.xaxis!.labels!.formatter!("", start)).toBe("2026-10-27 21:49:23");
    expect(options.tooltip!.x!.formatter!(start)).toBe("2026-10-27 21:49:23 America/Los_Angeles");
    expect(chart().props("series")[0].data[0].x).toBe(start);
  });
  it("deduplicates independently cached monitors and bounds each series to 120 samples", async () => {
    await sample(); render();
    await sample(1, { collected_at: new Date(start).toISOString() });
    expect(chart().props("series")[0].data).toHaveLength(1);
    for (let index = 2; index <= 125; index++) await sample(index);
    expect(chart().props("series").map((item: { data: unknown[] }) => item.data.length)).toEqual([120, 120]);
    expect(chart().props("series")[1].data.at(-1).y).toBe(125);
  });
  it.each([
    { sample_status: "warming_up" }, { sample_status: "waiting_for_dhcp" },
    { process_state: "disabled" }, { retrying: true }, { error: "Probe failed" },
    { collected_at: new Date(start - 10000).toISOString() }, { rtt_avg_ms: null },
  ])("leaves unavailable readings as gaps: %j", async overrides => {
    await sample(); render(); await sample(1, overrides);
    expect(chart().props("series")[1].data.at(-1)).toEqual({ x: start + 3000, y: null });
  });
  it("uses applied configuration instead of drafts and gaps disabled or missing monitors", async () => {
    await sample(); render();
    const store = useControllerStore();
    store.draft = { ...store.state.data!.desired, gateway_monitors: [] };
    await sample(1);
    expect(chart().props("series")[1].data.at(-1).y).toBe(1);
    store.state.data!.desired.gateway_monitors[0]!.enabled = false;
    await sample(2);
    expect(chart().props("series")[1].data.at(-1).y).toBeNull();
    store.gatewayStatistics.data = {
      ...store.gatewayStatistics.data!,
      sample: { ...store.gatewayStatistics.data!.sample, collected_at: new Date(start + 9000).toISOString() },
      monitors: [],
    };
    await flushPromises();
    expect(chart().props("series")[0].data.at(-1).y).toBeNull();
  });
  it("ignores failed/stale polls, and clears history for another scope or a disconnect", async () => {
    await sample(); render();
    const store = useControllerStore();
    store.gatewayStatistics.stale = true; store.gatewayStatistics.error = "Gateway cache unavailable";
    await sample(1);
    expect(chart().props("series")[1].data).toHaveLength(1);
    store.gatewayStatistics.stale = false; store.gatewayStatistics.error = null;
    await flushPromises();
    store.gatewayStatistics.data = { ...store.gatewayStatistics.data!, sample: { ...store.gatewayStatistics.data!.sample, scope: "another-host" } };
    await flushPromises();
    expect(chart().props("series")[1].data).toHaveLength(1);
    store.connected = false; await flushPromises();
    expect(wrapper.find(".apex-chart-stub").exists()).toBe(false);
  });
  it("shows an explicit empty state and never plots simulated data", async () => {
    render();
    expect(wrapper.text()).toContain("No Mean RTT measurements available yet.");
    await sample();
    const store = useControllerStore();
    store.gatewayStatistics.data = { ...store.gatewayStatistics.data!, sample: { ...store.gatewayStatistics.data!.sample, status: "simulated" } };
    await flushPromises();
    expect(wrapper.find(".apex-chart-stub").exists()).toBe(false);
    expect(wrapper.text()).toContain("No Mean RTT measurements available yet.");
  });
});
