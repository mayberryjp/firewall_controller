import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent } from "vue";
import { LosslessNumber } from "lossless-json";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DHCPRelayView from "@/views/DHCPRelayView.vue";
import DHCPRelayLogsView from "@/views/DHCPRelayLogsView.vue";
import SyslogView from "@/views/SyslogView.vue";
import SyslogLogsView from "@/views/SyslogLogsView.vue";
import ResourceTable from "@/components/feature/ResourceTable.vue";
import RSSIRQView from "@/views/RSSIRQView.vue";
import PersistentLogStream from "@/components/feature/PersistentLogStream.vue";
import { useDiagnosticRead } from "@/composables/useDiagnosticRead";
import { useLogHistory } from "@/composables/useLogHistory";
import { useControllerStore } from "@/stores/controller";
import * as api from "@/services/netcontrol";
import { ApiFailure } from "@/services/api";
import { runtimeSchema, systemSchema } from "@/types/domain";
import { interfaceCapabilitySnapshot } from "../diagnosticsFixtures";
import { state, runtime, config } from "../fixtures";
import { persistentLog, relayLog, relayStatistics, telemetryEpoch } from "../serviceTelemetryFixtures";

const stubs = {
  VTable: { template: "<table><slot /></table>" },
  VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
  VChip: { template: "<span><slot /></span>" }, VAlert: { template: "<div><slot /></div>" },
  VSelect: { props: ["modelValue", "items", "disabled"], emits: ["update:modelValue"], template: '<select :value="modelValue" :disabled="disabled" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="item in items" :key="item.value" :value="item.value">{{ item.title }}</option></select>' },
  VCombobox: { props: ["modelValue"], emits: ["update:modelValue"], template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)">' },
  VSwitch: true, VTextField: true, DatasetStatus: true, ResourcePage: true,
  RouterLink: { template: "<a><slot /></a>" },
};
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function pollingHost(setup: () => Record<string, unknown>) {
  return defineComponent({ setup, template: "<div>{{ data }}</div>" });
}
let visibility = "visible";
beforeEach(() => {
  vi.useFakeTimers(); setActivePinia(createPinia()); visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility === "visible" ? "visible" : "hidden");
  const store = useControllerStore();
  store.connected = true; store.state.data = state(); store.state.stale = false;
  store.runtime.data = runtime(); store.runtime.stale = false;
  store.draft = config();
  vi.spyOn(api, "getDHCPRelayStatistics").mockResolvedValue(relayStatistics());
  vi.spyOn(api, "getDHCPRelayLog").mockResolvedValue(relayLog());
  vi.spyOn(api, "getPersistentLog").mockImplementation(async source => persistentLog(source));
  vi.spyOn(api, "getInterfaceCapabilities").mockResolvedValue(interfaceCapabilitySnapshot());
  vi.spyOn(api, "refreshInterfaceCapabilities").mockResolvedValue(interfaceCapabilitySnapshot());
});
afterEach(() => { useControllerStore().$dispose(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("service counters", () => {
  it.each(["disabled", "missing"] as const)("uses a dash for %s disabled relay status and counters", async status => {
    const store = useControllerStore();
    store.runtime.data!.dhcp_relay = status === "disabled" ? [{ interface: "lab0", state: "disabled" }] : [];
    const result = relayStatistics();
    result.interfaces[0]!.enabled = false;
    result.interfaces[0]!.state = "disabled";
    result.interfaces[0]!.counters = null;
    vi.mocked(api.getDHCPRelayStatistics).mockResolvedValueOnce(result);
    const wrapper = mount(DHCPRelayView, { global: { stubs } }); await flushPromises();
    const cells = wrapper.get("tbody tr").findAll("td");
    expect(cells[2]!.text()).toBe("-");
    expect(cells.slice(4, 6).map(cell => cell.text())).toEqual(["-", "-"]);
    expect(cells.slice(4, 6).map(cell => cell.get("span").attributes("color"))).toEqual(["default", "default"]);
    wrapper.unmount();
  });
  it.each([
    ["0", "0", "success"],
    ["3", "3", "success"],
    ["3", "2", "error"],
    ["9007199254740993", "9007199254740992", "error"],
    ["18446744073709551615", "18446744073709551615", "success"],
    [null, "2", "default"],
  ])("colors request/reply chips for %s / %s as %s", async (requests, replies, color) => {
    const result = relayStatistics();
    if (requests === null) result.interfaces[0]!.counters = null;
    else {
      result.interfaces[0]!.counters!.requests_forwarded = requests;
      result.interfaces[0]!.counters!.replies_received = replies!;
    }
    vi.mocked(api.getDHCPRelayStatistics).mockResolvedValueOnce(result);
    const wrapper = mount(DHCPRelayView, { global: { stubs } }); await flushPromises();
    const cells = wrapper.get("tbody tr").findAll("td").slice(4, 6);
    expect(cells.map(cell => cell.get("span").attributes("color"))).toEqual([color, color]);
    expect(cells.map(cell => cell.get("span").attributes("variant"))).toEqual(["tonal", "tonal"]);
    wrapper.unmount();
  });
  it("keeps unknown runtime status visible for an enabled relay", async () => {
    const store = useControllerStore();
    store.draft!.interfaces[0]!.dhcp_relay.enabled = true;
    store.runtime.data!.dhcp_relay = [];
    const wrapper = mount(DHCPRelayView, { global: { stubs } }); await flushPromises();
    expect(wrapper.get("tbody tr").findAll("td")[2]!.text()).toBe("Unknown");
    wrapper.unmount();
  });
  it("adds only the two requested counters to existing DHCP relay rows", async () => {
    const store = useControllerStore(), before = JSON.stringify(store.draft);
    const result = relayStatistics();
    result.interfaces[0]!.counters!.requests_forwarded = "18446744073709551615";
    vi.mocked(api.getDHCPRelayStatistics).mockResolvedValueOnce(result);
    const wrapper = mount(DHCPRelayView, { global: { stubs } }); await flushPromises();
    const panel = wrapper.get(".relay-table");
    expect(panel.text()).toContain("18,446,744,073,709,551,615");
    expect(panel.findAll("th").map(cell => cell.text())).toEqual(["Interface", "Servers", "Status", "Enabled", "Requests forwarded", "Replies received", "Actions"]);
    expect(panel.findAll("tbody tr")[0]!.findAll("td").slice(4, 6).map(cell => cell.text())).toEqual(["18,446,744,073,709,551,615", "2"]);
    expect(wrapper.findAll("table")).toHaveLength(1);
    expect(JSON.stringify(store.draft)).toBe(before);
    expect(api.getDHCPRelayLog).not.toHaveBeenCalled();
  });
  it.each(["success", "failure"] as const)("keeps initial counters neutral until %s", async outcome => {
    const pending = deferred<ReturnType<typeof relayStatistics>>();
    vi.mocked(api.getDHCPRelayStatistics).mockReturnValueOnce(pending.promise);
    const wrapper = mount(DHCPRelayView, { global: { stubs } });
    expect(wrapper.findAll("tbody tr")[0]!.findAll("td").slice(4, 6).map(cell => cell.text())).toEqual(["...", "..."]);
    expect(wrapper.get("tbody tr").findAll("td").slice(4, 6).map(cell => cell.get("span").attributes("color"))).toEqual(["default", "default"]);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    if (outcome === "success") pending.resolve(relayStatistics());
    else pending.reject(new ApiFailure("HTTP 503: Relay unavailable", 503));
    await flushPromises();
    expect(wrapper.text()).toContain(outcome === "success" ? "Requests forwarded" : "HTTP 503");
    expect(wrapper.findAll("tbody tr")[0]!.findAll("td")[4]!.text()).toBe(outcome === "success" ? "3" : "Unknown");
    expect(wrapper.get("tbody tr").findAll("td").slice(4, 6).map(cell => cell.get("span").attributes("color"))).toEqual(outcome === "success" ? ["error", "error"] : ["default", "default"]);
  });
  it("renders changed attempts, retained errors and null measurements without modifying settings", async () => {
    const result = relayStatistics(); result.generation = "2"; result.totals = null;
    result.worker = { name: "dhcp-relay", state: "error", retrying: true, error: "Relay socket failed" };
    result.interfaces[0]!.counters = null;
    useControllerStore().runtime.data!.dhcp_relay = [{ interface: "lab0", state: "error", retrying: true }];
    vi.mocked(api.getDHCPRelayStatistics).mockResolvedValueOnce(result);
    const wrapper = mount(DHCPRelayView, { global: { stubs } }); await flushPromises();
    expect(wrapper.text()).toContain("Recovering");
    expect(wrapper.get('[role="alert"]').text()).toBe("Relay socket failed");
    expect(wrapper.findAll("tbody tr")[0]!.text()).toContain("Unknown");
  });
  it("puts syslog counters on Services Syslog and distinguishes capture from forwarding", () => {
    const store = useControllerStore();
    store.runtime.data = runtimeSchema.parse({ ...runtime(), appliance_services: [{
      name: "syslog", scope: "host", state: "running", forwarding_enabled: false,
      received_records: 10, captured_records: 10, forwarded_records: 0, forwarded_deliveries: 1,
      failed_deliveries: 1, error: "Collector unavailable", destination_errors: ["Send failed"],
    }] });
    const wrapper = mount(SyslogView, { global: { stubs } });
    expect(wrapper.text()).toContain("Local capture:");
    expect(wrapper.text()).toContain("Forwarding: Disabled");
    const panel = wrapper.get(".service-table");
    expect(panel.findAll("th").map(item => item.text())).toEqual(["Host", "Port", "Transport", "Logs read", "Remote sends", "Actions"]);
    expect(panel.findAll("td").slice(1, 3).map(item => item.text())).toEqual(["10", "1"]);
    expect(wrapper.findAll("table")).toHaveLength(1);
    expect(wrapper.text()).toContain("Collector unavailable");
    expect(wrapper.text()).toContain("Send failed");
    expect(api.getPersistentLog).not.toHaveBeenCalled();
  });
  it.each(["servers", "editing", "empty"] as const)("uses colored syslog total chips with %s rows", async mode => {
    const store = useControllerStore();
    store.draft!.syslog.servers = mode === "empty" ? [] : [
      { host: "192.0.2.10", port: 514, transport: "udp" },
      { host: "192.0.2.11", port: 514, transport: "tcp" },
    ];
    store.runtime.data = runtimeSchema.parse({ ...runtime(), appliance_services: [{
      name: "syslog", scope: "host", state: "running",
      received_records: new LosslessNumber("18446744073709551615"), forwarded_deliveries: 0,
    }] });
    const before = JSON.stringify(store.draft);
    const wrapper = mount(SyslogView, { global: { stubs } });
    if (mode === "editing") await wrapper.get('[aria-label="Edit 192.0.2.10"]').trigger("click");
    const cells = wrapper.get("tbody tr").findAll("td");
    const chips = cells.slice(mode === "empty" ? 1 : 3, mode === "empty" ? 3 : 5).map(cell => cell.get("span"));
    expect(chips.map(chip => chip.text())).toEqual(["18,446,744,073,709,551,615", "0"]);
    expect(chips.map(chip => chip.attributes("color"))).toEqual(["info", "primary"]);
    expect(chips.map(chip => chip.attributes("variant"))).toEqual(["tonal", "tonal"]);
    expect(chips.map(chip => chip.attributes("size"))).toEqual(["small", "small"]);
    if (mode !== "empty") expect(wrapper.findAll('td[title="Service total"]')).toHaveLength(2);
    expect(JSON.stringify(store.draft)).toBe(before);
    wrapper.unmount();
  });
  it.each(["success", "failure"] as const)("keeps syslog counter chips neutral while pending until %s", async outcome => {
    const store = useControllerStore();
    store.draft!.syslog.servers = [];
    store.runtime.data = null;
    store.runtime.loading = true;
    store.runtime.error = null;
    const wrapper = mount(SyslogView, { global: { stubs } });
    const chips = () => wrapper.get("tbody tr").findAll("td").slice(1, 3).map(cell => cell.get("span"));
    expect(chips().map(chip => chip.text())).toEqual(["...", "..."]);
    expect(chips().map(chip => chip.attributes("color"))).toEqual(["default", "default"]);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    store.runtime.loading = false;
    if (outcome === "success") {
      store.runtime.data = runtimeSchema.parse({ ...runtime(), appliance_services: [{
        name: "syslog", scope: "host", state: "running",
        received_records: 10, forwarded_deliveries: 2,
      }] });
    } else store.runtime.error = "HTTP 503: Syslog unavailable";
    await flushPromises();
    expect(chips().map(chip => chip.text())).toEqual(outcome === "success" ? ["10", "2"] : ["Unknown", "Unknown"]);
    expect(chips().map(chip => chip.attributes("color"))).toEqual(outcome === "success" ? ["info", "primary"] : ["default", "default"]);
    expect(wrapper.find('[role="alert"]').exists()).toBe(outcome === "failure");
    wrapper.unmount();
  });
  it("puts exact per-instance NetFlow counters on Services NetFlow", () => {
    const store = useControllerStore();
    store.runtime.data!.softflowd = [{
      name: "office", state: "running", exported_flows: "9007199254740993", exported_packets: "18446744073709551615", exported_bytes: "1464",
      exported_flow_packets: "9007199254740993", exported_flow_bytes: "18446744073709551615", export_errors: "0",
    }, { name: "guest", state: "stopped", error: "Export failed" }];
    const value = store.draft!.softflowd[0]!;
    const rows = ["office", "guest"].map((name, index) => ({ value: { ...value, name }, index, rowID: name }));
    const wrapper = mount(ResourceTable, { props: { section: "softflowd", rows, total: 2, disabled: false, detail: false }, global: { stubs } });
    const panel = wrapper.get("table");
    expect(panel.findAll("tbody tr")).toHaveLength(2);
    expect(panel.findAll("thead th").map(cell => cell.text())).toContain("Flow records");
    expect(panel.findAll("thead th").map(cell => cell.text())).toContain("Export datagrams");
    expect(panel.text()).toContain("9,007,199,254,740,993");
    expect(panel.text()).toContain("18,446,744,073,709,551,615");
    expect(panel.text()).toContain("Unknown");
    expect(panel.text()).not.toContain("Export payload bytes");
    expect(wrapper.findAll("table")).toHaveLength(1);
  });
});

describe("diagnostic log pages", () => {
  it("uses the saved timezone for fractional timestamps, not unsaved timezone drafts", async () => {
    const store = useControllerStore();
    store.state.data!.desired.system = systemSchema.parse({ timezone: "Asia/Tokyo" });
    store.draft!.system = systemSchema.parse({ timezone: "America/New_York" });
    const relayLogs = mount(DHCPRelayLogsView, { global: { stubs } });
    const logs = mount(PersistentLogStream, { props: { source: "syslog", active: true }, global: { stubs } });
    await flushPromises();
    for (const wrapper of [relayLogs, logs]) {
      expect(wrapper.get("time").text()).toBe("2026-11-11 09:00:00");
      expect(wrapper.text()).toContain("Asia/Tokyo");
      expect(wrapper.get("time").attributes("datetime")).toContain(".987654Z");
    }
  });
  it("drains DHCP pages in order with unchanged filters, including empty pages", async () => {
    const first = relayLog(); first.has_more = true;
    const empty = relayLog("2"); empty.events = []; empty.has_more = true;
    vi.mocked(api.getDHCPRelayLog).mockResolvedValueOnce(first).mockResolvedValueOnce(empty).mockResolvedValueOnce(relayLog("3"));
    const wrapper = mount(DHCPRelayLogsView, { global: { stubs } }); await flushPromises();
    expect(wrapper.findAll("tbody tr")).toHaveLength(2);
    expect(wrapper.text()).toContain("Discover");
    expect(wrapper.get("time").text()).toBe("2026-11-11 00:00:00");
    expect(api.getDHCPRelayLog).toHaveBeenNthCalledWith(2, { cursor: `${telemetryEpoch}:1`, limit: 100 }, expect.any(AbortSignal));
    expect(api.getDHCPRelayLog).toHaveBeenNthCalledWith(3, { cursor: `${telemetryEpoch}:2`, limit: 100 }, expect.any(AbortSignal));
    wrapper.unmount();
  });
  it("keeps pending DHCP logs neutral and applies the current event filter when loading completes", async () => {
    const pending = deferred<ReturnType<typeof relayLog>>();
    vi.mocked(api.getDHCPRelayLog).mockReturnValueOnce(pending.promise);
    const wrapper = mount(DHCPRelayLogsView, { global: { stubs } });
    await wrapper.get('[aria-label="Event"]').setValue("packets_rejected");
    expect(wrapper.get('[role="status"]').text()).toBe("Loading logs...");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("No matching relay events.");
    pending.resolve(relayLog()); await flushPromises();
    expect(wrapper.get("tbody").text()).toBe("No matching relay events.");
    expect(api.getDHCPRelayLog).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
  it("surfaces an initial DHCP read failure with filters selected", async () => {
    const pending = deferred<ReturnType<typeof relayLog>>();
    vi.mocked(api.getDHCPRelayLog).mockReturnValueOnce(pending.promise);
    const wrapper = mount(DHCPRelayLogsView, { global: { stubs } });
    await wrapper.get('[aria-label="Event"]').setValue("failures");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    pending.reject(new ApiFailure("HTTP 503: Relay unavailable", 503)); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("HTTP 503");
    expect(wrapper.find("table").exists()).toBe(false);
    wrapper.unmount();
  });
  it("colors DHCP event and reason chips and filters uppercase MACs and failures without resetting history", async () => {
    const page = relayLog("7");
    const base = page.events[0]!;
    page.events = [
      { ...base, sequence: "1", client_mac: "aa:bb:cc:dd:ee:01" },
      { ...base, sequence: "2", event: "packets_rejected", reason: "malformed", client_mac: "Aa:Bb:Cc:Dd:Ee:01" },
      { ...base, sequence: "3", event: "send_errors", reason: "send failed", client_mac: "aa:bb:cc:dd:ee:02" },
      { ...base, sequence: "4", event: "worker_error", reason: "worker failed", client_mac: null },
      { ...base, sequence: "5", event: "transactions_expired", reason: "expired", client_mac: "aa:bb:cc:dd:ee:01" },
      { ...base, sequence: "6", event: "replies_received", reason: "", client_mac: "aa:bb:cc:dd:ee:01" },
      { ...base, sequence: "7", event: "packets_rejected", reason: "malformed", client_mac: "aa:bb:cc:dd:ee:02" },
    ];
    vi.mocked(api.getDHCPRelayLog).mockResolvedValueOnce(page);
    const wrapper = mount(DHCPRelayLogsView, { global: { stubs } }); await flushPromises();
    const rows = wrapper.findAll("tbody tr");
    expect(rows.map(row => row.findAll("td")[6]!.text())).toEqual([
      "AA:BB:CC:DD:EE:01", "AA:BB:CC:DD:EE:01", "AA:BB:CC:DD:EE:02", "-",
      "AA:BB:CC:DD:EE:01", "AA:BB:CC:DD:EE:01", "AA:BB:CC:DD:EE:02",
    ]);
    expect(rows.map(row => row.findAll("td")[2]!.get("span").attributes("color"))).toEqual([
      "success", "error", "error", "error", "warning", "primary", "error",
    ]);
    const reasons = rows.map(row => row.findAll("td")[7]!);
    expect(reasons[0]!.text()).toBe("-");
    expect(reasons[0]!.find("span").exists()).toBe(false);
    expect(reasons[1]!.get("span").attributes("color")).toBe(reasons[6]!.get("span").attributes("color"));
    expect(reasons[1]!.get("span").attributes("color")).not.toBe(reasons[2]!.get("span").attributes("color"));
    expect(reasons[1]!.get("span").attributes("variant")).toBe("tonal");
    expect(reasons[1]!.text()).toBe("malformed");
    expect(wrapper.get('[aria-label="Client MAC"]').findAll("option").map(option => option.text())).toEqual([
      "All MAC addresses", "AA:BB:CC:DD:EE:01", "AA:BB:CC:DD:EE:02",
    ]);
    await wrapper.get('[aria-label="Event"]').setValue("failures");
    expect(wrapper.findAll("tbody tr")).toHaveLength(4);
    await wrapper.get('[aria-label="Client MAC"]').setValue("AA:BB:CC:DD:EE:01");
    expect(wrapper.findAll("tbody tr")).toHaveLength(1);
    expect(wrapper.get("tbody").text()).toContain("Rejected");
    await wrapper.get('[aria-label="Client MAC"]').setValue("");
    await wrapper.get('[aria-label="Event"]').setValue("packets_rejected");
    expect(wrapper.findAll("tbody tr")).toHaveLength(2);
    await wrapper.get('[aria-label="Event"]').setValue("");
    expect(wrapper.findAll("tbody tr")).toHaveLength(7);
    expect(api.getDHCPRelayLog).toHaveBeenCalledTimes(1);
    const next = relayLog("8");
    next.events[0]!.client_mac = "aa:bb:cc:dd:ee:01";
    next.events[0]!.event = "packets_rejected";
    next.events[0]!.reason = "malformed";
    vi.mocked(api.getDHCPRelayLog).mockResolvedValueOnce(next);
    await wrapper.get('[aria-label="Event"]').setValue("packets_rejected");
    await vi.advanceTimersByTimeAsync(1000); await flushPromises();
    expect(wrapper.findAll("tbody tr")).toHaveLength(3);
    expect(api.getDHCPRelayLog).toHaveBeenLastCalledWith({ cursor: `${telemetryEpoch}:7`, limit: 100 }, expect.any(AbortSignal));
    expect(wrapper.findAll("tbody tr").at(-1)!.findAll("td")[7]!.get("span").attributes("color")).toBe(reasons[1]!.get("span").attributes("color"));
    wrapper.unmount();
  });
  it("reports DHCP gaps and clears old-epoch entries on daemon reset", async () => {
    const wrapper = mount(DHCPRelayLogsView, { global: { stubs } }); await flushPromises();
    const gap = relayLog("2"); gap.gap = true; gap.events[0]!.reason = "before reset";
    vi.mocked(api.getDHCPRelayLog).mockResolvedValueOnce(gap);
    await vi.advanceTimersByTimeAsync(1000); await flushPromises();
    expect(wrapper.text()).toContain("overwritten");
    const reset = relayLog("1", "ffffffffffffffffffffffffffffffff"); reset.reset = true;
    vi.mocked(api.getDHCPRelayLog).mockResolvedValueOnce(reset);
    await vi.advanceTimersByTimeAsync(1000); await flushPromises();
    expect(wrapper.text()).toContain("history restarted");
    expect(wrapper.text()).not.toContain("before reset");
    expect(wrapper.findAll("tbody tr")).toHaveLength(1);
  });
  it.each(["success", "failure"] as const)("keeps pending persistent logs neutral until %s", async outcome => {
    const pending = deferred<ReturnType<typeof persistentLog>>();
    vi.mocked(api.getPersistentLog).mockReturnValueOnce(pending.promise);
    const wrapper = mount(PersistentLogStream, { props: { source: "syslog", active: true }, global: { stubs } });
    expect(wrapper.text()).toContain("Loading logs");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("No retained");
    if (outcome === "success") pending.resolve(persistentLog());
    else pending.reject(new ApiFailure("HTTP 403: Permission denied", 403));
    await flushPromises();
    expect(wrapper.text()).toContain(outcome === "success" ? "syslog entry 1" : "logs.read");
  });
  it.each([
    ["syslog", "recent"], ["netcontrol", "recent"],
    ["syslog", "history"], ["netcontrol", "history"],
  ] as const)("shows newest %s entries first in %s mode and prepends polled updates", async (source, mode) => {
    const first = persistentLog(source, "2");
    first.entries.unshift(...persistentLog(source, "1").entries);
    vi.mocked(api.getPersistentLog).mockResolvedValue(first);
    const wrapper = mount(PersistentLogStream, { props: { source, active: true }, global: { stubs } });
    await flushPromises();
    if (mode === "history") {
      await wrapper.get("select").setValue(mode); await flushPromises();
      expect(api.getPersistentLog).toHaveBeenLastCalledWith(source, { cursor: `${telemetryEpoch}:0`, limit: 100 }, expect.any(AbortSignal));
    }
    const messages = () => wrapper.findAll("td.log-message").map(cell => cell.text());
    expect(messages()).toEqual([`${source} entry 2`, `${source} entry 1`]);
    expect(first.entries.map(entry => entry.sequence)).toEqual(["1", "2"]);

    vi.mocked(api.getPersistentLog).mockResolvedValueOnce(persistentLog(source, "3"));
    await vi.advanceTimersByTimeAsync(3000); await flushPromises();
    expect(api.getPersistentLog).toHaveBeenLastCalledWith(source, { cursor: `${telemetryEpoch}:2`, limit: 100 }, expect.any(AbortSignal));
    expect(messages()).toEqual([`${source} entry 3`, `${source} entry 2`, `${source} entry 1`]);

    const empty = persistentLog(source, "3"); empty.entries = [];
    vi.mocked(api.getPersistentLog).mockResolvedValueOnce(empty);
    await vi.advanceTimersByTimeAsync(3000); await flushPromises();
    expect(api.getPersistentLog).toHaveBeenLastCalledWith(source, { cursor: `${telemetryEpoch}:3`, limit: 100 }, expect.any(AbortSignal));
    expect(messages()).toEqual([`${source} entry 3`, `${source} entry 2`, `${source} entry 1`]);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    wrapper.unmount();
  });
  it("keeps separate cursors and pauses polling for inactive tabs and hidden pages", async () => {
    const wrapper = mount(SyslogLogsView, { global: { stubs } }); await flushPromises();
    expect(api.getPersistentLog).toHaveBeenCalledTimes(1);
    await wrapper.get("#netcontrol-tab").trigger("click"); await flushPromises();
    expect(api.getPersistentLog).toHaveBeenLastCalledWith("netcontrol", { cursor: undefined, limit: 100 }, expect.any(AbortSignal));
    const next = persistentLog("netcontrol", "2");
    vi.mocked(api.getPersistentLog).mockResolvedValueOnce(next);
    await vi.advanceTimersByTimeAsync(3000); await flushPromises();
    expect(api.getPersistentLog).toHaveBeenLastCalledWith("netcontrol", { cursor: `${telemetryEpoch}:1`, limit: 100 }, expect.any(AbortSignal));
    const calls = vi.mocked(api.getPersistentLog).mock.calls.length;
    visibility = "hidden"; document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(10000); expect(api.getPersistentLog).toHaveBeenCalledTimes(calls);
    visibility = "visible";
    vi.mocked(api.getPersistentLog).mockResolvedValueOnce(persistentLog("netcontrol", "3"));
    document.dispatchEvent(new Event("visibilitychange")); await flushPromises();
    expect(api.getPersistentLog).toHaveBeenLastCalledWith("netcontrol", { cursor: `${telemetryEpoch}:2`, limit: 100 }, expect.any(AbortSignal));
    vi.mocked(api.getPersistentLog).mockResolvedValueOnce(persistentLog("syslog", "2"));
    await wrapper.get("#syslog-tab").trigger("click"); await flushPromises();
    expect(api.getPersistentLog).toHaveBeenLastCalledWith("syslog", { cursor: `${telemetryEpoch}:1`, limit: 100 }, expect.any(AbortSignal));
  });
  it("browses from oldest_cursor, safely renders text and retains history/cursor after read failure", async () => {
    const first = persistentLog(); first.entries[0]!.message = '<img src=x onerror="alert(1)"> opaque JSON {';
    vi.mocked(api.getPersistentLog).mockResolvedValueOnce(first);
    const wrapper = mount(PersistentLogStream, { props: { source: "syslog", active: true }, global: { stubs } }); await flushPromises();
    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.text()).toContain("<img");
    expect(wrapper.get("time").text()).toBe("2026-11-11 00:00:00");
    expect(wrapper.get("time").attributes("datetime")).toContain(".987654Z");
    await wrapper.get("select").setValue("history"); await flushPromises();
    expect(api.getPersistentLog).toHaveBeenLastCalledWith("syslog", { cursor: `${telemetryEpoch}:0`, limit: 100 }, expect.any(AbortSignal));
    vi.mocked(api.getPersistentLog).mockRejectedValueOnce(new ApiFailure("HTTP 503: Storage unavailable", 503));
    await vi.advanceTimersByTimeAsync(3000); await flushPromises();
    expect(wrapper.text()).toContain("Last-known logs");
    expect(wrapper.text()).toContain("syslog entry 1");
    vi.mocked(api.getPersistentLog).mockResolvedValueOnce(persistentLog("syslog", "2"));
    await vi.advanceTimersByTimeAsync(5000); await flushPromises();
    expect(api.getPersistentLog).toHaveBeenLastCalledWith("syslog", { cursor: `${telemetryEpoch}:1`, limit: 100 }, expect.any(AbortSignal));
    expect(wrapper.findAll("tbody tr")).toHaveLength(2);
  });
});

describe("polling and history bounds", () => {
  it("does not overlap, clears cross-session data and ignores responses after unmount", async () => {
    const pending = deferred<string>();
    const reader = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue("new session");
    const Host = pollingHost(() => useDiagnosticRead<string>(reader));
    const wrapper = mount(Host); await vi.advanceTimersByTimeAsync(12000);
    expect(reader).toHaveBeenCalledTimes(1);
    useControllerStore().sessionVersion++; await flushPromises();
    expect(wrapper.text()).toBe("new session");
    pending.resolve("old session"); await flushPromises(); expect(wrapper.text()).toBe("new session");
    wrapper.unmount(); await vi.advanceTimersByTimeAsync(10000); expect(reader).toHaveBeenCalledTimes(2);
  });
  it("bounds displayed history by bytes and drains at most four pages per poll", async () => {
    let sequence = 0;
    const reader = vi.fn(async () => {
      const entries = Array.from({ length: 100 }, () => ({ sequence: String(++sequence), message: "x".repeat(65000) }));
      return { entries, page: { next_cursor: `${telemetryEpoch}:${sequence}`, gap: false, reset: false, has_more: true } };
    });
    let history: ReturnType<typeof useLogHistory<{ sequence: string; message: string }, { next_cursor: string; gap: boolean; reset: boolean; has_more: boolean }>>;
    const Host = pollingHost(() => { history = useLogHistory(reader, 3000, () => ""); return history; });
    mount(Host); await flushPromises();
    expect(reader).toHaveBeenCalledTimes(4);
    expect(history!.data.value!.trimmed).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(history!.data.value!.entries)).byteLength).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(history!.data.value!.entries.at(-1)!.sequence).toBe("400");
  });
});

describe("RSS / IRQ diagnostics", () => {
  function enablePhysicalInterface(name = "eno1") {
    const store = useControllerStore();
    store.state.data!.desired.interfaces.push({ ...config().interfaces[0]!, name, kind: "ethernet", up: true });
  }
  it("shows IRQ observations in chips without interrupt expansion, automatic refresh or tuning controls", async () => {
    enablePhysicalInterface();
    const snapshot = interfaceCapabilitySnapshot(), row = snapshot.inventory.interfaces[0]!;
    snapshot.collected_at = "2026-11-11T00:00:00.987654Z";
    row.rss = { context: 0, indirection_table: [0, 1, 1, 3], hash_function: 9, input_transformation: 0 };
    row.interrupts = [{ irq: 135, description: "eno1-TxRx-0", effective_cpus: [1, 7], counts: [{ cpu_id: 7, interrupts: "18446744073709551615" }], errors: [] }];
    row.queues[0]!.irqs = [135];
    row.capabilities.find(feature => feature.name === "rss")!.enabled = true;
    vi.mocked(api.getInterfaceCapabilities).mockResolvedValueOnce(snapshot);
    const wrapper = mount(RSSIRQView, { global: { stubs } }); await flushPromises();
    expect(wrapper.text()).toContain("0, 1, 3");
    expect(wrapper.text()).toContain("Toeplitz, 0x8");
    expect(wrapper.text()).toContain("135: 1, 7");
    expect(wrapper.text()).not.toContain("18,446,744,073,709,551,615");
    expect(wrapper.find("details").exists()).toBe(false);
    expect(wrapper.findAll("table")).toHaveLength(1);
    expect(wrapper.findAll("tbody tr")).toHaveLength(1);
    expect(wrapper.get("tbody tr").findAll("td")[0]!.get("span").attributes("color")).toBe("success");
    expect(wrapper.get("time").text()).toBe("2026-11-11 00:00:00");
    await vi.advanceTimersByTimeAsync(10000);
    expect(api.getInterfaceCapabilities).toHaveBeenCalledTimes(1);
    expect(api.refreshInterfaceCapabilities).not.toHaveBeenCalled();
    expect(wrapper.findAll("button")).toHaveLength(1);
    await wrapper.get("button").trigger("click"); await flushPromises();
    expect(api.refreshInterfaceCapabilities).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
  it.each(["ethernet", "device"])("combines enabled physical interfaces reported as %s while excluding disabled, VLAN and virtual interfaces", async kind => {
    enablePhysicalInterface();
    enablePhysicalInterface("eno2");
    enablePhysicalInterface("eno3");
    const store = useControllerStore();
    store.state.data!.desired.interfaces.find(link => link.name === "eno3")!.up = false;
    store.state.data!.desired.interfaces.push({ ...config().interfaces[0]!, name: "vlan10", kind: "vlan", vlan: { parent: "eno1", id: 10 } });
    store.runtime.data!.parent_interfaces = [
      { name: "eno4", kind: "ethernet", available: true, up: true },
      { name: "eno5", kind: "ethernet", available: true, up: false },
      { name: "eno6", kind: "ethernet", available: false, up: true },
    ];
    const snapshot = interfaceCapabilitySnapshot(), physical = snapshot.inventory.interfaces[0]!;
    physical.kind = kind;
    physical.capabilities.find(feature => feature.name === "rss")!.enabled = false;
    physical.link!.carrier = false;
    snapshot.inventory.interfaces.push(
      { ...physical, name: "eno2" },
      { ...physical, name: "eno3" },
      { ...physical, name: "eno4" },
      { ...physical, name: "eno5" },
      { ...physical, name: "eno6" },
      { ...physical, name: "vlan10", kind: "vlan" },
      { ...physical, name: "lab0", hardware: null },
    );
    vi.mocked(api.getInterfaceCapabilities).mockResolvedValueOnce(snapshot);
    const before = JSON.stringify(store.state.data);
    const wrapper = mount(RSSIRQView, { global: { stubs } }); await flushPromises();
    expect(wrapper.findAll("table")).toHaveLength(1);
    expect(wrapper.findAll("tbody tr").map(row => row.get("th").text())).toEqual(["ENO1", "ENO2", "ENO4"]);
    expect(wrapper.findAll("tbody tr").map(row => row.findAll("td")[0]!.get("span").attributes("color"))).toEqual(["warning", "warning", "warning"]);
    expect(wrapper.find("details").exists()).toBe(false);
    expect(JSON.stringify(store.state.data)).toBe(before);
    wrapper.unmount();
  });
  it("shows a focused empty state when no enabled physical interfaces qualify", async () => {
    const wrapper = mount(RSSIRQView, { global: { stubs } }); await flushPromises();
    expect(wrapper.text()).toContain("No enabled physical interfaces.");
    expect(wrapper.find("table").exists()).toBe(false);
    wrapper.unmount();
  });
  it.each(["success", "failure"] as const)("keeps pending interface configuration neutral until %s", async outcome => {
    const store = useControllerStore(), saved = state();
    saved.desired.interfaces.push({ ...config().interfaces[0]!, name: "eno1", kind: "ethernet" });
    store.state.data = null; store.runtime.data = null;
    store.state.loading = true;
    const wrapper = mount(RSSIRQView, { global: { stubs } }); await flushPromises();
    expect(wrapper.text()).toContain("Loading interfaces...");
    expect(wrapper.text()).not.toContain("No enabled physical interfaces.");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    store.state.loading = false;
    if (outcome === "success") store.state.data = saved;
    else store.state.error = "Unable to read interface configuration";
    await flushPromises();
    expect(wrapper.text()).not.toContain("Loading interfaces...");
    if (outcome === "success") expect(wrapper.get("tbody tr th").text()).toBe("ENO1");
    else {
      expect(wrapper.get('[role="alert"]').text()).toBe("Unable to read interface configuration");
      expect(wrapper.text()).not.toContain("No enabled physical interfaces.");
    }
    wrapper.unmount();
  });
});
