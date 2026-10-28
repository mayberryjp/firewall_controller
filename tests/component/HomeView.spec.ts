import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ConnectView from "@/views/ConnectView.vue";
import HomeView from "@/views/HomeView.vue";
import OverviewSystem from "@/components/feature/OverviewSystem.vue";
import FieldInput from "@/components/base/FieldInput.vue";
import { useControllerStore } from "@/stores/controller";
import * as registry from "@/services/registry";
import * as api from "@/services/netcontrol";
import { state, runtime, statistics, monitor, gatewayStatistics, healthSnapshot } from "../fixtures";
import { navigationSections } from "@/constants/navigation";
import { defaultOverviewLayout, type OverviewLayout } from "@/services/overviewLayout";
vi.mock("vue-router", () => ({ useRouter: () => ({ replace: vi.fn() }), useRoute: () => ({ query: {} }) }));
beforeEach(() => {
  setActivePinia(createPinia());
  vi.spyOn(registry, "restoreRegistrySession").mockResolvedValue(false);
});
describe("connection and editor contracts", () => {
  it("shows the registry sign-in form without architecture boilerplate", () => {
    const wrapper = mount(ConnectView, { global: {
      stubs: { VAlert: true, VCard: { template: "<div><slot /></div>" }, VForm: { template: "<form><slot /></form>" }, VTextField: true, VBtn: true },
    } });
    expect(wrapper.get("h1").text()).toBe("Connect to a firewall");
    expect(wrapper.find("form").exists()).toBe(true);
    expect(wrapper.find("v-text-field-stub").attributes("label")).toBe("Registry admin password");
    expect(wrapper.text()).not.toContain("Device records and encrypted firewall keys");
    expect(useControllerStore().connected).toBe(false);
  });
  it("shows and hides the registry password without changing its value", async () => {
    const wrapper = mount(ConnectView, { global: {
      stubs: {
        VAlert: true,
        VCard: { template: "<div><slot /></div>" },
        VForm: { template: "<form><slot /></form>" },
        VTextField: {
          props: ["modelValue", "type"],
          emits: ["update:modelValue"],
          template: '<div><input :type="type" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" /><slot name="append-inner" /></div>',
        },
        VBtn: { template: "<button><slot /></button>" },
      },
    } });
    const input = wrapper.get("input");
    await input.setValue("test-password");
    expect(input.attributes("type")).toBe("password");
    await wrapper.get('button[aria-label="Show password"]').trigger("click");
    expect(input.attributes("type")).toBe("text");
    expect(input.element.value).toBe("test-password");
    await wrapper.get('button[aria-label="Hide password"]').trigger("click");
    expect(input.attributes("type")).toBe("password");
    expect(input.element.value).toBe("test-password");
  });
  it("splits address lines into separate values without rewriting host bits", async () => {
    const wrapper = mount(FieldInput, {
      props: { field: { key: "addresses", label: "Addresses", kind: "lines" }, modelValue: [], path: "editor.addresses" },
      global: { stubs: { VTextarea: { props: ["modelValue"], emits: ["update:modelValue"], template: '<textarea @input="$emit(\'update:modelValue\', $event.target.value)" />' } } },
    });
    await wrapper.get("textarea").setValue("192.0.2.10/24\n2001:db8::10/64");
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([["192.0.2.10/24", "2001:db8::10/64"]]);
  });
});

