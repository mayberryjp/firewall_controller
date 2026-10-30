import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JsonPanel from "@/components/base/JsonPanel.vue";
import DatasetStatus from "@/components/base/DatasetStatus.vue";
import RelayStatus from "@/components/feature/RelayStatus.vue";
import TransactionActions from "@/components/feature/TransactionActions.vue";
import GatewayStatisticsPanel from "@/components/feature/GatewayStatisticsPanel.vue";
import HistoryView from "@/views/HistoryView.vue";
import TransactionsView from "@/views/TransactionsView.vue";
import TransactionDetailView from "@/views/TransactionDetailView.vue";
import { useControllerStore } from "@/stores/controller";
import { gatewayStatistics, state, statistics, transaction } from "../fixtures";

const timestamp = "2026-01-02T03:04:05.987+02:00";
const formatted = "2026-01-02 01:04:05";
const box = { template: "<div><slot /></div>" };
const global = { stubs: {
  VTable: box, VAlert: box, VBtn: box, VChip: box, RouterLink: box,
  VDialog: { template: "<div />" }, VProgressLinear: true,
} };

beforeEach(() => { setActivePinia(createPinia()); });
afterEach(() => { vi.useRealTimers(); });

describe("human-facing timestamp displays", () => {
  it("reactively uses the saved system timezone in diagnostics, not unsaved drafts", async () => {
    const store = useControllerStore();
    store.state.data = state();
    store.state.data.desired.system = { hostname: "", domain: "", timezone: "America/Los_Angeles" };
    const original = { collected_at: timestamp, readings: [timestamp] };
    const wrapper = mount(JsonPanel, { props: { value: original } });
    expect(wrapper.text()).toContain("Collected at (America/Los_Angeles)");
    expect(wrapper.text()).toContain("2026-01-01 17:04:05");
    expect(wrapper.text()).toContain("2026-01-01 17:04:05 America/Los_Angeles");
    store.draft = { ...store.state.data.desired, system: { hostname: "", domain: "", timezone: "Asia/Kolkata" } };
    await flushPromises();
    expect(wrapper.text()).toContain("2026-01-01 17:04:05");
    store.state.data = { ...store.state.data, desired: { ...store.state.data.desired, system: store.draft.system } };
    await flushPromises();
    expect(wrapper.text()).toContain("Collected at (Asia/Kolkata)");
    expect(wrapper.text()).toContain("2026-01-02 06:34:05");
    expect(wrapper.text()).not.toContain("UTC");
    expect(original.collected_at).toBe(timestamp);
  });

  it("uses the system timezone in gateway detail labels, tooltips, and confirmation deadlines", () => {
    const store = useControllerStore();
    store.state.data = state();
    store.state.data.desired.system = { hostname: "", domain: "", timezone: "Asia/Kolkata" };
    store.gatewayStatistics.data = { sample: statistics().sample, monitors: [{ ...gatewayStatistics(), collected_at: timestamp }] };
    const gateway = mount(GatewayStatisticsPanel, { props: { name: gatewayStatistics().name }, global });
    expect(gateway.text()).toContain("Measured (Asia/Kolkata)");
    expect(gateway.text()).toContain("2026-01-02 06:34:05");
    store.state.stale = true; store.state.lastSuccess = Date.parse(timestamp);
    const stale = mount(DatasetStatus, { props: { query: store.state, label: "State" }, global });
    expect(stale.get("p").attributes("title")).toBe("Last read 2026-01-02 06:34:05 Asia/Kolkata");
    const pending = transaction(); pending.confirmation_deadline = timestamp;
    const actions = mount(TransactionActions, { props: { transaction: pending }, global });
    expect(actions.get("time").text()).toBe("2026-01-02 06:34:05");
    expect(actions.get("time").attributes("datetime")).toBe(timestamp);
    expect(actions.get("time").attributes("title")).toBe("2026-01-02 06:34:05 Asia/Kolkata");
  });

  it("groups commit results and comment with metadata without duplicate actors or redundant navigation", async () => {
    const store = useControllerStore(), committed = {
      ...transaction("committed"), submitted_at: timestamp, committed_at: timestamp,
      committed_revision: "2026.10.30.1",
      actor: "operator", committed_by: "operator", description: "Update the office route", restored_from_revision: "2026.10.29.1",
    };
    vi.spyOn(store, "readTransaction").mockResolvedValue(committed);
    const wrapper = mount(TransactionDetailView, { props: { id: committed.id }, global: { stubs: { ...global.stubs, ConfigDiff: true } } });
    try {
      await flushPromises();
      const metadata = Object.fromEntries(wrapper.findAll(".record-metadata dt").map(label => [label.text(), label.element.nextElementSibling?.textContent?.trim()]));
      expect(metadata).toMatchObject({
        Status: "committed", "Base revision": "2026.10.29.1", "Result revision": "2026.10.30.1", Actor: "operator",
        "Submitted (UTC)": formatted, "Committed (UTC)": formatted, Comment: committed.description, "Restored from": "2026.10.29.1",
      });
      expect(wrapper.text().split("operator")).toHaveLength(2);
      expect(wrapper.text()).not.toContain("Commit details"); expect(wrapper.text()).not.toContain("All commits");
      expect(wrapper.findComponent(TransactionActions).exists()).toBe(false);
      expect(wrapper.text()).not.toContain(timestamp);
      expect(committed.committed_at).toBe(timestamp);
    } finally { wrapper.unmount(); }
  });
  it.each(["pending_confirmation", "recovery_failed"])("retains necessary lifecycle actions for %s without a self-link", async status => {
    const record = transaction(status);
    vi.spyOn(useControllerStore(), "readTransaction").mockResolvedValue(record);
    const wrapper = mount(TransactionDetailView, { props: { id: record.id }, global: { stubs: { ...global.stubs, ConfigDiff: true } } });
    try {
      await flushPromises();
      expect(wrapper.getComponent(TransactionActions).props("showDetails")).toBe(false);
      expect(wrapper.text()).toContain(status === "pending_confirmation" ? "Confirm changes" : "Retry rollback");
      expect(wrapper.text()).not.toContain("Commit details");
    } finally { wrapper.unmount(); }
  });
  it("formats every expanded gateway-monitor timestamp to UTC seconds without changing samples", () => {
    const store = useControllerStore();
    const sample = {
      ...gatewayStatistics(),
      collected_at: timestamp,
      started_at: "2026-01-02T02:03:04.123456789Z",
      health_changed_at: "2026-01-02T03:04:05.999999999-07:00",
      last_success_at: "2026-01-02T04:05:06Z",
    };
    const original = structuredClone(sample);
    store.gatewayStatistics.data = { sample: statistics().sample, monitors: [sample] };
    const wrapper = mount(GatewayStatisticsPanel, { props: { name: sample.name }, global });
    const measurement = (name: string) => wrapper.findAll("dl > div").find(row => row.get("dt").text() === name)!.get("dd").text();
    expect(measurement("Measured (UTC)")).toBe(formatted);
    expect(measurement("Started (UTC)")).toBe("2026-01-02 02:03:04");
    expect(measurement("Health changed (UTC)")).toBe("2026-01-02 10:04:05");
    expect(measurement("Last success (UTC)")).toBe("2026-01-02 04:05:06");
    for (const value of [sample.collected_at, sample.started_at, sample.health_changed_at, sample.last_success_at]) {
      expect(wrapper.text()).not.toContain(value);
    }
    expect(store.gatewayStatistics.data.monitors[0]).toEqual(original);
    wrapper.unmount();
  });

  it("preserves unavailable timestamps in expanded gateway-monitor details", () => {
    const store = useControllerStore();
    const sample = { ...gatewayStatistics(), started_at: null, health_changed_at: null, last_success_at: null };
    store.gatewayStatistics.data = { sample: statistics().sample, monitors: [sample] };
    const wrapper = mount(GatewayStatisticsPanel, { props: { name: sample.name }, global });
    for (const name of ["Started (UTC)", "Health changed (UTC)", "Last success (UTC)"]) {
      const row = wrapper.findAll("dl > div").find(row => row.get("dt").text() === name)!;
      expect(row.get("dd").text()).toBe("Unavailable");
    }
    wrapper.unmount();
  });

  it("formats nested diagnostics and Unix-second leases without changing the source values", () => {
    const value = {
      sample: { collected_at: timestamp, started_at: null },
      leases: [{ acquired_at: 0, lifetime: 3600 }],
      counters: { rx_bytes: "18446744073709551615", tx_bytes: "0" },
    };
    const original = structuredClone(value);
    const wrapper = mount(JsonPanel, { props: { value } });
    expect(wrapper.text()).toContain("Sample / collected at (UTC)");
    expect(wrapper.text()).toContain(formatted);
    expect(wrapper.text()).toContain("Sample / started at");
    expect(wrapper.text()).toContain("Unavailable");
    expect(wrapper.text()).toContain("Leases 1 / acquired at (UTC)");
    expect(wrapper.text()).toContain("1970-01-01 00:00:00");
    expect(wrapper.text()).toContain("3600");
    expect(wrapper.text()).toContain("18446744073709551615");
    expect(value).toEqual(original);
    expect(wrapper.text()).not.toContain(timestamp);
  });

  it("formats stale-data tooltips in UTC", () => {
    const store = useControllerStore();
    store.state.stale = true; store.state.lastSuccess = Date.parse(timestamp);
    const wrapper = mount(DatasetStatus, { props: { query: store.state, label: "State" }, global });
    expect(wrapper.get("p").attributes("title")).toBe(`Last read ${formatted} UTC`);
  });

  it("formats timestamp arrays while preserving ordinary strings and numbers", () => {
    const wrapper = mount(JsonPanel, { props: { value: { readings: [timestamp, "unchanged", 123] } } });
    expect(wrapper.get("dd").text()).toBe(`${formatted} UTC, unchanged, 123`);
  });

  it("formats relay start tooltips", () => {
    const wrapper = mount(RelayStatus, { props: { status: {
      interface: "lab0", state: "running", pid: 12, started_at: timestamp,
    } } });
    expect(wrapper.get("span").attributes("title")).toBe(`PID 12 · Started ${formatted} UTC`);
  });

  it("keeps the original deadline and countdown precision while formatting its label", () => {
    vi.useFakeTimers(); vi.setSystemTime(Date.parse(timestamp) - 1501);
    const pending = transaction(); pending.confirmation_deadline = timestamp;
    const wrapper = mount(TransactionActions, { props: { transaction: pending }, global });
    expect(wrapper.get("time").text()).toBe(formatted);
    expect(wrapper.get("time").attributes("datetime")).toBe(timestamp);
    expect(wrapper.get("time").attributes("title")).toBe(`${formatted} UTC`);
    expect(wrapper.text()).toContain("2s remaining");
    wrapper.unmount();
  });

  it("formats history timestamps and preserves missing-value placeholders", () => {
    const store = useControllerStore();
    vi.spyOn(store, "refreshRevisions").mockResolvedValue();
    store.revisions.data = [{
      revision: "2026.10.29.2", current: true, submitted_at: timestamp, committed_at: null,
    }];
    const wrapper = mount(HistoryView, { global });
    expect(wrapper.text()).toContain("Submitted (UTC)");
    expect(wrapper.text()).toContain("Committed (UTC)");
    expect(wrapper.get("tbody").text()).toContain(formatted);
    expect(wrapper.get("tbody").text()).toContain("—");
    expect(wrapper.text()).not.toContain(timestamp);
  });

  it("keeps the full commit hash on one line in push requests", () => {
    const store = useControllerStore();
    const hash = "0123456789abcdef0123456789abcdef01234567";
    vi.spyOn(store, "refreshRevisions").mockResolvedValue();
    store.revisions.data = [{
      revision: "2026.10.29.2", transaction_id: hash,
    }];
    const wrapper = mount(HistoryView, { global });
    const link = wrapper.get(`tbody [to="/config/commits/${hash}"]`);
    expect(link.text()).toBe(hash);
    expect(link.classes()).toContain("text-no-wrap");
  });

  it("formats commit listings without rewriting their API timestamps", () => {
    const store = useControllerStore(), pending = transaction();
    pending.submitted_at = timestamp; pending.confirmation_deadline = timestamp;
    vi.spyOn(store, "refreshTransactions").mockResolvedValue();
    store.transactions.data = { [pending.id]: pending };
    const wrapper = mount(TransactionsView, { global });
    expect(wrapper.text()).toContain("Deadline (UTC)");
    expect(wrapper.get("tbody").text().split(formatted)).toHaveLength(3);
    expect(wrapper.text()).not.toContain(timestamp);
    expect(store.transactions.data[pending.id]!.confirmation_deadline).toBe(timestamp);
  });
});
