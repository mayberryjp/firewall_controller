import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PossibleMissingRulesView from "@/views/PossibleMissingRulesView.vue";
import { getFirewallDenyLog } from "@/services/netcontrol";
import { ApiFailure } from "@/services/api";
import { useControllerStore } from "@/stores/controller";
import { navigationSections } from "@/constants/navigation";
import { cloneConfig } from "@/services/configuration";
import { firewallDenyPage } from "../firewallTelemetryFixtures";
import { state } from "../fixtures";
import type { FirewallDenyPage } from "@/services/firewallTelemetry";

vi.mock("@/services/netcontrol", () => ({ getFirewallDenyLog: vi.fn() }));
const stubs = {
  VTable: { template: "<table><slot /></table>" },
  VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
  VAlert: { template: "<div><slot /></div>" }, VProgressLinear: true,
  VChip: { props: ["color", "size"], template: '<span :data-color="color" :data-size="size"><slot /></span>' },
  VSelect: {
    props: ["modelValue", "label", "items"], emits: ["update:modelValue"],
    template: '<select :aria-label="label" :value="modelValue" @change="$emit(\'update:modelValue\', Number($event.target.value))"><option v-for="item in items" :key="item.value" :value="item.value">{{ item.title }}</option></select>',
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
  it("appears directly after Firewall drops in Diagnostics navigation", () => {
    const pages = navigationSections.find(section => section.name === "diagnostics-section")!.pages;
    expect(pages[pages.findIndex(item => item.name === "firewall-drops") + 1]!.name).toBe("possible-missing-rules");
  });

  it("switches all five periods without extra reads or configuration writes", async () => {
    wrapper = mount(PossibleMissingRulesView, { global: { stubs } }); await flushPromises();
    expect(wrapper.get("select").findAll("option").map(option => option.text())).toEqual(["Last hour", "Last 4 hours", "Last 8 hours", "Last day", "Last week"]);
    for (const [hours, count] of [[1, 1], [4, 2], [8, 3], [24, 4], [168, 5]]) {
      await wrapper.get("select").setValue(String(hours));
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

  it("formats the fixed period boundary in the saved timezone with seconds only, not an unsaved draft", async () => {
    const store = useControllerStore();
    store.state.data!.desired.system = { hostname: "", domain: "", timezone: "America/Los_Angeles" };
    store.draft = cloneConfig(store.state.data!.desired); store.draft.system!.timezone = "Asia/Tokyo";
    wrapper = mount(PossibleMissingRulesView, { global: { stubs } }); await flushPromises();
    expect(wrapper.text()).toContain("Period (America/Los_Angeles): 2026-11-08 03:34:56 to 2026-11-08 04:34:56.");
    expect(wrapper.get('[data-label="Last seen (America/Los_Angeles)"] time').text()).toBe("2026-11-08 04:34:56");
    expect(wrapper.get("time").attributes("datetime")).toBe("2026-11-08T12:34:56.789Z");
    expect(wrapper.text()).not.toContain(".789");
    expect(getFirewallDenyLog).toHaveBeenCalledWith(expect.objectContaining({ until_ms: until }), expect.any(AbortSignal));
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
