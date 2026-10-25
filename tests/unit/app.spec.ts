import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@/stores/app";
import { useControllerStore } from "@/stores/controller";
import { usePolling } from "@/composables/usePolling";
import * as api from "@/services/netcontrol";
import { state, runtime, transaction } from "../fixtures";
import privateRoutes from "@/router/routes/privateRoutes";
import { navigationSections, primaryNavigationSections } from "@/constants/navigation";

const PollingHost = defineComponent({ setup() { usePolling(); return () => null; } });

describe("routed navigation sections", () => {
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
    expect(primaryNavigationSections.map(section => section.title)).toEqual(["Interfaces", "Routing", "Firewall", "VPN", "Services", "Settings"]);
    expect(navigationSections.find(section => section.name === "networking-section")?.pages.map(page => page.name)).toEqual(["interfaces", "vlans", "loopbacks"]);
    expect(navigationSections.find(section => section.name === "routing-section")?.pages.map(page => page.name)).toEqual(["routes", "gateway-monitors"]);
    expect(navigationSections.find(section => section.name === "config-section")?.path).toBe("/config");
    expect(navigationSections.find(section => section.name === "overview-section")?.path).toBe("/overview");
    expect(navigationSections.find(section => section.name === "firewall-section")?.pages.map(page => page.name)).toEqual(["firewall", "firewall-input", "connections", "nat"]);
    expect(navigationSections.find(section => section.name === "vpn-section")?.pages.map(page => page.name)).toEqual(["wireguard"]);
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
      ["/interfaces/lab0", "interfaces"], ["/wireguard/wg0", "wireguard"], ["/services/softflowd/capture", "softflowd"],
      ["/config/commits/transaction-id", "commits"], ["/config/revisions/0", "history"],
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
  });
  it("loads all page and detail views with distinct top-level pages", async () => {
    const children = privateRoutes.flatMap(section => section.children ?? []).filter(child => child.component);
    const views = await Promise.all(children.map(async child => {
      const load = child.component as () => Promise<{ default: object }>;
      return (await load()).default;
    }));
    expect(views.every(view => view && typeof view === "object")).toBe(true);
    const pages = views.filter((_, index) => !children[index]!.path.includes(":"));
    expect(new Set(pages).size).toBe(pages.length);
  });
  it("redirects config entry and legacy URLs to canonical config pages", async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: privateRoutes });
    for (const [source, target] of [
      ["/config", "/config/changes"], ["/activity", "/config/changes"],
      ["/changes", "/config/changes"], ["/transactions", "/config/commits"],
      ["/transactions/tx-test?source=bookmark#details", "/config/commits/tx-test?source=bookmark#details"],
      ["/history", "/config/revisions"], ["/history/9007199254740993", "/config/revisions/9007199254740993"],
    ]) {
      await router.push(source!);
      expect(router.currentRoute.value.fullPath).toBe(target);
      expect(router.currentRoute.value.meta.authenticated).toBe(true);
    }
    expect(navigationSections.find(section => section.path === "/config")?.pages.map(page => page.title)).toEqual(["SAVE", "Commits", "PUSH REQUESTS"]);
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
  it.each(["/interfaces", "/interfaces/lab0", "/wireguard", "/routes", "/services/ntp", "/config/commits/tx-test", "/config/changes", "/config/revisions"])("keeps %s manual even during pending transactions", async path => {
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
