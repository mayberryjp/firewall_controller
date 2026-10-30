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
import type { FirewallCounters } from "@/services/firewallTelemetry";
import { hostPolicyConfig, runtime, state, transaction } from "../fixtures";
import { dnatRule } from "../bgpFixtures";
import { firewallCounters, firewallDenyPage } from "../firewallTelemetryFixtures";

vi.mock("@/services/netcontrol", async importOriginal => ({
  ...await importOriginal<typeof import("@/services/netcontrol")>(),
  getFirewallCounters: vi.fn(), getFirewallDenyLog: vi.fn(),
}));
const stubs = {
  VTable: { template: "<table><slot /></table>" },
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
    expect(getFirewallDenyLog).toHaveBeenLastCalledWith({ limit: 100, before_id: "18446744073709551614" }, expect.any(AbortSignal));
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
      .toEqual(["ICMP", "Any IPv4", "ICMP", "Any"]);
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
    expect(entries.map(row => row.get(".rule-value--ingress").text())).toEqual(["wan0", "lab0"]);
    expect(entries[1]!.attributes("data-action")).toBe(action);
    expect(entries[1]!.get(".rule-origin").text()).toBe("Import: other_provider");
    expect(entries[1]!.findAll(".counter-value")[0]!.text()).toBe("42");
    expect(overrides.get("th").attributes("title")).toContain("First matching");
    expect(overrides.get("th").attributes("title")).toContain("catch-all");
    expect(overrides.findAll("button, [data-rule-index]")).toHaveLength(0);
    expect(table.get(".host-rule").attributes("data-action")).toBe(opposite);
    expect(table.get(".host-rule--default").attributes("data-action")).toBe(opposite);
    expect(table.get(".system-rule--default .rule-value--order").text()).toBe("Global");
    expect(table.get(".rule-section--user").text()).not.toContain("63001");
    expect(store.draft).toBeNull();
    await wrapper.get('[aria-label="Edit rule 1"]').trigger("click");
    expect(wrapper.findAll(".interface-rule")).toHaveLength(2);
    expect(wrapper.findAll(".rule-editor")).toHaveLength(1);
    await wrapper.get("form").trigger("submit");
    expect(store.draft?.firewall.policies?.interfaces).toEqual(settings.firewall.policies!.interfaces);
    expect(store.draft?.firewall.policies?.hosts.find(host => host.id === "server")?.rules)
      .toEqual(settings.firewall.policies!.hosts.find(host => host.id === "server")!.rules);
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
    expect(wrapper.text()).toContain("IPv4 ICMP exception");
    expect(wrapper.text()).toContain("Generated input default");
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
