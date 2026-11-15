import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RouteTableView from "@/views/RouteTableView.vue";
import { getRouteTable, type RouteTable } from "@/services/routeTable";
import { useControllerStore } from "@/stores/controller";
import { cloneConfig } from "@/services/configuration";
import { kernelRoute, kernelTable } from "../routeTableFixtures";
import { state } from "../fixtures";

vi.mock("@/services/routeTable", async original => ({
  ...await original<typeof import("@/services/routeTable")>(), getRouteTable: vi.fn(),
}));
const stubs = {
  VBtn: { props: ["disabled", "loading", "icon"], template: '<button :disabled="disabled"><slot /></button>' },
  VChip: { props: ["color", "tag"], template: '<component :is="tag || \'span\'" :data-color="color"><slot /></component>' },
  VAlert: { template: '<div role="alert"><slot /></div>' },
  VIcon: true,
  VSelect: { props: ["modelValue", "items", "label"], template: '<select :aria-label="label" />' },
  VTextField: {
    props: ["modelValue"], emits: ["update:modelValue"],
    template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
};
let wrapper: ReturnType<typeof mount> | undefined;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.resetAllMocks(); setActivePinia(createPinia());
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const store = useControllerStore(); store.connected = true; store.state.data = state();
  vi.mocked(getRouteTable).mockResolvedValue(kernelTable());
});
afterEach(() => {
  wrapper?.unmount(); wrapper = undefined; useControllerStore().$dispose();
  vi.useRealTimers(); vi.restoreAllMocks();
});
async function render() {
  wrapper = mount(RouteTableView, { global: { stubs } }); await flushPromises();
}

