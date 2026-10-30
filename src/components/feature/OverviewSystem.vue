<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import VueApexCharts from "vue3-apexcharts";
import type { ApexOptions } from "apexcharts";
import { useControllerStore } from "@/stores/controller";
import { cpuUsage, formatBytes, formatUptime, usagePercent, type HostHealth } from "@/services/hostHealth";
import { useTimestamps } from "@/composables/useTimestamps";
import { isInitialLoad } from "@/services/datasets";
import OverviewWidget from "./OverviewWidget.vue";
const { formatTimestamp, timeZone } = useTimestamps();
const store = useControllerStore(), cpu = ref<number | null>(null);
let previous: HostHealth | null = null;
watch(() => [store.hostHealth.data, store.hostHealth.stale, store.hostHealth.error] as const, ([value, stale, error]) => {
  if (!value || stale || error) { previous = null; cpu.value = null; return; }
  cpu.value = cpuUsage(value, previous); previous = value;
}, { immediate: true });
onMounted(() => { if (store.connected && document.visibilityState !== "hidden") void store.refreshHostHealth(); });
const snapshot = computed(() => store.hostHealth.data);
const note = computed(() => store.hostHealth.error ? (snapshot.value ? "Stale" : "Unavailable") : isInitialLoad(store.hostHealth) ? undefined : store.hostHealth.stale ? "Stale" : snapshot.value?.sample.status === "simulated" ? "Simulated" : snapshot.value?.sample.status === "partial" ? "Partial" : undefined);
const detail = computed(() => store.hostHealth.error ?? (snapshot.value ? `${snapshot.value.sample.scope} | Collected (${timeZone.value}): ${formatTimestamp(snapshot.value.sample.collected_at)}` : undefined));
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
    { name: "CPU usage", chart: { unit: "%", values: [cpu.value] }, value: cpu.value === null ? (sections?.cpu.data ? "Collecting" : "Unavailable") : "Busy time", percent: cpu.value, detail: "Approximate busy time; excludes idle and I/O wait. Green <70%, amber 70-89.99%, red >=90%." },
    { name: "Memory", chart: { unit: "%", values: [used] }, value: memory ? `${formatBytes(memory.used_bytes)} / ${formatBytes(memory.bytes.MemTotal)}` : "Unavailable", percent: used, detail: "Used = total minus available memory; reclaimable cache remains available." },
    { name: "Swap", chart: { unit: "%", values: [swap] }, value: memory ? (memory.bytes.SwapTotal === "0" ? "Not configured" : `${formatBytes(memory.swap_used_bytes)} / ${formatBytes(memory.bytes.SwapTotal)}`) : "Unavailable", percent: swap },
    { name: "Load (1 / 5 / 15 min)", chart: { unit: "Load", values: [load?.one ?? null, load?.five ?? null, load?.fifteen ?? null], names: ["1 min", "5 min", "15 min"] }, value: load ? [load.one, load.five, load.fifteen].map(value => number.format(value)).join(" / ") : "Unavailable", percent: null },
    { name: "Uptime", value: uptime ? formatUptime(uptime.uptime_seconds) : "Unavailable", percent: null },
    { name: "Root filesystem", value: root ? `${formatBytes(root.used_bytes)} / ${formatBytes(root.total_bytes)}` : "Unavailable", percent: disk, detail: root ? `${formatBytes(root.available_bytes)} available (excludes reserved space)${root.read_only ? "; read-only" : ""}` : sections?.filesystems.error ?? undefined },
    { name: "Temperature (highest)", chart: { unit: "\u00b0C", values: [temperatures[0] ? temperatures[0].value / 1000 : null] }, value: temperatures[0] ? `${number.format(temperatures[0].value / 1000)} \u00b0C` : "Unavailable", percent: null, detail: temperatures[0]?.label },
    { name: "Fan", chart: { unit: "RPM", values: [fan?.data?.value ?? null] }, value: fan?.data ? `${number.format(fan.data.value)} RPM` : "Unavailable", percent: null, detail: fan?.data?.label ?? fan?.chip },
  ];
});
const selectedMetric = ref("");
const selectedRow = computed(() => rows.value.find(row => row.name === selectedMetric.value));
const history = ref<Array<{ time: number; values: Record<string, Array<number | null>> }>>([]);
let identity: string | null = null;
watch(() => [store.hostHealth.data, store.hostHealth.stale, store.hostHealth.error] as const, ([data, stale, error]) => {
  if (!data || data.sample.status === "simulated") { history.value = []; identity = null; return; }
  if (stale || error) return;
  const nextIdentity = JSON.stringify([data.sample.scope, data.sample.boot_id]);
  if (identity !== nextIdentity) history.value = [];
  identity = nextIdentity;
  const time = Date.parse(data.sample.collected_at);
  if (time <= (history.value.at(-1)?.time ?? -Infinity)) return;
  history.value = [...history.value, {
    time, values: Object.fromEntries(rows.value.flatMap(row => row.chart ? [[row.name, row.chart.values]] : [])),
  }].slice(-120);
}, { immediate: true });
const series = computed(() => (selectedRow.value?.chart?.values ?? []).map((_, index) => ({
  name: selectedRow.value?.chart?.names?.[index] ?? selectedMetric.value,
  data: history.value.map(frame => ({ x: frame.time, y: frame.values[selectedMetric.value]?.[index] ?? null })),
})));
const chartOptions = computed<ApexOptions>(() => ({
  chart: { type: "line", background: "transparent", foreColor: "#f0f3f7", fontFamily: "inherit", animations: { enabled: false }, toolbar: { show: false }, zoom: { enabled: false } },
  theme: { mode: "dark" }, colors: ["#4a90d9", "#2ec4a0", "#f5a623"],
  stroke: { width: 2, curve: "straight" }, markers: { size: 2 }, grid: { borderColor: "#29313d" },
  xaxis: {
    type: "datetime", tickAmount: 2, title: { text: `Time (${timeZone.value})` },
    labels: { datetimeUTC: true, hideOverlappingLabels: true, formatter: (value, timestamp) => formatTimestamp(timestamp ?? Number(value)) },
  },
  yaxis: { title: { text: selectedRow.value?.chart?.unit }, labels: { formatter: value => number.format(value) } },
  tooltip: {
    x: { formatter: value => `${formatTimestamp(value)} ${timeZone.value}` },
    y: { formatter: value => value === null || value === undefined ? "Unavailable" : `${number.format(value)} ${selectedRow.value?.chart?.unit ?? ""}` },
  },
  noData: { text: "Waiting for resource samples" },
  responsive: [{ breakpoint: 640, options: { xaxis: { labels: { show: false } } } }],
}));
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
            <button
              v-if="row.chart"
              type="button"
              class="metric-link"
              :aria-expanded="selectedMetric === row.name"
              aria-controls="system-live-chart"
              @click="selectedMetric = selectedMetric === row.name ? '' : row.name"
            >
              {{ row.name }}
            </button>
            <template v-else>
              {{ row.name }}
            </template>
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
    <section
      v-if="selectedRow?.chart"
      id="system-live-chart"
      class="live-chart"
      :aria-label="`${selectedMetric} live view`"
    >
      <div class="chart-heading">
        <h3 class="text-subtitle-2">
          {{ selectedMetric }} — Live view
        </h3>
        <v-btn
          aria-label="Close live view"
          icon="mdi-close"
          variant="text"
          size="x-small"
          @click="selectedMetric = ''"
        />
      </div>
      <p
        v-if="!isInitialLoad(store.hostHealth) && !series.some(item => item.data.some(point => point.y !== null))"
        role="status"
        class="text-medium-emphasis"
      >
        {{ snapshot?.sample.status === 'simulated' ? 'Live resource readings are unavailable for simulated samples.' : selectedRow.value === 'Not configured' ? 'Swap is not configured.' : selectedRow.value === 'Unavailable' ? 'Resource readings are unavailable.' : 'Waiting for available resource samples.' }}
      </p>
      <VueApexCharts
        :key="selectedMetric"
        type="line"
        height="220"
        width="100%"
        :options="chartOptions"
        :series="series"
      />
    </section>
  </OverviewWidget>
</template>

<style scoped>
.metric-value { font-variant-numeric: tabular-nums; }
.metric-link { color: inherit; font: inherit; text-align: inherit; cursor: pointer; }
.metric-link:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
.live-chart { padding: 12px; min-width: 0; }
.chart-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
:deep(th), :deep(td) { white-space: normal !important; overflow-wrap: anywhere; }
:deep(th:first-child) { width: 40%; }
</style>