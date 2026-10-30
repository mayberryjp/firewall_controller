import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@/stores/app";
import { useControllerStore } from "@/stores/controller";
import { usePolling } from "@/composables/usePolling";
import * as api from "@/services/netcontrol";
import { state, runtime, transaction, healthSnapshot, mdnsStatus } from "../fixtures";
import privateRoutes from "@/router/routes/privateRoutes";
import { navigationSections, primaryNavigationSections } from "@/constants/navigation";
import { resourceTitles } from "@/services/resourceCollections";

const PollingHost = defineComponent({ setup() { usePolling(); return () => null; } });

describe("routed navigation sections", () => {
  it("places SANDO IMPORT and ADVANCED at the end of Settings", () => {
    const settings = navigationSections.find(section => section.name === "settings-section");
    expect(settings?.pages.map(page => page.name)).toEqual(["settings-general", "settings-mqtt-streaming", "settings-dynamic-dns", "settings-sando", "settings-advanced"]);
  });
  it("opens INTERFACE RULES first from Firewall/NAT while preserving the existing firewall page", async () => {
    const section = navigationSections.find(section => section.name === "firewall-section")!;
    expect(section.pages[0]).toMatchObject({ title: "INTERFACE RULES", name: "firewall-ingress", path: "/firewall/ingress" });
    const router = createRouter({ history: createMemoryHistory(), routes: privateRoutes });
    await router.push({ name: section.name });
    expect(router.currentRoute.value.name).toBe("firewall-ingress");
    expect(router.currentRoute.value.meta.authenticated).toBe(true);
    await router.push("/firewall");
    expect(router.currentRoute.value.name).toBe("firewall");
  });
  it("labels the existing firewall route PROTECTED HOSTS without changing its URL", () => {
    const page = navigationSections.find(section => section.name === "firewall-section")?.pages.find(page => page.name === "firewall");
    expect(page).toMatchObject({ title: "PROTECTED HOSTS", path: "/firewall" });
    expect(resourceTitles.firewall).toBe("PROTECTED HOSTS");
    const router = createRouter({ history: createMemoryHistory(), routes: privateRoutes });
    expect(router.resolve("/firewall").name).toBe("firewall");
  });
  it("labels the input firewall route Firewall destined without changing its URL", () => {
    const page = navigationSections.find(section => section.name === "firewall-section")?.pages.find(page => page.name === "firewall-input");
    expect(page).toMatchObject({ title: "Firewall destined", path: "/firewall/input" });
    const router = createRouter({ history: createMemoryHistory(), routes: privateRoutes });
    expect(router.resolve("/firewall/input").name).toBe("firewall-input");
  });
  it("routes NetFlow/IPFIX through netflow while preserving the backend resource identity", () => {
    const page = navigationSections.find(section => section.name === "services-section")?.pages.find(page => page.name === "netflow");
    expect(page?.title).toBe("NetFlow/IPFIX");
    expect(page?.path).toBe("/services/netflow");
    expect(resourceTitles.softflowd).toBe("NetFlow/IPFIX");
    const router = createRouter({ history: createMemoryHistory(), routes: privateRoutes });
    expect(router.resolve(page!.path).name).toBe("netflow");
    expect(router.resolve("/services/netflow/capture").name).toBe("netflow-detail");
  });
  it("uses the selected Interfaces, Routing, Services, and VPN icons", () => {
    const interfaces = navigationSections.find(section => section.name === "networking-section");
    expect(interfaces?.icon).toBe("mdi-lan");
    expect(interfaces?.pages.find(page => page.name === "interfaces")?.icon).toBe("mdi-lan");
    const routing = navigationSections.find(section => section.name === "routing-section");
    expect(routing?.icon).toBe("mdi-transit-connection-variant");
    expect(routing?.pages.find(page => page.name === "routes")?.icon).toBe("mdi-transit-connection-variant");
    expect(routing?.pages.find(page => page.name === "routes")?.title).toBe("Static Routes");
    expect(navigationSections.find(section => section.name === "services-section")?.icon).toBe("mdi-apps");
    const vpn = navigationSections.find(section => section.name === "vpn-section");
    expect(vpn?.icon).toBe("mdi-wan");
    expect(vpn?.pages.find(page => page.name === "wireguard")?.icon).toBe("mdi-wan");
  });
  it("keeps Config routable without a duplicate primary navigation entry", () => {
    expect(primaryNavigationSections.map(section => section.title)).toEqual(["Interfaces", "Routing", "Firewall/NAT", "VPN", "Services", "Diagnostics", "Settings"]);
    expect(navigationSections.find(section => section.name === "networking-section")?.pages.map(page => page.name)).toEqual(["interfaces", "vlans", "loopbacks", "blackhole", "tunnels"]);
    expect(navigationSections.find(section => section.name === "routing-section")?.pages.map(page => page.name)).toEqual(["routes", "gateway-monitors", "bgp", "bgp-peers", "bgp-routes"]);
    expect(navigationSections.find(section => section.name === "config-section")?.path).toBe("/config");
    expect(navigationSections.find(section => section.name === "overview-section")?.path).toBe("/overview");
    expect(navigationSections.find(section => section.name === "firewall-section")?.pages.map(page => page.name)).toEqual(["firewall-ingress", "firewall", "firewall-input", "connections", "nat", "dnat"]);
    expect(navigationSections.find(section => section.name === "vpn-section")?.pages.map(page => page.name)).toEqual(["wireguard"]);
  });
  it("includes Download config in Diagnostics", () => {
    const diagnostics = navigationSections.find(section => section.name === "diagnostics-section");
    expect(diagnostics?.pages.map(page => page.name)).toEqual(["real-time-traffic", "firewall-drops", "process-health", "interface-drops", "qdiscs", "tcp-windowing", "capture-details", "api-explorer", "download-config"]);
    expect(diagnostics?.pages.find(page => page.name === "download-config")).toMatchObject({ title: "Download config", path: "/diagnostics/download-config" });
  });
  it("opens BGP routes under Routing and redirects the old Diagnostics URL", async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: privateRoutes });
    await router.push("/diagnostics/bgp-routes?source=bookmark#routes");
    expect(router.currentRoute.value.fullPath).toBe("/routing/bgp/routes?source=bookmark#routes");
    expect(router.currentRoute.value.name).toBe("bgp-routes");
    expect(router.currentRoute.value.matched[0]?.name).toBe("routing-section");
    expect(router.currentRoute.value.meta.authenticated).toBe(true);
  });
  it("preserves every page URL and its authenticated section", () => {
    const router = createRouter({ history: createMemoryHistory(), routes: privateRoutes });
    for (const section of navigationSections) for (const page of section.pages) {
      const resolved = router.resolve(page.path);
      expect(resolved.name).toBe(page.name);
      expect(resolved.meta.authenticated).toBe(true);
      expect(resolved.matched[0]?.name).toBe(section.name);
    }
    for (const [path, selectedPage] of [
      ["/interfaces/lab0", "interfaces"], ["/wireguard/wg0", "wireguard"], ["/services/netflow/capture", "netflow"],
      ["/config/commits/transaction-id", "commits"], ["/config/revisions/2026.10.29.1", "history"],
    ]) {
      expect(router.resolve(path!).meta.navigationPage).toBe(selectedPage);
      expect(router.resolve(path!).meta.authenticated).toBe(true);
    }
    expect(router.resolve("/wireguard/wg0").matched[0]?.name).toBe("vpn-section");
    for (const path of ["/routes", "/policy-rules", "/gateway-monitors"]) {
      expect(router.resolve(path).matched[0]?.name).toBe("routing-section");
    }
  });
  it("opens Interfaces and Routing entry URLs without changing existing page URLs", async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: privateRoutes });
    await router.push("/networking");
    expect(router.currentRoute.value.path).toBe("/interfaces");
    await router.push("/routing");
    expect(router.currentRoute.value.path).toBe("/routes");
    expect(router.currentRoute.value.meta.authenticated).toBe(true);
    await router.push("/settings");
    expect(router.currentRoute.value.path).toBe("/settings/general");
    expect(router.currentRoute.value.meta.authenticated).toBe(true);
    await router.push("/diagnostics");
    expect(router.currentRoute.value.path).toBe("/diagnostics/traffic");
    expect(router.currentRoute.value.meta.authenticated).toBe(true);
    await router.push("/diagnostics/link-diagnostics");
    expect(router.currentRoute.value.path).toBe("/diagnostics/interface-drops");
  });
  it("loads distinct top-level views except for explicitly separate BGP editor modes", async () => {
    const children = privateRoutes.flatMap(section => section.children ?? []).filter(child => child.component);
    const views = await Promise.all(children.map(async child => {
      const load = child.component as () => Promise<{ default: object }>;
      return (await load()).default;
    }));
    expect(views.every(view => view && typeof view === "object")).toBe(true);
    const processIndex = children.findIndex(child => child.name === "bgp");
    const peersIndex = children.findIndex(child => child.name === "bgp-peers");
    expect(views[peersIndex]).toBe(views[processIndex]);
    expect(children[peersIndex]!.props).toEqual({ mode: "peers" });
    expect(children[processIndex]!.props).toBeUndefined();
    const pages = views.filter((_, index) => !children[index]!.path.includes(":") && index !== peersIndex);
    expect(new Set(pages).size).toBe(pages.length);
  });
  it("redirects config entry and legacy URLs to canonical config pages", async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: privateRoutes });
    for (const [source, target] of [
      ["/config", "/config/changes"], ["/activity", "/config/changes"],
      ["/settings/upgrade?source=bookmark#status", "/config/upgrade?source=bookmark#status"],
      ["/changes", "/config/changes"], ["/transactions", "/config/commits"],
      ["/transactions/tx-test?source=bookmark#details", "/config/commits/tx-test?source=bookmark#details"],
      ["/history", "/config/revisions"], ["/history/2026.10.29.4294967294", "/config/revisions/2026.10.29.4294967294"],
    ]) {
      await router.push(source!);
      expect(router.currentRoute.value.fullPath).toBe(target);
      expect(router.currentRoute.value.meta.authenticated).toBe(true);
    }
    expect(navigationSections.find(section => section.path === "/config")?.pages.map(page => page.title)).toEqual(["SAVE", "Commits", "PUSH REQUESTS", "Upgrade"]);
    expect(navigationSections.find(section => section.path === "/settings")?.pages.some(page => page.name === "settings-upgrade")).toBe(false);
  });
});

