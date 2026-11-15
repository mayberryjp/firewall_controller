import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NetworkExperienceHostView from "@/views/NetworkExperienceHostView.vue";
import NetworkExperienceHostCharts from "@/components/feature/NetworkExperienceHostCharts.vue";
import { getNetworkExperienceHistory, type ExperienceHistory } from "@/services/networkExperience";
import { useControllerStore } from "@/stores/controller";
import { cloneConfig } from "@/services/configuration";
import { experienceHistory } from "../networkExperienceFixtures";
import { state } from "../fixtures";

vi.mock("@/services/networkExperience", async original => ({
  ...await original<typeof import("@/services/networkExperience")>(), getNetworkExperienceHistory: vi.fn(),
}));
vi.mock("vue3-apexcharts", () => ({
  default: { name: "VueApexCharts", props: ["options", "series"], template: '<div class="replay-chart" />' },
}));
const stubs = {
  VBtn: { props: ["disabled", "icon"], template: '<button :disabled="disabled"><slot /></button>' },
  VChip: { props: ["color"], template: '<span class="chip" :data-color="color"><slot /></span>' },
  VAlert: { template: '<div role="alert"><slot /></div>' },
  VIcon: true,
  RouterLink: { template: '<a><slot /></a>' },
};
let wrapper: ReturnType<typeof mount> | undefined;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.clearAllMocks(); setActivePinia(createPinia());
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const store = useControllerStore(); store.connected = true; store.state.data = state();
  vi.mocked(getNetworkExperienceHistory).mockResolvedValue(experienceHistory());
});
afterEach(() => {
  wrapper?.unmount(); wrapper = undefined; useControllerStore().$dispose();
  vi.useRealTimers(); vi.restoreAllMocks();
});
async function render() {
  wrapper = mount(NetworkExperienceHostView, { props: { address: "192.0.2.20" }, global: { stubs } }); await flushPromises();
}
describe("Host experience replay", () => {
  it("formats signal measurements, scores, chart axes and tooltips while retaining integer counts", async () => {
    const history = experienceHistory();
    history.samples[359]!.sample!.tcp.rtt_remote.p95_ms = 25.12345;
    history.samples[359]!.sample!.tcp.advertised_window_min_bytes_host = 1000;
    vi.mocked(getNetworkExperienceHistory).mockResolvedValue(history);
    await render();
    expect(wrapper!.get('[data-host-metric="remote_p95"]').text()).toContain("25.12 ms");
    expect(wrapper!.get('[data-host-metric="host_min_window"]').text()).toContain("1.00 KB");
    expect(wrapper!.get('[data-host-metric="connections"]').text()).toContain("3");
    expect(wrapper!.get(".host-core").text()).toContain("100.00/100");
    const charts = wrapper!.findAllComponents({ name: "VueApexCharts" });
    const traffic = charts[0]!.props("options"), timing = charts[1]!.props("options"), counts = charts[2]!.props("options");
    expect(traffic.yaxis.labels.formatter(400000)).toBe("400.00K");
    expect(traffic.tooltip.y.formatter(400000)).toBe("400,000.00 bps");
    expect(timing.yaxis.labels.formatter(0)).toBe("0.00");
    expect(timing.tooltip.y.formatter(25.12345)).toBe("25.12 ms");
    expect(timing.tooltip.y.formatter(null)).toBe("Unavailable");
    expect(counts.yaxis.labels.formatter(2)).toBe("2");
    expect(counts.tooltip.y.formatter(2)).toBe("2 observations / interval");
    expect(charts[1]!.props("series")[1].data[359]).toBe(25.12345);
  });
  it.each(["success", "failure"])("keeps pending history neutral until %s", async outcome => {
    let resolve!: (value: ExperienceHistory) => void, reject!: (failure: Error) => void;
    vi.mocked(getNetworkExperienceHistory).mockImplementationOnce(() => new Promise((done, fail) => { resolve = done; reject = fail; }));
    await render();
    expect(wrapper!.text()).toContain("Loading host experience");
    expect(wrapper!.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper!.find(".host-signal-map").exists()).toBe(false);
    if (outcome === "success") resolve(experienceHistory()); else reject(new Error("HTTP 503: host history unavailable"));
    await flushPromises();
    expect(wrapper!.text()).not.toContain("Loading host experience");
    if (outcome === "success") expect(wrapper!.findAll(".replay-chart")).toHaveLength(4);
    else expect(wrapper!.get('[role="alert"]').text()).toContain("HTTP 503");
  });
  it("scrubs all 360 slots without substituting samples and pins the replay window through refreshes", async () => {
    await render();
    expect(getNetworkExperienceHistory).toHaveBeenCalledExactlyOnceWith("192.0.2.20", expect.any(AbortSignal));
    const slider = wrapper!.get<HTMLInputElement>('input[type="range"]');
    expect(slider.element.value).toBe("359");
    expect(wrapper!.get('[data-host-metric="download"]').text()).toContain("400.00 Kbps");
    await slider.setValue("358");
    expect(wrapper!.text()).toContain("No sample was collected here");
    expect(wrapper!.get('[data-host-metric="download"]').text()).toContain("Unavailable");
    expect(wrapper!.getComponent(NetworkExperienceHostCharts).props("selectedIndex")).toBe(358);
    const next = experienceHistory();
    next.samples[359]!.sample!.traffic.received_bps = 999000;
    vi.mocked(getNetworkExperienceHistory).mockResolvedValue(next);
    await vi.advanceTimersByTimeAsync(10000); await flushPromises();
    expect(slider.element.value).toBe("358");
    expect(wrapper!.get('[data-host-metric="download"]').text()).toContain("Unavailable");
    await wrapper!.get(".replay-heading button").trigger("click");
    expect(slider.element.value).toBe("359");
    expect(wrapper!.get('[data-host-metric="download"]').text()).toContain("999.00 Kbps");
  });
  it("does not attribute a previous owner interval to the latest host's device metadata", async () => {
    const history = experienceHistory();
    history.samples[359]!.sample!.configured_host_id = "previous-owner";
    history.samples[359]!.sample!.configured_name = "Previous Sensor";
    vi.mocked(getNetworkExperienceHistory).mockResolvedValue(history);
    await render();
    expect(wrapper!.get(".host-core-description").text()).toBe("Previous Sensor");
    expect(wrapper!.get(".host-core-icon").attributes("data-device-icon")).toBe("DEFAULT");
    expect(wrapper!.text()).toContain("Previous Host Ownership");
  });
  it("uses the saved timezone at every display boundary and retains full interval precision", async () => {
    const store = useControllerStore(), saved = state();
    saved.desired.system = { hostname: "", domain: "", timezone: "Asia/Tokyo" }; store.state.data = saved;
    await render();
    expect(wrapper!.get(".replay-context time").text()).toBe("2026-11-14 09:25:10");
    expect(wrapper!.get(".replay-context time").attributes("datetime")).toBe("2026-11-14T00:25:10.123456Z");
    expect(wrapper!.get('input[type="range"]').attributes("aria-valuetext")).toContain("2026-11-14 09:25:00");
    const chart = wrapper!.findComponent({ name: "VueApexCharts" });
    expect(chart.props("options").xaxis.labels.formatter("359")).toBe("2026-11-14 09:25:10");
    store.draft = cloneConfig(saved.desired); store.draft.system!.timezone = "America/New_York";
    await flushPromises();
    expect(wrapper!.get(".replay-context time").text()).toBe("2026-11-14 09:25:10");
    const updated = state();
    updated.desired.system = { hostname: "", domain: "", timezone: "UTC" }; store.state.data = updated;
    await flushPromises();
    expect(chart.props("options").xaxis.labels.formatter("359")).toBe("2026-11-14 00:25:10");
  });
  it("keeps failed refreshes explicit and neutral and stops replay/polling when hidden or unmounted", async () => {
    await render();
    vi.mocked(getNetworkExperienceHistory).mockRejectedValue(new Error("History read failed"));
    await vi.advanceTimersByTimeAsync(10000); await flushPromises();
    expect(wrapper!.get('[role="alert"]').text()).toContain("History read failed");
    expect(wrapper!.get('[data-host-metric="dns_p95"] .chip').attributes("data-color")).toBe("default");
    await wrapper!.get('input[type="range"]').setValue("357");
    await wrapper!.get('[aria-label="Play replay at 40 times real time"]').trigger("click");
    await vi.advanceTimersByTimeAsync(250);
    expect(wrapper!.get<HTMLInputElement>('input[type="range"]').element.value).toBe("358");
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    const reads = vi.mocked(getNetworkExperienceHistory).mock.calls.length;
    await vi.advanceTimersByTimeAsync(20000);
    expect(wrapper!.get<HTMLInputElement>('input[type="range"]').element.value).toBe("358");
    expect(getNetworkExperienceHistory).toHaveBeenCalledTimes(reads);
    wrapper!.unmount(); wrapper = undefined;
    await vi.advanceTimersByTimeAsync(20000);
    expect(getNetworkExperienceHistory).toHaveBeenCalledTimes(reads);
  });
});
