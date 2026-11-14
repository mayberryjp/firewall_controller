import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NetworkExperienceView from "@/views/NetworkExperienceView.vue";
import NetworkExperienceHistory from "@/components/feature/NetworkExperienceHistory.vue";
import { getNetworkExperience, getNetworkExperienceHistory } from "@/services/networkExperience";
import { useControllerStore } from "@/stores/controller";
import { cloneConfig } from "@/services/configuration";
import { state } from "../fixtures";
import { experienceHistory, experienceLatest } from "../networkExperienceFixtures";

vi.mock("@/services/networkExperience", async original => ({
  ...await original<typeof import("@/services/networkExperience")>(), getNetworkExperience: vi.fn(), getNetworkExperienceHistory: vi.fn(),
}));
vi.mock("vue3-apexcharts", () => ({
  default: { name: "VueApexCharts", props: ["options", "series"], template: '<div class="history-chart" />' },
}));
const stubs = {
  VTable: { template: "<table><slot /></table>" }, VProgressLinear: true,
  VAlert: { template: '<div role="alert"><slot /></div>' },
  VChip: { props: ["color"], template: '<span class="chip" :data-color="color"><slot /></span>' },
  VBtn: { template: "<button><slot /></button>" },
  VTextField: { props: ["modelValue"], emits: ["update:modelValue"], template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />' },
  VSelect: { props: ["modelValue", "items"], emits: ["update:modelValue"], template: '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="item in items" :key="item.value" :value="item.value">{{ item.title }}</option></select>' },
  VueApexCharts: { name: "VueApexCharts", props: ["options", "series"], template: '<div class="history-chart" />' },
};
let wrapper: ReturnType<typeof mount> | undefined;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.clearAllMocks(); setActivePinia(createPinia());
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const store = useControllerStore(); store.connected = true; store.state.data = state();
  vi.mocked(getNetworkExperience).mockResolvedValue(experienceLatest());
  vi.mocked(getNetworkExperienceHistory).mockResolvedValue(experienceHistory());
});
afterEach(() => { wrapper?.unmount(); wrapper = undefined; useControllerStore().$dispose(); vi.useRealTimers(); vi.restoreAllMocks(); });
async function render() {
  wrapper = mount(NetworkExperienceView, { global: { stubs } }); await flushPromises();
}
describe("Network experience diagnostics", () => {
  it("renders one compact row per IP, a small safe icon, local description and colored host-perspective chips", async () => {
    await render();
    expect(wrapper!.findAll("tbody tr")).toHaveLength(1);
    expect(wrapper!.get(".host-description").text()).toBe("Front Door Camera");
    expect(wrapper!.get(".host-icon").attributes("data-device-icon")).not.toContain("http");
    expect(wrapper!.findAll("tbody td").map(cell => cell.text())).toEqual([
      "Front door camera", "Front Door Camera", "vlan20", "192.0.2.20", "Excellent · 100Limited confidence",
      "416 Kbps", "↓ 400 Kbps", "↑ 16 Kbps", "520 KB · Partial", "2026-11-14 00:25:09",
    ]);
    expect(wrapper!.findAll("tbody .chip")[1]!.attributes("data-color")).toBe("success");
    expect(wrapper!.text()).not.toContain(".987654"); expect(wrapper!.text()).not.toContain("24-hour");
    expect(getNetworkExperienceHistory).not.toHaveBeenCalled();
  });
  it.each(["success", "failure"])("keeps initial pending data neutral until %s", async outcome => {
    let resolve!: (value: ReturnType<typeof experienceLatest>) => void, reject!: (error: Error) => void;
    vi.mocked(getNetworkExperience).mockImplementationOnce(() => new Promise((done, fail) => { resolve = done; reject = fail; }));
    await render();
    expect(wrapper!.text()).toContain("Loading network experience");
    expect(wrapper!.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper!.text()).not.toContain("No configured");
    if (outcome === "success") resolve(experienceLatest()); else reject(new Error("HTTP 503: unsupported native mode"));
    await flushPromises();
    expect(wrapper!.text()).not.toContain("Loading network experience");
    if (outcome === "success") expect(wrapper!.findAll("tbody tr")).toHaveLength(1);
    else expect(wrapper!.get('[role="alert"]').text()).toContain("HTTP 503");
  });
  it("renders starting, idle, missing and stale evidence without invented good scores or zero traffic", async () => {
    const data = experienceLatest();
    data.status = "starting"; data.hosts[0]!.sample = null;
    vi.mocked(getNetworkExperience).mockResolvedValueOnce(data);
    await render();
    expect(wrapper!.text()).toContain("Waiting for the first");
    expect(wrapper!.text()).toContain("Waiting");
    expect(wrapper!.findAll("tbody td")[6]!.text()).toContain("Unavailable");
    const idle = experienceLatest();
    idle.hosts[0]!.sample!.activity = "idle"; idle.hosts[0]!.sample!.experience = {
      ...idle.hosts[0]!.sample!.experience, level: "unknown", score: null, status: "idle", confidence: "none",
    };
    vi.mocked(getNetworkExperience).mockResolvedValueOnce(idle);
    await vi.advanceTimersByTimeAsync(10000); await flushPromises();
    expect(wrapper!.text()).toContain("Unknown"); expect(wrapper!.text()).toContain("Idle");
    vi.mocked(getNetworkExperience).mockRejectedValue(new Error("Read failed"));
    await vi.advanceTimersByTimeAsync(40000); await flushPromises();
    expect(wrapper!.text()).toContain("Historical observations only");
    expect(wrapper!.findAll("tbody .chip").some(chip => chip.attributes("data-color") === "success")).toBe(false);
  });
  it("formats timestamps in saved timezone, ignoring unsaved drafts, and expires retained observations", async () => {
    const store = useControllerStore();
    store.state.data!.desired.system = { hostname: "", domain: "", timezone: "Asia/Tokyo" };
    await render();
    expect(wrapper!.text()).toContain("Last seen (Asia/Tokyo)");
    expect(wrapper!.text()).toContain("2026-11-14 09:25:09");
    store.draft = cloneConfig(store.state.data!.desired); store.draft.system!.timezone = "America/New_York";
    await flushPromises(); expect(wrapper!.text()).toContain("2026-11-14 09:25:09");
    vi.mocked(getNetworkExperience).mockRejectedValue(new Error("Disconnected"));
    await vi.advanceTimersByTimeAsync(3601000); await flushPromises();
    expect(wrapper!.text()).toContain("Retained measurements have expired");
    expect(wrapper!.text()).not.toContain("Excellent");
    expect(wrapper!.findAll("tbody td")[9]!.text()).toBe("Unavailable");
  });
  it("loads only selected history, preserves gaps/epoch transitions and cancels polling while hidden/unmounted", async () => {
    const history = experienceHistory(), first = structuredClone(history.samples.at(-1)!), second = structuredClone(first);
    second.sample!.observation_epoch = "epoch-2";
    second.sample!.start_at = first.end_at;
    second.end_at = second.sample!.end_at = "2026-11-14T00:25:20.123456Z";
    history.samples.splice(358, 2, first, second); history.returned_samples = 2;
    vi.mocked(getNetworkExperienceHistory).mockResolvedValue(history);
    await render();
    await wrapper!.get(".host-name").trigger("click"); await flushPromises();
    expect(getNetworkExperienceHistory).toHaveBeenCalledExactlyOnceWith("192.0.2.20", expect.any(AbortSignal));
    const chart = wrapper!.findComponent({ name: "VueApexCharts" });
    expect(chart.props("series")[0].data.slice(-4)).toEqual([null, 400000, null, 400000]);
    await wrapper!.get('select[aria-label="History metric"]').setValue("timing");
    expect(wrapper!.findComponent({ name: "VueApexCharts" }).props("series").map((line: { name: string }) => line.name))
      .toEqual(["Remote-path ACK p95", "Host-path ACK p95", "DNS response p95"]);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(20000);
    expect(getNetworkExperienceHistory).toHaveBeenCalledTimes(1);
    wrapper!.unmount(); wrapper = undefined;
    await vi.advanceTimersByTimeAsync(20000);
    expect(getNetworkExperience).toHaveBeenCalledTimes(1);
  });
  it.each(["success", "failure"])("keeps selected-history loading neutral until %s", async outcome => {
    let resolve!: (value: ReturnType<typeof experienceHistory>) => void, reject!: (error: Error) => void;
    vi.mocked(getNetworkExperienceHistory).mockImplementationOnce(() => new Promise((done, fail) => { resolve = done; reject = fail; }));
    wrapper = mount(NetworkExperienceHistory, { props: { address: "192.0.2.20" }, global: { stubs } }); await flushPromises();
    expect(wrapper.text()).toContain("Loading host history");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    if (outcome === "success") resolve(experienceHistory()); else reject(new Error("HTTP 404: no retained history"));
    await flushPromises();
    expect(wrapper.text()).not.toContain("Loading host history");
    if (outcome === "failure") expect(wrapper.get('[role="alert"]').text()).toContain("HTTP 404");
    else expect(wrapper.find(".history-chart").exists()).toBe(true);
  });
});
