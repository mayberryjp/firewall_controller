<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import DatasetStatus from "@/components/base/DatasetStatus.vue";
import { useControllerStore } from "@/stores/controller";
import { isInitialLoad } from "@/services/datasets";
import { cpuUsage, formatBytes, formatUptime, usagePercent, type HostHealth } from "@/services/hostHealth";
import type { Statistics } from "@/types/domain";

const store = useControllerStore(), cpu = ref<number | null>(null);
const snapshot = shallowRef<HostHealth | null>(null);
const excludedStatistics = shallowRef<Statistics | null>(null);
let previous: HostHealth | null = null, seen: HostHealth | null = null, session = store.sessionVersion;
const hidden = ref(document.visibilityState === "hidden");
watch(() => [store.hostHealth.data, store.hostHealth.stale, store.hostHealth.error, store.connected, store.sessionVersion] as const,
  ([data, stale, error, connected, currentSession]) => {
    if (!connected || session !== currentSession) {
      session = currentSession; previous = null; snapshot.value = null; cpu.value = null; seen = data;
      excludedStatistics.value = store.statistics.data; return;
    }
    if (stale || error || hidden.value) { previous = null; cpu.value = null; return; }
    if (data === seen) return;
    seen = data; snapshot.value = data;
    const valid = data && data.sample.status !== "simulated" &&
      data.sections.cpu.status === "available" && data.sections.uptime.status === "available";
    cpu.value = valid ? cpuUsage(data, previous) : null;
    previous = valid ? data : null;
  }, { immediate: true });
function visibilityChanged() {
  hidden.value = document.visibilityState === "hidden";
  previous = null; cpu.value = null;
}
onMounted(() => {
  document.addEventListener("visibilitychange", visibilityChanged);
  if (store.connected && !hidden.value) void store.refreshHostHealth();
});
onUnmounted(() => document.removeEventListener("visibilitychange", visibilityChanged));

const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const rows = computed(() => {
  const sections = snapshot.value?.sections;
  const pending = isInitialLoad(store.hostHealth);
  const missing = pending ? "Loading..." : snapshot.value?.sample.status === "simulated" ? "Simulated" : "Unavailable";
  const memory = sections?.memory.status === "available" ? sections.memory.data : null;
  const load = sections?.load.status === "available" ? sections.load.data : null;
  const percent = memory ? usagePercent(memory.used_bytes, memory.bytes.MemTotal) : null;
  const statistics = store.connected && store.statistics.data !== excludedStatistics.value ? store.statistics.data : null;
  const uptime = statistics?.uptime;
  const uptimeData = statistics?.sample.status !== "simulated" && uptime?.scope === "host" && uptime.status === "available" ? uptime.data : null;
  return [
    { label: "CPU", value: cpu.value === null ? (sections?.cpu.status === "available" && sections.cpu.data && sections.uptime.status === "available" && sections.uptime.data &&
      !store.hostHealth.stale && !store.hostHealth.error ? "Collecting..." : missing) : `${number.format(cpu.value)}%`,
      detail: "Busy time, excluding idle and I/O wait", error: sections?.cpu.error ?? sections?.uptime.error },
    { label: "Memory", value: percent === null ? missing : `${number.format(percent)}%`,
      detail: memory ? `${formatBytes(memory.used_bytes)} / ${formatBytes(memory.bytes.MemTotal)}` : undefined, error: sections?.memory.error },
    { label: "Load (1 min)", value: load ? number.format(load.one) : missing,
      detail: load ? `5 min: ${number.format(load.five)}; 15 min: ${number.format(load.fifteen)}` : undefined, error: sections?.load.error },
    { label: "Host uptime", value: uptimeData ? formatUptime(uptimeData.uptime_seconds) : isInitialLoad(store.statistics) ? "Loading..." : "Unavailable",
      detail: store.statistics.error ?? (store.statistics.stale ? "Last known value" : undefined), error: uptime?.error },
  ];
});
</script>

<template>
  <section
    class="host-performance"
    aria-label="Host performance"
  >
    <DatasetStatus
      :query="store.hostHealth"
      label="Host performance"
    />
    <dl class="host-metrics">
      <div
        v-for="row in rows"
        :key="row.label"
        :title="row.detail"
      >
        <dt>{{ row.label }}</dt>
        <dd>{{ row.value }}</dd>
        <p
          v-if="row.error"
          class="metric-error"
          role="status"
        >
          {{ row.error }}
        </p>
      </div>
    </dl>
  </section>
</template>

<style scoped>
.host-performance { min-width: 0; margin-top: 8px; padding: 6px 8px; border-radius: 8px; background: var(--bg-elevated); }
.host-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.host-metrics > div { min-width: 0; }
dt { color: var(--text-secondary); font-size: 9px; line-height: 12px; text-transform: uppercase; letter-spacing: .8px; }
dd { color: var(--text-primary); font-size: 13px; line-height: 20px; font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.metric-error { color: rgb(var(--v-theme-error)); font-size: 11px; overflow-wrap: anywhere; }
@media (max-width: 600px) {
  dd { font-size: 12px; }
}
</style>
