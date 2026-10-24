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
import { navigationSections } from "@/constants/navigation";

describe("routed navigation sections", () => {
  it("preserves every page URL and its authenticated section", () => {
    const router = createRouter({ history: createMemoryHistory(), routes: privateRoutes });
    for (const section of navigationSections) for (const page of section.pages) {
      const resolved = router.resolve(page.path);
      expect(resolved.name).toBe(page.name);
      expect(resolved.meta.authenticated).toBe(true);
      expect(resolved.matched[0]?.name).toBe(section.name);
    }
    for (const [path, selectedPage] of [
      ["/interfaces/lab0", "interfaces"], ["/services/softflowd/capture", "softflowd"],
      ["/transactions/transaction-id", "transactions"], ["/history/0", "history"],
    ]) {
      expect(router.resolve(path!).meta.navigationPage).toBe(selectedPage);
      expect(router.resolve(path!).meta.authenticated).toBe(true);
    }
  });
  it("loads a distinct Vue view for every subpage and detail route", async () => {
    const children = privateRoutes.flatMap(section => section.children ?? []);
    const views = await Promise.all(children.map(async child => {
      const load = child.component as () => Promise<{ default: object }>;
      return (await load()).default;
    }));
    expect(new Set(views).size).toBe(children.length);
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

describe("overview-only polling", () => {
  it.each(["/interfaces", "/interfaces/lab0", "/wireguard", "/routes", "/services/ntp", "/transactions/tx-test", "/changes", "/history"])("keeps %s manual even during pending transactions", async path => {
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
    const component = defineComponent({ setup() { usePolling(); return () => null; } });
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:pathMatch(.*)*", component }] });
    await router.push(path);
    const wrapper = mount(component, { global: { plugins: [pinia, router] } });
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
