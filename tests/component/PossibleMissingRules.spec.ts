import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PossibleMissingRulesView from "@/views/PossibleMissingRulesView.vue";
import { getFirewallDenyLog } from "@/services/netcontrol";
import { ApiFailure } from "@/services/api";
import { useControllerStore } from "@/stores/controller";
import { navigationSections } from "@/constants/navigation";
import { cloneConfig } from "@/services/configuration";
import { firewallDenyPage, filteredFirewallDenyPage } from "../firewallTelemetryFixtures";
import { state } from "../fixtures";
import type { FirewallDenyPage } from "@/services/firewallTelemetry";

vi.mock("@/services/netcontrol", () => ({ getFirewallDenyLog: vi.fn() }));
const stubs = {
  VSwitch: {
    props: ["modelValue", "ariaLabel"], emits: ["update:modelValue"],
    template: '<input type="checkbox" :aria-label="ariaLabel" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
  },
  VTable: { template: "<table><slot /></table>" },
  VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
  VIcon: true,
  VAlert: { template: "<div><slot /></div>" }, VProgressLinear: true,
  VChip: { props: ["color", "size"], template: '<span :data-color="color" :data-size="size"><slot /></span>' },
  VSelect: {
    props: ["modelValue", "label", "items"], emits: ["update:modelValue"],
    template: '<select :aria-label="label" :value="modelValue" @change="$emit(\'update:modelValue\', label === \'Time period\' ? Number($event.target.value) : $event.target.value)"><option v-for="item in items" :key="item.value" :value="item.value">{{ item.title }}</option></select>',
  },
};
const until = Date.parse("2026-11-08T12:34:56.789Z");
let wrapper: ReturnType<typeof mount> | undefined;
function page(): FirewallDenyPage {
  const result = firewallDenyPage(); result.next_before_id = null;
  result.records = [0, 2, 6, 12, 25, 169].map((hours, index) => ({
    ...result.records[0]!, id: String(10 - index), timestamp_ms: until - hours * 3600000,
    source_port: 50000 + index, destination_port: 443,
  }));
  return result;
}
beforeEach(() => {
  setActivePinia(createPinia()); vi.clearAllMocks(); vi.spyOn(Date, "now").mockReturnValue(until);
  const store = useControllerStore(); store.connected = true; store.state.data = state();
  vi.mocked(getFirewallDenyLog).mockResolvedValue(page());
});
afterEach(() => { wrapper?.unmount(); wrapper = undefined; useControllerStore().$dispose(); vi.restoreAllMocks(); });