describe("app store", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("opens and closes mobile navigation", () => {
    const app = useAppStore();
    expect(app.navigationOpen).toBe(false);
    app.toggleNavigation();
    expect(app.navigationOpen).toBe(true);
    app.toggleNavigation();
    expect(app.navigationOpen).toBe(false);
  });
});

describe("page-scoped polling", () => {
  beforeEach(() => {
    vi.spyOn(api, "getPlatformStatus").mockResolvedValue({ process_health: {
      status: "unknown", healthy: null, collected_at: null, stale: true, components: [],
    }, active_alerts: [] });
  });
  it.each(["received", "advertised"] as const)("polls %s BGP routes under Routing and stops on navigation", async direction => {
    vi.useFakeTimers();
    const pinia = createPinia(); setActivePinia(pinia);
    const store = useControllerStore(); store.connected = true; store.bgpRouteDirection = direction;
    vi.spyOn(store, "refreshUpgrade").mockResolvedValue();
    const received = vi.spyOn(store, "refreshBGPRoutes").mockResolvedValue();
    const advertised = vi.spyOn(store, "refreshBGPAdvertisedRoutes").mockResolvedValue();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: "/routing/bgp/routes", name: "bgp-routes", component: PollingHost },
      { path: "/diagnostics/traffic", component: PollingHost },
    ] });
    await router.push("/routing/bgp/routes");
    const wrapper = mount(PollingHost, { global: { plugins: [pinia, router] } });
    const active = direction === "received" ? received : advertised;
    const inactive = direction === "received" ? advertised : received;
    try {
      await vi.advanceTimersByTimeAsync(6100);
      expect(active).toHaveBeenCalledTimes(3);
      expect(inactive).not.toHaveBeenCalled();
      await router.push("/diagnostics/traffic");
      await vi.advanceTimersByTimeAsync(6000);
      expect(active).toHaveBeenCalledTimes(3);
      expect(inactive).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); store.$dispose(); visibility.mockRestore(); vi.useRealTimers(); }
  });
  it.each(["/diagnostics/interface-drops", "/diagnostics/qdiscs", "/diagnostics/tcp-windowing", "/diagnostics/capture-details"])("polls %s only while visible, single-flighting requests and retaining drafts", async path => {
    vi.useFakeTimers();
    const pinia = createPinia(); setActivePinia(pinia);
    const store = useControllerStore(); store.connected = true; store.state.data = state();
    store.stage(state().desired); const draft = JSON.stringify(store.draft);
    vi.spyOn(store, "refreshUpgrade").mockResolvedValue();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    let finish!: () => void;
    const read = vi.spyOn(store, "refreshLinkDiagnostics").mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue();
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:pathMatch(.*)*", component: PollingHost }] });
    await router.push(path);
    const wrapper = mount(PollingHost, { global: { plugins: [pinia, router] } });
    try {
      await vi.advanceTimersByTimeAsync(15000); expect(read).toHaveBeenCalledTimes(1);
      finish(); await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(3000); expect(read).toHaveBeenCalledTimes(2);
      visibility.mockReturnValue("hidden"); document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(6000); expect(read).toHaveBeenCalledTimes(2);
      visibility.mockReturnValue("visible"); document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0); expect(read).toHaveBeenCalledTimes(3);
      await router.push("/config/changes"); await vi.advanceTimersByTimeAsync(6000);
      expect(read).toHaveBeenCalledTimes(3); expect(JSON.stringify(store.draft)).toBe(draft);
      wrapper.unmount(); await vi.advanceTimersByTimeAsync(6000); expect(read).toHaveBeenCalledTimes(3);
    } finally { wrapper.unmount(); store.$dispose(); visibility.mockRestore(); vi.useRealTimers(); }
  });
  it("polls live traffic only on its visible page and stops on navigation or unmount", async () => {
    vi.useFakeTimers();
    const pinia = createPinia(); setActivePinia(pinia);
    const store = useControllerStore(); store.connected = true;
    const refreshStatistics = vi.spyOn(store, "refreshStatistics").mockResolvedValue();
    const refreshState = vi.spyOn(store, "refreshState").mockResolvedValue();
    const refreshRuntime = vi.spyOn(store, "refreshRuntime").mockResolvedValue();
    vi.spyOn(store, "refreshUpgrade").mockResolvedValue();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:pathMatch(.*)*", component: PollingHost }] });
    await router.push("/diagnostics/traffic");
    const wrapper = mount(PollingHost, { global: { plugins: [pinia, router] } });
    try {
      await vi.advanceTimersByTimeAsync(6100);
      expect(refreshStatistics).toHaveBeenCalledTimes(3);
      expect(refreshState).not.toHaveBeenCalled(); expect(refreshRuntime).not.toHaveBeenCalled();
      visibility.mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(6000);
      expect(refreshStatistics).toHaveBeenCalledTimes(3);
      visibility.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(100);
      expect(refreshStatistics).toHaveBeenCalledTimes(4);
      await router.push("/services/dhcp-relay");
      await vi.advanceTimersByTimeAsync(6000);
      expect(refreshStatistics).toHaveBeenCalledTimes(4);
      wrapper.unmount();
      await vi.advanceTimersByTimeAsync(6000);
      expect(refreshStatistics).toHaveBeenCalledTimes(4);
    } finally { wrapper.unmount(); visibility.mockRestore(); vi.useRealTimers(); }
  });
  it("polls cached health independently of failed configuration reads without overlapping or changing drafts", async () => {
    vi.useFakeTimers();
    const pinia = createPinia(); setActivePinia(pinia);
    const store = useControllerStore(); store.connected = true;
    store.state.data = state(); store.stage(state().desired); store.state.error = "Observation unavailable";
    const draft = JSON.stringify(store.draft);
    vi.spyOn(store, "refreshUpgrade").mockResolvedValue();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    let finish!: (value: Awaited<ReturnType<typeof api.getPlatformStatus>>) => void;
    const read = vi.mocked(api.getPlatformStatus).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:pathMatch(.*)*", component: PollingHost }] });
    await router.push("/config/changes");
    const wrapper = mount(PollingHost, { global: { plugins: [pinia, router] } });
    try {
      await vi.advanceTimersByTimeAsync(12000); expect(read).toHaveBeenCalledTimes(1);
      finish({ process_health: { status: "unknown", healthy: null, collected_at: null, stale: true, components: [] }, active_alerts: [] });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(3000); expect(read).toHaveBeenCalledTimes(2);
      visibility.mockReturnValue("hidden"); document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(9000); expect(read).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(store.draft)).toBe(draft);
    } finally { wrapper.unmount(); visibility.mockRestore(); vi.useRealTimers(); }
  });
  it.each(["/services/ntp", "/services/syslog", "/services/vnstat", "/services/dhcp-relay", "/services/netflow", "/services/netflow/capture"])("polls recovering service runtime on %s without overlapping reads", async path => {
    vi.useFakeTimers();
    const pinia = createPinia(); setActivePinia(pinia);
    const store = useControllerStore(); store.connected = true;
    for (const action of ["refreshState", "refreshTransactions", "refreshStatistics", "refreshGatewayStatistics", "refreshUpgrade", "refreshHostHealth"] as const) {
      vi.spyOn(store, action).mockResolvedValue();
    }
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    let finish!: () => void;
    const read = vi.spyOn(store, "refreshRuntime").mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue();
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:pathMatch(.*)*", component: PollingHost }] });
    await router.push(path);
    const wrapper = mount(PollingHost, { global: { plugins: [pinia, router] } });
    try {
      await vi.advanceTimersByTimeAsync(15000); expect(read).toHaveBeenCalledTimes(1);
      finish(); await vi.advanceTimersByTimeAsync(0);
      store.runtime.error = "Service status unavailable";
      await vi.advanceTimersByTimeAsync(4999); expect(read).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1); expect(read).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(20000); expect(read).toHaveBeenCalledTimes(6);
      await router.push("/config/changes"); await vi.advanceTimersByTimeAsync(10000);
      expect(read).toHaveBeenCalledTimes(6);
    } finally { wrapper.unmount(); vi.useRealTimers(); }
  });
  it("polls mDNS only on its page at 3..5 seconds, deduplicating in-flight reads and pausing hidden/disconnected tabs", async () => {
    vi.useFakeTimers();
    const pinia = createPinia(); setActivePinia(pinia);
    const store = useControllerStore(); store.connected = true;
    for (const action of ["refreshState", "refreshRuntime", "refreshTransactions", "refreshStatistics", "refreshGatewayStatistics", "refreshUpgrade", "refreshHostHealth"] as const) {
      vi.spyOn(store, action).mockResolvedValue();
    }
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    let finish!: (value: { instances: ReturnType<typeof mdnsStatus>[]; error: string }) => void;
    const read = vi.spyOn(api, "getMDNSStatus").mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:pathMatch(.*)*", component: PollingHost }] });
    await router.push("/services/mdns");
    const wrapper = mount(PollingHost, { global: { plugins: [pinia, router] } });
    try {
      expect(read).toHaveBeenCalledTimes(1);
      void store.refreshMDNSStatus();
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(15000);
      expect(read).toHaveBeenCalledTimes(1);
      finish({ instances: [mdnsStatus()], error: "" });
      await vi.advanceTimersByTimeAsync(0);
      read.mockRejectedValue(new Error("status unavailable"));
      await vi.advanceTimersByTimeAsync(2999); expect(read).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1); expect(read).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(3000); expect(read).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(5000); expect(read).toHaveBeenCalledTimes(4);
      await vi.advanceTimersByTimeAsync(5000); expect(read).toHaveBeenCalledTimes(5);
      visibility.mockReturnValue("hidden"); document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(10000); expect(read).toHaveBeenCalledTimes(5);
      visibility.mockReturnValue("visible"); read.mockResolvedValue({ instances: [mdnsStatus()], error: "" });
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0); expect(read).toHaveBeenCalledTimes(6);
      await router.push("/services/ntp"); await vi.advanceTimersByTimeAsync(10000);
      expect(read).toHaveBeenCalledTimes(6);
      await router.push("/services/mdns"); await vi.advanceTimersByTimeAsync(0); expect(read).toHaveBeenCalledTimes(7);
      store.disconnect(); await vi.advanceTimersByTimeAsync(10000);
      expect(read).toHaveBeenCalledTimes(7); expect(store.mdnsStatus.data).toBeNull();
    } finally { wrapper.unmount(); vi.useRealTimers(); }
  });
  it("keeps host and MQTT polling route-scoped, non-overlapping, hidden-tab paused and stopped on unmount", async () => {
    vi.useFakeTimers();
    const pinia = createPinia(); setActivePinia(pinia);
    const store = useControllerStore(); store.connected = true;
    for (const action of ["refreshState", "refreshRuntime", "refreshTransactions", "refreshStatistics", "refreshGatewayStatistics", "refreshUpgrade"] as const) vi.spyOn(store, action).mockResolvedValue();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    let finish!: (value: ReturnType<typeof healthSnapshot>) => void;
    const host = vi.spyOn(api, "getHostHealth").mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(healthSnapshot());
    const mqtt = vi.spyOn(api, "getMqttStatus").mockResolvedValue({ device_id: "a".repeat(32), enabled: false, state: "disabled", error: null, last_published_at_unix: null });
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:pathMatch(.*)*", component: PollingHost }] });
    await router.push("/overview");
    const wrapper = mount(PollingHost, { global: { plugins: [pinia, router] } });
    try {
      await vi.advanceTimersByTimeAsync(12000); expect(host).toHaveBeenCalledTimes(1); expect(mqtt).not.toHaveBeenCalled();
      finish(healthSnapshot()); await vi.advanceTimersByTimeAsync(0);
      await router.push("/settings/mqtt-streaming"); await vi.advanceTimersByTimeAsync(15000);
      expect(host).toHaveBeenCalledTimes(1); expect(mqtt).toHaveBeenCalledTimes(3);
      visibility.mockReturnValue("hidden"); document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(15000); expect(mqtt).toHaveBeenCalledTimes(3);
      visibility.mockReturnValue("visible"); document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0); expect(mqtt).toHaveBeenCalledTimes(4);
      wrapper.unmount(); await vi.advanceTimersByTimeAsync(15000); expect(mqtt).toHaveBeenCalledTimes(4);
    } finally { wrapper.unmount(); visibility.mockRestore(); vi.useRealTimers(); }
  });
  it("polls only gateway measurements on the visible monitor page and stops when monitoring is disabled", async () => {
    vi.useFakeTimers();
    const pinia = createPinia(); setActivePinia(pinia);
    const store = useControllerStore(); store.connected = true;
    const refreshState = vi.spyOn(store, "refreshState").mockResolvedValue();
    const refreshRuntime = vi.spyOn(store, "refreshRuntime").mockResolvedValue();
    const refreshTransactions = vi.spyOn(store, "refreshTransactions").mockResolvedValue();
    const refreshStatistics = vi.spyOn(store, "refreshStatistics").mockResolvedValue();
    const refreshGatewayStatistics = vi.spyOn(store, "refreshGatewayStatistics").mockResolvedValue();
    vi.spyOn(store, "refreshUpgrade").mockResolvedValue();
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:pathMatch(.*)*", component: PollingHost }] });
    await router.push("/gateway-monitors");
    const wrapper = mount(PollingHost, { global: { plugins: [pinia, router] } });
    try {
      await vi.advanceTimersByTimeAsync(6000); expect(refreshGatewayStatistics).not.toHaveBeenCalled();
      store.gatewayMonitoring = true;
      await vi.advanceTimersByTimeAsync(6000); expect(refreshGatewayStatistics).toHaveBeenCalledTimes(2);
      for (const action of [refreshState, refreshRuntime, refreshTransactions, refreshStatistics]) expect(action).not.toHaveBeenCalled();
      store.gatewayMonitoring = false;
      await vi.advanceTimersByTimeAsync(6000); expect(refreshGatewayStatistics).toHaveBeenCalledTimes(2);
    } finally { wrapper.unmount(); vi.useRealTimers(); }
  });
  it.each(["settings-advanced", "transaction-detail"])("monitors pending transaction outcomes on %s and pauses elsewhere or when hidden", async name => {
    vi.useFakeTimers();
    const pinia = createPinia(); setActivePinia(pinia);
    const store = useControllerStore(); store.connected = true;
    store.transactions.data = { "tx-test": transaction() };
    const refreshState = vi.spyOn(store, "refreshState").mockResolvedValue();
    const refreshTransactions = vi.spyOn(store, "refreshTransactions").mockResolvedValue();
    const refreshRuntime = vi.spyOn(store, "refreshRuntime").mockResolvedValue();
    vi.spyOn(store, "refreshUpgrade").mockResolvedValue();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: "/settings/advanced", name: "settings-advanced", component: PollingHost },
      { path: "/config/commits/:id", name: "transaction-detail", component: PollingHost },
      { path: "/interfaces", component: PollingHost },
    ] });
    await router.push({ name, params: name === "transaction-detail" ? { id: "tx-test" } : {} });
    const wrapper = mount(PollingHost, { global: { plugins: [pinia, router] } });
    try {
      await vi.advanceTimersByTimeAsync(2100);
      expect(refreshState).toHaveBeenCalledTimes(3);
      expect(refreshTransactions).toHaveBeenCalledTimes(3);
      expect(refreshRuntime).not.toHaveBeenCalled();
      visibility.mockReturnValue("hidden"); document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(5000);
      expect(refreshTransactions).toHaveBeenCalledTimes(3);
      visibility.mockReturnValue("visible"); document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
      expect(refreshTransactions).toHaveBeenCalledTimes(4);
      await router.push("/interfaces");
      await vi.advanceTimersByTimeAsync(5000);
      expect(refreshTransactions).toHaveBeenCalledTimes(4);
      expect(refreshState).toHaveBeenCalledTimes(4);
    } finally { wrapper.unmount(); store.$dispose(); visibility.mockRestore(); vi.useRealTimers(); }
  });
  it.each(["/interfaces", "/interfaces/lab0", "/config/changes", "/config/revisions"])("keeps %s manual even during pending transactions", async path => {
    vi.useFakeTimers();
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useControllerStore();
    store.connected = true;
    const refreshState = vi.spyOn(store, "refreshState").mockResolvedValue();
    const refreshRuntime = vi.spyOn(store, "refreshRuntime").mockResolvedValue();
    const refreshTransactions = vi.spyOn(store, "refreshTransactions").mockResolvedValue();
    const refreshStatistics = vi.spyOn(store, "refreshStatistics").mockResolvedValue();
    const refreshGatewayStatistics = vi.spyOn(store, "refreshGatewayStatistics").mockResolvedValue();
    store.monitoring = true; store.gatewayMonitoring = true;
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:pathMatch(.*)*", component: PollingHost }] });
    await router.push(path);
    const wrapper = mount(PollingHost, { global: { plugins: [pinia, router] } });
    try {
      await vi.advanceTimersByTimeAsync(15000);
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(5000);
      expect(refreshState).not.toHaveBeenCalled();
      expect(refreshRuntime).not.toHaveBeenCalled();
      expect(refreshTransactions).not.toHaveBeenCalled();
      expect(refreshStatistics).not.toHaveBeenCalled();
      expect(refreshGatewayStatistics).not.toHaveBeenCalled();

      const getState = vi.spyOn(api, "getState").mockResolvedValue(state());
      const getRuntime = vi.spyOn(api, "getRuntime").mockResolvedValue(runtime());
      vi.spyOn(api, "getTransactions").mockResolvedValue({});
      await store.refresh();
      expect(getState).toHaveBeenCalledTimes(1);
      expect(getRuntime).toHaveBeenCalledTimes(1);

      const pending = transaction();
      store.transactions.data = { [pending.id]: pending };
      await vi.advanceTimersByTimeAsync(5000);
      expect(refreshState).not.toHaveBeenCalled();
      expect(refreshRuntime).not.toHaveBeenCalled();
      expect(refreshTransactions).not.toHaveBeenCalled();

      store.transactions.data = {};
      await router.push("/overview");
      await vi.advanceTimersByTimeAsync(5000);
      expect(refreshState).toHaveBeenCalled();
      expect(refreshRuntime).toHaveBeenCalled();
      expect(refreshTransactions).toHaveBeenCalled();
      expect(refreshStatistics).toHaveBeenCalled();
      expect(refreshGatewayStatistics).toHaveBeenCalled();
      await router.push(path);
      for (const action of [refreshState, refreshRuntime, refreshTransactions, refreshStatistics, refreshGatewayStatistics]) action.mockClear();
      await vi.advanceTimersByTimeAsync(15000);
      for (const action of [refreshState, refreshRuntime, refreshTransactions, refreshStatistics, refreshGatewayStatistics]) expect(action).not.toHaveBeenCalled();
    } finally {
      wrapper.unmount();
      vi.useRealTimers();
    }
  });
});
