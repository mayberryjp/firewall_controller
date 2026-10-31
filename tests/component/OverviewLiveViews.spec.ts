import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import type { ApexOptions } from "apexcharts";
import OverviewSystem from "@/components/feature/OverviewSystem.vue";
import OverviewCounters from "@/components/feature/OverviewCounters.vue";
import { useControllerStore } from "@/stores/controller";
import { healthSnapshot, state, statistics, trafficStatistics } from "../fixtures";

vi.mock("vue3-apexcharts", () => ({ default: {
  name: "ResourceChart", props: ["options", "series"], template: '<div class="apex-chart-stub" />',
} }));
const stubs = {
  VCard: { template: "<section><slot /></section>" },
  VTable: { template: "<table><slot /></table>" },
  VChip: { template: "<span><slot /></span>" },
  VBtn: { template: "<button><slot /></button>" },
};
let wrapper: ReturnType<typeof mount>;
beforeEach(() => {
  setActivePinia(createPinia());
  const store = useControllerStore();
  store.hostHealth.data = healthSnapshot(); store.hostHealth.stale = false;
  store.statistics.data = trafficStatistics(); store.statistics.stale = false;
});
afterEach(() => wrapper?.unmount());
function system() { wrapper = mount(OverviewSystem, { global: { stubs } }); }
function chart() { return wrapper.getComponent({ name: "ResourceChart" }); }
async function select(name: string) {
  await wrapper.findAll("th button").find(button => button.text() === name)!.trigger("click");
}
async function sample(uptime: number) {
  useControllerStore().hostHealth.data = healthSnapshot(
    String(9007199254740993n + BigInt(uptime - 100) * 25n),
    String(9007199254740993n + BigInt(uptime - 100) * 75n), uptime,
  );
  await flushPromises();
}

