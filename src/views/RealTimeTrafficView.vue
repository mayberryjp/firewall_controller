<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import VueApexCharts from "vue3-apexcharts";
import type { ApexOptions } from "apexcharts";
import DatasetStatus from "@/components/base/DatasetStatus.vue";
import { useControllerStore } from "@/stores/controller";
import { formatTimestamp } from "@/services/timestamps";
import { trafficFrame, trafficHistoryLimit, usableTrafficSample, type TrafficCounter, type TrafficFrame } from "@/services/traffic";
import type { Statistics } from "@/types/domain";

const store = useControllerStore();
const selectedInterface = ref("");
const route = useRoute();
watch(() => route.query.interface, value => {
  selectedInterface.value = typeof value === "string" ? value : "";
}, { immediate: true });
const display = ref("both");
const history = ref<TrafficFrame[]>([]);
let previous: Statistics | null = null;
const interfaceNames = computed(() => (store.statistics.data?.interfaces ?? []).map(item => item.name).sort((a, b) => a.localeCompare(b)));
const watchedInterfaces = computed(() => selectedInterface.value ? [selectedInterface.value] : interfaceNames.value);
const interfaceOptions = computed(() => [
  { title: "All interfaces", value: "" },
  ...interfaceNames.value.map(name => ({ title: name, value: name })),
]);
const displayOptions = [
  { title: "Both graphs", value: "both" },
  { title: "Bytes", value: "bytes" },
  { title: "Packets", value: "packets" },
];
const metrics = [
  { id: "bytes", title: "Bytes", unit: "bytes/s", incoming: "rx_bytes", outgoing: "tx_bytes" },
  { id: "packets", title: "Packets", unit: "packets/s", incoming: "rx_packets", outgoing: "tx_packets" },
] as const;
const visibleMetrics = computed(() => metrics.filter(metric => display.value === "both" || display.value === metric.id));
const selectionMissing = computed(() => selectedInterface.value !== "" &&
  !store.statistics.data?.interfaces.some(item => item.name === selectedInterface.value));
function combinedRate(frame: TrafficFrame, name: string, incoming: TrafficCounter, outgoing: TrafficCounter): number | null {
  const rates = frame.interfaces[name], received = rates?.[incoming], sent = rates?.[outgoing];
  if (received === null || received === undefined || sent === null || sent === undefined) return null;
  const total = received + sent;
  return Number.isFinite(total) ? total : null;
}
const hasRates = computed(() => history.value.some(frame => watchedInterfaces.value.some(name =>
  metrics.some(metric => combinedRate(frame, name, metric.incoming, metric.outgoing) !== null))));
