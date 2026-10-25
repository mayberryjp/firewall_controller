<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useControllerStore } from "@/stores/controller";
import { cpuUsage, formatBytes, formatUptime, usagePercent, type HostHealth } from "@/services/hostHealth";
import { formatTimestamp } from "@/services/timestamps";
import OverviewWidget from "./OverviewWidget.vue";
const store = useControllerStore(), cpu = ref<number | null>(null);
let previous: HostHealth | null = null;
watch(() => [store.hostHealth.data, store.hostHealth.stale] as const, ([value, stale]) => {
  if (!value || stale) { previous = null; cpu.value = null; return; }
  cpu.value = cpuUsage(value, previous); previous = value;
}, { immediate: true });
onMounted(() => { if (store.connected && document.visibilityState !== "hidden") void store.refreshHostHealth(); });
const snapshot = computed(() => store.hostHealth.data);
const note = computed(() => store.hostHealth.error ? (snapshot.value ? "Stale" : "Unavailable") : store.hostHealth.loading && !snapshot.value ? "Loading" : store.hostHealth.stale ? "Stale" : snapshot.value?.sample.status === "simulated" ? "Simulated" : snapshot.value?.sample.status === "partial" ? "Partial" : undefined);
const detail = computed(() => store.hostHealth.error ?? (snapshot.value ? `${snapshot.value.sample.scope} | Collected (UTC): ${formatTimestamp(snapshot.value.sample.collected_at)}` : undefined));
const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const rows = computed(() => {
  const sections = snapshot.value?.sections;
  const memory = sections?.memory.data, load = sections?.load.data, uptime = sections?.uptime.data;
  const root = sections?.filesystems.data?.find(item => item.mount_point === "/")?.usage.data;
  const temperatures = [
    ...(sections?.thermal.data ?? []).flatMap(item => item.data ? [{ label: item.data.type, value: item.data.temperature_millicelsius }] : []),
    ...(sections?.hwmon.data ?? []).flatMap(item => item.unit === "millicelsius" && item.data ? [{ label: item.data.label ?? item.chip ?? item.id, value: item.data.value }] : []),
  ].sort((left, right) => right.value - left.value);
  const fan = sections?.hwmon.data?.find(item => item.unit === "rpm" && item.data);
  const used = memory ? usagePercent(memory.used_bytes, memory.bytes.MemTotal) : null;
  const swap = memory ? usagePercent(memory.swap_used_bytes, memory.bytes.SwapTotal) : null;
  const disk = root ? usagePercent(root.used_bytes, root.total_bytes) : null;
  return [
    { name: "CPU usage", value: cpu.value === null ? (sections?.cpu.data ? "Collecting" : "Unavailable") : "Busy time", percent: cpu.value, detail: "Approximate busy time; excludes idle and I/O wait. Green <70%, amber 70-89.99%, red >=90%." },
    { name: "Memory", value: memory ? `${formatBytes(memory.used_bytes)} / ${formatBytes(memory.bytes.MemTotal)}` : "Unavailable", percent: used, detail: "Used = total minus available memory; reclaimable cache remains available." },
    { name: "Swap", value: memory ? (memory.bytes.SwapTotal === "0" ? "Not configured" : `${formatBytes(memory.swap_used_bytes)} / ${formatBytes(memory.bytes.SwapTotal)}`) : "Unavailable", percent: swap },
    { name: "Load (1 / 5 / 15 min)", value: load ? [load.one, load.five, load.fifteen].map(value => number.format(value)).join(" / ") : "Unavailable", percent: null },
    { name: "Uptime", value: uptime ? formatUptime(uptime.uptime_seconds) : "Unavailable", percent: null },
    { name: "Root filesystem", value: root ? `${formatBytes(root.used_bytes)} / ${formatBytes(root.total_bytes)}` : "Unavailable", percent: disk, detail: root ? `${formatBytes(root.available_bytes)} available (excludes reserved space)${root.read_only ? "; read-only" : ""}` : sections?.filesystems.error ?? undefined },
    { name: "Temperature (highest)", value: temperatures[0] ? `${number.format(temperatures[0].value / 1000)} \u00b0C` : "Unavailable", percent: null, detail: temperatures[0]?.label },
    { name: "Fan", value: fan?.data ? `${number.format(fan.data.value)} RPM` : "Unavailable", percent: null, detail: fan?.data?.label ?? fan?.chip },
  ];
});
function color(value: number | null): string {
  return store.hostHealth.stale || value === null ? "default" : value >= 90 ? "error" : value >= 70 ? "warning" : "success";
}
</script>

<template>
  <OverviewWidget
    title="System stats"
    :note="note"
    :detail="detail"
  >
    <v-table density="compact">
      <thead>
        <tr>
          <th scope="col">
            Metric
          </th><th scope="col">
            Value
          </th><th scope="col">
            Usage
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.name"
          :title="row.detail"
        >
          <th scope="row">
            {{ row.name }}
          </th>
          <td class="metric-value">
            {{ row.value }}
          </td>
          <td>
            <v-chip
              v-if="row.percent !== null"
              :color="color(row.percent)"
              size="x-small"
              variant="tonal"
              :title="store.hostHealth.stale ? 'Last known value' : 'Usage: green <70%, amber 70-89.99%, red >=90%'"
            >
              {{ number.format(row.percent) }} %
            </v-chip>
          </td>
        </tr>
      </tbody>
    </v-table>
  </OverviewWidget>
</template>

<style scoped>
.metric-value { font-variant-numeric: tabular-nums; }
:deep(th), :deep(td) { white-space: normal !important; overflow-wrap: anywhere; }
:deep(th:first-child) { width: 40%; }
</style>