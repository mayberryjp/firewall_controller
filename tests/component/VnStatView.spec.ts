import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import VnStatView from "@/views/VnStatView.vue";
import { useControllerStore } from "@/stores/controller";
import * as api from "@/services/netcontrol";
import { ApiFailure } from "@/services/api";
import { state, vnstatReporting } from "../fixtures";

const stubs = {
  VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
  VTable: { template: "<table><slot /></table>" }, VProgressLinear: true, VTextField: true, VSwitch: true,
};
let wrapper: ReturnType<typeof mount>;
beforeEach(() => {
  setActivePinia(createPinia());
  const store = useControllerStore();
  store.connected = true; store.state.data = state(); store.state.stale = false; store.state.lastSuccess = Date.now();
  store.state.data.desired.vnstat = { enabled: true, collector: "192.0.2.10:9999" };
  vi.spyOn(api, "getVnStatReporting").mockResolvedValue(vnstatReporting());
});
afterEach(() => { wrapper?.unmount(); useControllerStore().$dispose(); vi.restoreAllMocks(); });
describe("vnStat daily reporting", () => {
  it("shows the appliance-local attempt date and exact socket counters without implying delivery", async () => {
    wrapper = mount(VnStatView, { global: { stubs } }); await flushPromises();
    expect(wrapper.findAll("th").map(item => item.text())).toEqual(["Collector", "Enabled", "Last report", "Sent", "Failed", "Actions"]);
    const row = wrapper.get("tbody tr");
    expect(row.text()).toContain("192.0.2.10:9999");
    expect(row.findAll(".report-value").map(item => item.text())).toEqual(["2026-10-29", "18446744073709551615", "0"]);
    expect(row.findAll("td")[2]!.attributes("title")).toContain("Appliance-local attempt date");
    expect(row.findAll("td")[3]!.attributes("title")).toContain("UDP delivery is not confirmed");
    expect(wrapper.findAll("h2, dl, section section")).toHaveLength(0);
    expect(wrapper.text()).not.toContain("2026-10-29 00:00:00");
    expect(useControllerStore().draft).toBeNull();
  });
  it("shows an advanced attempt date alongside failed sends as a non-blocking warning", async () => {
    vi.mocked(api.getVnStatReporting).mockResolvedValue({
      ...vnstatReporting(), last_report_date: "2026-10-30", failed_datagrams: "7", last_report_error: "Collector route unavailable",
    });
    wrapper = mount(VnStatView, { global: { stubs } }); await flushPromises();
    expect(wrapper.findAll(".report-value").map(item => item.text())).toEqual(["2026-10-30", "18446744073709551615", "7"]);
    expect(wrapper.get('[role="status"]').text()).toBe("Collector route unavailable");
    expect(wrapper.get('[aria-label="Edit collector"]').attributes("disabled")).toBeUndefined();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });
  it("distinguishes no recorded attempt and genuine zero counters from unavailable statistics", async () => {
    vi.mocked(api.getVnStatReporting).mockResolvedValue({ ...vnstatReporting(), last_report_date: null, sent_datagrams: "0" });
    wrapper = mount(VnStatView, { global: { stubs } }); await flushPromises();
    expect(wrapper.findAll(".report-value").map(item => item.text())).toEqual(["No attempt recorded", "0", "0"]);
  });
  it("surfaces read failures without fabricating dates or counts or blocking collector edits", async () => {
    vi.mocked(api.getVnStatReporting).mockRejectedValue(new ApiFailure("Native accounting unavailable", 503));
    wrapper = mount(VnStatView, { global: { stubs } }); await flushPromises();
    expect(wrapper.findAll(".report-value").map(item => item.text())).toEqual(["Unavailable", "Unavailable", "Unavailable"]);
    expect(wrapper.text()).toContain("Native accounting unavailable"); expect(wrapper.text()).not.toContain("No attempt recorded");
    expect(wrapper.get('[aria-label="Edit collector"]').attributes("disabled")).toBeUndefined();
  });
  it("labels previously loaded reporting data when a later read fails", async () => {
    wrapper = mount(VnStatView, { global: { stubs } }); await flushPromises();
    vi.mocked(api.getVnStatReporting).mockRejectedValue(new ApiFailure("Connection lost", 503));
    await useControllerStore().refreshVnStatReporting(); await flushPromises();
    expect(wrapper.text()).toContain("Showing previously loaded data");
    expect(wrapper.findAll(".report-value")[0]!.text()).toBe("2026-10-29");
  });
  it("keeps the empty state inside the table instead of adding a reporting panel", async () => {
    useControllerStore().state.data!.desired.vnstat = { enabled: false, collector: null };
    wrapper = mount(VnStatView, { global: { stubs } }); await flushPromises();
    expect(wrapper.get("tbody td").attributes("colspan")).toBe("6");
    expect(wrapper.get("tbody td").text()).toBe("No collectors.");
    expect(wrapper.findAll(".report-value, h2, dl")).toHaveLength(0);
  });
});
