import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LinkDiagnosticsTable from "@/components/feature/LinkDiagnosticsTable.vue";
import { useControllerStore } from "@/stores/controller";
import { linkDiagnostics } from "../diagnosticsFixtures";
import { state, trafficStatistics } from "../fixtures";

type Kind = "interfaces" | "queues" | "windows" | "capture";
let wrapper: ReturnType<typeof mount>;
beforeEach(() => {
  vi.useFakeTimers(); setActivePinia(createPinia());
  const store = useControllerStore(); store.connected = true; store.state.data = state();
  store.linkDiagnostics.data = linkDiagnostics(); store.linkDiagnostics.stale = false; store.linkDiagnostics.lastSuccess = Date.now();
  vi.spyOn(store, "refreshLinkDiagnostics").mockResolvedValue();
});
afterEach(() => { wrapper?.unmount(); useControllerStore().$dispose(); vi.useRealTimers(); });
function render(kind: Kind = "interfaces") {
  wrapper = mount(LinkDiagnosticsTable, { props: { kind }, global: { stubs: {
    VTable: { template: "<table><slot /></table>" }, VProgressLinear: true,
    VChip: { props: ["color"], template: '<span class="chip" :data-color="color"><slot /></span>' },
    RouterLink: { props: ["to"], template: '<a :href="to"><slot /></a>' },
  } } });
}
describe("Focused link diagnostic tables", () => {
  it.each([
    ["interfaces", "Interface drops", ["Interface", "Errors (RX + TX)", "Errors delta", "Drops (RX + TX)", "Drops delta", "Drop percentage"]],
    ["queues", "QDISCS", ["Interface", "Kind", "Handle", "Parent", "Status", "Queue (packets)", "Backlog (bytes)", "Growth (bytes)", "Drops", "Drops delta", "Requeues", "Overlimits"]],
    ["windows", "TCP WINDOWING", ["Interface", "TCP ACK packets", "Zero-window observations", "Zero-window transitions", "Window decreases (% of ACKs)", "Minimum raw window", "Maximum raw window"]],
    ["capture", "Capture details", ["Tracked directions", "Direction limit", "Kernel drops", "Rejected headers", "Capacity rejections", "Capture gaps"]],
  ] as const)("shows only the %s table without router-local TCP or raw metadata", (kind, label, headers) => {
    const store = useControllerStore(); store.stage(state().desired); const draft = JSON.stringify(store.draft);
    render(kind);
    expect(wrapper.get("section").attributes("aria-label")).toBe(label);
    expect(wrapper.findAll("thead")[0]!.findAll("th").map(item => item.text())).toEqual([...headers]);
    expect(wrapper.findAll("h1, h2")).toHaveLength(0);
    for (const hidden of ["Router-local TCP", "Socket SRTT", "Scope:", "Schema:", "Sample age:", "Measurement coverage", "future_evidence_code"]) {
      expect(wrapper.text()).not.toContain(hidden);
    }
    expect(wrapper.text()).toContain("Collected (UTC): 2026-10-28 01:02:03");
    expect(wrapper.text()).not.toContain(".987654"); expect(store.linkDiagnostics.data!.collected_at).toContain(".987654");
    expect(wrapper.findAll("button")).toHaveLength(0); expect(JSON.stringify(store.draft)).toBe(draft);
  });
  it("preserves exact interface counters and colors cumulative observations separately from deltas", () => {
    const data = useControllerStore().linkDiagnostics.data!;
    data.interfaces!.push({ index: 3, name: "zero0", errors: "1", drops: "2", errors_delta: "0", drops_delta: "0" });
    render();
    expect(wrapper.text()).toContain("9007199254740993"); expect(wrapper.text()).toContain("18446744073709551615");
    const rows = wrapper.findAll("tbody tr");
    expect(rows[0]!.findAll(".chip").slice(0, 5).map(chip => chip.attributes("data-color"))).toEqual(["info", "warning", "default", "warning", "warning"]);
    expect(rows[1]!.findAll(".chip").slice(0, 5).map(chip => chip.attributes("data-color"))).toEqual(["info", "warning", "success", "warning", "success"]);
    expect(wrapper.text()).toContain("Unavailable");
  });
  it("updates inline error/drop increases on polling and hides them for zero, reset, and stale samples", async () => {
    const store = useControllerStore();
    const sample = linkDiagnostics();
    sample.interfaces![0]!.errors_delta = "2"; sample.interfaces![0]!.drops_delta = "9007199254740993";
    store.linkDiagnostics.data = sample;
    render();
    const increases = () => wrapper.findAll('tbody span[title="Increase since the previous diagnostic sample"]').map(item => item.text());
    expect(increases()).toEqual(["+2", "+9007199254740993"]);
    store.linkDiagnostics.data = { ...sample, interfaces: [{ ...sample.interfaces![0]!, errors_delta: "0", drops_delta: null }] };
    await flushPromises();
    expect(increases()).toEqual([]);
    store.linkDiagnostics.data = { ...sample, interfaces: [{ ...sample.interfaces![0]!, errors_delta: "3", drops_delta: "4" }] };
    await flushPromises();
    expect(increases()).toEqual(["+3", "+4"]);
    await vi.advanceTimersByTimeAsync(5001); await flushPromises();
    expect(increases()).toEqual([]);
  });
  it("shows colored cumulative drop percentages without a packet column", async () => {
    const store = useControllerStore(), sample = trafficStatistics();
    sample.interfaces = [{ ...sample.interfaces[0]!, name: "lab0", index: 2, counters: { rx_packets: "60", tx_packets: "30", rx_dropped: "6", tx_dropped: "4" } }];
    store.statistics.data = sample; store.statistics.stale = false; store.statistics.lastSuccess = Date.now();
    render();
    expect(wrapper.findAll("thead th").map(cell => cell.text())).not.toContain("Packets (RX + TX)");
    const totals = () => wrapper.findAll("tbody tr")[0]!.findAll("td").slice(5).map(cell => cell.text());
    const color = () => wrapper.findAll("tbody tr")[0]!.findAll("td")[5]!.get(".chip").attributes("data-color");
    expect(totals()).toEqual(["10.00%"]); expect(color()).toBe("warning");
    store.statistics.data = { ...sample, interfaces: [{ ...sample.interfaces[0]!, counters: { rx_packets: "9007199254740993", tx_packets: "1", rx_dropped: "0", tx_dropped: "0" } }] };
    await flushPromises(); expect(totals()).toEqual(["0.00%"]); expect(color()).toBe("success");
    store.statistics.data = { ...sample, interfaces: [{ ...sample.interfaces[0]!, index: 3 }] };
    await flushPromises(); expect(totals()).toEqual(["Unavailable"]); expect(color()).toBe("default");
    store.statistics.data = { ...sample, interfaces: [{ ...sample.interfaces[0]!, counters: { rx_packets: "9007199254740993", tx_packets: "1" } }] };
    await flushPromises(); expect(totals()).toEqual(["Unavailable"]); expect(color()).toBe("default");
    store.statistics.data = sample;
    store.statistics.stale = true;
    await flushPromises(); expect(totals()).toEqual(["Unavailable"]); expect(color()).toBe("default");
    store.statistics.stale = false; store.statistics.lastSuccess = Date.now() - 4000;
    await flushPromises(); expect(totals()).toEqual(["10.00%"]);
    await vi.advanceTimersByTimeAsync(1001); await flushPromises();
    expect(totals()).toEqual(["Unavailable"]); expect(color()).toBe("default");
    expect(wrapper.findAll(".chip")[0]!.text()).toBe("Current");
    await vi.advanceTimersByTimeAsync(4000); await flushPromises();
    expect(wrapper.findAll(".chip")[0]!.text()).toBe("Stale");
  });
  it("keeps qdiscs separate and preserves signed backlog growth and unavailable values", () => {
    render("queues");
    expect(wrapper.findAll("tbody tr")).toHaveLength(2);
    expect(wrapper.text()).toContain("-256"); expect(wrapper.text()).toContain("9007199254740993");
    expect(wrapper.text()).toContain("their statistics help identify congestion, queue buildup, and intentional packet drops");
    expect(wrapper.findAll("tbody tr")[1]!.text()).toContain("unavailable");
    expect(wrapper.findAll("tbody tr")[1]!.text()).toContain("Unavailable");
    const cells = wrapper.findAll("tbody tr")[0]!.findAll("td");
    expect(cells[8]!.text()).toContain("+1");
    for (const index of [8, 9, 10, 11]) expect(cells[index]!.get(".chip").attributes("data-color")).toBe("warning");
    expect(cells[5]!.get(".chip").attributes("data-color")).toBe("info");
    expect(cells[6]!.get(".chip").attributes("data-color")).toBe("info");
    for (const cell of wrapper.findAll("tbody tr")[1]!.findAll("td").slice(5)) {
      expect(cell.get(".chip").attributes("data-color")).toBe("default");
    }
  });
  it("uses green chips for measured zero interface errors/drops and qdisc events", async () => {
    const data = useControllerStore().linkDiagnostics.data!;
    data.interfaces![0] = { index: 2, name: "lab0", errors: "0", errors_delta: "0", drops: "0", drops_delta: "0" };
    render();
    expect(wrapper.findAll("tbody .chip").slice(1, 5).every(chip => chip.attributes("data-color") === "success")).toBe(true);
    data.queues![0]!.queue = { qlen_packets: 0, backlog_bytes: 0, drops: "0", requeues: "0", overlimits: "0" };
    data.queues![0]!.drops_delta = "0"; data.queues![0]!.backlog_growth_bytes = "0";
    await wrapper.setProps({ kind: "queues" });
    const cells = wrapper.findAll("tbody tr")[0]!.findAll("td");
    for (const index of [7, 8, 9, 10, 11]) expect(cells[index]!.get(".chip").attributes("data-color")).toBe("success");
  });
  it("colors TCP event counts amber but does not rate ACK traffic or raw windows as faults", () => {
    render("windows");
    const cells = wrapper.findAll("tbody tr")[0]!.findAll("td");
    for (const index of [2, 3, 4]) expect(cells[index]!.get(".chip").attributes("data-color")).toBe("warning");
    for (const index of [1, 5, 6]) expect(cells[index]!.get(".chip").attributes("data-color")).toBe("info");
    expect(cells[4]!.get(".chip").attributes("title")).toContain("Cumulative");
    expect(wrapper.find("details").exists()).toBe(false);
  });
  it.each([false, true])("only colors zero TCP event counts green when capture is complete (%s)", async complete => {
    const headers = useControllerStore().linkDiagnostics.data!.packet_headers!;
    headers.statistics_complete = complete;
    headers.interfaces[0]!.zero_window_observations = "0";
    headers.interfaces[0]!.zero_window_transitions = "0";
    headers.interfaces[0]!.window_decreases = "0";
    headers.kernel_drops = "0"; headers.rejected_headers = "0"; headers.untracked_packets = "0"; headers.capture_gaps = "0";
    render("windows");
    const cells = wrapper.findAll("tbody tr")[0]!.findAll("td");
    for (const index of [2, 3, 4]) expect(cells[index]!.get(".chip").attributes("data-color")).toBe(complete ? "success" : "default");
    await wrapper.setProps({ kind: "capture" });
    for (const cell of wrapper.findAll("tbody td").slice(2)) {
      expect(cell.get(".chip").attributes("data-color")).toBe(complete ? "success" : "default");
    }
  });
  it("explains zero windows without linking to capture details or embedding the capture table", () => {
    render("windows");
    expect(wrapper.findAll(".chip").find(chip => chip.text() === "Capture incomplete")!.attributes("data-color")).toBe("warning");
    expect(wrapper.find('a[href="/diagnostics/capture-details"]').exists()).toBe(false);
    expect(wrapper.find("details").exists()).toBe(false);
    expect(wrapper.findAll("table")).toHaveLength(1);
    expect(wrapper.text()).not.toContain("Kernel drops");
    expect(wrapper.text()).toContain("A zero window means the receiver is advertising no space for more data");
    expect(wrapper.text()).toContain("receiver_window_pressure");
    expect(wrapper.text()).not.toContain("interface_drops");
  });
  it.each([
    ["1", "3", "33.33%"],
    ["0", "10", "0.00%"],
    ["0", "0", "Unavailable"],
    ["4", "3", "Unavailable"],
    ["9007199254740993", "18014398509481986", "50.00%"],
  ])("shows window decreases %s / ACKs %s as %s", (decreases, acks, expected) => {
    const row = useControllerStore().linkDiagnostics.data!.packet_headers!.interfaces[0]!;
    row.window_decreases = decreases; row.tcp_ack_packets = acks;
    render("windows");
    expect(wrapper.findAll("tbody tr")[0]!.findAll("td")[4]!.get("span.text-caption").text()).toBe(expected);
  });
  it("shows exact capture counters even when there are no observed TCP interfaces", () => {
    useControllerStore().linkDiagnostics.data!.packet_headers!.interfaces = [];
    render("capture");
    expect(wrapper.findAll(".chip").find(chip => chip.text() === "Capture incomplete")!.attributes("data-color")).toBe("warning");
    expect(wrapper.text()).toContain("18446744073709551615");
    expect(wrapper.text()).toContain("help distinguish real network problems from missing or truncated capture data");
    expect(wrapper.get("th[title*='could not receive']").text()).toBe("Kernel drops");
    expect(wrapper.text()).not.toContain("Zero-window observations");
    expect(wrapper.findAll("tbody tr")).toHaveLength(1);
    for (const cell of wrapper.findAll("tbody td").slice(2)) {
      expect(cell.get(".chip").attributes("data-color")).toBe("warning");
    }
  });
  it.each(["interfaces", "queues", "windows", "capture"] as const)("expires %s measurements and removes current severity colors", async kind => {
    render(kind); await vi.advanceTimersByTimeAsync(5001); await flushPromises();
    expect(wrapper.findAll(".chip")[0]!.text()).toBe("Stale");
    expect(wrapper.text()).toContain("Historical observations only");
    for (const chip of wrapper.findAll("tbody .chip")) {
      expect(["success", "warning", "error"]).not.toContain(chip.attributes("data-color"));
    }
  });
  it("shows unavailable capture explicitly instead of inventing zero counters", () => {
    useControllerStore().linkDiagnostics.data!.packet_headers = null;
    render("capture");
    expect(wrapper.text()).toContain("Measurements unavailable.");
    expect(wrapper.findAll("tbody td")).toHaveLength(1);
    expect(wrapper.findAll("tbody .chip")).toHaveLength(0);
  });
  it("includes time since the cached read when opening a retained sample", async () => {
    const store = useControllerStore(); store.linkDiagnostics.data!.age_ms = 500; store.linkDiagnostics.lastSuccess = Date.now() - 4000;
    render(); expect(wrapper.findAll(".chip")[0]!.text()).toBe("Current");
    await vi.advanceTimersByTimeAsync(501); await flushPromises();
    expect(wrapper.findAll(".chip")[0]!.text()).toBe("Stale");
  });
  it.each(["starting", "unavailable", "stale", "simulated"] as const)("keeps %s measurements explicitly unavailable", status => {
    useControllerStore().linkDiagnostics.data = { ...linkDiagnostics(), status, collected_at: null, age_ms: null, interval_seconds: null, interfaces: null, queues: null, local_tcp: null, packet_headers: null, signals: [] };
    render(); expect(wrapper.text()).toContain("Current measurements are unavailable");
    expect(wrapper.text()).toContain("Measurements unavailable.");
    expect(wrapper.text()).toContain("Collected (UTC): Unavailable");
    expect(wrapper.findAll("tbody tr")).toHaveLength(1);
  });
  it("identifies retained measurements after a failed read without blocking editing", () => {
    const store = useControllerStore(); store.linkDiagnostics.error = "HTTP 503: cache unavailable"; store.linkDiagnostics.stale = true;
    render(); expect(wrapper.text()).toContain("HTTP 503"); expect(wrapper.text()).toContain("Historical observations only");
    expect(store.readOnlyReason).toBe("");
  });
});
