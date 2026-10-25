import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JsonPanel from "@/components/base/JsonPanel.vue";
import DatasetStatus from "@/components/base/DatasetStatus.vue";
import RelayStatus from "@/components/feature/RelayStatus.vue";
import TransactionActions from "@/components/feature/TransactionActions.vue";
import HistoryView from "@/views/HistoryView.vue";
import TransactionsView from "@/views/TransactionsView.vue";
import { useControllerStore } from "@/stores/controller";
import { transaction } from "../fixtures";

const timestamp = "2026-01-02T03:04:05.987+02:00";
const formatted = "2026-01-02 01:04:05";
const box = { template: "<div><slot /></div>" };
const global = { stubs: {
  VTable: box, VAlert: box, VBtn: box, RouterLink: box,
  VDialog: { template: "<div />" }, VProgressLinear: true,
} };

beforeEach(() => { setActivePinia(createPinia()); });
afterEach(() => { vi.useRealTimers(); });

describe("human-facing timestamp displays", () => {
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
      revision: "1", current: true, submitted_at: timestamp, committed_at: null,
    }];
    const wrapper = mount(HistoryView, { global });
    expect(wrapper.text()).toContain("Submitted (UTC)");
    expect(wrapper.text()).toContain("Committed (UTC)");
    expect(wrapper.get("tbody").text()).toContain(formatted);
    expect(wrapper.get("tbody").text()).toContain("—");
    expect(wrapper.text()).not.toContain(timestamp);
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