describe("Overview live views", () => {
  it("shows aggregate host uptime and the running software version first as plain text", async () => {
    const store = useControllerStore();
    store.state.data = state(); store.state.stale = false;
    store.statistics.data = trafficStatistics(89961);
    system();
    const rows = wrapper.findAll("tbody tr");
    expect(rows.slice(0, 3).map(row => row.get("th").text())).toEqual(["Host uptime", "Current version", "CPU usage"]);
    expect(rows[0]!.get(".metric-value").text()).toBe("1d 1h 1m");
    expect(rows[1]!.get(".metric-value").text()).toBe(store.state.data.desired.software!.version);
    expect(rows.slice(0, 2).every(row => !row.find("button").exists())).toBe(true);
    expect(wrapper.findAll("tbody th").filter(row => row.text() === "Host uptime")).toHaveLength(1);
    store.statistics.data = trafficStatistics(3);
    await sample(103);
    expect(wrapper.findAll("tbody tr")[0]!.get(".metric-value").text()).toBe("0d 0h 1m");
  });
  it("keeps the top fields loading until their initial reads succeed", async () => {
    const store = useControllerStore();
    store.statistics.data = null;
    system();
    expect(wrapper.findAll("tbody tr").slice(0, 2).map(row => row.get(".metric-value").text())).toEqual(["Loading...", "Loading..."]);
    store.state.data = state(); store.state.stale = false;
    store.statistics.data = trafficStatistics(3);
    await sample(103);
    expect(wrapper.findAll("tbody tr").slice(0, 2).map(row => row.get(".metric-value").text())).toEqual(["0d 0h 1m", store.state.data.desired.software!.version]);
  });
  it("shows unavailable fields and read errors after initial failures", async () => {
    const store = useControllerStore();
    store.statistics.data = null;
    system();
    store.statistics.error = "Statistics unavailable";
    store.state.error = "State unavailable";
    await flushPromises();
    const rows = wrapper.findAll("tbody tr").slice(0, 2);
    expect(rows.map(row => row.get(".metric-value").text())).toEqual(["Unavailable", "Unavailable"]);
    expect(rows[1]!.attributes("title")).toBe("State unavailable");
    expect(rows[0]!.attributes("title")).toBe("Statistics unavailable");
  });
  it("does not fabricate missing uptime or software metadata and identifies stale versions", async () => {
    const store = useControllerStore();
    store.state.data = state(); store.state.stale = false;
    delete store.state.data.desired.software;
    store.statistics.data!.sample.status = "partial";
    store.statistics.data!.uptime = { scope: "host", collected_at: store.statistics.data!.sample.collected_at, status: "unavailable", data: null, error: "Uptime not supported" };
    system();
    expect(wrapper.findAll("tbody tr").slice(0, 2).map(row => row.get(".metric-value").text())).toEqual(["Unavailable", "Unavailable"]);
    expect(wrapper.findAll("tbody tr")[0]!.attributes("title")).toBe("Uptime not supported");
    expect(wrapper.findAll("tbody tr").find(row => row.get("th").text() === "Memory")!.get(".metric-value").text()).not.toBe("Unavailable");
    store.state.data = state(); store.state.stale = true;
    await flushPromises();
    expect(wrapper.findAll("tbody tr")[1]!.attributes("title")).toBe("Last known value");
    store.state.error = "State refresh failed";
    await flushPromises();
    expect(wrapper.findAll("tbody tr")[1]!.attributes("title")).toBe("State refresh failed");
    expect(wrapper.findAll("tbody tr")[1]!.get(".metric-value").text()).toBe(store.state.data.desired.software!.version);
  });
  it("accepts zero and fractional uptime without using summed idle or host-health uptime", async () => {
    const store = useControllerStore();
    system();
    for (const [seconds, expected] of [[0, "0d 0h 0m"], [86400.5, "1d 0h 0m"]] as const) {
      store.statistics.data = trafficStatistics();
      store.statistics.data.uptime.data = { uptime_seconds: seconds, idle_seconds: 999999999.25 };
      await flushPromises();
      expect(wrapper.findAll("tbody tr")[0]!.get(".metric-value").text()).toBe(expected);
    }
    store.statistics.stale = true; store.statistics.error = "Statistics refresh failed";
    await flushPromises();
    expect(wrapper.findAll("tbody tr")[0]!.get(".metric-value").text()).toBe("1d 0h 0m");
    expect(wrapper.findAll("tbody tr")[0]!.attributes("title")).toBe("Statistics refresh failed");
  });
  it("never falls back to measured host-health uptime for simulated aggregate readings", async () => {
    const store = useControllerStore();
    store.statistics.data = statistics();
    system();
    expect(wrapper.findAll("tbody tr")[0]!.get(".metric-value").text()).toBe("Unavailable");
    expect(wrapper.findAll("tbody tr")[0]!.attributes("title")).toBe("Simulated host uptime is unavailable");
    store.statistics.data.uptime.data = { uptime_seconds: 123, idle_seconds: 456 };
    await flushPromises();
    expect(wrapper.findAll("tbody tr")[0]!.get(".metric-value").text()).toBe("Unavailable");
  });
  it("makes only the six resource names clickable and toggles an inline chart", async () => {
    system();
    expect(wrapper.findAll("th button").map(button => button.text())).toEqual([
      "CPU usage", "Memory", "Swap", "Load (1 / 5 / 15 min)", "Temperature (highest)", "Fan",
    ]);
    expect(wrapper.find(".apex-chart-stub").exists()).toBe(false);
    await select("Memory");
    expect(wrapper.find('[aria-label="Memory live view"]').exists()).toBe(true);
    expect(chart().props("series")[0].data[0].y).toBe(75);
    expect(wrapper.findAll("thead th")).toHaveLength(3);
    await select("Memory");
    expect(wrapper.find(".apex-chart-stub").exists()).toBe(false);
    await select("Fan");
    await wrapper.get('[aria-label="Close live view"]').trigger("click");
    expect(wrapper.find(".apex-chart-stub").exists()).toBe(false);
  });
  it("plots each metric with live updates, exact CPU deltas and all three loads", async () => {
    system(); await sample(103);
    for (const [name, values] of [
      ["CPU usage", [25]], ["Memory", [75]], ["Swap", [0]],
      ["Load (1 / 5 / 15 min)", [0.1, 0.2, 0.3]], ["Temperature (highest)", [48.125]], ["Fan", [0]],
    ] as const) {
      await select(name);
      expect(chart().props("series").map((item: { data: Array<{ y: number | null }> }) => item.data.at(-1)?.y)).toEqual(values);
    }
    await sample(106);
    expect(chart().props("series")[0].data).toHaveLength(3);
  });
  it("formats fractional-second chart inputs as UTC seconds", async () => {
    system(); await select("Memory");
    const options = chart().props("options") as ApexOptions;
    const time = Date.parse(healthSnapshot().sample.collected_at);
    expect(options.xaxis!.labels!.formatter!("", time)).toBe("2026-10-24 12:01:40");
    expect(options.tooltip!.x!.formatter!(time)).toBe("2026-10-24 12:01:40 UTC");
  });
  it("uses the saved system timezone in live chart headings, axes, tooltips and collection details", async () => {
    const store = useControllerStore();
    store.state.data = state();
    store.state.data.desired.system = { hostname: "", domain: "", timezone: "Asia/Kolkata" };
    system(); await select("Memory");
    const options = chart().props("options") as ApexOptions;
    const time = Date.parse(healthSnapshot().sample.collected_at);
    expect(options.xaxis!.title!.text).toBe("Time (Asia/Kolkata)");
    expect(options.xaxis!.labels!.formatter!("", time)).toBe("2026-10-24 17:31:40");
    expect(options.tooltip!.x!.formatter!(time)).toBe("2026-10-24 17:31:40 Asia/Kolkata");
    expect(wrapper.get(".widget-note").attributes("title")).toContain("Collected (Asia/Kolkata): 2026-10-24 17:31:40");
  });
  it("bounds history, ignores duplicate samples and clears it on a host reboot", async () => {
    system(); await select("Memory");
    await sample(100);
    expect(chart().props("series")[0].data).toHaveLength(1);
    for (let index = 1; index <= 125; index++) await sample(100 + index * 3);
    expect(chart().props("series")[0].data).toHaveLength(120);
    const next = healthSnapshot(undefined, undefined, 500); next.sample.boot_id = "boot-2";
    useControllerStore().hostHealth.data = next; await flushPromises();
    expect(chart().props("series")[0].data).toHaveLength(1);
  });
  it("does not add stale or simulated observations and leaves missing sensors as gaps", async () => {
    system(); await select("CPU usage");
    const store = useControllerStore();
    store.hostHealth.stale = true; store.hostHealth.error = "Host health unavailable";
    await sample(103);
    expect(chart().props("series")[0].data).toHaveLength(1);
    expect(wrapper.text()).toContain("Stale");
    expect(wrapper.get(".widget-note").attributes("title")).toBe("Host health unavailable");
    store.hostHealth.stale = false; store.hostHealth.error = null; await flushPromises();
    expect(chart().props("series")[0].data.at(-1).y).toBeNull();
    const next = healthSnapshot(undefined, undefined, 106);
    next.sections.thermal.data = []; next.sections.hwmon.data = [];
    store.hostHealth.data = next; await flushPromises(); await select("Fan");
    expect(chart().props("series")[0].data.at(-1).y).toBeNull();
    const simulated = healthSnapshot(); simulated.sample.status = "simulated";
    store.hostHealth.data = simulated; await flushPromises();
    expect(chart().props("series")[0].data).toEqual([]);
  });
  it("links the counters heading and interface names to the traffic viewer", async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: "/", component: { template: "<div />" } },
      { path: "/diagnostics/traffic", component: { template: "<div />" } },
    ] });
    await router.push("/");
    useControllerStore().statistics.data = statistics();
    wrapper = mount(OverviewCounters, { global: { stubs, plugins: [router] } });
    expect(wrapper.get("h2 a").attributes("href")).toBe("/diagnostics/traffic");
    const link = wrapper.get("tbody th a");
    expect(link.attributes("href")).toBe(`/diagnostics/traffic?interface=${encodeURIComponent(link.text())}`);
    expect(link.classes()).toContain("counter-link");
    await link.trigger("click"); await flushPromises();
    expect(router.currentRoute.value.query.interface).toBe(link.text());
  });
});
