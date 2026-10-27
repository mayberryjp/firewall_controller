import { onMounted, onUnmounted, watch } from "vue";
import { useRoute } from "vue-router";
import { useControllerStore } from "@/stores/controller";

export function usePolling(): void {
  const store = useControllerStore();
  const route = useRoute();
  const stops: Array<() => void> = [];
  function schedule(action: () => Promise<void>, interval: () => number, failed: () => boolean, enabled = () => true, allRoutes = false, maxBackoff = 10000): void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false, running = false, failures = 0;
    async function run(): Promise<void> {
      if (stopped || running) return;
      if (store.connected && (allRoutes || route.path === "/overview") && document.visibilityState !== "hidden" && enabled()) {
        running = true;
        try { await action(); } finally { running = false; }
        failures = failed() ? Math.min(failures + 1, 4) : 0;
      }
      if (!stopped) timer = setTimeout(() => { void run(); }, failures ? Math.min(maxBackoff, Math.max(interval(), [1000, 2000, 5000, 10000][failures - 1] ?? 10000)) : interval());
    }
    const wake = () => { clearTimeout(timer); void run(); };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    const unwatch = watch(() => store.connected, wake);
    const unwatchRoute = watch(() => route.path, wake);
    void run();
    stops.push(() => {
      stopped = true; clearTimeout(timer); unwatch(); unwatchRoute();
      document.removeEventListener("visibilitychange", wake); window.removeEventListener("online", wake);
    });
  }
  onMounted(() => {
    schedule(store.refreshState, () => store.activeTransactions.length || store.uncertain ? 1000 : 5000, () => Boolean(store.state.error));
    schedule(store.refreshRuntime, () => 5000, () => Boolean(store.runtime.error));
    schedule(store.refreshRuntime, () => 5000, () => Boolean(store.runtime.error), () => route.path.startsWith("/wireguard") || route.path === "/routes", true);
    schedule(store.refreshTransactions, () => store.activeTransactions.length || store.uncertain ? 1000 : 10000, () => Boolean(store.transactions.error));
    schedule(store.refreshStatistics, () => 3000, () => Boolean(store.statistics.error), () => store.monitoring);
    schedule(store.refreshGatewayStatistics, () => 3000, () => Boolean(store.gatewayStatistics.error), () => store.gatewayMonitoring && ["/overview", "/gateway-monitors"].includes(route.path), true);
    schedule(store.refreshHostHealth, () => 3000, () => Boolean(store.hostHealth.error));
    schedule(store.refreshMqttStatus, () => 7500, () => Boolean(store.mqttStatus.error), () => route.path === "/settings/mqtt-streaming", true);
    schedule(store.refreshDynamicDnsStatus, () => 7500, () => Boolean(store.dynamicDnsStatus.error), () => route.path === "/settings/dynamic-dns", true);
    schedule(store.refreshMDNSStatus, () => 3000, () => Boolean(store.mdnsStatus.error), () => route.path === "/services/mdns", true, 5000);
    schedule(store.refreshUpgrade, () => store.upgradeActive || store.upgradeUncertain ? 2000 : 15000, () => Boolean(store.upgrade.error), () => true, true);
  });
  onUnmounted(() => stops.forEach((stop) => stop()));
}
