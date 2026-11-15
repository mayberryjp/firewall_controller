import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NetworkExperienceView from "@/views/NetworkExperienceView.vue";
import NetworkExperienceHistory from "@/components/feature/NetworkExperienceHistory.vue";
import { getNetworkExperience, getNetworkExperienceSummary, getNetworkExperienceHistory } from "@/services/networkExperience";
import { useControllerStore } from "@/stores/controller";
import { cloneConfig } from "@/services/configuration";
import { state } from "../fixtures";
import { experienceHistory, experienceSummary } from "../networkExperienceFixtures";

vi.mock("@/services/networkExperience", async original => ({
  ...await original<typeof import("@/services/networkExperience")>(),
  getNetworkExperience: vi.fn(), getNetworkExperienceSummary: vi.fn(), getNetworkExperienceHistory: vi.fn(),
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
  vi.resetAllMocks(); setActivePinia(createPinia());
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const store = useControllerStore(); store.connected = true; store.state.data = state();
  vi.mocked(getNetworkExperienceSummary).mockResolvedValue(experienceSummary());
  vi.mocked(getNetworkExperienceHistory).mockResolvedValue(experienceHistory());
});
afterEach(() => { wrapper?.unmount(); wrapper = undefined; useControllerStore().$dispose(); vi.useRealTimers(); vi.restoreAllMocks(); });
async function render() {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: "/", component: { render: () => null } },
    { path: "/diagnostics/network-experience/:address", name: "network-experience-host", component: { render: () => null } },
  ] });
  wrapper = mount(NetworkExperienceView, { global: { stubs, plugins: [router] } }); await flushPromises();
}
describe("Network experience hourly summaries", () => {
  it("strongly fades only Not Rated hosts without disabling their history links", async () => {
    const data = experienceSummary(), unrated = structuredClone(data.hosts[0]!);
    unrated.ip_address = "192.0.2.21";
    unrated.summary.experience.worst_rated_level = null;
    unrated.summary.experience.last_rated = null;
    data.hosts.push(unrated);
    vi.mocked(getNetworkExperienceSummary).mockResolvedValueOnce(data);
    await render();
    expect(wrapper!.get('[data-host-address="192.0.2.20"]').classes()).not.toContain("host-not-rated");
    const row = wrapper!.get('[data-host-address="192.0.2.21"]');
    expect(row.classes()).toContain("host-not-rated");
    expect(row.get('[data-metric="experience"]').text()).toBe("Not Rated");
    expect(row.get(".host-name").attributes("href")).toBe("/diagnostics/network-experience/192.0.2.21");
  });
  it("renders a compact aggregate row, exact totals, pooled ratios and explicit timing semantics", async () => {
    const data = experienceSummary(), value = data.hosts[0]!.summary;
    value.firewall.dropped_sent_packets.total = "18446744073709551616";
    value.tcp.rtt_remote.p50_ms = 123.756;
    value.tcp.rtt_remote.percentile_unavailable_reason = null;
    value.tcp.rtt_host.p50_ms = 0;
    value.tcp.rtt_host.percentile_unavailable_reason = null;
    value.dns.unanswered.total = "9";
    value.dns.unanswered_ratio = { ...value.dns.unanswered_ratio, numerator: "1", denominator: "4", percent: 25 };
    vi.mocked(getNetworkExperienceSummary).mockResolvedValue(data);
    await render();
    expect(wrapper!.findAll("tbody tr")).toHaveLength(1);
    expect(wrapper!.get(".host-description").text()).toBe("Front Door Camera");
    expect(wrapper!.get(".host-icon").attributes("data-device-icon")).toBe("IP_CAMERA");
    expect(wrapper!.find('[data-metric="coverage"]').exists()).toBe(false);
    expect(wrapper!.get('[data-metric="experience"]').text()).toBe("Excellent");
    expect(wrapper!.get('[data-metric="experience"]').findAll(".chip")).toHaveLength(1);
    expect(wrapper!.get('[data-metric="experience"] .chip').attributes("title")).toContain("1/360 observed");
    expect(wrapper!.get('[data-metric="experience"] .chip').attributes("title")).toContain("Worst rated experience");
    expect(wrapper!.get('[data-metric="experience"]').text()).not.toContain("Last Rated");
    expect(wrapper!.findAll("tbody td .text-caption")).toHaveLength(0);
    expect(wrapper!.get('[data-metric="throughput"]').text()).toContain("↓ 400 Kbps");
    expect(wrapper!.get('[data-metric="dropped_sent_packets"]').text()).toBe("18446744073709551616");
    expect(wrapper!.get('[data-metric="dropped_sent_packets"] .chip').attributes("data-color")).toBe("error");
    expect(wrapper!.find('[data-metric="dns_unanswered"]').exists()).toBe(false);
    expect(wrapper!.get('[data-metric="dns_response_time"] span').attributes("title")).toContain("25.00% (1 / 4)");
    expect(wrapper!.get('[data-metric="remote_rtt"] .chip').text()).toBe("Remote ~124 ms");
    expect(wrapper!.get('[data-metric="local_rtt"] .chip').text()).toBe("Local ~0 ms");
    expect(wrapper!.findAll("thead th").map(header => header.text())).toContain("RTT Median");
    expect(wrapper!.get('[data-metric="rtt_median"]').findAll(".chip")).toHaveLength(2);
    expect(wrapper!.get('[data-metric="remote_rtt"] .chip').attributes("title")).toContain("Approximate p50");
    expect(wrapper!.get('[data-metric="tcp_retransmissions"] [data-direction="sent"]').text()).toContain("↑ 0");
    expect(wrapper!.get('[data-metric="tcp_retransmissions"] [data-direction="sent"] .chip').attributes("title")).toContain("0.00% (0 / 100");
    expect(wrapper!.get('[data-metric="total_connections"]').text()).toBe("Current 3");
    expect(wrapper!.get('[data-metric="connections"]').findAll(".chip")).toHaveLength(2);
    expect(wrapper!.findAll("thead th").some(header => header.text() === "1-Hour Average Connections")).toBe(false);
    expect(wrapper!.get('[data-metric="average_connections"]').text()).toBe("Avg 3");
    expect(wrapper!.get('[data-metric="dns_response_time"]').text()).toBe("-");
    expect(wrapper!.find('[data-metric="dns_response_time"] .chip').exists()).toBe(false);
    expect(wrapper!.get('[data-metric="dns_response_time"] span').attributes("title")).toContain("distributions and variation weights not retained");
    expect(wrapper!.text()).not.toContain(".987654");
    expect(getNetworkExperience).not.toHaveBeenCalled();
    expect(getNetworkExperienceHistory).not.toHaveBeenCalled();
  });
  it.each([
    ["0", "info"], ["1", "yellow-darken-2"], ["9", "yellow-darken-2"],
    ["10", "orange-darken-2"], ["99", "orange-darken-2"], ["100", "error"], [null, "default"],
  ])("colors observed-hour firewall drops %s as %s", async (total, color) => {
    const data = experienceSummary();
    data.hosts[0]!.summary.firewall.dropped_sent_packets.total = total;
    vi.mocked(getNetworkExperienceSummary).mockResolvedValueOnce(data);
    await render();
    if (total === null) {
      expect(wrapper!.get('[data-metric="dropped_sent_packets"]').text()).toBe("-");
      expect(wrapper!.find('[data-metric="dropped_sent_packets"] .chip').exists()).toBe(false);
    } else expect(wrapper!.get('[data-metric="dropped_sent_packets"] .chip').attributes("data-color")).toBe(color);
  });
  it("renders approximate DNS p50 with partial timing evidence, weighted variation and independent hour coverage", async () => {
    const data = experienceSummary(), dns = data.hosts[0]!.summary.dns;
    dns.response_time_p50_ms = 12.6; dns.timing_unavailable_reason = null;
    dns.timing_samples = "10"; dns.timing_observed_slots = 2; dns.timing_missing_slots = 1;
    dns.response_time_variation_mean_ms = 3; dns.variation_pairs = "9";
    vi.mocked(getNetworkExperienceSummary).mockResolvedValueOnce(data);
    await render();
    const cell = () => wrapper!.get('[data-metric="dns_response_time"]');
    expect(cell().get(".chip").text()).toBe("~13 ms");
    expect(cell().find('[aria-label="Partial timing evidence"]').exists()).toBe(true);
    expect(cell().get(".chip").attributes("title")).toContain("10 timing samples · 2 observed timing slots · 1 missing");
    expect(cell().get(".chip").attributes("title")).toContain("Pair-weighted DNS variation: 3.00 ms · 9 pairs");
    dns.timing_coverage_complete = true; dns.timing_missing_slots = 0;
    dns.response_time_p50_ms = 0;
    vi.mocked(getNetworkExperienceSummary).mockResolvedValueOnce(structuredClone(data));
    await vi.advanceTimersByTimeAsync(10000); await flushPromises();
    expect(cell().get(".chip").text()).toBe("~0 ms");
    expect(cell().find('[aria-label="Partial timing evidence"]').exists()).toBe(false);
    expect(cell().get(".chip").attributes("title")).toContain("does not establish full-hour or capture coverage");
  });
  it("defaults to exact current total connections descending and sorts above-u64 counts with missing values last", async () => {
    const data = experienceSummary(), low = data.hosts[0]!;
    low.summary.firewall.dropped_sent_packets.total = "18446744073709551616";
    low.summary.connections.current.total = "1";
    const high = structuredClone(low), missing = structuredClone(low);
    high.ip_address = "192.0.2.21"; high.summary.traffic.received_bps = 0; high.summary.traffic.sent_bps = 0;
    high.summary.connections.current.total = "9007199254740993";
    high.summary.firewall.dropped_sent_packets.total = "18446744073709551617";
    missing.ip_address = "192.0.2.22"; missing.summary.traffic.received_bps = null;
    missing.summary.firewall.dropped_sent_packets.total = null;
    missing.summary.connections.current.total = null;
    data.hosts.push(high, missing);
    vi.mocked(getNetworkExperienceSummary).mockResolvedValue(data);
    await render();
    const addresses = () => wrapper!.findAll("tbody tr").map(row => row.attributes("data-host-address"));
    expect(addresses()).toEqual(["192.0.2.21", "192.0.2.20", "192.0.2.22"]);
    expect(wrapper!.findAll("thead th").find(header => header.text() === "Connections")!.attributes("aria-sort")).toBe("descending");
    const header = wrapper!.findAll("thead button").find(button => button.text() === "Firewall Drops")!;
    await header.trigger("click");
    expect(addresses()).toEqual(["192.0.2.20", "192.0.2.21", "192.0.2.22"]);
    await header.trigger("click");
    expect(addresses()).toEqual(["192.0.2.21", "192.0.2.20", "192.0.2.22"]);
    expect(getNetworkExperienceSummary).toHaveBeenCalledOnce();
  });
  it("keeps total and average chips distinct in one column and never fills missing current data", async () => {
    const data = experienceSummary(), first = data.hosts[0]!, second = structuredClone(first);
    first.summary.connections.current.total = "30";
    first.summary.connections.average.total = 20.125;
    first.summary.connections.average.observed_slots = 2;
    first.summary.connections.average.coverage_seconds = 20;
    second.ip_address = "192.0.2.21";
    second.summary.connections.average.total = 20.124;
    second.summary.connections.current = {
      ...second.summary.connections.current, status: "unavailable", total: null,
      error: "Current host attachment changed",
    };
    data.hosts.push(second);
    vi.mocked(getNetworkExperienceSummary).mockResolvedValueOnce(data);
    await render();
    const row = (address: string) => wrapper!.get(`[data-host-address="${address}"]`);
    expect(row(first.ip_address).get('[data-metric="total_connections"]').text()).toBe("Current 30");
    expect(row(first.ip_address).get('[data-metric="average_connections"]').text()).toBe("Avg 20");
    expect(row(first.ip_address).get('[data-metric="average_connections"] .chip').attributes("title")).toContain("2/360 snapshots · 20s coverage");
    expect(row(second.ip_address).get('[data-metric="total_connections"]').text()).toBe("-");
    expect(row(second.ip_address).get('[data-metric="total_connections"] span').attributes("title")).toContain("attachment changed");
    expect(row(second.ip_address).get('[data-metric="average_connections"]').text()).toBe("Avg 20");
    const missing = experienceSummary();
    missing.hosts[0]!.summary.connections.current.total = null;
    missing.hosts[0]!.summary.connections.average.total = null;
    vi.mocked(getNetworkExperienceSummary).mockResolvedValueOnce(missing);
    await vi.advanceTimersByTimeAsync(10000); await flushPromises();
    expect(wrapper!.get('[data-metric="total_connections"]').text()).toBe("-");
    expect(wrapper!.get('[data-metric="average_connections"]').text()).toBe("-");
  });
  it("marks current counts stale only after 30 seconds, including backend-established stale data", async () => {
    const data = experienceSummary();
    data.hosts[0]!.summary.connections.current.age_ms = 30000;
    vi.mocked(getNetworkExperienceSummary).mockResolvedValueOnce(data);
    await render();
    const current = () => wrapper!.get('[data-metric="total_connections"]');
    expect(current().text()).toBe("Current 3");
    expect(current().get(".chip").attributes("title")).toContain("Age: 30.00s");
    await vi.advanceTimersByTimeAsync(1000); await flushPromises();
    expect(current().text()).toContain("Stale");
    expect(current().get(".chip").attributes("data-color")).toBe("default");
    expect(wrapper!.get('[data-metric="average_connections"] .chip').attributes("data-color")).toBe("info");
    const backendStale = experienceSummary();
    backendStale.hosts[0]!.summary.connections.current.status = "stale";
    vi.mocked(getNetworkExperienceSummary).mockResolvedValueOnce(backendStale);
    await vi.advanceTimersByTimeAsync(9000); await flushPromises();
    expect(current().text()).toContain("Stale");
    expect(current().get(".chip").text()).toBe("Current 3");
  });
  it("does not fetch more than one page and makes the 256-host limit explicit while searching loaded rows", async () => {
    const data = experienceSummary(), original = data.hosts[0]!;
    data.hosts = Array.from({ length: 256 }, (_, index) => ({ ...structuredClone(original), ip_address: `192.0.2.${index}` }));
    data.eligible_hosts = 300; data.next_cursor = "more-hosts";
    vi.mocked(getNetworkExperienceSummary).mockResolvedValue(data);
    await render();
    expect(wrapper!.findAll("tbody tr")).toHaveLength(256);
    expect(wrapper!.text()).toContain("Showing 256 of 300 eligible hosts");
    expect(getNetworkExperienceSummary).toHaveBeenCalledOnce();
    await wrapper!.get("input").setValue("not in this page");
    expect(wrapper!.text()).toContain("No matching hosts in the loaded summary");
    expect(getNetworkExperienceSummary).toHaveBeenCalledOnce();
  });
  it.each(["success", "failure"])("keeps initial pending data neutral until %s", async outcome => {
    let resolve!: (value: ReturnType<typeof experienceSummary>) => void, reject!: (error: Error) => void;
    vi.mocked(getNetworkExperienceSummary).mockImplementationOnce(() => new Promise((done, fail) => { resolve = done; reject = fail; }));
    await render();
    expect(wrapper!.text()).toContain("Loading network experience");
    expect(wrapper!.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper!.text()).not.toContain("No configured");
    expect(wrapper!.text()).not.toContain("stale");
    if (outcome === "success") resolve(experienceSummary()); else reject(new Error("HTTP 503: unsupported summary endpoint"));
    await flushPromises();
    expect(wrapper!.text()).not.toContain("Loading network experience");
    if (outcome === "success") expect(wrapper!.findAll("tbody tr")).toHaveLength(1);
    else expect(wrapper!.get('[role="alert"]').text()).toContain("HTTP 503");
  });
  it("distinguishes zero from unavailable, retains historical idle ratings and flags mixed ownership", async () => {
    const data = experienceSummary(), value = data.hosts[0]!.summary;
    value.identity_changed = true; value.identity_changes.host_id = true;
    value.experience.last_rated!.is_last_observed_slot = false;
    value.experience.idle = { slots: 1, seconds: 10 }; value.experience.missing = { slots: 358, seconds: 3580 };
    value.observed_slots = 2; value.complete_slots = 2;
    value.traffic.received_bps = null;
    value.firewall.dropped_sent_packets.total = null;
    value.dns.unanswered_ratio = { ...value.dns.unanswered_ratio, numerator: null, denominator: null, percent: null };
    vi.mocked(getNetworkExperienceSummary).mockResolvedValue(data);
    await render();
    expect(wrapper!.get('[data-metric="experience"]').text()).toBe("Excellent");
    expect(wrapper!.get('[data-metric="experience"] .chip').attributes("title")).toContain("Idle: 10s");
    expect(wrapper!.get('[data-metric="experience"] .chip').attributes("title")).toContain("not the current state");
    expect(wrapper!.get('[data-metric="experience"] .chip').attributes("title")).toContain("spans identities");
    expect(wrapper!.get('[data-metric="throughput"] span').text()).toBe("-");
    expect(wrapper!.get('[data-metric="dropped_sent_packets"]').text()).toBe("-");
    expect(wrapper!.get('[data-metric="dns_response_time"] span').attributes("title")).toContain("Unavailable / Unavailable");
    expect(wrapper!.get('[data-metric="tcp_retransmissions"] [data-direction="sent"]').text()).toContain("↑ 0");
  });
  it("uses saved timezone for window and last rating, ignores drafts and neutralizes failed/stale reads", async () => {
    const store = useControllerStore();
    store.state.data!.desired.system = { hostname: "", domain: "", timezone: "Asia/Tokyo" };
    await render();
    expect(wrapper!.get(".experience-toolbar > span").attributes("title")).toContain("Window (Asia/Tokyo): 2026-11-14 08:25:10");
    expect(wrapper!.text()).toContain("Last Seen (Asia/Tokyo)");
    expect(wrapper!.text()).toContain("2026-11-14 09:25:09");
    expect(wrapper!.get('[data-metric="experience"] .chip').attributes("title")).toContain("Last rated (Asia/Tokyo): 2026-11-14 09:25:10");
    expect(wrapper!.get('[data-metric="total_connections"] .chip').attributes("title")).toContain("Observed (Asia/Tokyo): 2026-11-14 09:25:10");
    expect(wrapper!.get('[data-metric="average_connections"] .chip').attributes("title")).toContain("First observed (Asia/Tokyo): 2026-11-14 09:25:10");
    expect(wrapper!.get('[data-metric="total_connections"] .chip').attributes("title")).not.toContain(".123456");
    expect(wrapper!.text()).not.toContain(".123456");
    store.draft = cloneConfig(store.state.data!.desired); store.draft.system!.timezone = "America/New_York";
    await flushPromises(); expect(wrapper!.text()).toContain("2026-11-14 09:25:09");
    vi.mocked(getNetworkExperienceSummary).mockRejectedValue(new Error("HTTP 429: read admission busy"));
    await vi.advanceTimersByTimeAsync(10000); await flushPromises();
    expect(wrapper!.get('[role="alert"]').text()).toContain("HTTP 429");
    expect(wrapper!.text()).toContain("Retained hourly evidence is stale");
    expect(wrapper!.findAll('[data-metric="experience"] .chip').every(chip => chip.attributes("data-color") === "default")).toBe(true);
    expect(wrapper!.get('[data-metric="total_connections"] .chip').attributes("data-color")).toBe("default");
    expect(wrapper!.get('[data-metric="average_connections"] .chip').attributes("data-color")).toBe("default");
    await vi.advanceTimersByTimeAsync(3601000); await flushPromises();
    expect(wrapper!.text()).toContain("Retained measurements have expired");
    expect(wrapper!.text()).not.toContain("Excellent");
    for (const side of ["local_rtt", "remote_rtt"]) {
      expect(wrapper!.get(`[data-metric="${side}"]`).text()).toBe("-");
      expect(wrapper!.find(`[data-metric="${side}"] .chip`).exists()).toBe(false);
    }
    expect(wrapper!.get('[data-metric="total_connections"]').text()).toBe("-");
    expect(wrapper!.get('[data-metric="average_connections"]').text()).toBe("-");
  });
  it("preserves real host replay links and pauses hidden/unmounted polling", async () => {
    await render();
    expect(wrapper!.get(".host-name").element.tagName).toBe("A");
    expect(wrapper!.get(".host-name").attributes("href")).toBe("/diagnostics/network-experience/192.0.2.20");
    await wrapper!.get(".host-name").trigger("click"); await flushPromises();
    expect(wrapper!.vm.$route.name).toBe("network-experience-host");
    expect(getNetworkExperienceHistory).not.toHaveBeenCalled();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(20000);
    wrapper!.unmount(); wrapper = undefined;
    await vi.advanceTimersByTimeAsync(20000);
    expect(getNetworkExperienceSummary).toHaveBeenCalledOnce();
  });
  it("preserves history percentage and contributor precision without changing integer counts", async () => {
    const history = experienceHistory();
    history.samples[359]!.sample!.tcp.retransmission_percent_sent = 2.5678;
    history.samples[359]!.sample!.experience.components[0]!.value = 12.3456;
    vi.mocked(getNetworkExperienceHistory).mockResolvedValue(history);
    wrapper = mount(NetworkExperienceHistory, { props: { address: "192.0.2.20" }, global: { stubs } });
    await flushPromises();
    const chart = wrapper.findComponent({ name: "VueApexCharts" });
    expect(chart.props("options").yaxis.labels.formatter(0)).toBe("0.00");
    expect(chart.props("options").tooltip.y.formatter(400000)).toBe("400,000.00 bps");
    expect(wrapper.get('[aria-label="Experience contributors"]').text()).toContain("12.35 ms");
    await wrapper.get("select").setValue("repeats");
    expect(wrapper.findComponent({ name: "VueApexCharts" }).props("options").tooltip.y.formatter(2.5678)).toBe("2.57 %");
    await wrapper.get("select").setValue("drops");
    expect(wrapper.findComponent({ name: "VueApexCharts" }).props("options").tooltip.y.formatter(2)).toBe("2 packets / bucket");
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
