import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FirewallDropsView from "@/views/FirewallDropsView.vue";
import FirewallRuleTable from "@/components/feature/FirewallRuleTable.vue";
import FirewallPolicySettings from "@/components/feature/FirewallPolicySettings.vue";
import ResourceTable from "@/components/feature/ResourceTable.vue";
import DNATView from "@/views/DNATView.vue";
import FirewallInputView from "@/views/FirewallInputView.vue";
import { getFirewallCounters, getFirewallDenyLog } from "@/services/netcontrol";
import { ApiFailure } from "@/services/api";
import { useControllerStore } from "@/stores/controller";
import { cloneConfig } from "@/services/configuration";
import type { FirewallCounters, FirewallDenyPage } from "@/services/firewallTelemetry";
import { hostPolicyConfig, runtime, state, transaction } from "../fixtures";
import { dnatRule } from "../bgpFixtures";
import { firewallCounters, firewallDenyPage, filteredFirewallDenyPage } from "../firewallTelemetryFixtures";

vi.mock("@/services/netcontrol", async importOriginal => ({
  ...await importOriginal<typeof import("@/services/netcontrol")>(),
  getFirewallCounters: vi.fn(), getFirewallDenyLog: vi.fn(),
}));
const stubs = {
  VSwitch: {
    props: ["modelValue", "ariaLabel"], emits: ["update:modelValue"],
    template: '<input type="checkbox" :aria-label="ariaLabel" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
  },
  RouterLink: { props: ["to"], template: '<a :href="`/interfaces/${encodeURIComponent(to.params.name)}`"><slot /></a>' },
  VTable: { template: "<table><slot /></table>" },
  VPagination: {
    props: ["modelValue", "length"], emits: ["update:modelValue"],
    template: '<nav><button v-for="number in length" :key="number" :aria-label="`Page ${number}`" :aria-current="modelValue === number ? \'page\' : undefined" @click="$emit(\'update:modelValue\', number)">{{ number }}</button></nav>',
  },
  VBtn: { props: ["disabled", "loading"], template: '<button :disabled="disabled"><slot /></button>' },
  VIcon: true, VChip: { props: ["color", "size"], template: '<span :data-color="color" :data-size="size"><slot /></span>' }, VProgressLinear: true,
  VAlert: { template: "<div><slot /></div>" },
  VTextField: {
    props: ["modelValue", "label"], emits: ["update:modelValue"],
    template: '<input :aria-label="label" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
  VSelect: {
    props: ["modelValue", "label", "items", "disabled"], emits: ["update:modelValue"],
    template: '<select :aria-label="label" :disabled="disabled" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="item in items" :key="item.value" :value="item.value">{{ item.title }}</option></select>',
  },
};
let wrapper: ReturnType<typeof mount>;
beforeEach(() => {
  setActivePinia(createPinia()); vi.clearAllMocks();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const store = useControllerStore();
  store.connected = true; store.state.data = state(); store.runtime.data = runtime();
  store.state.stale = false; store.state.lastSuccess = Date.now(); store.runtime.stale = false;
  vi.mocked(getFirewallCounters).mockResolvedValue(firewallCounters());
  vi.mocked(getFirewallDenyLog).mockResolvedValue(firewallDenyPage());
});
afterEach(() => { wrapper?.unmount(); useControllerStore().$dispose(); vi.useRealTimers(); vi.restoreAllMocks(); });
const button = (text: string) => wrapper.findAll("button").find(item => item.text() === text)!;
const values = () => wrapper.findAll(".host-rule")[0]!.findAll(".counter-value").map(item => item.text());

describe("firewall drop history", () => {
  it("numbers server-selected rows, slices after sorting and clears pages when category selection changes", async () => {
    const initial = firewallDenyPage(), base = initial.records[0]!;
    initial.records = Array.from({ length: 455 }, (_, index) => ({
      ...base, id: String(1000 - index), packet_length: index,
      tags: index < 250 ? ["ipv4_broadcast"] : [],
    }));
    vi.mocked(getFirewallDenyLog).mockImplementation(async query => filteredFirewallDenyPage(initial.records, query ?? {}));
    wrapper = mount(FirewallDropsView, { global: { stubs } }); await flushPromises();
    expect(wrapper.findAll('[aria-label^="Page "]')).toHaveLength(0);
    await button("Load older").trigger("click"); await flushPromises();
    await button("Load older").trigger("click"); await flushPromises();
    expect(wrapper.findAll('[aria-label^="Page "]')).toHaveLength(3);
    expect(wrapper.findAll(".drop-row")).toHaveLength(100);
    expect(wrapper.text()).toContain("100 of 205 drops shown");
    await wrapper.get('[aria-label="Page 3"]').trigger("click");
    expect(wrapper.findAll('.drop-row [data-label="Bytes"]').map(cell => cell.text())).toEqual(["450", "451", "452", "453", "454"]);
    expect(getFirewallDenyLog).toHaveBeenCalledTimes(3);
    await wrapper.get('[aria-label="Include broadcast drops"]').setValue(true); await flushPromises();
    expect(wrapper.findAll('[aria-label^="Page "]')).toHaveLength(0);
    expect(wrapper.findAll('.drop-row [data-label="Bytes"]')[0]!.text()).toBe("0");
    await button("Load older").trigger("click"); await flushPromises();
    await wrapper.get('[aria-label="Page 2"]').trigger("click");
    await wrapper.get('[aria-label="Include broadcast drops"]').setValue(false); await flushPromises();
    expect(wrapper.findAll('[aria-label^="Page "]')).toHaveLength(0);
    expect(wrapper.findAll(".drop-row")).toHaveLength(100);
    await button("Load older").trigger("click"); await flushPromises();
    await wrapper.get('[aria-label="Page 2"]').trigger("click");
    const bytes = wrapper.findAll("th").find(cell => cell.text() === "Bytes")!;
    await bytes.get("button").trigger("click"); await bytes.get("button").trigger("click");
    expect(wrapper.get('[aria-label="Page 1"]').attributes("aria-current")).toBe("page");
    expect(wrapper.findAll('.drop-row [data-label="Bytes"]')[0]!.text()).toBe("449");
    await button("Load older").trigger("click"); await flushPromises();
    await wrapper.get('[aria-label="Page 3"]').trigger("click");
    vi.mocked(getFirewallDenyLog).mockResolvedValue({ ...initial, records: initial.records.slice(-1) });
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(wrapper.findAll('[aria-label^="Page "]')).toHaveLength(0);
    expect(wrapper.findAll(".drop-row")).toHaveLength(1);
    expect(useControllerStore().draft).toBeNull();
  });
  it("loads 100 additional matching rows across cursor gaps with fixed flags and remaining capacity", async () => {
    const initial = firewallDenyPage(), base = initial.records[0]!;
    initial.records = [{ ...base, id: "1000" }]; initial.next_before_id = "1000";
    const mixed: FirewallDenyPage = {
      ...initial, next_before_id: "800", cursor_expired: true,
      records: Array.from({ length: 40 }, (_, index) => ({ ...base, id: String(839 - index) })),
    };
    const last: FirewallDenyPage = {
      ...initial, next_before_id: null, oldest_id: "700",
      records: Array.from({ length: 60 }, (_, index) => ({ ...base, id: String(799 - index) })),
    };
    vi.mocked(getFirewallDenyLog).mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(mixed).mockResolvedValueOnce(last);
    wrapper = mount(FirewallDropsView, { global: { stubs } }); await flushPromises();
    await button("Load older").trigger("click"); await flushPromises();
    expect(vi.mocked(getFirewallDenyLog).mock.calls.map(([query]) => query)).toEqual([
      { limit: 100, before_id: undefined, include_broadcast: false, include_tcp_closures: false },
      { limit: 100, before_id: "1000", include_broadcast: false, include_tcp_closures: false },
      { limit: 60, before_id: "800", include_broadcast: false, include_tcp_closures: false },
    ]);
    expect(wrapper.findAll(".drop-row")).toHaveLength(100);
    expect(wrapper.findAll('[aria-label^="Page "]')).toHaveLength(2);
    await wrapper.get('[aria-label="Page 2"]').trigger("click");
    expect(wrapper.findAll(".drop-row")).toHaveLength(1);
    expect(wrapper.text()).toContain("Retention gap");
    expect(wrapper.findAll("button").some(item => item.text() === "Load older")).toBe(false);
    expect(getFirewallDenyLog).toHaveBeenCalledTimes(3);
  });
  it("retains partial history and its cursor when a later batch fails, and retries without duplicates", async () => {
    const initial = firewallDenyPage(), base = initial.records[0]!;
    initial.records = [{ ...base, id: "10" }]; initial.next_before_id = "10";
    const partial: FirewallDenyPage = { ...initial, records: [{ ...base, id: "9" }], next_before_id: "9" };
    let reject!: (error: Error) => void;
    vi.mocked(getFirewallDenyLog).mockResolvedValueOnce(initial).mockResolvedValueOnce(partial)
      .mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    wrapper = mount(FirewallDropsView, { global: { stubs } }); await flushPromises();
    await button("Load older").trigger("click"); await flushPromises();
    expect(button("Load older").attributes("disabled")).toBeDefined();
    expect(wrapper.text()).not.toContain("Previous results are retained");
    reject(new ApiFailure("unavailable", 503)); await flushPromises();
    expect(wrapper.text()).toContain("Previous results are retained");
    expect(wrapper.findAll(".drop-row")).toHaveLength(2);
    vi.mocked(getFirewallDenyLog).mockResolvedValueOnce({
      ...initial, records: [{ ...base, id: "9" }, { ...base, id: "8" }], next_before_id: null,
    });
    await button("Load older").trigger("click"); await flushPromises();
    expect(getFirewallDenyLog).toHaveBeenLastCalledWith({ limit: 100, before_id: "9", include_broadcast: false, include_tcp_closures: false }, expect.any(AbortSignal));
    expect(wrapper.text()).not.toContain("Previous results are retained");
    expect(wrapper.findAll(".drop-row")).toHaveLength(3);
  });
  it("defaults categories off and requests independent server inclusion including empty ACK and overlapping tags", async () => {
    const initial = firewallDenyPage(), base = initial.records[0]!;
    initial.records = [
      { ...base, id: "9", tags: ["ipv4_broadcast"], packet_length: 90 },
      { ...base, id: "8", tags: ["tcp_finish"], packet_length: 80 },
      { ...base, id: "7", tags: ["tcp_reset"], packet_length: 70 },
      { ...base, id: "6", tags: ["tcp_reset", "ipv4_broadcast"], packet_length: 60 },
      { ...base, id: "5", tags: ["tcp_ack_only"], tcp_flags: 16, tcp_payload_length: 0, packet_length: 50 },
      { ...base, id: "4", tags: ["tcp_connection_attempt"], packet_length: 40 },
      { ...base, id: "3", tags: [], tcp_flags: 16, tcp_payload_length: null, packet_length: 30 },
      { ...base, id: "2", tags: [], tcp_flags: 16, tcp_payload_length: 4, packet_length: 20 },
      { ...base, id: "1", tags: [], packet_length: 10 },
    ];
    const original = JSON.stringify(initial);
    vi.mocked(getFirewallDenyLog).mockImplementation(async query => filteredFirewallDenyPage(initial.records, query ?? {}));
    wrapper = mount(FirewallDropsView, { global: { stubs } });
    const broadcast = wrapper.get<HTMLInputElement>('[aria-label="Include broadcast drops"]');
    const tcp = wrapper.get<HTMLInputElement>('[aria-label="Include TCP FIN/RST/empty ACK drops"]');
    expect(broadcast.element.checked).toBe(false); expect(tcp.element.checked).toBe(false);
    await flushPromises();
    expect(wrapper.findAll(".drop-row")).toHaveLength(4);
    const header = wrapper.findAll("th").find(cell => cell.text() === "Bytes")!;
    await header.get("button").trigger("click");
    await broadcast.setValue(true); await flushPromises();
    expect(wrapper.findAll(".drop-row")).toHaveLength(5);
    await tcp.setValue(true); await flushPromises();
    expect(wrapper.findAll(".drop-row")).toHaveLength(9);
    expect(header.attributes("aria-sort")).toBe("ascending");
    await broadcast.setValue(false); await flushPromises();
    expect(wrapper.findAll(".drop-row")).toHaveLength(7);
    await tcp.setValue(false); await flushPromises();
    expect(wrapper.findAll(".drop-row")).toHaveLength(4);
    expect(getFirewallDenyLog).toHaveBeenCalledTimes(5);
    expect(vi.mocked(getFirewallDenyLog).mock.calls.map(([query]) => [query?.include_broadcast, query?.include_tcp_closures, query?.before_id]))
      .toEqual([[false, false, undefined], [true, false, undefined], [true, true, undefined], [false, true, undefined], [false, false, undefined]]);
    expect(JSON.stringify(initial)).toBe(original);
    expect(useControllerStore().draft).toBeNull();
  });
  it("keeps pending capture neutral and shows retained history when the successful read establishes logging is disabled", async () => {
    let resolve!: (value: ReturnType<typeof firewallDenyPage>) => void;
    vi.mocked(getFirewallDenyLog).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    wrapper = mount(FirewallDropsView, { global: { stubs } }); await flushPromises();
    expect(wrapper.text()).not.toContain("Drop logging is disabled");
    const retained = firewallDenyPage(); retained.capture.status = "disabled";
    resolve(retained); await flushPromises();
    expect(wrapper.text()).toContain("Drop logging is disabled. Existing history is retained");
    expect(wrapper.findAll(".drop-row")).toHaveLength(retained.records.length);
    expect(wrapper.text()).not.toContain("Capture is disabled");
  });
  it("aborts an older read on selection changes, clears its cursor and ignores late old results while the new selection loads", async () => {
    const initial = firewallDenyPage(), base = initial.records[0]!;
    initial.records = [{ ...base, id: "10" }]; initial.next_before_id = "10";
    let resolveOld!: (value: FirewallDenyPage) => void, resolveNew!: (value: FirewallDenyPage) => void;
    vi.mocked(getFirewallDenyLog).mockResolvedValueOnce(initial)
      .mockImplementationOnce(() => new Promise(done => { resolveOld = done; }))
      .mockImplementationOnce(() => new Promise(done => { resolveNew = done; }));
    wrapper = mount(FirewallDropsView, { global: { stubs } }); await flushPromises();
    await button("Load older").trigger("click"); await flushPromises();
    const oldSignal = vi.mocked(getFirewallDenyLog).mock.calls[1]![1]!;
    await wrapper.get('[aria-label="Include broadcast drops"]').setValue(true); await flushPromises();
    expect(oldSignal.aborted).toBe(true);
    expect(wrapper.findAll(".drop-row")).toHaveLength(0);
    expect(wrapper.text()).not.toContain("No retained");
    expect(getFirewallDenyLog).toHaveBeenLastCalledWith({
      limit: 100, before_id: undefined, include_broadcast: true, include_tcp_closures: false,
    }, expect.any(AbortSignal));
    resolveOld({ ...initial, records: [{ ...base, id: "9", packet_length: 999 }], next_before_id: null });
    await flushPromises();
    expect(wrapper.findAll(".drop-row")).toHaveLength(0);
    expect(wrapper.get('[aria-label="Refresh"]').attributes("disabled")).toBeDefined();
    resolveNew({ ...initial, records: [{ ...base, id: "20", packet_length: 200 }], next_before_id: null });
    await flushPromises();
    expect(wrapper.get('.drop-row [data-label="Bytes"]').text()).toBe("200");
    expect(wrapper.findAll("button").some(item => item.text() === "Load older")).toBe(false);
  });
  it("preserves applied filters and the selected flags after a rejected category read without showing old rows or falling back", async () => {
    const initial = firewallDenyPage(); initial.next_before_id = null;
    vi.mocked(getFirewallDenyLog).mockResolvedValue(initial);
    wrapper = mount(FirewallDropsView, { global: { stubs } }); await flushPromises();
    await wrapper.get('[aria-label="Source or destination IP"]').setValue("192.0.2.20");
    await wrapper.get("form").trigger("submit"); await flushPromises();
    vi.mocked(getFirewallDenyLog).mockRejectedValueOnce(new ApiFailure("Unknown include_tcp_closures query", 400));
    await wrapper.get('[aria-label="Include TCP FIN/RST/empty ACK drops"]').setValue(true); await flushPromises();
    expect(wrapper.text()).toContain("Unknown include_tcp_closures query");
    expect(wrapper.findAll(".drop-row")).toHaveLength(0);
    expect(wrapper.text()).not.toContain("No retained");
    await wrapper.get('[aria-label="Refresh"]').trigger("click"); await flushPromises();
    expect(getFirewallDenyLog).toHaveBeenLastCalledWith(expect.objectContaining({
      address: "192.0.2.20", before_id: undefined, include_broadcast: false, include_tcp_closures: true,
    }), expect.any(AbortSignal));
    expect(wrapper.findAll(".drop-row")).toHaveLength(1);
  });
  it.each([true, false])("distinguishes empty matching results from globally empty history (retained=%s)", async retained => {
    const empty = firewallDenyPage(); empty.records = []; empty.next_before_id = null;
    if (!retained) { empty.oldest_id = null; empty.newest_id = null; }
    vi.mocked(getFirewallDenyLog).mockResolvedValueOnce(empty);
    wrapper = mount(FirewallDropsView, { global: { stubs } }); await flushPromises();
    expect(wrapper.text()).toContain(retained ? "No retained drops match these filters." : "No retained firewall drops.");
    expect(wrapper.findAll("button").some(item => item.text() === "Load older")).toBe(false);
    expect(getFirewallDenyLog).toHaveBeenCalledTimes(1);
  });
  it("sorts through accessible headers and preserves the selection across older pages, filters and refreshes without changing cursors", async () => {
    const initial = firewallDenyPage(), base = initial.records[0]!;
    initial.records = [
      { ...base, id: "6", source: "192.0.2.10", packet_length: 1000 },
      { ...base, id: "5", source: "192.0.2.2", packet_length: 60 },
      { ...base, id: "4", source: "192.0.2.20", packet_length: 200 },
    ];
    initial.next_before_id = "4";
    vi.mocked(getFirewallDenyLog).mockResolvedValueOnce(initial);
    wrapper = mount(FirewallDropsView, { global: { stubs } }); await flushPromises();
    const sources = () => wrapper.findAll('.drop-row [data-label="Source / port"] .mono').map(cell => cell.text());
    const header = (label: string) => wrapper.findAll("th").find(cell => cell.text() === label)!;
    expect(wrapper.findAll("thead button")).toHaveLength(8);
    expect(wrapper.findAll("thead th").every(cell => cell.attributes("aria-sort") === "none")).toBe(true);
    expect(sources()).toEqual(["192.0.2.10", "192.0.2.2", "192.0.2.20"]);
    await header("Source / port").get("button").trigger("click");
    expect(sources()).toEqual(["192.0.2.2", "192.0.2.10", "192.0.2.20"]);
    expect(header("Source / port").attributes("aria-sort")).toBe("ascending");
    await header("Source / port").get("button").trigger("click");
    expect(sources()).toEqual(["192.0.2.20", "192.0.2.10", "192.0.2.2"]);
    expect(header("Source / port").attributes("aria-sort")).toBe("descending");
    expect(getFirewallDenyLog).toHaveBeenCalledTimes(1);
    await header("Bytes").get("button").trigger("click");
    await header("Bytes").get("button").trigger("click");
    expect(sources()).toEqual(["192.0.2.10", "192.0.2.20", "192.0.2.2"]);
    expect(header("Source / port").attributes("aria-sort")).toBe("none");
    const older = { ...initial, records: [{ ...base, id: "3", source: "192.0.2.3", packet_length: 100 }], next_before_id: null };
    vi.mocked(getFirewallDenyLog).mockResolvedValueOnce(older);
    await button("Load older").trigger("click"); await flushPromises();
    expect(sources()).toEqual(["192.0.2.10", "192.0.2.20", "192.0.2.3", "192.0.2.2"]);
    expect(getFirewallDenyLog).toHaveBeenLastCalledWith({ limit: 100, before_id: "4", include_broadcast: false, include_tcp_closures: false }, expect.any(AbortSignal));
    vi.mocked(getFirewallDenyLog).mockResolvedValue(initial);
    await wrapper.get('[aria-label="Refresh"]').trigger("click"); await flushPromises();
    expect(sources()).toEqual(["192.0.2.10", "192.0.2.20", "192.0.2.2"]);
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(header("Bytes").attributes("aria-sort")).toBe("descending");
    expect(sources()).toEqual(["192.0.2.10", "192.0.2.20", "192.0.2.2"]);
    expect(getFirewallDenyLog).toHaveBeenLastCalledWith(expect.objectContaining({ before_id: undefined }), expect.any(AbortSignal));
    expect(useControllerStore().draft).toBeNull();
  });
  it("uses the configured timezone for rows and converts local filter bounds to API milliseconds", async () => {
    const store = useControllerStore();
    store.state.data!.desired.system = { hostname: "", domain: "", timezone: "America/Los_Angeles" };
    wrapper = mount(FirewallDropsView, { global: { stubs } }); await flushPromises();
    expect(wrapper.get("time").text()).toBe("2026-10-30 05:34:56");
    expect(wrapper.get("time").attributes("datetime")).toBe("2026-10-30T12:34:56.789Z");
    expect(wrapper.find('[data-label="Time (America/Los_Angeles)"]').exists()).toBe(true);
    expect(wrapper.get("thead").text()).toContain("Time (America/Los_Angeles)");
    await wrapper.get('[aria-label="More filters"]').trigger("click");
    await wrapper.get('[aria-label="Since (America/Los_Angeles)"]').setValue("2026-10-30 05:00:00");
    await wrapper.get('[aria-label="Until (America/Los_Angeles)"]').setValue("2026-10-30 06:00:00");
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(getFirewallDenyLog).toHaveBeenLastCalledWith(expect.objectContaining({
      since_ms: Date.parse("2026-10-30T12:00:00Z"), until_ms: Date.parse("2026-10-30T13:00:00Z"),
    }), expect.any(AbortSignal));
    await wrapper.get('[aria-label="Since (America/Los_Angeles)"]').setValue("2026-11-01 01:30:00");
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(wrapper.text()).toContain("ambiguous");
    expect(getFirewallDenyLog).toHaveBeenCalledTimes(2);
  });

  it("uses UTC seconds and preserves nulls and zero ports without a details column", async () => {
    wrapper = mount(FirewallDropsView, { global: { stubs } }); await flushPromises();
    expect(wrapper.get("time").text()).toBe("2026-10-30 12:34:56");
    expect(wrapper.get("time").attributes("datetime")).toBe("2026-10-30T12:34:56.789Z");
    expect(wrapper.get('[data-label="Source / port"] .mono').text()).toBe("192.0.2.20");
    expect(wrapper.get('[title="Source port 0"]').text()).toBe("0");
    expect(wrapper.get('[data-label="Destination / port"]').text()).toContain("198.51.100.10");
    expect(wrapper.get('[data-label="Destination / port"]').text()).toContain("—");
    expect(wrapper.get('[data-label="Ingress"]').text()).toBe("—");
    expect(wrapper.findAll("thead th").map(cell => cell.text())).toEqual([
      "Time (UTC)", "Source / port", "Destination / port", "Protocol", "Ingress", "Egress", "Bytes", "Reason",
    ]);
    expect(wrapper.findAll(".drop-row td")).toHaveLength(8);
    expect(wrapper.find('[aria-label^="Details for drop"]').exists()).toBe(false);
    expect(wrapper.find(".drop-details").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("c".repeat(64));
    expect(useControllerStore().draft).toBeNull();
  });
  it("uses compact colored chips and keeps UTC filters behind an accessible toggle without clearing values", async () => {
    wrapper = mount(FirewallDropsView, { global: { stubs } }); await flushPromises();
    expect(wrapper.get(".drop-table").classes()).toContain("app-table");
    const visibility = wrapper.get(".drop-toolbar .drop-visibility-controls");
    expect(visibility.element.children[0]?.getAttribute("aria-label")).toBe("Apply filters");
    expect(visibility.element.children[1]?.getAttribute("aria-label")).toBe("More filters");
    expect(visibility.element.children[2]?.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
    expect(visibility.findAll('input[type="checkbox"]')).toHaveLength(2);
    expect(wrapper.text()).not.toContain("Retained input/forward drops only");
    expect(wrapper.text()).not.toContain("Capture can be incomplete; empty history does not prove there were no drops");
    expect(wrapper.text()).not.toContain("Bytes are IP packet lengths, not flow totals");
    expect(wrapper.get('[data-label="Protocol"] [data-color="info"]').text()).toBe("TCP");
    expect(wrapper.get('[data-label="Reason"] [data-color="error"]').text()).toBe("Rule drop");
    expect(wrapper.get('[title="Source port 0"]').attributes("data-color")).toBe("primary");
    const toggle = wrapper.get('[aria-label="More filters"]');
    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(wrapper.find('[aria-label="Since (UTC)"]').exists()).toBe(false);
    await toggle.trigger("click");
    expect(toggle.attributes("aria-expanded")).toBe("true");
    await wrapper.get('[aria-label="Since (UTC)"]').setValue("2026-10-30 00:00:00");
    await toggle.trigger("click"); await toggle.trigger("click");
    expect(wrapper.get<HTMLInputElement>('[aria-label="Since (UTC)"]').element.value).toBe("2026-10-30 00:00:00");
    expect(getFirewallDenyLog).toHaveBeenCalledTimes(1);
  });
  it("loads older records by exact exclusive cursor, retaining ID order even when the clock moves backwards", async () => {
    const older = firewallDenyPage();
    older.records[0]!.id = "18446744073709551613"; older.records[0]!.timestamp_ms += 1000;
    older.next_before_id = null; older.cursor_expired = true;
    vi.mocked(getFirewallDenyLog).mockResolvedValueOnce(firewallDenyPage()).mockResolvedValueOnce(older);
    wrapper = mount(FirewallDropsView, { global: { stubs } }); await flushPromises();
    await button("Load older").trigger("click"); await flushPromises();
    expect(getFirewallDenyLog).toHaveBeenLastCalledWith({ limit: 100, before_id: "18446744073709551614", include_broadcast: false, include_tcp_closures: false }, expect.any(AbortSignal));
    expect(wrapper.findAll("time").map(item => item.text())).toEqual(["2026-10-30 12:34:56", "2026-10-30 12:34:57"]);
    expect(wrapper.text()).toContain("Retention gap"); expect(button("Load older")).toBeUndefined();
  });
  it("keeps successful results explicitly stale after errors and rejects non-advancing cursors", async () => {
    wrapper = mount(FirewallDropsView, { global: { stubs } }); await flushPromises();
    await button("Load older").trigger("click"); await flushPromises();
    expect(wrapper.text()).toContain("non-advancing history cursor");
    expect(wrapper.findAll("time")).toHaveLength(1);
    vi.mocked(getFirewallDenyLog).mockRejectedValueOnce(new ApiFailure("Capture storage failed", 503));
    await wrapper.get('[aria-label="Refresh"]').trigger("click"); await flushPromises();
    expect(wrapper.text()).toContain("unavailable"); expect(wrapper.text()).toContain("Previous results are retained");
  });
  it("submits AND filters with UTC bounds and resets pagination without making writes", async () => {
    wrapper = mount(FirewallDropsView, { global: { stubs } }); await flushPromises();
    await wrapper.get('[aria-label="Source or destination IP"]').setValue("2001:db8::1");
    await wrapper.get('[aria-label="IP protocol (0–255)"]').setValue("0");
    await wrapper.get('[aria-label="Chain"]').setValue("input");
    await wrapper.get('[aria-label="More filters"]').trigger("click");
    await wrapper.get('[aria-label="Since (UTC)"]').setValue("2026-10-30 00:00:00");
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(getFirewallDenyLog).toHaveBeenLastCalledWith(expect.objectContaining({
      address: "2001:db8::1", protocol: 0, chain: "input", since_ms: Date.parse("2026-10-30T00:00:00Z"), before_id: undefined,
    }), expect.any(AbortSignal));
    await wrapper.get('[aria-label="Since (UTC)"]').setValue("2026-02-30 00:00:00");
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(wrapper.text()).toContain("valid UTC time"); expect(getFirewallDenyLog).toHaveBeenCalledTimes(2);
    expect(useControllerStore().editorDirty).toBe(false); expect(useControllerStore().draft).toBeNull();
  });
  it("distinguishes permission denial from a healthy empty page and unhealthy capture with overlapping loss indicators", async () => {
    vi.mocked(getFirewallDenyLog).mockRejectedValueOnce(new ApiFailure("Forbidden", 403));
    wrapper = mount(FirewallDropsView, { global: { stubs } }); await flushPromises();
    expect(wrapper.text()).toContain("firewall.logs.read"); expect(wrapper.text()).not.toContain("No retained drops");
    const page = firewallDenyPage(); page.records = []; page.next_before_id = null;
    page.capture.status = "error"; page.capture.error = "Missing nft_log";
    page.capture.discarded_records = "9007199254740993"; page.capture.sequence_gaps = "4";
    vi.mocked(getFirewallDenyLog).mockResolvedValue(page);
    await wrapper.get('[aria-label="Refresh"]').trigger("click"); await flushPromises();
    expect(wrapper.text()).toContain("No retained drops"); expect(wrapper.text()).toContain("not healthy");
    expect(wrapper.text()).toContain("9007199254740993"); expect(wrapper.text()).toContain("not an exact lost-packet total");
  });
  it("aborts on unmount and discards results from another session", async () => {
    let resolve!: (value: ReturnType<typeof firewallDenyPage>) => void;
    vi.mocked(getFirewallDenyLog).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    wrapper = mount(FirewallDropsView, { global: { stubs } });
    const signal = vi.mocked(getFirewallDenyLog).mock.calls[0]![1]!;
    useControllerStore().sessionVersion++; await flushPromises();
    expect(signal.aborted).toBe(true);
    resolve({ ...firewallDenyPage(), records: [] }); await flushPromises();
    expect(wrapper.findAll("time")).toHaveLength(1);
    const latest = vi.mocked(getFirewallDenyLog).mock.calls.at(-1)![1]!;
    wrapper.unmount(); expect(latest.aborted).toBe(true);
  });
});

describe("firewall rule totals", () => {
  function relaySettings() {
    const settings = hostPolicyConfig();
    settings.interfaces[0]!.dhcp_relay = { enabled: true, servers: ["198.51.100.40"] };
    settings.firewall.input = { policy: "drop", interfaces: [{ interface: "lab0", rules: [{ action: "drop" }] }] };
    return settings;
  }
  it("shows full DHCP rules in the system section before user drops with exact counters and no editor", async () => {
    const store = useControllerStore(), settings = relaySettings();
    store.state.data!.desired = settings;
    vi.mocked(getFirewallCounters).mockResolvedValue(firewallCounters(settings));
    wrapper = mount(FirewallRuleTable, { props: { scope: "input", owner: "lab0" }, global: { stubs } });
    await flushPromises();
    const rows = wrapper.findAll('.rule-section--system .system-rule[title^="DHCP relay"]');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.findAll(".rule-value").map(cell => cell.text())).toEqual([
      "DHCP clients", "LAB0", "Any IPv4", "192.0.2.10/32, 255.255.255.255/32", "UDP", "68", "67", "accept",
    ]);
    expect(rows[1]!.findAll(".rule-value").map(cell => cell.text())).toEqual([
      "DHCP servers", "Any", "198.51.100.40/32", "192.0.2.10/32", "UDP", "67", "67", "accept",
    ]);
    expect(wrapper.find(".counter-summary").exists()).toBe(false);
    expect(rows[0]!.findAll(".counter-value").map(value => value.text())).toEqual(["9007199254740993", "18446744073709551616"]);
    expect(rows[1]!.findAll(".counter-value")[0]!.text()).toBe("0");
    for (const row of rows) {
      expect(row.get(".rule-origin").text()).toBe("System");
      expect(row.findAll("button, input, select, [data-rule-index]")).toHaveLength(0);
      expect(row.findAll("td").reduce((total, cell) => total + Number(cell.attributes("colspan") ?? 1), 0))
        .toBe(wrapper.findAll("thead th").length);
    }
    expect(wrapper.get(".rule-section--user").text()).not.toContain("DHCP");
    expect(store.draft).toBeNull();
    expect(store.state.data!.desired).toEqual(settings);
    const manual = cloneConfig(settings).firewall;
    await wrapper.get('[aria-label="Edit rule 1"]').trigger("click");
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(store.draft!.firewall).toEqual(manual);
  });
  it("only shows relay rules under their configured interface when switching interfaces", async () => {
    const store = useControllerStore(), settings = relaySettings();
    settings.interfaces.push({ ...settings.interfaces[0]!, name: "vlan30", addresses: ["192.0.30.1/24"] });
    settings.interfaces.push({ ...settings.interfaces[0]!, name: "wan0", dhcp_relay: { enabled: false, servers: [] } });
    store.state.data!.desired = settings;
    vi.mocked(getFirewallCounters).mockResolvedValue(firewallCounters(settings));
    wrapper = mount(FirewallRuleTable, { props: { scope: "input", owner: "wan0" }, global: { stubs } });
    await flushPromises();
    expect(wrapper.text()).not.toContain("DHCP");
    await wrapper.setProps({ owner: "vlan30" });
    const rows = wrapper.findAll('.system-rule[title^="DHCP relay"]');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.text()).toContain("VLAN30");
    expect(rows[0]!.text()).toContain("192.0.30.1/32");
    expect(rows[1]!.text()).toContain("192.0.30.1/32");
    expect(rows.every(row => !row.text().includes("192.0.2.10/32"))).toBe(true);
  });
  it("shows generated DHCP counters without requiring an input policy or inventing them on older backends", async () => {
    const store = useControllerStore(), settings = relaySettings();
    delete settings.firewall.input;
    settings.firewall.allow_all_icmp = false;
    store.state.data!.desired = settings;
    vi.mocked(getFirewallCounters).mockResolvedValue(firewallCounters(settings));
    wrapper = mount(FirewallInputView, { global: { stubs } }); await flushPromises();
    expect(wrapper.findAll('.system-rule[title^="DHCP relay"]')).toHaveLength(2);
    expect(wrapper.text()).toContain("No host input filter configured.");
    expect(wrapper.find(".counter-summary").exists()).toBe(false);
    expect(wrapper.findAll('.system-rule[title^="DHCP relay"]')[0]!.text()).toContain("192.0.2.10/32");
    const older = firewallCounters(settings);
    older.rules = older.rules.filter(row => !row.id.includes("/dhcp_relay/"));
    vi.mocked(getFirewallCounters).mockResolvedValue(older);
    document.dispatchEvent(new Event("visibilitychange")); await flushPromises();
    expect(wrapper.findAll('.system-rule[title^="DHCP relay"]')).toHaveLength(0);
    expect(store.draft).toBeNull();
  });
  it.each(["success", "failure"] as const)("keeps initial counter loading neutral until %s", async outcome => {
    const store = useControllerStore(), settings = relaySettings();
    store.state.data!.desired = settings;
    let resolve!: (sample: FirewallCounters) => void, reject!: (error: Error) => void;
    vi.mocked(getFirewallCounters).mockImplementationOnce(() => new Promise((done, fail) => { resolve = done; reject = fail; }));
    wrapper = mount(FirewallRuleTable, { props: { scope: "input", owner: "lab0" }, global: { stubs } });
    expect(wrapper.text()).toContain("Loading firewall counters");
    expect(wrapper.text()).not.toContain("unavailable");
    expect(wrapper.findAll('.system-rule[title^="DHCP relay"]')).toHaveLength(0);
    if (outcome === "success") resolve(firewallCounters(settings));
    else reject(new ApiFailure("Counter read failed", 503));
    await flushPromises();
    expect(wrapper.findAll('.system-rule[title^="DHCP relay"]')).toHaveLength(outcome === "success" ? 2 : 0);
    if (outcome === "failure") expect(wrapper.text()).toContain("Counter read failed");
  });
  it("invalidates relay draft counters and refreshes after apply and rollback without caching ruleset identities", async () => {
    const store = useControllerStore(), settings = relaySettings();
    store.state.data!.desired = settings;
    vi.mocked(getFirewallCounters).mockResolvedValue(firewallCounters(settings));
    wrapper = mount(FirewallRuleTable, { props: { scope: "input", owner: "lab0" }, global: { stubs } });
    await flushPromises();
    expect(wrapper.findAll('.system-rule[title^="DHCP relay"]')).toHaveLength(2);
    store.draft = cloneConfig(settings);
    store.draft.interfaces[0]!.dhcp_relay.servers = ["198.51.100.41"];
    await flushPromises();
    expect(wrapper.findAll('.system-rule[title^="DHCP relay"]')).toHaveLength(0);
    expect(wrapper.findAll(".counter-value").every(value => value.text() === "—")).toBe(true);
    const pending = transaction();
    pending.candidate = cloneConfig(store.draft);
    store.draft = null;
    const applied = { ...firewallCounters(pending.candidate), transaction_id: pending.id, ruleset_id: "c".repeat(64) };
    vi.mocked(getFirewallCounters).mockResolvedValue(applied);
    store.state.data = { ...store.state.data!, active_transaction: pending };
    await flushPromises();
    expect(getFirewallCounters).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain("Sampled (UTC)");
    expect(wrapper.findAll('.system-rule[title^="DHCP relay"]')).toHaveLength(2);
    const rolledBack = firewallCounters(settings);
    rolledBack.ruleset_id = "d".repeat(64);
    vi.mocked(getFirewallCounters).mockResolvedValue(rolledBack);
    store.state.data = { ...store.state.data!, active_transaction: undefined };
    await flushPromises();
    expect(wrapper.findAll('.system-rule[title^="DHCP relay"]')).toHaveLength(2);
    expect(getFirewallCounters).toHaveBeenCalledTimes(3);
    expect(store.state.data!.desired.firewall).toEqual(settings.firewall);
  });
  function mountRules(scope: "host" | "interface" | "input" = "host", owner = "desk") {
    const store = useControllerStore(); store.state.data!.desired = hostPolicyConfig();
    if (scope === "input") store.state.data!.desired.firewall.input = { policy: "drop", interfaces: [{ interface: "unused0", rules: [] }, { interface: "lab0", rules: [{ action: "accept" }] }] };
    vi.mocked(getFirewallCounters).mockResolvedValue(firewallCounters(store.state.data!.desired));
    wrapper = mount(FirewallRuleTable, { props: { scope, owner }, global: { stubs } });
  }
  it("shows exact expanded totals and true zero defaults, with a fractional UTC sample formatted to seconds", async () => {
    mountRules(); await flushPromises();
    expect(values()).toEqual(["9007199254740993", "18446744073709551616"]);
    expect(wrapper.findAll(".host-rule--default .counter-value")[0]!.text()).toBe("0");
    expect(wrapper.text()).toContain("Sampled (UTC): 2026-10-30 12:34:56");
    expect(wrapper.find('[title^="Established/related bypass"]').exists()).toBe(true);
    expect(wrapper.find('[title="IPv4 ICMP exception"]').exists()).toBe(true);
  });
  it.each([["interface", "lab0"], ["input", "lab0"]] as const)("maps %s rules using their original interface and rule indexes", async (scope, owner) => {
    mountRules(scope, owner); await flushPromises();
    expect(values()).toEqual(["9007199254740993", "18446744073709551616"]);
    if (scope === "input") expect(wrapper.find('[title^="Loopback bypass"]').exists()).toBe(true);
  });
  it.each(["host", "interface", "input"] as const)("embeds %s system, user and default rules in one compact ordered table", async scope => {
    mountRules(scope, scope === "host" ? "desk" : "lab0"); await flushPromises();
    const policy = wrapper.get(`table[aria-label="${scope === "host" ? "Host rules" : scope === "input" ? "Input rules" : "Interface rules"}"]`);
    expect(wrapper.findAll("table")).toHaveLength(1);
    expect(policy.findAll("thead")).toHaveLength(1);
    expect(policy.findAll(".rule-section-heading").map(row => row.text())).toEqual(scope === "host"
      ? ["System Rules", "Interface Overrides", "Host Rules", "Default Rules"] : ["System Rules", "User Rules", "Default Rules"]);
    expect(policy.findAll("tbody").map(body => body.classes()[0])).toEqual(scope === "host"
      ? ["rule-section--system", "rule-section--interfaces", "rule-section--user", "rule-section--defaults"]
      : ["rule-section--system", "rule-section--user", "rule-section--defaults"]);
    expect(policy.find(".counter-summary").exists()).toBe(false);
    const rows = policy.findAll(".system-rule");
    expect(rows).toHaveLength(scope === "input" ? 4 : 3);
    for (const row of rows) {
      expect(row.findAll("button, input, select, [data-rule-index]")).toHaveLength(0);
      expect(row.attributes("data-rule-index")).toBeUndefined();
      expect(row.findAll("td")).toHaveLength(policy.findAll("thead th").length);
      expect(row.get(".rule-origin").text()).toBe("System");
      expect(row.get(".rule-actions").text()).toBe("—");
      expect(row.find("td > div.text-caption").exists()).toBe(false);
    }
    expect(rows[0]!.findAll(".rule-value:not(.rule-value--ingress)").map(value => value.text()).slice(0, 4))
      .toEqual(scope === "input" ? ["ICMP", "Any", "Any IPv4", "ICMP"] : ["ICMP", "Any IPv4", "ICMP", "Any"]);
    expect(policy.get(".rule-section--system").findAll(".host-rule")).toHaveLength(0);
    expect(policy.get(".rule-section--user").findAll(".system-rule")).toHaveLength(0);
    expect(policy.get(".rule-section--defaults").findAll("tr").at(-1)!.classes()).toContain("system-rule--default");
    expect(rows[0]!.attributes("data-action")).toBe("accept");
    expect(rows.at(-1)!.findAll(".counter-value").map(value => value.text())).toEqual(["0", "18446744073709551616"]);
    if (scope === "input") {
      expect(rows[1]!.attributes("title")).toContain("Ingress: lo");
      expect(rows[2]!.attributes("title")).toContain("Connection state: established, related");
      expect(rows[3]!.attributes("data-action")).toBe("drop");
    }
    expect(useControllerStore().draft).toBeNull();
  });
  it.each(["accept", "drop"] as const)("shows %s interface overrides ahead of the opposing source-host policy without changing rule ownership or indexes", async action => {
    const store = useControllerStore(), settings = hostPolicyConfig(), opposite = action === "accept" ? "drop" : "accept";
    settings.firewall.policies!.hosts.find(host => host.id === "phone")!.addresses.push("2001:db8::30");
    settings.interfaces.push({ ...settings.interfaces[0]!, name: "wan0", role: "wan", addresses: ["203.0.113.1/24"] });
    settings.firewall.policies!.interfaces = [
      { interface: "wan0", rules: [{ protocol: "udp", destination_ports: [53], action: "drop" }] },
      { interface: "lab0", rules: [{ action, origin: "import", import_source: "other_provider" }] },
    ];
    const host = settings.firewall.policies!.hosts.find(host => host.id === "desk")!;
    host.rules = [{ destination_host: "server", action: opposite }];
    host.policy = opposite;
    settings.firewall.policies!.hosts.find(host => host.id === "server")!.rules = [{
      protocol: "tcp", destination_ports: [63001], action: "accept",
    }];
    store.state.data = { ...state(), desired: settings };
    const sample = firewallCounters(settings);
    sample.rules.find(row => row.id === "forward:/firewall/policies/interfaces/1/rules/0")!.packets = "42";
    vi.mocked(getFirewallCounters).mockResolvedValue(sample);
    wrapper = mount(FirewallRuleTable, { props: { scope: "host", owner: "desk" }, global: { stubs } });
    await flushPromises();
    const table = wrapper.get("table"), overrides = table.get(".rule-section--interfaces");
    const entries = overrides.findAll(".interface-rule");
    expect(entries.map(row => row.get(".rule-value--ingress").text())).toEqual(["LAB0"]);
    expect(entries[0]!.attributes("data-action")).toBe(action);
    expect(entries[0]!.get(".rule-origin").text()).toBe("Import: other_provider");
    expect(entries[0]!.findAll(".counter-value")[0]!.text()).toBe("42");
    expect(overrides.get("th").attributes("title")).toContain("First matching");
    expect(overrides.get("th").attributes("title")).toContain("catch-all");
    expect(overrides.findAll("button, [data-rule-index]")).toHaveLength(0);
    expect(table.get(".host-rule").attributes("data-action")).toBe(opposite);
    expect(table.get(".host-rule--default").attributes("data-action")).toBe(opposite);
    expect(table.get(".system-rule--default .rule-value--order").text()).toBe("Global");
    expect(table.get(".rule-section--user").text()).not.toContain("63001");
    expect(store.draft).toBeNull();
    await wrapper.get('[aria-label="Edit rule 1"]').trigger("click");
    expect(wrapper.findAll(".interface-rule")).toHaveLength(1);
    expect(wrapper.findAll(".rule-editor")).toHaveLength(1);
    await wrapper.get("form").trigger("submit");
    expect(store.draft?.firewall.policies?.interfaces).toEqual(settings.firewall.policies!.interfaces);
    expect(store.draft?.firewall.policies?.hosts.find(host => host.id === "server")?.rules)
      .toEqual(settings.firewall.policies!.hosts.find(host => host.id === "server")!.rules);
  });
  it.each([
    { address: "10.2.10.2", networks: ["10.2.10.1/24"] },
    { address: "2001:db8:10::2", networks: ["10.2.10.1/24", "2001:db8:10::1/64"] },
  ])("shows only subnet-matching overrides for $address", async ({ address, networks }) => {
    const store = useControllerStore(), settings = hostPolicyConfig();
    settings.firewall.policies!.hosts.find(host => host.id === "desk")!.addresses = [address];
    settings.interfaces.push(
      { ...settings.interfaces[0]!, name: "vlan10", addresses: networks },
      { ...settings.interfaces[0]!, name: "vlan20", addresses: ["10.2.20.1/24", "2001:db8:20::1/64"] },
      { ...settings.interfaces[0]!, name: "empty0", addresses: [] },
    );
    settings.firewall.policies!.interfaces = [
      { interface: "vlan20", rules: [{ action: "drop" }] },
      { interface: "vlan10", rules: [{ action: "accept" }, { protocol: "udp", action: "drop" }] },
      { interface: "empty0", rules: [{ action: "drop" }] },
      { interface: "missing0", rules: [{ action: "drop" }] },
    ];
    store.state.data = { ...state(), desired: settings };
    wrapper = mount(FirewallRuleTable, { props: { scope: "host", owner: "desk" }, global: { stubs } });
    await flushPromises();
    const entries = wrapper.findAll(".interface-rule");
    expect(entries.map(row => row.get(".rule-value--ingress").text())).toEqual(["VLAN10", "VLAN10"]);
    expect(entries.map(row => row.get(".rule-value--order").text())).toEqual(["1", "2"]);
    expect(entries.map(row => row.attributes("data-action"))).toEqual(["accept", "drop"]);
    expect(store.draft).toBeNull();
    await wrapper.setProps({ scope: "interface", owner: "vlan20" });
    expect(wrapper.findAll(".host-rule")).toHaveLength(1);
    expect(wrapper.get(".host-rule").attributes("data-action")).toBe("drop");
  });
  it("updates matching overrides for host selection, pending configurations and drafts without staging display changes", async () => {
    const store = useControllerStore(), settings = hostPolicyConfig();
    settings.interfaces.push({ ...settings.interfaces[0]!, name: "server0", addresses: ["198.51.100.1/24"] });
    settings.firewall.policies!.interfaces.push({ interface: "server0", rules: [{ action: "accept" }] });
    store.state.data = { ...state(), desired: settings };
    wrapper = mount(FirewallRuleTable, { props: { scope: "host", owner: "desk" }, global: { stubs } });
    await flushPromises();
    const ingress = () => wrapper.findAll(".interface-rule").map(row => row.get(".rule-value--ingress").text());
    expect(ingress()).toEqual(["LAB0"]);
    await wrapper.setProps({ owner: "server" });
    expect(ingress()).toEqual(["SERVER0"]);
    const pending = transaction();
    pending.candidate = cloneConfig(settings);
    pending.candidate.firewall.policies!.hosts.find(host => host.id === "server")!.addresses = ["192.0.2.25", "198.51.100.25"];
    store.state.data = { ...store.state.data!, active_transaction: pending };
    await flushPromises();
    expect(ingress()).toEqual(["LAB0", "SERVER0"]);
    expect(store.draft).toBeNull();
    store.draft = cloneConfig(pending.candidate);
    store.draft.interfaces.find(link => link.name === "server0")!.addresses = ["203.0.113.1/24"];
    await flushPromises();
    expect(ingress()).toEqual(["LAB0"]);
    store.draft.firewall.policies!.hosts.find(host => host.id === "server")!.addresses = ["10.2.10.2"];
    await flushPromises();
    expect(ingress()).toEqual([]);
    expect(wrapper.find(".rule-section--interfaces").exists()).toBe(false);
    expect(wrapper.find(".host-rule--default").exists()).toBe(true);
  });
  it("keeps actual system rules visible with unknown totals when counters fail or firewall edits are unapplied", async () => {
    mountRules("input", "unused0"); await flushPromises();
    expect(wrapper.get('table[aria-label="Input rules"]').text()).toContain("No explicit ingress rules");
    const store = useControllerStore();
    store.draft = cloneConfig(store.state.data!.desired);
    store.draft.firewall.input!.policy = "accept";
    await flushPromises();
    const system = wrapper.get('table[aria-label="Input rules"]');
    expect(system.findAll(".system-rule")).toHaveLength(4);
    expect(system.get(".system-rule--default").attributes("data-action")).toBe("accept");
    expect(system.findAll(".counter-value").every(value => value.text() === "—")).toBe(true);
    vi.mocked(getFirewallCounters).mockRejectedValueOnce(new ApiFailure("Counter unavailable", 503));
    document.dispatchEvent(new Event("visibilitychange")); await flushPromises();
    expect(system.findAll(".system-rule")).toHaveLength(4);
    expect(wrapper.text()).toContain("Counter unavailable");
  });
  it("uses the configured host index instead of the alphabetically sorted host-list position", async () => {
    const store = useControllerStore(); store.state.data!.desired = hostPolicyConfig();
    const sample = firewallCounters(store.state.data!.desired);
    sample.rules.find(row => row.config_path === "/firewall/policies/hosts/2/rules/0")!.packets = "42";
    vi.mocked(getFirewallCounters).mockResolvedValue(sample);
    wrapper = mount(FirewallPolicySettings, { props: { selectedConfig: store.state.data!.desired, showDraft: false }, global: { stubs } });
    await flushPromises(); expect(wrapper.findAll(".host-rule .counter-value")[0]!.text()).toBe("42");
  });
  it("hides measurements for reordered firewall drafts but preserves them for unrelated edits", async () => {
    mountRules(); await flushPromises(); const store = useControllerStore();
    store.draft = cloneConfig(store.state.data!.desired); store.draft.ntp.enabled = true;
    await flushPromises(); expect(values()[0]).toBe("9007199254740993");
    store.draft.firewall.policies!.hosts[0]!.rules.reverse();
    await flushPromises(); expect(values()).toEqual(["—", "—"]); expect(wrapper.text()).toContain("unapplied firewall edits");
  });
  it("uses pending applied candidates with the same transaction rather than committed rows", async () => {
    const store = useControllerStore(), pending = transaction(); pending.candidate = hostPolicyConfig();
    store.state.data!.active_transaction = pending;
    vi.mocked(getFirewallCounters).mockResolvedValue({ ...firewallCounters(pending.candidate), transaction_id: pending.id });
    wrapper = mount(FirewallRuleTable, { props: { scope: "host", owner: "desk" }, global: { stubs } });
    await flushPromises(); expect(values()[0]).toBe("9007199254740993");
  });
  it("keeps missing, failed and simulated measurements distinct from zero", async () => {
    mountRules(); vi.mocked(getFirewallCounters).mockRejectedValueOnce(new ApiFailure("Unsupported counter", 503));
    document.dispatchEvent(new Event("visibilitychange")); await flushPromises();
    expect(values()).toEqual(["—", "—"]); expect(wrapper.text()).toContain("Unsupported counter");
    const sample = firewallCounters();
    vi.mocked(getFirewallCounters).mockResolvedValue({ ...sample, sample: { ...sample.sample, status: "simulated" }, rules: [], generation: null, ruleset_id: null });
    document.dispatchEvent(new Event("visibilitychange")); await flushPromises();
    expect(values()).toEqual(["—", "—"]); expect(wrapper.text()).toContain("not measured by the simulator");
  });
  it("is visible-only, single-flight, abortable and ignores cancelled replies", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    mountRules(); await flushPromises();
    let resolve!: (value: FirewallCounters) => void;
    vi.mocked(getFirewallCounters).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await vi.advanceTimersByTimeAsync(5000); await vi.advanceTimersByTimeAsync(15000);
    expect(getFirewallCounters).toHaveBeenCalledTimes(2);
    const signal = vi.mocked(getFirewallCounters).mock.calls[1]![0]!;
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(signal.aborted).toBe(true); resolve(firewallCounters()); await flushPromises();
    await vi.advanceTimersByTimeAsync(60000); expect(getFirewallCounters).toHaveBeenCalledTimes(2);
    expect(values()).toEqual(["—", "—"]);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange")); await flushPromises();
    expect(getFirewallCounters).toHaveBeenCalledTimes(3);
    wrapper.unmount(); await vi.advanceTimersByTimeAsync(60000); expect(getFirewallCounters).toHaveBeenCalledTimes(3);
  });
  it("backs off after failures instead of hammering the backend", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); mountRules(); await flushPromises();
    vi.mocked(getFirewallCounters).mockRejectedValueOnce(new ApiFailure("Counter unavailable", 503));
    await vi.advanceTimersByTimeAsync(5000); expect(getFirewallCounters).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(9999); expect(getFirewallCounters).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); expect(getFirewallCounters).toHaveBeenCalledTimes(3);
  });
  it.each(["firewall", "nat"] as const)("uses original %s resource indexes even for filtered rows", async section => {
    const store = useControllerStore(), settings = store.state.data!.desired;
    if (section === "nat") settings.firewall.nat.masquerade.push({ ...settings.firewall.nat.masquerade[0]! });
    else settings.firewall.rules.push({ ...settings.firewall.rules[0]! });
    const entries = section === "nat" ? settings.firewall.nat.masquerade : settings.firewall.rules;
    const sample = firewallCounters(settings);
    sample.rules.find(row => row.config_path === (section === "nat" ? "/firewall/nat/masquerade/1" : "/firewall/rules/1"))!.packets = "43";
    vi.mocked(getFirewallCounters).mockResolvedValue(sample);
    wrapper = mount(ResourceTable, { props: { section, rows: [{ value: entries[1]!, index: 1, rowID: "filtered" }], total: 2, disabled: false, detail: false }, global: { stubs } });
    await flushPromises(); expect(wrapper.get(".counter-value").text()).toBe("43");
  });
  it("shows DNAT measurements for a pending applied candidate", async () => {
    const store = useControllerStore(), pending = transaction(); pending.candidate.firewall.nat.destination_rewrite = [dnatRule()];
    store.state.data!.active_transaction = pending;
    vi.mocked(getFirewallCounters).mockResolvedValue({ ...firewallCounters(pending.candidate), transaction_id: pending.id });
    wrapper = mount(DNATView, { global: { stubs } }); await flushPromises();
    expect(wrapper.get(".counter-value").text()).toBe("9007199254740993"); expect(wrapper.text()).toContain("initial connection-mapping evaluations");
  });
  it("shows generated ICMP input counters without pretending that an input filter was configured", async () => {
    wrapper = mount(FirewallInputView, { global: { stubs } }); await flushPromises();
    expect(wrapper.text()).toContain("No host input filter configured.");
    expect(wrapper.get('.system-rule[title="IPv4 ICMP exception"]').text()).toContain("ICMP");
    expect(wrapper.get('.system-rule[title="Generated input default"]').text()).toContain("accept");
    expect(wrapper.findAll(".counter-value").some(value => value.text() === "0")).toBe(true);
    expect(wrapper.find(".host-rule").exists()).toBe(false);
  });
  it("keeps global forwarding defaults visible when no configured hosts remain", async () => {
    const store = useControllerStore(); store.state.data!.desired = hostPolicyConfig();
    store.state.data!.desired.firewall.policies!.hosts = [];
    vi.mocked(getFirewallCounters).mockResolvedValue(firewallCounters(store.state.data!.desired));
    wrapper = mount(FirewallPolicySettings, { props: { selectedConfig: store.state.data!.desired, showDraft: false }, global: { stubs } });
    await flushPromises(); expect(wrapper.text()).toContain("Forwarding default");
    expect(wrapper.get(".counter-value").text()).toBe("0");
    expect(wrapper.find(".host-rule").exists()).toBe(false);
  });
});
