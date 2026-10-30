import { computed, onUnmounted, ref, toValue, watch, type MaybeRefOrGetter } from "vue";
import { useControllerStore } from "@/stores/controller";
import { getFirewallCounters } from "@/services/netcontrol";
import { counterConfigurationMatches, firewallCounterSummaries, type FirewallCounters, type FirewallCounterSummary } from "@/services/firewallTelemetry";
import { useTimestamps } from "@/composables/useTimestamps";
import type { Config } from "@/types/domain";
import { isInitialLoad } from "@/services/datasets";

export function useFirewallCounters(selected: MaybeRefOrGetter<Config | undefined>, enabled: MaybeRefOrGetter<boolean> = true) {
  const store = useControllerStore();
  const { formatTimestamp, timeZone } = useTimestamps();
  const data = ref<FirewallCounters | null>(null), error = ref(""), loading = ref(false);
  let timer: ReturnType<typeof setTimeout> | undefined, controller: AbortController | undefined;
  let version = 0, failures = 0, disposed = false;
  const available = computed(() => Boolean(data.value && !store.state.stale && !store.busy &&
    counterConfigurationMatches(data.value, store.state.data, toValue(selected))));
  const notice = computed(() => {
    if (!toValue(enabled)) return "";
    if (error.value) return `Firewall counters unavailable: ${error.value}`;
    if (!data.value) return loading.value ? "Loading firewall counters..." : "";
    if (isInitialLoad(store.state)) return "";
    if (data.value.sample.status === "simulated") return "Firewall counters are not measured by the simulator.";
    if (!available.value) return "Live counters do not match this configuration snapshot or its unapplied firewall edits. Refresh committed state before comparing.";
    return `Rule matches since the last ruleset reset. Sampled (${timeZone.value}): ${formatTimestamp(data.value.sample.collected_at)}.`;
  });
  const byID = computed(() => new Map(available.value ? data.value?.rules.map(row => [row.id, row]) : []));
  function counts(path: string, chain: string) {
    const row = byID.value.get(`${chain}:${path}`);
    return { packets: row?.packets ?? "—", bytes: row?.bytes ?? "—" };
  }
  function summaries(chain: keyof typeof firewallCounterSummaries): FirewallCounterSummary[] {
    return firewallCounterSummaries[chain].flatMap(item => {
      const row = byID.value.get(item.id);
      return row ? [{ ...item, packets: row.packets, bytes: row.bytes, origin: row.origin ?? "system", import_source: row.import_source ?? null }] : [];
    });
  }
  function stop(): void {
    version++; clearTimeout(timer); controller?.abort(); controller = undefined;
    loading.value = false; data.value = null;
  }
  async function refresh(): Promise<void> {
    if (disposed || loading.value || !toValue(enabled) || !store.connected || store.busy || store.state.stale || document.visibilityState === "hidden") return;
    const current = version;
    controller = new AbortController(); loading.value = true;
    try {
      const result = await getFirewallCounters(controller.signal);
      if (current !== version || disposed) return;
      data.value = result; error.value = ""; failures = 0;
    } catch (failure) {
      if (current !== version || disposed) return;
      data.value = null; failures++;
      error.value = failure instanceof Error ? failure.message : "Unable to read firewall rule matches.";
    } finally {
      if (current === version && !disposed) {
        loading.value = false;
        timer = setTimeout(() => { void refresh(); }, failures ? Math.min(60000, 5000 * 2 ** Math.min(failures, 4)) : 5000);
      }
    }
  }
  function restart(): void { stop(); error.value = ""; failures = 0; void refresh(); }
  watch(() => [
    toValue(enabled), store.connected, store.sessionVersion, store.busy, store.state.stale,
    store.state.data?.revision, store.state.data?.active_transaction?.id, store.state.data?.active_transaction?.status,
  ], restart, { immediate: true });
  document.addEventListener("visibilitychange", restart);
  window.addEventListener("online", restart);
  onUnmounted(() => {
    disposed = true; stop();
    document.removeEventListener("visibilitychange", restart); window.removeEventListener("online", restart);
  });
  return { data, notice, counts, summaries };
}
