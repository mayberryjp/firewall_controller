<script setup lang="ts">
import { computed } from "vue";
import VueApexCharts from "vue3-apexcharts";
import type { ApexOptions } from "apexcharts";
import { useTimestamps } from "@/composables/useTimestamps";
import { experienceNumber, type ExperienceHistory } from "@/services/networkExperience";
import {
  hostChartValue, hostExperienceMetrics, hostHistoryPoints, type HostExperienceMetric,
} from "@/services/hostExperience";

const props = defineProps<{ history: ExperienceHistory; selectedIndex: number; stale: boolean }>();
const emit = defineEmits<{ select: [index: number] }>();
const { formatTimestamp, timeZone } = useTimestamps();
const groups = [
  { key: "traffic", title: "Traffic", unit: "bps", icon: "mdi-swap-vertical", metrics: ["download", "upload"], colors: ["#38bdf8", "#a78bfa"] },
  { key: "latency", title: "Response Timing", unit: "ms", icon: "mdi-timer-outline", metrics: ["dns_p95", "remote_p95", "host_p50"], colors: ["#facc15", "#ff9859", "#34d399"] },
  { key: "drops", title: "Drops & TCP Repeats", unit: "observations / interval", icon: "mdi-shield-outline", metrics: ["drops_sent", "drops_received", "retrans_sent", "retrans_received"], colors: ["#ff657e", "#ffb25f", "#a78bfa", "#38bdf8"] },
  { key: "connections", title: "Connections & Receive Pressure", unit: "count", icon: "mdi-pulse", metrics: ["connections", "unreplied", "host_zero_window", "peer_zero_window"], colors: ["#38bdf8", "#ffb25f", "#ff657e", "#a78bfa"] },
] satisfies { key: string; title: string; unit: string; icon: string; metrics: HostExperienceMetric[]; colors: string[] }[];
const points = computed(() => hostHistoryPoints(props.history));
const tickLabels = computed(() => points.value.map(point => formatTimestamp(point.at)));
const selectedPoint = computed(() => points.value.findIndex(point => point.slotIndex === props.selectedIndex));
const chartSeries = computed(() => groups.map(group => group.metrics.map(metric => ({
  name: hostExperienceMetrics[metric].label, data: points.value.map(point => hostChartValue(point.sample, metric)),
}))));
const charts = computed(() => groups.map((group, groupIndex) => {
  const labels = tickLabels.value;
  const options: ApexOptions = {
    chart: {
      type: "line", background: "transparent", foreColor: "#b1b8c0", fontFamily: "inherit",
      animations: { enabled: false }, toolbar: { show: false }, zoom: { enabled: false },
      events: {
        markerClick: (_event, _context, details) => {
          const point = details?.dataPointIndex;
          const index = point === undefined ? undefined : points.value[point]?.slotIndex;
          if (index !== null && index !== undefined) emit("select", index);
        },
      },
    },
    theme: { mode: "dark" },
    colors: props.stale ? group.colors.map(() => "#8b949e") : group.colors,
    stroke: { width: 1.8, curve: "straight" }, markers: { size: 2, hover: { size: 5 } },
    grid: { borderColor: "#21262d", padding: { left: 8, right: 8 } },
    xaxis: {
      type: "category", categories: points.value.map((_point, index) => String(index)), tickAmount: 2,
      axisTicks: { show: false }, axisBorder: { show: false },
      labels: { rotate: 0, hideOverlappingLabels: true, formatter: value => {
        return labels[Number(value)] ?? "";
      } },
    },
    yaxis: { min: 0, labels: { formatter: value => group.key === "traffic" || group.key === "latency" ?
      experienceNumber(value, true) : new Intl.NumberFormat("en-US", { maximumFractionDigits: 0, notation: "compact" }).format(value) } },
    annotations: { xaxis: [{ x: String(selectedPoint.value), borderColor: "#38bdf8", strokeDashArray: 0, label: {
      text: "Selected", style: { color: "#0d1117", background: "#38bdf8", fontSize: "9px" },
    } }] },
    tooltip: {
      x: { formatter: (_value, context?: { dataPointIndex: number }) => {
        const point = points.value[context?.dataPointIndex ?? -1];
        return point ? `${formatTimestamp(point.at)} ${timeZone.value}` : "Unavailable";
      } },
      y: { formatter: value => value == null ? "Unavailable" :
        `${group.key === "traffic" || group.key === "latency" ? experienceNumber(value) : value} ${group.unit}` },
    },
    legend: { position: "top", fontSize: "10px" }, noData: { text: "No observed samples" },
  };
  return { ...group, options, series: chartSeries.value[groupIndex] };
}));
const unsafeCounts = computed(() => props.history.samples.some(slot => groups.some(group => group.metrics.some(metric => {
  const source = slot.sample;
  return source !== null && hostExperienceMetrics[metric].unit === "count" &&
    hostExperienceMetrics[metric].read(source) !== null && hostChartValue(source, metric) === null &&
    ["available", "partial"].includes(source[hostExperienceMetrics[metric].source].status);
}))));
</script>

<template>
  <section
    class="host-history-charts"
    aria-label="Host performance over the replay window"
  >
    <article
      v-for="chart in charts"
      :key="chart.key"
      class="host-chart"
    >
      <header>
        <h2>
          <v-icon
            :icon="chart.icon"
            size="16"
          />{{ chart.title }}
        </h2><span>{{ chart.unit }} · {{ timeZone }}</span>
      </header>
      <VueApexCharts
        type="line"
        height="230"
        :options="chart.options"
        :series="chart.series"
      />
    </article>
    <p
      v-if="unsafeCounts"
      class="chart-note"
      role="status"
    >
      Counts beyond the chart's exact integer range are omitted from lines. Their full values remain visible in the selected interval.
    </p>
    <p class="chart-note">
      Missing observations and changes in observation epoch, owner, network or revision break lines. Select a chart marker to inspect that interval.
    </p>
  </section>
</template>

<style scoped>
.host-history-charts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.host-chart { min-width: 0; padding: 15px 12px 4px; background: var(--bg-secondary); border: var(--app-border); border-radius: 12px; overflow: hidden; }
.host-chart header { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 0 4px; flex-wrap: wrap; }
.host-chart h2 { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 600; }
.host-chart header > span { font-size: 10px; color: var(--text-muted); }
.chart-note { grid-column: 1 / -1; font-size: 11px; color: var(--text-muted); }
@media (max-width: 700px) { .host-history-charts { grid-template-columns: minmax(0, 1fr); } }
</style>