describe("possible missing rules page", () => {
  it("aggregates server-selected packets and refetches category changes while keeping period changes local", async () => {
    const result = page(), base = result.records[0]!;
    const tags = [
      ["ipv4_broadcast"], ["tcp_finish"], ["tcp_reset"], ["tcp_ack_only"], ["tcp_connection_attempt"], [],
    ] satisfies typeof base.tags[];
    result.records = tags.map((tags, index) => ({ ...base, id: String(10 - index), source_port: 50000 + index, tags }));
    const original = JSON.stringify(result);
    vi.mocked(getFirewallDenyLog).mockImplementation(async query => filteredFirewallDenyPage(result.records, query ?? {}));
    wrapper = mount(PossibleMissingRulesView, { global: { stubs } });
    const broadcast = wrapper.get<HTMLInputElement>('[aria-label="Include broadcast drops"]');
    const tcp = wrapper.get<HTMLInputElement>('[aria-label="Include TCP FIN/RST/empty ACK drops"]');
    expect(wrapper.get(".missing-rules-toolbar").findAll('input[type="checkbox"]')).toHaveLength(2);
    expect(broadcast.element.checked).toBe(false); expect(tcp.element.checked).toBe(false);
    await flushPromises();
    const totals = () => wrapper!.findAll(".missing-rules-totals [data-color]").map(chip => chip.text());
    expect(totals()).toEqual(["2 packets", "120 bytes"]);
    await broadcast.setValue(true); await flushPromises();
    expect(totals()).toEqual(["3 packets", "180 bytes"]);
    await tcp.setValue(true); await flushPromises();
    expect(totals()).toEqual(["6 packets", "360 bytes"]);
    await tcp.setValue(false); await flushPromises();
    expect(totals()).toEqual(["3 packets", "180 bytes"]);
    await broadcast.setValue(false); await flushPromises();
    expect(totals()).toEqual(["2 packets", "120 bytes"]);
    await tcp.setValue(true); await flushPromises();
    expect(totals()).toEqual(["5 packets", "300 bytes"]);
    expect(wrapper.get('[data-label="Packets"]').text()).toBe("5");
    expect(wrapper.text()).not.toContain("loaded drops shown");
    expect(wrapper.text()).not.toContain("Captured input/forward drops only");
    expect(wrapper.text()).not.toContain("Source ports are ignored");
    await wrapper.get('[aria-label="Time period"]').setValue("4");
    expect(totals()).toEqual(["5 packets", "300 bytes"]);
    expect(getFirewallDenyLog).toHaveBeenCalledTimes(6);
    await broadcast.setValue(true); await flushPromises();
    expect(totals()).toEqual(["6 packets", "360 bytes"]);
    expect(getFirewallDenyLog).toHaveBeenCalledTimes(7);
    expect(vi.mocked(getFirewallDenyLog).mock.calls.every(([query]) => query?.before_id === undefined)).toBe(true);
    expect(JSON.stringify(result)).toBe(original);
    expect(useControllerStore().draft).toBeNull();
  });
  it("shows an empty matching view and never hides real read failures", async () => {
    const result = page(); result.records = [];
    vi.mocked(getFirewallDenyLog).mockResolvedValue(result);
    wrapper = mount(PossibleMissingRulesView, { global: { stubs } }); await flushPromises();
    expect(wrapper.text()).toContain("No retained drops match these filters in this period.");
    expect(wrapper.text()).not.toContain("No retained drops in this period");
    vi.mocked(getFirewallDenyLog).mockRejectedValue(new ApiFailure("HTTP 500: drop history failed", 500));
    await wrapper.get('[aria-label="Refresh"]').trigger("click"); await flushPromises();
    expect(wrapper.text()).toContain("HTTP 500: drop history failed");
  });
  it("does not warn about disabled capture before a completed read and preserves history when logging is disabled", async () => {
    let resolve!: (value: FirewallDenyPage) => void;
    vi.mocked(getFirewallDenyLog).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    wrapper = mount(PossibleMissingRulesView, { global: { stubs } }); await flushPromises();
    expect(wrapper.text()).not.toContain("Drop logging is disabled");
    const result = page(); result.capture.status = "disabled";
    resolve(result); await flushPromises();
    expect(wrapper.text()).toContain("Drop logging is disabled. Existing history is retained");
    expect(wrapper.get('[data-label="Packets"]').text()).toBe("1");
    expect(wrapper.text()).not.toContain("Capture is disabled");
  });
  it("cancels the previous selection's paginated read and ignores late results until the new selection finishes", async () => {
    const first = page(), base = first.records[0]!;
    first.records = Array.from({ length: 500 }, (_, index) => ({ ...base, id: String(1000 - index) }));
    first.next_before_id = "501";
    let resolveOld!: (value: FirewallDenyPage) => void, resolveNew!: (value: FirewallDenyPage) => void;
    vi.mocked(getFirewallDenyLog).mockResolvedValueOnce(first)
      .mockImplementationOnce(() => new Promise(done => { resolveOld = done; }))
      .mockImplementationOnce(() => new Promise(done => { resolveNew = done; }));
    wrapper = mount(PossibleMissingRulesView, { global: { stubs } }); await flushPromises();
    const signal = vi.mocked(getFirewallDenyLog).mock.calls[1]![1]!;
    expect(wrapper.find(".missing-rules-totals").exists()).toBe(false);
    await wrapper.get('[aria-label="Include broadcast drops"]').setValue(true); await flushPromises();
    expect(signal.aborted).toBe(true);
    expect(getFirewallDenyLog).toHaveBeenLastCalledWith({
      limit: 500, before_id: undefined, since_ms: until - 7 * 86400000, until_ms: until,
      include_broadcast: true, include_tcp_closures: false,
    }, expect.any(AbortSignal));
    resolveOld({ ...first, records: [{ ...base, id: "500" }], next_before_id: null });
    await flushPromises();
    expect(wrapper.find(".missing-rules-totals").exists()).toBe(false);
    expect(wrapper.findAll(".missing-rule-row")).toHaveLength(0);
    resolveNew({ ...first, records: [{ ...base, id: "2000", packet_length: 90 }], next_before_id: null });
    await flushPromises();
    expect(wrapper.findAll(".missing-rules-totals [data-color]").map(chip => chip.text())).toEqual(["1 packets", "90 bytes"]);
    expect(wrapper.text()).not.toContain("500 packets");
  });
  it("clears old totals on a failed category change, surfaces the error and retries the same flags only on request", async () => {
    wrapper = mount(PossibleMissingRulesView, { global: { stubs } }); await flushPromises();
    expect(wrapper.find(".missing-rules-totals").exists()).toBe(true);
    vi.mocked(getFirewallDenyLog).mockRejectedValueOnce(new ApiFailure("Unknown include_tcp_closures query", 400));
    const tcp = wrapper.get<HTMLInputElement>('[aria-label="Include TCP FIN/RST/empty ACK drops"]');
    await tcp.setValue(true); await flushPromises();
    expect(tcp.element.checked).toBe(true);
    expect(wrapper.text()).toContain("Unknown include_tcp_closures query");
    expect(wrapper.find(".missing-rules-totals").exists()).toBe(false);
    expect(getFirewallDenyLog).toHaveBeenCalledTimes(2);
    await wrapper.get('[aria-label="Refresh"]').trigger("click"); await flushPromises();
    expect(getFirewallDenyLog).toHaveBeenLastCalledWith(expect.objectContaining({
      before_id: undefined, include_broadcast: false, include_tcp_closures: true,
    }), expect.any(AbortSignal));
    expect(wrapper.find(".missing-rules-totals").exists()).toBe(true);
  });
  it.each([true, false])("distinguishes no matching drops from no global retained history (retained=%s)", async retained => {
    const empty = page(); empty.records = [];
    if (!retained) { empty.oldest_id = null; empty.newest_id = null; }
    vi.mocked(getFirewallDenyLog).mockResolvedValueOnce(empty);
    wrapper = mount(PossibleMissingRulesView, { global: { stubs } }); await flushPromises();
    expect(wrapper.text()).toContain(retained ? "No retained drops match these filters in this period." : "No retained firewall drops.");
    expect(getFirewallDenyLog).toHaveBeenCalledTimes(1);
  });
  it("appears directly after Firewall drops in Diagnostics navigation", () => {
    const pages = navigationSections.find(section => section.name === "diagnostics-section")!.pages;
    expect(pages[pages.findIndex(item => item.name === "firewall-drops") + 1]!.name).toBe("possible-missing-rules");
  });

  it("switches all five periods without extra reads or configuration writes", async () => {
    wrapper = mount(PossibleMissingRulesView, { global: { stubs } }); await flushPromises();
    expect(wrapper.get('[aria-label="Time period"]').findAll("option").map(option => option.text())).toEqual(["Last hour", "Last 4 hours", "Last 8 hours", "Last day", "Last week"]);
    for (const [hours, count] of [[1, 1], [4, 2], [8, 3], [24, 4], [168, 5]]) {
      await wrapper.get('[aria-label="Time period"]').setValue(String(hours));
      expect(wrapper.findAll(".missing-rule-row")).toHaveLength(1);
      expect(wrapper.get('[data-label="Packets"]').text()).toBe(String(count));
      expect(wrapper.get('[data-label="Bytes"]').text()).toBe(String(count! * 60));
      expect(wrapper.findAll(".missing-rules-totals [data-color]").map(chip => chip.text())).toEqual([`${count} packets`, `${count! * 60} bytes`]);
    }
    expect(getFirewallDenyLog).toHaveBeenCalledTimes(1);
    expect(wrapper.get('[data-label="Ingress"]').text()).toBe("Index 3");
    expect(wrapper.get('[data-label="Egress"]').text()).toBe("WAN0");
    expect(wrapper.get('[data-label="Last seen (UTC)"] time').text()).toBe("2026-11-08 12:34:56");
    expect(wrapper.get("time").attributes("datetime")).toBe("2026-11-08T12:34:56.789Z");
    expect(wrapper.get("thead").text()).toContain("Last seen (UTC)");
    expect(getFirewallDenyLog).toHaveBeenCalledWith(expect.objectContaining({ since_ms: until - 7 * 86400000 }), expect.any(AbortSignal));
    expect(wrapper.text()).not.toContain("50000");
    expect(useControllerStore().draft).toBeNull();
  });

  it("sorts through accessible headers and compact controls and retains sorting across periods and refreshes", async () => {
    const result = page(), base = result.records[0]!;
    result.records = [
      { ...base, id: "6", source: "10.2.10.2", packet_length: 60 },
      { ...base, id: "5", source: "10.2.10.10", packet_length: 120 },
      { ...base, id: "4", source: "10.2.10.10", packet_length: 120 },
      { ...base, id: "3", source: "10.2.10.20", timestamp_ms: until - 2 * 3600000 },
    ];
    vi.mocked(getFirewallDenyLog).mockResolvedValue(result);
    wrapper = mount(PossibleMissingRulesView, { global: { stubs } }); await flushPromises();
    const sources = () => wrapper!.findAll('.missing-rule-row [data-label="Source"]').map(cell => cell.text());
    const header = (label: string) => wrapper!.findAll("th").find(cell => cell.text() === label)!;
    expect(wrapper.findAll("thead button")).toHaveLength(11);
    expect(header("Packets").attributes("aria-sort")).toBe("descending");
    expect(sources()).toEqual(["10.2.10.10", "10.2.10.2"]);
    await header("Source").get("button").trigger("click");
    expect(sources()).toEqual(["10.2.10.2", "10.2.10.10"]);
    expect(header("Source").attributes("aria-sort")).toBe("ascending");
    expect(header("Packets").attributes("aria-sort")).toBe("none");
    await header("Source").get("button").trigger("click");
    expect(sources()).toEqual(["10.2.10.10", "10.2.10.2"]);
    expect(header("Source").attributes("aria-sort")).toBe("descending");
    await wrapper.get('[aria-label="Time period"]').setValue("4");
    expect(sources()).toEqual(["10.2.10.20", "10.2.10.10", "10.2.10.2"]);
    expect(getFirewallDenyLog).toHaveBeenCalledTimes(1);
    await wrapper.get('[aria-label="Refresh"]').trigger("click"); await flushPromises();
    expect(sources()).toEqual(["10.2.10.20", "10.2.10.10", "10.2.10.2"]);
    expect(header("Source").attributes("aria-sort")).toBe("descending");
    await wrapper.get('[aria-label="Sort by"]').setValue("bytes");
    expect(header("Bytes").attributes("aria-sort")).toBe("ascending");
    expect(sources()).toEqual(["10.2.10.2", "10.2.10.20", "10.2.10.10"]);
    await wrapper.get('[aria-label="Sort descending"]').trigger("click");
    expect(header("Bytes").attributes("aria-sort")).toBe("descending");
    expect(sources()).toEqual(["10.2.10.10", "10.2.10.2", "10.2.10.20"]);
    expect(getFirewallDenyLog).toHaveBeenCalledTimes(2);
    expect(useControllerStore().draft).toBeNull();
  });

  it("omits period captions while retaining fixed query boundaries and saved-timezone row timestamps", async () => {
    const store = useControllerStore();
    store.state.data!.desired.system = { hostname: "", domain: "", timezone: "America/Los_Angeles" };
    store.draft = cloneConfig(store.state.data!.desired); store.draft.system!.timezone = "Asia/Tokyo";
    wrapper = mount(PossibleMissingRulesView, { global: { stubs } }); await flushPromises();
    expect(wrapper.text()).not.toContain("Period (");
    expect(wrapper.get('[data-label="Last seen (America/Los_Angeles)"] time').text()).toBe("2026-11-08 04:34:56");
    expect(wrapper.get("time").attributes("datetime")).toBe("2026-11-08T12:34:56.789Z");
    expect(wrapper.text()).not.toContain(".789");
    expect(getFirewallDenyLog).toHaveBeenCalledWith(expect.objectContaining({ since_ms: until - 7 * 86400000, until_ms: until }), expect.any(AbortSignal));
    const updated = cloneConfig(store.state.data!.desired);
    updated.system!.timezone = "Asia/Tokyo";
    store.state.data = { ...store.state.data!, desired: updated };
    await flushPromises();
    expect(wrapper.get('[data-label="Last seen (Asia/Tokyo)"] time').text()).toBe("2026-11-08 21:34:56");
  });

  it.each([[6, "TCP", "info"], [17, "UDP", "primary"], [1, "ICMP", "warning"], [58, "ICMPv6", "warning"], [99, "IP 99", "grey"]])(
    "uses protocol chips and colored port, interface, chain and reason chips for protocol %i",
    async (protocol, label, color) => {
      const result = page();
      result.records = [{ ...result.records[0]!, protocol: Number(protocol), ingress: "lab0" }];
      vi.mocked(getFirewallDenyLog).mockResolvedValue(result);
      wrapper = mount(PossibleMissingRulesView, { global: { stubs } }); await flushPromises();
      expect(wrapper.get(`[data-label="Protocol"] [data-color="${color}"]`).text()).toBe(label);
      expect(wrapper.get('[data-label="Destination port"] [data-color="primary"]').text()).toBe("443");
      expect(wrapper.get('[data-label="Ingress"] [data-color="primary"]').text()).toBe("LAB0");
      expect(wrapper.get('[data-label="Egress"] [data-color="secondary"]').text()).toBe("WAN0");
      expect(wrapper.get('[data-label="Chain"] [data-color="secondary"]').text()).toBe("forward");
      expect(wrapper.get('[data-label="Reason"] [data-color="error"]').text()).toBe("Rule drop");
    },
  );

  it("preserves port zero and missing ports, with input and default-policy chip colors", async () => {
    const result = page();
    result.records = [
      { ...result.records[0]!, destination_port: 0, chain: "input", reason: "policy" },
      { ...result.records[0]!, id: "9", destination_port: null },
    ];
    vi.mocked(getFirewallDenyLog).mockResolvedValue(result);
    wrapper = mount(PossibleMissingRulesView, { global: { stubs } }); await flushPromises();
    expect(wrapper.findAll('[data-label="Destination port"]').map(cell => cell.text()).sort()).toEqual(["0", "—"]);
    expect(wrapper.get('[data-label="Chain"] [data-color="info"]').text()).toBe("input");
    expect(wrapper.get('[data-label="Reason"] [data-color="warning"]').text()).toBe("Default policy");
  });

  it("shows neutral loading until all pages succeed, then shows established warnings", async () => {
    let resolve!: (result: FirewallDenyPage) => void;
    vi.mocked(getFirewallDenyLog).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    wrapper = mount(PossibleMissingRulesView, { global: { stubs } }); await flushPromises();
    expect(wrapper.find('[aria-label="Loading drop summary"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain("No retained");
    expect(wrapper.text()).not.toContain("incomplete");
    const first = page(); first.cursor_expired = true; first.capture.status = "stopped";
    first.next_before_id = "6";
    let finish!: (result: FirewallDenyPage) => void;
    vi.mocked(getFirewallDenyLog).mockImplementationOnce(() => new Promise(done => { finish = done; }));
    resolve(first); await flushPromises();
    expect(wrapper.find(".missing-rules-totals").exists()).toBe(false);
    finish({ ...page(), records: [] }); await flushPromises();
    expect(wrapper.text()).toContain("Retention gap");
    expect(wrapper.text()).toContain("Capture: stopped");
    expect(wrapper.find('[aria-label="Loading drop summary"]').exists()).toBe(false);
    expect(wrapper.find(".missing-rules-totals").exists()).toBe(true);
  });

  it("reports a pending read failure without empty or partial success", async () => {
    let reject!: (reason: Error) => void;
    vi.mocked(getFirewallDenyLog).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    wrapper = mount(PossibleMissingRulesView, { global: { stubs } }); await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    reject(new ApiFailure("Forbidden", 403)); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("firewall.logs.read");
    expect(wrapper.text()).not.toContain("No retained");
    expect(wrapper.find(".missing-rules-totals").exists()).toBe(false);
  });

  it("keeps previous totals on a failed refresh and clears them when the controller session changes", async () => {
    wrapper = mount(PossibleMissingRulesView, { global: { stubs } }); await flushPromises();
    const first = page(); first.next_before_id = "6";
    vi.mocked(getFirewallDenyLog).mockResolvedValueOnce(first).mockRejectedValueOnce(new Error("Older page failed"));
    await wrapper.get('[aria-label="Refresh"]').trigger("click"); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("Previous totals are retained");
    expect(wrapper.get('[data-label="Packets"]').text()).toBe("1");
    vi.mocked(getFirewallDenyLog).mockRejectedValueOnce(new Error("New controller failed"));
    useControllerStore().sessionVersion++; await flushPromises();
    expect(wrapper.find(".missing-rules-totals").exists()).toBe(false);
    expect(wrapper.get('[role="alert"]').text()).toContain("New controller failed");
  });

  it("aborts on unmount and ignores an obsolete response", async () => {
    let resolve!: (result: FirewallDenyPage) => void;
    vi.mocked(getFirewallDenyLog).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    wrapper = mount(PossibleMissingRulesView, { global: { stubs } }); await flushPromises();
    const signal = vi.mocked(getFirewallDenyLog).mock.calls[0]![1]!;
    wrapper.unmount(); wrapper = undefined;
    expect(signal.aborted).toBe(true);
    resolve(page()); await flushPromises();
    expect(getFirewallDenyLog).toHaveBeenCalledTimes(1);
  });
});