describe("Routing table", () => {
  it.each(["success", "failure"])("keeps initial pending data neutral until %s", async outcome => {
    let resolve!: (value: RouteTable) => void, reject!: (error: Error) => void;
    vi.mocked(getRouteTable).mockImplementationOnce(() => new Promise((done, fail) => { resolve = done; reject = fail; }));
    await render();
    expect(wrapper!.text()).toContain("Loading routing table...");
    expect(wrapper!.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper!.text()).not.toContain("No main-table routes");
    if (outcome === "success") resolve(kernelTable()); else reject(new Error("HTTP 503: native route table unsupported"));
    await flushPromises();
    expect(wrapper!.text()).not.toContain("Loading routing table...");
    if (outcome === "success") expect(wrapper!.findAll(".route-row")).toHaveLength(1);
    else {
      expect(wrapper!.get('[role="alert"]').text()).toContain("HTTP 503");
      expect(wrapper!.text()).not.toContain("No main-table routes");
    }
  });
  it("keeps null metrics distinct from zero and exposes unknown IDs and missing link indices without expandable rows", async () => {
    const attribute = { kind: 999, value_hex: "0102", nested: true, network_byte_order: true };
    vi.mocked(getRouteTable).mockResolvedValue(kernelTable([
      kernelRoute(),
      kernelRoute({
        destination: "198.51.100.0/24", protocol: 242, type: 245, metric: 0,
        gateway: null, interface: null, interface_index: null, flags: 0x80000000,
        next_hops: [{ interface_index: 99, interface: null, gateway: "192.0.2.2", weight: 256, flags: 128, attributes: [attribute] }],
        attributes: [attribute, { ...attribute, value_hex: "03" }],
      }),
    ]));
    await render();
    expect(wrapper!.findAll(".metric-cell").map(cell => cell.text())).toEqual(["Not specified", "0"]);
    expect(wrapper!.findAll("thead th").map(header => header.text())).not.toContain("Protocol");
    expect(wrapper!.get("tbody").text()).not.toContain("Protocol 242");
    expect(wrapper!.text()).toContain("Type 245");
    expect(wrapper!.text()).toContain("Index 99");
    expect(wrapper!.find(".route-row button").exists()).toBe(false);
    expect(wrapper!.find("details, .expanded-row, pre").exists()).toBe(false);
  });
  it("excludes local and custom tables from rows, counts and filter choices", async () => {
    vi.mocked(getRouteTable).mockResolvedValue(kernelTable([
      kernelRoute(),
      kernelRoute({ table: 255, protocol: 2, interface: "lo", interface_index: 1, destination: "127.0.0.1/32" }),
      kernelRoute({ table: 4000000000, protocol: 186, interface: "tunnel0", interface_index: 99 }),
    ]));
    await render();
    expect(wrapper!.findAll(".route-row")).toHaveLength(1);
    expect(wrapper!.findAll(".family-count").map(count => count.text())).toEqual(["1", "1", "0"]);
    const filters = wrapper!.findAllComponents(stubs.VSelect);
    expect(filters.map(filter => filter.props("label"))).not.toContain("Table");
    expect(filters.find(filter => filter.props("label") === "Protocol")!.props("items")).toEqual([{ value: 4, title: "Static (4)" }]);
    expect(filters.find(filter => filter.props("label") === "Interface")!.props("items")).toEqual([{ value: "index:2", title: "WAN0 (#2)" }]);
    await wrapper!.get("input").setValue("tunnel0");
    expect(wrapper!.findAll(".route-row")).toHaveLength(0);
  });
  it("filters and sorts locally without re-reading the backend", async () => {
    vi.mocked(getRouteTable).mockResolvedValue(kernelTable([
      kernelRoute({ metric: 0 }),
      kernelRoute({ family: "ipv6", destination: "::/0", source_prefix: "::/0", protocol: 186, metric: 20 }),
    ]));
    await render();
    const metric = wrapper!.findAll(".sort-header").find(button => button.text() === "Metric")!;
    await metric.trigger("click"); await metric.trigger("click");
    expect(wrapper!.findAll(".metric-cell").map(cell => cell.text())).toEqual(["20", "0"]);
    await wrapper!.get("input").setValue("BGP");
    expect(wrapper!.findAll(".route-row")).toHaveLength(1);
    expect(wrapper!.get(".route-row").text()).toContain("::/0");
    await wrapper!.findAll(".family-filters button")[1]!.trigger("click");
    expect(wrapper!.text()).toContain("No routes match these filters.");
    await wrapper!.get(".empty-routes button").trigger("click");
    expect(wrapper!.findAll(".route-row")).toHaveLength(2);
    expect(getRouteTable).toHaveBeenCalledOnce();
  });
  it("formats millisecond input in the saved timezone, preserving machine precision and ignoring draft timezone", async () => {
    const store = useControllerStore(), saved = state();
    saved.desired.system = { hostname: "", domain: "", timezone: "Asia/Tokyo" };
    store.state.data = saved;
    await render();
    expect(wrapper!.text()).toContain("Observed (Asia/Tokyo):");
    expect(wrapper!.get("time").text()).toBe("2026-11-14 09:25:10");
    expect(wrapper!.get("time").attributes("datetime")).toBe("2026-11-14T00:25:10.987Z");
    store.draft = cloneConfig(saved.desired); store.draft.system!.timezone = "America/New_York";
    await flushPromises();
    expect(wrapper!.get("time").text()).toBe("2026-11-14 09:25:10");
  });
  it("retains clearly stale routes after a failed refresh rather than presenting an empty success", async () => {
    await render();
    vi.mocked(getRouteTable).mockRejectedValueOnce(new Error("HTTP 503: netlink timeout"));
    await wrapper!.get(".live-routes-header button").trigger("click"); await flushPromises();
    expect(wrapper!.get('[role="alert"]').text()).toContain("netlink timeout");
    expect(wrapper!.text()).toContain("Stale: last-known routes retained");
    expect(wrapper!.findAll(".route-row")).toHaveLength(1);
    expect(wrapper!.text()).not.toContain("No main-table routes");
  });
});