const sampleNotice = computed(() => {
  if (selectionMissing.value) return `Interface ${selectedInterface.value} is no longer available. Select another interface to watch.`;
  const data = store.statistics.data;
  if (!data) return store.statistics.loading ? "Loading interface counters." : "No interface counters available.";
  if (data.sample.status === "simulated") return "Live traffic is unavailable for simulated counters.";
  if (!usableTrafficSample(data)) return "Live interface counters are unavailable.";
  if (!data.interfaces.length) return "No interface counters available.";
  const watched = selectedInterface.value ? data.interfaces.filter(item => item.name === selectedInterface.value) : data.interfaces;
  const unavailable = watched.find(item => item.status !== "available" || item.error || !item.counters);
  if (unavailable) return unavailable.error ? `${unavailable.name}: ${unavailable.error}` : `Interface counters for ${unavailable.name} are unavailable.`;
  if (!hasRates.value && !store.statistics.error) return "Waiting for two comparable counter samples. Missing counters appear as gaps.";
  return "";
});
function append(frame: TrafficFrame): void {
  history.value = [...history.value, frame].slice(-trafficHistoryLimit);
}
function breakSeries(): void {
  previous = null;
}
watch(() => [store.statistics.data, store.statistics.stale, store.statistics.error, store.connected] as const, ([data, stale, error, connected]) => {
  if (!connected) { previous = null; history.value = []; return; }
  if (!data || stale || error || !usableTrafficSample(data)) { breakSeries(); return; }
  if (previous && previous.sample.scope !== data.sample.scope) {
    previous = null; history.value = [];
  }
  if (previous && Date.parse(data.sample.collected_at) <= Date.parse(previous.sample.collected_at)) return;
  append(trafficFrame(previous, data));
  previous = data;
});
function series(incoming: TrafficCounter, outgoing: TrafficCounter) {
  return watchedInterfaces.value.map(name => ({
    name,
    data: history.value.map(frame => ({
      x: frame.time,
      y: combinedRate(frame, name, incoming, outgoing),
    })),
  }));
}
const rateFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, notation: "compact" });
const interfaceColors = ["#4a90d9", "#2ec4a0", "#7b61ff", "#f5a623", "#ff5a36", "#e879c5", "#22d3ee", "#a3e635"];
function options(id: string, unit: string): ApexOptions {
  return {
    chart: {
      id: `traffic-${id}`, type: "line", background: "transparent", foreColor: "#f0f3f7",
      fontFamily: "inherit", animations: { enabled: false }, toolbar: { show: false }, zoom: { enabled: false },
    },
    theme: { mode: "dark" },
    colors: watchedInterfaces.value.map(name => interfaceColors[Math.max(0, interfaceNames.value.indexOf(name)) % interfaceColors.length]!),
    stroke: { width: 2, curve: "straight" },
    markers: { size: 2 },
    grid: { borderColor: "#29313d" },
    legend: { position: "top", showForSingleSeries: true },
    xaxis: {
      type: "datetime", tickAmount: 3, title: { text: "Time (UTC)" },
      labels: { datetimeUTC: true, hideOverlappingLabels: true, formatter: (value, timestamp) => formatTimestamp(timestamp ?? Number(value)) },
    },
    yaxis: { min: 0, title: { text: unit }, labels: { formatter: value => rateFormat.format(value) } },
    tooltip: {
      x: { formatter: value => `${formatTimestamp(value)} UTC` },
      y: { formatter: value => value === null || value === undefined ? "Unavailable" : `${rateFormat.format(value)} ${unit}` },
    },
    noData: { text: "Waiting for traffic samples" },
    responsive: [{ breakpoint: 640, options: { xaxis: { labels: { show: false } } } }],
  };
}
onMounted(() => {
  document.addEventListener("visibilitychange", breakSeries);
  if (store.connected) void store.refreshStatistics();
});
onUnmounted(() => document.removeEventListener("visibilitychange", breakSeries));
</script>

<template>
  <section aria-label="Real Time Traffic">
    <div class="traffic-controls">
      <v-select
        v-model="selectedInterface"
        :items="interfaceOptions"
        label="Watch interface"
        aria-label="Watch interface"
        density="compact"
        hide-details
      />
      <v-select
        v-model="display"
        :items="displayOptions"
        label="Show graphs"
        aria-label="Show graphs"
        density="compact"
        hide-details
      />
    </div>
    <DatasetStatus
      :query="store.statistics"
      label="Interface counters"
    />
    <p
      v-if="sampleNotice"
      role="status"
      class="text-medium-emphasis mb-4"
    >
      {{ sampleNotice }}
    </p>
    <div class="traffic-charts">
      <section
        v-for="metric in visibleMetrics"
        :key="metric.id"
        :aria-labelledby="`traffic-${metric.id}-title`"
        class="traffic-chart"
      >
        <h2
          :id="`traffic-${metric.id}-title`"
          class="text-h6"
        >
          {{ metric.title }}
        </h2>
        <VueApexCharts
          type="line"
          height="220"
          width="100%"
          :options="options(metric.id, metric.unit)"
          :series="series(metric.incoming, metric.outgoing)"
        />
      </section>
    </div>
  </section>
</template>

<style scoped>
.traffic-controls { display: flex; flex-wrap: wrap; gap: 16px; margin-bottom: 20px; }
.traffic-controls > * { flex: 1 1 200px; min-width: 0; }
.traffic-charts { display: grid; gap: 16px; }
.traffic-chart { min-width: 0; }
</style>
