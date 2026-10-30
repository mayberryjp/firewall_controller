<script setup lang="ts">
import { computed, ref, watch } from "vue";
import VueApexCharts from "vue3-apexcharts";
import type { ApexOptions } from "apexcharts";
import { useControllerStore } from "@/stores/controller";
import { gatewaySampleState } from "@/services/gatewayHealth";
import { useTimestamps } from "@/composables/useTimestamps";
const { formatTimestamp, timeZone } = useTimestamps();

const store = useControllerStore();
const stored = computed(() => store.activeTransactions.find(item => item.status === "pending_confirmation")?.candidate ?? store.state.data?.desired);
const names = computed(() => [...new Set([
  ...(stored.value?.gateway_monitors.map(item => item.name) ?? []),
  ...(store.gatewayStatistics.data?.monitors.map(item => item.name) ?? []),
])].sort());
const history = ref(new Map<string, Array<{ x: number; y: number | null }>>());
let scope: string | null = null;
watch(() => [store.gatewayStatistics.data, store.gatewayStatistics.stale, store.gatewayStatistics.error, store.connected] as const, ([data, stale, error, connected]) => {
  if (!connected || !data || data.sample.status === "simulated") {
    history.value = new Map(); scope = null; return;
  }
  if (stale || error) return;
  if (scope !== data.sample.scope) history.value = new Map();
  scope = data.sample.scope;
  const now = Date.now();
  history.value = new Map(names.value.map(name => {
    const config = stored.value?.gateway_monitors.find(item => item.name === name);
    const monitor = data.monitors.find(item => item.name === name);
    const available = Boolean(monitor && config?.enabled === true && monitor.process_state === "running" &&
      !monitor.error && gatewaySampleState(monitor, config, now, false) === "available");
    const time = Date.parse((available ? monitor?.collected_at : data.sample.collected_at) ?? "");
    const points = history.value.get(name) ?? [];
    if (!Number.isFinite(time) || time <= (points.at(-1)?.x ?? -Infinity)) return [name, points];
    return [name, [...points, { x: time, y: available ? monitor?.rtt_avg_ms ?? null : null }].slice(-120)];
  }));
}, { immediate: true });
const series = computed(() => names.value.map(name => ({ name, data: history.value.get(name) ?? [] })));
const hasMeasurements = computed(() => series.value.some(item => item.data.some(point => point.y !== null)));
const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, useGrouping: false });
const options = computed<ApexOptions>(() => ({
  chart: {
    type: "line", background: "transparent", foreColor: "#f0f3f7", fontFamily: "inherit",
    animations: { enabled: false }, toolbar: { show: false }, zoom: { enabled: false },
  },
  theme: { mode: "dark" },
  colors: ["#4a90d9", "#2ec4a0", "#7b61ff", "#f5a623", "#ff5a36", "#e879c5", "#22d3ee", "#a3e635"],
  stroke: { width: 2, curve: "straight" }, markers: { size: 2 },
  grid: { borderColor: "#29313d" },
  legend: { position: "top", showForSingleSeries: true },
  xaxis: {
    type: "datetime", tickAmount: 3, title: { text: `Time (${timeZone.value})` },
    labels: { datetimeUTC: true, hideOverlappingLabels: true, formatter: (value, timestamp) => formatTimestamp(timestamp ?? Number(value)) },
  },
  yaxis: { min: 0, title: { text: "Mean RTT (ms)" }, labels: { formatter: value => number.format(value) } },
  tooltip: {
    x: { formatter: value => `${formatTimestamp(value)} ${timeZone.value}` },
    y: { formatter: value => value === null || value === undefined ? "Unavailable" : `${number.format(value)} ms` },
  },
  responsive: [{ breakpoint: 640, options: { xaxis: { labels: { show: false } } } }],
}));
</script>

<template>
  <v-card
    tag="section"
    aria-label="Gateway Mean RTT"
    class="pa-4 mb-5"
  >
    <h2 class="text-h6 mb-3">
      Mean RTT
    </h2>
    <VueApexCharts
      v-if="hasMeasurements"
      type="line"
      height="200"
      :options="options"
      :series="series"
    />
    <p
      v-else
      class="text-medium-emphasis"
    >
      No Mean RTT measurements available yet.
    </p>
  </v-card>
</template>