describe("compact overview dashboard", () => {
  beforeEach(() => {
    const store = useControllerStore();
    vi.spyOn(registry, "getOverviewLayout").mockResolvedValue(defaultOverviewLayout());
    vi.spyOn(registry, "saveOverviewLayout").mockImplementation(async layout => layout);
    vi.spyOn(api, "getDiscoveredInterfaces").mockResolvedValue([]);
    store.state.data = state(); store.state.stale = false;
    store.statistics.data = statistics(); store.statistics.stale = false;
    store.gatewayStatistics.data = { sample: statistics().sample, monitors: [] }; store.gatewayStatistics.stale = false;
    vi.spyOn(store, "refreshStatistics").mockResolvedValue();
    vi.spyOn(store, "refreshGatewayStatistics").mockResolvedValue();
    vi.spyOn(store, "refreshHostHealth").mockResolvedValue();
  });
  function dashboard() {
    return mount(HomeView, { global: { stubs: {
      VCard: { props: ["tag"], template: '<component :is="tag || \'div\'"><slot /></component>' },
      VTable: { template: "<div><table><slot /></table></div>" },
      VBtn: { template: "<a><slot /></a>" },
      VChip: { props: ["color", "size", "variant"], template: '<span class="status-chip" :data-color="color"><slot /></span>' },
      RouterLink: { props: ["to"], template: '<a :href="to"><slot /></a>' },
    } } });
  }
  function button(wrapper: ReturnType<typeof dashboard>, text: string) {
    return wrapper.findAll("a, button").find(item => (item.attributes("aria-label") || item.text()) === text)!;
  }
  it("uses an accessible pencil control without a visible page heading", async () => {
    const wrapper = dashboard();
    try {
      expect(button(wrapper, "Customize layout").attributes("disabled")).toBe("true");
      await flushPromises();
      expect(wrapper.find("h1").exists()).toBe(false);
      expect(wrapper.find('section[aria-label="Overview"]').exists()).toBe(true);
      const customize = button(wrapper, "Customize layout");
      expect(customize.text()).toBe("");
      expect(customize.attributes("icon")).toBe("mdi-pencil-outline");
      expect(customize.attributes("title")).toBe("Customize layout");
      expect(customize.attributes("disabled")).toBe("false");
      await customize.trigger("click");
      expect(button(wrapper, "Save layout").exists()).toBe(true);
      expect(button(wrapper, "Cancel").exists()).toBe(true);
    } finally { wrapper.unmount(); }
  });
  it("loads the registry layout and saves moved and hidden boxes without staging firewall changes", async () => {
    const saved: OverviewLayout = { version: 1, columns: [["system", "interfaces"], ["gateways"]] };
    vi.mocked(registry.getOverviewLayout).mockResolvedValue(saved);
    const store = useControllerStore(), before = JSON.stringify(store.draft), wrapper = dashboard();
    try {
      await flushPromises();
      expect(wrapper.findAll("[data-widget]").map(box => box.attributes("data-widget"))).toEqual(["system", "interfaces", "gateways"]);
      await button(wrapper, "Customize layout").trigger("click");
      await wrapper.get('[aria-label="Move Interfaces up"]').trigger("click");
      await wrapper.get('[aria-label="Move Interfaces to right column"]').trigger("click");
      await wrapper.get('[aria-label="Hide Gateways"]').trigger("click");
      await button(wrapper, "Show WireGuard").trigger("click");
      expect(registry.saveOverviewLayout).not.toHaveBeenCalled();
      await button(wrapper, "Save layout").trigger("click"); await flushPromises();
      expect(registry.saveOverviewLayout).toHaveBeenCalledWith({ version: 1, columns: [["system", "wireguard"], ["interfaces"]] });
      expect(wrapper.text()).toContain("Overview layout saved to the registry.");
      expect(JSON.stringify(store.draft)).toBe(before);
    } finally { wrapper.unmount(); }
  });
  it("cancels unsaved edits, restores defaults, and allows every box to be hidden and restored", async () => {
    const wrapper = dashboard();
    try {
      await flushPromises(); await button(wrapper, "Customize layout").trigger("click");
      await wrapper.get('[aria-label="Hide Interfaces"]').trigger("click");
      await button(wrapper, "Cancel").trigger("click");
      expect(wrapper.find('[data-widget="interfaces"]').exists()).toBe(true);
      expect(registry.saveOverviewLayout).not.toHaveBeenCalled();
      await button(wrapper, "Customize layout").trigger("click");
      for (const id of ["Interfaces", "Gateways", "WireGuard", "System stats", "Interface counters"]) {
        await wrapper.get(`[aria-label="Hide ${id}"]`).trigger("click");
      }
      expect(wrapper.findAll("[data-widget]")).toHaveLength(0);
      expect(wrapper.text()).toContain("All overview boxes are hidden.");
      await button(wrapper, "Show System stats").trigger("click");
      expect(wrapper.findAll("[data-widget]")).toHaveLength(1);
      await button(wrapper, "Reset layout").trigger("click");
      expect(wrapper.findAll("[data-widget]")).toHaveLength(5);
    } finally { wrapper.unmount(); }
  });
  it("surfaces load and save failures and keeps failed saves editable for retry", async () => {
    vi.mocked(registry.getOverviewLayout).mockRejectedValueOnce(new Error("Registry offline"));
    const wrapper = dashboard();
    try {
      await flushPromises();
      expect(wrapper.text()).toContain("Could not load the shared overview layout. Registry offline");
      expect(button(wrapper, "Customize layout").attributes("disabled")).toBeDefined();
      await button(wrapper, "Retry layout").trigger("click"); await flushPromises();
      await button(wrapper, "Customize layout").trigger("click");
      await wrapper.get('[aria-label="Hide Interfaces"]').trigger("click");
      vi.mocked(registry.saveOverviewLayout).mockRejectedValueOnce(new Error("Storage unavailable"));
      await button(wrapper, "Save layout").trigger("click"); await flushPromises();
      expect(wrapper.text()).toContain("Could not save the overview layout.");
      expect(wrapper.find('[data-widget="interfaces"]').exists()).toBe(false);
      expect(wrapper.find('[aria-label="Hide Gateways"]').exists()).toBe(true);
      await button(wrapper, "Save layout").trigger("click"); await flushPromises();
      expect(wrapper.text()).toContain("Overview layout saved to the registry.");
    } finally { wrapper.unmount(); }
  });
  it("renders compact system stats with exact capacity percentages and a two-sample CPU rate", async () => {
    const store = useControllerStore(); store.hostHealth.data = healthSnapshot(); store.hostHealth.stale = false;
    const wrapper = dashboard(), system = wrapper.getComponent(OverviewSystem);
    const row = (name: string) => system.findAll("tbody tr").find(item => item.get("th").text() === name)!;
    expect(row("CPU usage").text()).toContain("Collecting");
    expect(row("Memory").text()).toContain("6 GB / 8 GB");
    expect(row("Memory").get(".status-chip").attributes("data-color")).toBe("warning");
    expect(row("Root filesystem").get(".status-chip").attributes("data-color")).toBe("error");
    expect(row("Root filesystem").attributes("title")).toContain("8 GB available");
    expect(row("Fan").text()).toContain("0 RPM");
    expect(row("Temperature (highest)").text()).toContain("48.13");
    expect(row("Temperature (highest)").find(".status-chip").exists()).toBe(false);
    expect(system.get(".widget-note").attributes("title")).toBe("host | Collected (UTC): 2026-10-24 12:01:40");
    store.hostHealth.data = healthSnapshot("9007199254741018", "9007199254741068", 103); await flushPromises();
    expect(row("CPU usage").get(".status-chip").text()).toBe("25 %");
    expect(row("CPU usage").get(".status-chip").attributes("data-color")).toBe("success");
    wrapper.unmount();
  });
  it("keeps stale system readings neutral and resets CPU rates without inventing absent sensors", async () => {
    const store = useControllerStore(); store.hostHealth.data = healthSnapshot(); store.hostHealth.stale = false;
    const wrapper = dashboard(), system = wrapper.getComponent(OverviewSystem);
    store.hostHealth.error = "Host health unavailable"; store.hostHealth.stale = true; await flushPromises();
    expect(system.get(".widget-note").text()).toBe("Stale");
    expect(system.text()).toContain("6 GB / 8 GB");
    expect(system.findAll(".status-chip").every(chip => chip.attributes("data-color") === "default")).toBe(true);
    const next = healthSnapshot("9007199254741018", "9007199254741068", 103);
    next.sections.thermal.data = []; next.sections.hwmon.data = [];
    store.hostHealth.error = null; store.hostHealth.data = next; store.hostHealth.stale = false; await flushPromises();
    expect(system.findAll("tbody tr").find(item => item.text().includes("CPU usage"))!.text()).toContain("Collecting");
    expect(system.findAll("tbody tr").find(item => item.text().includes("Temperature"))!.text()).toContain("Unavailable");
    expect(system.findAll("tbody tr").find(item => item.text().startsWith("Fan"))!.text()).toContain("Unavailable");
    wrapper.unmount();
  });
  it("omits the redundant host label for available system stats", async () => {
    const store = useControllerStore(), sample = healthSnapshot();
    sample.sample.status = "available";
    store.hostHealth.data = sample; store.hostHealth.stale = false;
    const wrapper = dashboard(), system = wrapper.getComponent(OverviewSystem);
    try {
      expect(system.find(".widget-note").exists()).toBe(false);
      store.hostHealth.stale = true; await flushPromises();
      expect(system.get(".widget-note").text()).toBe("Stale");
    } finally { wrapper.unmount(); }
  });
  it("shows the five compact widgets, preserves exact counters, and subscribes to live reads", () => {
    const store = useControllerStore(), wrapper = dashboard();
    expect(wrapper.findAll("h2").map(heading => heading.text())).toEqual(["Interfaces", "Gateways", "WireGuard", "System stats", "Interface counters"]);
    expect(wrapper.text()).toContain("18.45 EB");
    expect(wrapper.find('[title="18446744073709551615"]').exists()).toBe(true);
    expect(wrapper.text()).not.toMatch(/Recent transactions|Recent committed revisions|Expected live versus observed|Isolated lab control plane/);
    expect(store.refreshStatistics).toHaveBeenCalledOnce(); expect(store.refreshGatewayStatistics).toHaveBeenCalledOnce();
    expect(store.refreshHostHealth).not.toHaveBeenCalled();
    expect(store.gatewayMonitoring).toBe(true);
    wrapper.unmount(); expect(store.gatewayMonitoring).toBe(false);
  });
  it("does not report simulated interfaces as live links", () => {
    const wrapper = dashboard().get('[aria-label="Interfaces"]');
    expect(wrapper.text()).toContain("Simulated");
    expect(wrapper.text()).not.toContain("Up");
  });
  it.each([
    { oper: "UP", status: "Up", color: "success" },
    { oper: "DOWN", status: "Down", color: "error" },
    { oper: "UNKNOWN", status: "-", color: "default" },
  ])("separates admin Up from an operational $status interface", ({ oper, status, color }) => {
    const store = useControllerStore();
    store.statistics.data!.sample.status = "available";
    Object.assign(store.statistics.data!.interfaces[0]!, { status: "available", oper_state: oper });
    const wrapper = dashboard();
    try {
      const chips = wrapper.findAll('[aria-label="Interfaces"] .status-chip');
      expect(chips[0]!.text()).toBe("Up"); expect(chips[0]!.attributes("data-color")).toBe("success");
      expect(chips[1]!.text()).toBe(status); expect(chips[1]!.attributes("data-color")).toBe(color);
    } finally { wrapper.unmount(); }
  });
  it("shows discovered active addresses and DHCP/static mode instead of MTU without substituting configured addresses", async () => {
    const store = useControllerStore(), base = store.state.data!.desired.interfaces[0]!;
    store.state.data!.desired.interfaces.push({ ...base, name: "wan0" });
    store.state.data!.desired.dhcp_clients = { wan0: { client_id: "", hostname: "", route_metric: 0, use_mtu: false, use_domains: "no" } };
    vi.mocked(api.getDiscoveredInterfaces).mockResolvedValue([
      { name: "lab0", kind: "dummy", index: 1, mac: null, mtu: 1500, up: true, ownership: "managed", addresses: ["192.0.2.99/24"] },
      { name: "wan0", kind: "ethernet", index: 2, mac: null, mtu: 1500, up: true, ownership: "managed", addresses: ["198.51.100.20/24"] },
      { name: "eth9", kind: "ethernet", index: 3, mac: null, mtu: 1500, up: true, ownership: "unmanaged", addresses: [] },
    ]);
    const wrapper = dashboard();
    try {
      await flushPromises();
      const widget = wrapper.get('[aria-label="Interfaces"]');
      expect(widget.findAll("thead th").map(cell => cell.text())).toEqual(["Name", "Admin state", "Operational state", "Active IP", "Mode"]);
      expect(widget.findAll("tbody tr").map(row => row.findAll("td").map(cell => cell.text()).slice(3))).toEqual([
        ["192.0.2.99/24", "Static"], ["198.51.100.20/24", "DHCP"], ["None", "-"],
      ]);
      expect(widget.text()).not.toContain("192.0.2.10");
      vi.mocked(api.getDiscoveredInterfaces).mockRejectedValueOnce(new Error("Discovery failed"));
      store.statistics.data = statistics(); await flushPromises();
      expect(widget.text()).toContain("198.51.100.20/24"); expect(widget.find('[title*="Discovery failed"]').exists()).toBe(true);
    } finally { wrapper.unmount(); }
  });
  it("lists one interface per counter row with counters in labeled columns", () => {
    const store = useControllerStore();
    store.statistics.data!.interfaces[0]!.counters = {
      rx_packets: "11", tx_packets: "12", rx_bytes: "18446744073709551615",
      tx_bytes: "14", rx_errors: "15", tx_errors: "16",
    };
    store.statistics.data!.interfaces.push({
      ...store.statistics.data!.interfaces[0]!, name: "eth1",
      counters: { rx_packets: "21", tx_packets: "22", rx_bytes: "23", tx_bytes: "24", rx_errors: "25", tx_errors: "26" },
    });
    const widget = dashboard().get('[aria-label="Interface counters"]');
    expect(widget.findAll("thead th").map(cell => cell.text())).toEqual([
      "Interface", "Packets in", "Packets out", "Bytes in", "Bytes out", "Errors in", "Errors out",
    ]);
    expect(widget.findAll("tbody tr").map(row => row.findAll("th, td").map(cell => cell.text()))).toEqual([
      ["lab0", "11", "12", "18.45 EB", "14 B", "15", "16"],
      ["eth1", "21", "22", "23 B", "24 B", "25", "26"],
    ]);
  });
  it.each([
    { bytes: "0", display: "0 B" },
    { bytes: "999", display: "999 B" },
    { bytes: "1000", display: "1 KB" },
    { bytes: "1234567", display: "1.23 MB" },
    { bytes: "1234567890", display: "1.23 GB" },
    { bytes: "1234567890000", display: "1.23 TB" },
  ])("formats $bytes bytes as $display and abbreviates packet counters", ({ bytes, display }) => {
    useControllerStore().statistics.data!.interfaces[0]!.counters = {
      rx_packets: "9007199254740993", tx_packets: "1234567", rx_bytes: bytes, tx_bytes: bytes,
    };
    const wrapper = dashboard();
    try {
      expect(wrapper.get('[aria-label="Interface counters"] tbody tr').findAll("td").map(cell => cell.text())).toEqual([
        "9007.20T", "1.23M", display, display, "Unavailable", "Unavailable",
      ]);
    } finally { wrapper.unmount(); }
  });
  it.each([
    ["0", "0"], ["99999", "99,999"], ["100000", "100.00K"],
    ["100005", "100.01K"], ["999994", "999.99K"], ["999995", "1.00M"],
    ["1000000", "1.00M"], ["1234567", "1.23M"], ["1000000000", "1.00B"],
    ["1000000000000", "1.00T"], ["9007199254740993", "9007.20T"],
  ])("formats packet count %s as %s with the exact total in its tooltip", (value, display) => {
    useControllerStore().statistics.data!.interfaces[0]!.counters = { rx_packets: value, tx_packets: value };
    const wrapper = dashboard();
    try {
      const cells = wrapper.get('[aria-label="Interface counters"] tbody tr').findAll("td");
      for (const cell of cells.slice(0, 2)) {
        expect(cell.text()).toBe(display);
        expect(cell.attributes("title")).toBe(value);
      }
    } finally { wrapper.unmount(); }
  });
  function packetSnapshot(rx: string, tx: string, seconds: number) {
    const sample = statistics();
    sample.sample = { ...sample.sample, scope: "host", status: "available", collected_at: new Date(Date.UTC(2026, 9, 25, 12, 0, seconds)).toISOString() };
    sample.interfaces[0] = { ...sample.interfaces[0]!, index: 1, status: "available", counters: { rx_packets: rx, tx_packets: tx } };
    return sample;
  }
  it("shows exact per-poll packet deltas independently for each interface and direction", async () => {
    const store = useControllerStore();
    store.statistics.data = packetSnapshot("9007199254740993", "100000", 0);
    const wrapper = dashboard(), widget = wrapper.get('[aria-label="Interface counters"]');
    try {
      expect(widget.find(".status-chip").exists()).toBe(false);
      const next = packetSnapshot("9007199254741043", "223456", 3);
      next.interfaces.push({ ...next.interfaces[0]!, name: "eth1", index: 2 });
      store.statistics.data = next; await flushPromises();
      expect(widget.findAll(".status-chip").map(chip => chip.text())).toEqual(["+50", "+123.46K"]);
      expect(widget.findAll(".status-chip").map(chip => chip.attributes("title"))).toEqual([
        "+50 packets since previous poll", "+123,456 packets since previous poll",
      ]);
      expect(widget.findAll("tbody tr")[1]!.find(".status-chip").exists()).toBe(false);
      const unchanged = packetSnapshot("9007199254741043", "223456", 6);
      store.statistics.data = unchanged; await flushPromises();
      expect(widget.findAll(".status-chip").map(chip => chip.text())).toEqual(["+0", "+0"]);
      store.statistics.data = packetSnapshot("10", "223506", 9); await flushPromises();
      expect(widget.findAll(".status-chip").map(chip => chip.text())).toEqual(["+50"]);
      store.statistics.data = packetSnapshot("60", "223556", 12); await flushPromises();
      expect(widget.findAll(".status-chip").map(chip => chip.text())).toEqual(["+50", "+50"]);
    } finally { wrapper.unmount(); }
  });
  it.each(["stale", "error", "simulated", "missing", "unavailable", "removed", "scope", "identity", "duplicate time", "time regression"])(
    "resets packet deltas after %s instead of showing misleading increments", async change => {
      const store = useControllerStore(); store.statistics.data = packetSnapshot("1000", "2000", 0);
      const wrapper = dashboard(), widget = wrapper.get('[aria-label="Interface counters"]');
      try {
        store.statistics.data = packetSnapshot("1050", "2050", 3); await flushPromises();
        expect(widget.findAll(".status-chip")).toHaveLength(2);
        const next = packetSnapshot("1100", "2100", 6);
        if (change === "stale") store.statistics.stale = true;
        if (change === "error") store.statistics.error = "Statistics failed";
        if (change === "simulated") next.sample.status = "simulated";
        if (change === "missing") next.interfaces[0]!.counters = null;
        if (change === "unavailable") next.interfaces[0]!.status = "unavailable";
        if (change === "removed") next.interfaces = [];
        if (change === "scope") next.sample.scope = "another-host";
        if (change === "identity") next.interfaces[0]!.index = 2;
        if (change === "duplicate time") next.sample.collected_at = store.statistics.data!.sample.collected_at;
        if (change === "time regression") next.sample.collected_at = packetSnapshot("0", "0", 1).sample.collected_at;
        store.statistics.data = next; await flushPromises();
        expect(widget.find(".status-chip").exists()).toBe(false);
        store.statistics.stale = false; store.statistics.error = null;
        store.statistics.data = packetSnapshot("1150", "2150", 9); await flushPromises();
        if (["stale", "error", "simulated", "missing", "unavailable", "removed", "scope", "identity"].includes(change)) {
          expect(widget.find(".status-chip").exists()).toBe(false);
        } else {
          expect(widget.findAll(".status-chip").map(chip => chip.text())).toEqual(["+50", "+50"]);
        }
      } finally { wrapper.unmount(); }
    },
  );
  it("links the interfaces widget header like gateways while leaving counters without navigation", () => {
    const wrapper = dashboard();
    const interfacesLink = wrapper.get('[aria-label="Interfaces"] header a');
    expect(interfacesLink.attributes("aria-label")).toBe("Open Interfaces");
    expect(interfacesLink.attributes("to")).toBe("/interfaces");
    expect(wrapper.get('[aria-label="Interface counters"] h2 a').attributes("href")).toBe("/diagnostics/traffic");
    expect(wrapper.get('[aria-label="Gateways"] header a').attributes("aria-label")).toBe("Open Gateways");
    expect(wrapper.get('[aria-label="WireGuard"] header a').attributes("aria-label")).toBe("Open WireGuard");
  });
  it("spans every counter column when no interface samples are available", () => {
    useControllerStore().statistics.data!.interfaces = [];
    const widget = dashboard().get('[aria-label="Interface counters"]');
    expect(widget.get("tbody td").text()).toBe("No interface counters available.");
    expect(widget.get("tbody td").attributes("colspan")).toBe("7");
  });
  it("has no adopted-parent navigation and renders overview interface names without links", () => {
    const store = useControllerStore(), base = store.state.data!.desired.interfaces[0]!;
    store.state.data!.desired.interfaces.push(
      { ...base, name: "vlan30", kind: "vlan", vlan: { parent: "lab0", id: 30 } },
      { ...base, name: "wg0", kind: "wireguard", wireguard: { key_ref: "key", listen_port: 51820, peers: [] } },
    );
    store.statistics.data!.interfaces.push({ ...store.statistics.data!.interfaces[0]!, name: "eth1", kind: "ethernet", ownership: "unmanaged" });
    const widget = dashboard().get('[aria-label="Interfaces"]');
    expect(widget.findAll("tbody tr td:first-child").map(cell => cell.text())).toEqual(["lab0", "eth1", "vlan30", "wg0"]);
    expect(widget.find("tbody a").exists()).toBe(false);
    expect(navigationSections.flatMap(section => section.pages).some(page => page.path === "/parents")).toBe(false);
  });
  it("shows only the four WireGuard metric columns and does not invent missing runtime metrics", () => {
    const store = useControllerStore();
    store.state.data!.desired.interfaces.push({
      name: "wg0", kind: "wireguard", role: "wan", mtu: 1420, up: true, addresses: [], dhcp_relay: { enabled: false, servers: [] },
      wireguard: { key_ref: "wg-key", listen_port: 51820, peers: [{ public_key: "peer-key", allowed_ips: ["10.0.0.0/24"], persistent_keepalive_seconds: 25 }] },
    });
    store.statistics.data!.sample.status = "available";
    store.statistics.data!.interfaces.push({ name: "wg0", kind: "wireguard", ownership: "managed", mtu: 1420, admin_up: true, oper_state: "UP", status: "available", counters: null });
    const widget = dashboard().get('[aria-label="WireGuard"]');
    expect(widget.text()).not.toContain("wg0"); expect(widget.text()).toContain("Unavailable");
    expect(widget.get("tbody td").text()).toBe("—");
    expect(widget.find("tbody a").exists()).toBe(false);
    expect(widget.findAll("th").map(cell => cell.text())).toEqual(["Peer", "Last handshake", "Received", "Sent"]);
    expect(widget.findAll("tbody td").map(cell => cell.text())).toEqual(["—", "Unavailable", "Unavailable", "Unavailable"]);
    expect(widget.text()).not.toMatch(/Active peers|Connected/);
  });
  it("does not present stale interface or gateway data as healthy", async () => {
    const store = useControllerStore();
    store.state.data!.desired.gateway_monitors = [monitor()];
    store.gatewayStatistics.data!.monitors = [gatewayStatistics()];
    const wrapper = dashboard();
    expect(wrapper.get('[aria-label="Gateways"]').text()).toContain("Online");
    expect(wrapper.get('[aria-label="Gateways"]').text()).toContain("1.25 ms");
    store.gatewayStatistics.stale = true;
    store.statistics.stale = true;
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[aria-label="Gateways"]').text()).toContain("Unknown");
    expect(wrapper.get('[aria-label="Gateways"]').text()).not.toContain("Online");
    for (const chip of wrapper.findAll('[aria-label="Gateways"] .status-chip')) expect(chip.attributes("data-color")).toBe("default");
    expect(wrapper.get('[aria-label="Interfaces"]').text()).toContain("Unknown");
    expect(wrapper.get('[aria-label="Interface counters"]').text()).toContain("Stale");
  });
  it("shows each enabled WireGuard peer's endpoint, handshake and exact transfer totals", async () => {
    const store = useControllerStore();
    const sampledAt = Date.parse("2026-10-28T04:00:00.987Z");
    const peer = { public_key: "enabled-peer-public-key", allowed_ips: ["10.0.0.0/24"], persistent_keepalive_seconds: 25 };
    store.state.data!.desired.interfaces.push({
      name: "wg0", kind: "wireguard", role: "wan", mtu: 1420, up: true, addresses: [], dhcp_relay: { enabled: false, servers: [] },
      wireguard: { key_ref: "wg-key", listen_port: 51820, peers: [
        peer, { ...peer, public_key: "disabled-peer", enabled: false }, { ...peer, public_key: "second-peer" },
      ] },
    });
    store.runtime.data = { ...runtime(), wireguard: [{ interface: "wg0", public_key: null, listen_port: 51820, peers: [
      { public_key: peer.public_key, endpoint: "192.0.2.1:51820", last_handshake_unix_seconds: Math.floor(sampledAt / 1000) - 25, rx_bytes: "18446744073709551615", tx_bytes: "2048" },
      { public_key: "disabled-peer", endpoint: "disabled-runtime:123", last_handshake_unix_seconds: 1, rx_bytes: "999", tx_bytes: "888" },
      { public_key: "second-peer", endpoint: null, last_handshake_unix_seconds: Math.floor(sampledAt / 1000) - 300, rx_bytes: "10", tx_bytes: "1000" },
    ] }] };
    store.runtime.lastSuccess = sampledAt; store.runtime.stale = false;
    const wrapper = dashboard();
    const widget = wrapper.get('[aria-label="WireGuard"]');
    const rows = widget.findAll("tbody tr");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.get("td").text()).toBe("192.0.2.1:51820");
    expect(rows[0]!.text()).toContain("25 seconds ago");
    expect(rows[0]!.text()).toContain("18.45 EB");
    expect(rows[0]!.text()).toContain("2.05 KB");
    expect(rows[0]!.find('[title="18446744073709551615"]').exists()).toBe(true);
    expect(rows[1]!.findAll("td").map(cell => cell.text())).toEqual(["—", "5 minutes ago", "10 B", "1 KB"]);
    expect(rows[1]!.get(".status-chip").attributes("data-color")).toBe("orange");
    expect(widget.text()).not.toContain("disabled-runtime");
    const chip = rows[0]!.get(".status-chip");
    expect(chip.attributes("data-color")).toBe("green");
    expect(chip.attributes("title")).toContain("Last handshake 2026-10-28 03:59:35 UTC");
    expect(chip.attributes("title")).not.toMatch(/\.987|T03:/);
    store.runtime.stale = true;
    await wrapper.vm.$nextTick();
    expect(widget.text()).toContain("Runtime stale");
    expect(chip.attributes("data-color")).toBe("default");
    store.runtime.error = "Unable to fetch runtime";
    await wrapper.vm.$nextTick();
    expect(widget.text()).toContain("Runtime unavailable");
    expect(widget.get(".widget-note").attributes("title")).toBe("Unable to fetch runtime");
    wrapper.unmount();
  });
  it("matches WireGuard peers by tunnel as well as key and distinguishes NEVER from missing data", () => {
    const store = useControllerStore();
    for (const name of ["wg0", "wg1"]) store.state.data!.desired.interfaces.push({
      name, kind: "wireguard", role: "wan", mtu: 1420, up: true, addresses: [], dhcp_relay: { enabled: false, servers: [] },
      wireguard: { key_ref: "wg-key", listen_port: 51820, peers: [{ public_key: "shared-peer-key", endpoint: "configured:51820", allowed_ips: [], persistent_keepalive_seconds: 0 }] },
    });
    store.runtime.data = { ...runtime(), wireguard: [{ interface: "wg0", public_key: null, listen_port: 51820, peers: [
      { public_key: "shared-peer-key", endpoint: "runtime:123", last_handshake_unix_seconds: 0, rx_bytes: "0", tx_bytes: "0" },
    ] }] };
    store.runtime.stale = false;
    const wrapper = dashboard();
    const rows = wrapper.get('[aria-label="WireGuard"]').findAll("tbody tr");
    const first = rows[0]!;
    expect(first.get("td").text()).toBe("configured:51820");
    expect(first.text()).toContain("0 B");
    expect(first.get(".status-chip").text()).toBe("NEVER");
    expect(first.get(".status-chip").attributes("data-color")).toBe("red");
    const second = rows[1]!;
    expect(second.text()).toContain("Unavailable");
    expect(second.text()).not.toContain("NEVER");
    wrapper.unmount();
  });
  it("keeps available peer metrics independent of missing peers and omits empty or disabled tunnels", () => {
    const store = useControllerStore();
    const peer = { public_key: "peer-key", allowed_ips: [], persistent_keepalive_seconds: 0 };
    for (const [name, peers] of [
      ["wg0", [peer, { ...peer, public_key: "missing-key" }]],
      ["wg1", [{ ...peer, enabled: false }]],
      ["wg2", []],
    ] as const) store.state.data!.desired.interfaces.push({
      name, kind: "wireguard", role: "wan", mtu: 1420, up: true, addresses: [], dhcp_relay: { enabled: false, servers: [] },
      wireguard: { key_ref: "wg-key", listen_port: 51820, peers: [...peers] },
    });
    store.runtime.data = { ...runtime(), wireguard: [{ interface: "wg0", public_key: null, listen_port: 51820, peers: [
      { public_key: peer.public_key, endpoint: null, last_handshake_unix_seconds: 1, rx_bytes: "1000", tx_bytes: "2000" },
    ] }] };
    const wrapper = dashboard();
    const rows = wrapper.get('[aria-label="WireGuard"]').findAll("tbody tr");
    expect(rows.map(row => row.findAll("td").map(cell => cell.text()))).toEqual([
      ["—", expect.any(String), "1 KB", "2 KB"],
      ["—", "Unavailable", "Unavailable", "Unavailable"],
    ]);
    wrapper.unmount();
  });
  it("shows an empty state when there are no enabled WireGuard peers", () => {
    const store = useControllerStore();
    store.state.data!.desired.interfaces.push({
      name: "wg0", kind: "wireguard", role: "wan", mtu: 1420, up: true, addresses: [], dhcp_relay: { enabled: false, servers: [] },
      wireguard: { key_ref: "wg-key", listen_port: 51820, peers: [
        { public_key: "disabled-peer", allowed_ips: [], persistent_keepalive_seconds: 0, enabled: false },
      ] },
    });
    const wrapper = dashboard();
    expect(wrapper.get('[aria-label="WireGuard"] tbody').text()).toBe("No enabled WireGuard peers.");
    wrapper.unmount();
  });
  it.each([
    { color: "green", loss: 0, latency: 99, spread: 9 },
    { color: "yellow", loss: 1, latency: 100, spread: 10 },
    { color: "orange", loss: 3, latency: 150, spread: 20 },
    { color: "red", loss: 5, latency: 300, spread: 30 },
  ])("uses shared $color metric chips in the gateway widget", ({ color, loss, latency, spread }) => {
    const store = useControllerStore();
    store.state.data!.desired.gateway_monitors = [monitor()];
    store.gatewayStatistics.data = { sample: statistics().sample, monitors: [{
      ...gatewayStatistics(), loss_percent: loss, rtt_avg_ms: latency, rtt_stddev_ms: spread,
    }] };
    const wrapper = dashboard();
    try {
      const widget = wrapper.get('[aria-label="Gateways"]');
      for (const chip of widget.findAll("[data-metric] .status-chip")) {
        expect(chip.attributes("data-color")).toBe(color);
        expect(chip.attributes("title")).toContain("red >=");
      }
      expect(widget.findAll(".status-chip")).toHaveLength(4);
      expect(widget.get("td:last-child .status-chip").attributes("data-color")).toBe("success");
      expect(widget.text()).toContain("Online");
    } finally { wrapper.unmount(); }
  });
  it.each(["up", "degraded", "down"])("retains measured %s status through periodic Unknown gaps and accepts the next measured status", async health => {
    vi.useFakeTimers();
    const store = useControllerStore(), sample = { ...gatewayStatistics(), health };
    store.connected = true; store.state.data!.desired.gateway_monitors = [monitor()];
    store.gatewayStatistics.data = { sample: statistics().sample, monitors: [sample] };
    const wrapper = dashboard();
    const status = () => wrapper.get('[aria-label="Gateways"] tbody tr td:last-child');
    const label = health === "up" ? "Online" : health === "degraded" ? "Degraded" : "Down";
    try {
      expect(status().text()).toBe(label);
      expect(status().get(".status-chip").attributes("data-color")).toBe(health === "up" ? "success" : health === "down" ? "error" : "warning");
      await vi.advanceTimersByTimeAsync(3500);
      expect(status().text()).toBe(label); expect(status().attributes("title")).toContain("Last measured status");
      const readings = () => wrapper.get('[aria-label="Gateways"] tbody tr').findAll("td").slice(1, 4).map(cell => cell.text());
      expect(readings()).toEqual(["1.25 ms", "1.25 ms", "33.33 %"]);
      for (const chip of wrapper.findAll('[aria-label="Gateways"] [data-metric] .status-chip')) expect(chip.attributes("data-color")).toBe("default");
      store.gatewayStatistics.loading = true;
      await vi.advanceTimersByTimeAsync(3500);
      expect(readings()).toEqual(["1.25 ms", "1.25 ms", "33.33 %"]);
      expect(status().text()).toBe(label);
      store.gatewayStatistics.loading = false;
      store.gatewayStatistics.data = { sample: statistics().sample, monitors: [{ ...sample, collected_at: new Date().toISOString(), health: "unknown" }] };
      await wrapper.vm.$nextTick(); expect(status().text()).toBe(label);
      store.gatewayStatistics.data = { sample: statistics().sample, monitors: [{ ...sample, collected_at: new Date().toISOString(), health: health === "down" ? "up" : "down" }] };
      await wrapper.vm.$nextTick(); expect(status().text()).toBe(health === "down" ? "Online" : "Down");
      expect(status().attributes("title")).toBeUndefined();
    } finally { wrapper.unmount(); vi.useRealTimers(); }
  });
  it.each(["read failure", "stale dataset", "worker restart", "DHCP waiting", "path change", "disabled", "disconnect"])("does not retain the old gateway status after %s", async change => {
    vi.useFakeTimers();
    const store = useControllerStore(), sample = gatewayStatistics();
    store.connected = true; store.state.data!.desired.gateway_monitors = [monitor()];
    store.gatewayStatistics.data = { sample: statistics().sample, monitors: [sample] };
    const wrapper = dashboard();
    const status = () => wrapper.get('[aria-label="Gateways"] tbody tr td:last-child');
    try {
      await vi.advanceTimersByTimeAsync(3500); expect(status().text()).toBe("Online");
      if (change === "read failure") store.gatewayStatistics.error = "Read failed";
      else if (change === "stale dataset") store.gatewayStatistics.stale = true;
      else if (change === "disconnect") store.connected = false;
      else if (change === "disabled") store.state.data = { ...store.state.data!, desired: { ...store.state.data!.desired, gateway_monitors: [{ ...monitor(), enabled: false }] } };
      else store.gatewayStatistics.data = { sample: statistics().sample, monitors: [{ ...sample,
        ...(change === "worker restart" ? { started_at: new Date().toISOString() } : change === "path change" ? { resolved_gateway: "192.0.2.1" } : { process_state: "waiting", sample_status: "waiting_for_dhcp", reason: "waiting for DHCP lease" }),
      }] };
      await wrapper.vm.$nextTick(); expect(status().text()).toBe(change === "disabled" ? "Disabled" : "Unknown");
    } finally { wrapper.unmount(); vi.useRealTimers(); }
  });
  it("keeps missing counters unavailable rather than fabricating zeroes", () => {
    useControllerStore().statistics.data!.interfaces[0]!.counters = null;
    const widget = dashboard().get('[aria-label="Interface counters"]');
    expect(widget.text()).toContain("Unavailable");
    expect(widget.findAll("td").every(cell => cell.text() === "Unavailable")).toBe(true);
  });
  it("preserves zero counters while showing missing individual counters as unavailable", () => {
    const widget = dashboard().get('[aria-label="Interface counters"]');
    expect(widget.findAll("tbody td").map(cell => cell.text())).toEqual([
      "Unavailable", "Unavailable", "18.45 EB", "0 B", "Unavailable", "Unavailable",
    ]);
  });
});
