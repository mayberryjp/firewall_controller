<script setup lang="ts">
import { computed, ref } from "vue";
import VueApexCharts from "vue3-apexcharts";
import type { ApexOptions } from "apexcharts";
import { useDiagnosticRead } from "@/composables/useDiagnosticRead";
import { useTimestamps } from "@/composables/useTimestamps";
import {
  experienceLabel, getNetworkExperienceHistory, sumExperienceCounters,
  type ExperienceHost, type ExperienceSample,
} from "@/services/networkExperience";

const props = defineProps<{ address: string; latestHost?: ExperienceHost }>();
defineEmits<{ close: [] }>();
const { formatTimestamp, timeZone } = useTimestamps();
const { data, error, stale } = useDiagnosticRead(signal => getNetworkExperienceHistory(props.address, signal), 10000, () => props.address);
const metric = ref("throughput");
const choices = [
  { title: "Throughput (bps)", value: "throughput" }, { title: "Experience (0–100)", value: "experience" },
  { title: "Passive timing (ms)", value: "timing" }, { title: "Managed drops (packets)", value: "drops" },
  { title: "TCP repeats (%)", value: "repeats" }, { title: "Zero-window observations (count)", value: "pressure" },
];
function count(value: string | null): number | null {
  if (value === null) return null;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) ? numeric : null;
}
type Line = { name: string; read: (sample: ExperienceSample) => number | null };
const definitions = computed<{ unit: string; lines: Line[] }>(() => {
  switch (metric.value) {
    case "experience": return { unit: "score", lines: [{ name: "Experience", read: sample => sample.experience.score }] };
    case "timing": return { unit: "ms", lines: [
      { name: "Remote-path ACK p95", read: sample => sample.tcp.rtt_remote.p95_ms },
      { name: "Host-path ACK p95", read: sample => sample.tcp.rtt_host.p95_ms },
      { name: "DNS response p95", read: sample => sample.dns.response_time_p95_ms },
    ] };
    case "drops": return { unit: "packets / bucket", lines: [
      { name: "Upload drops", read: sample => count(sample.firewall.dropped_sent_packets) },
      { name: "Download drops", read: sample => count(sample.firewall.dropped_received_packets) },
    ] };
    case "repeats": return { unit: "%", lines: [
      { name: "Upload TCP repeats", read: sample => sample.tcp.retransmission_percent_sent },
      { name: "Download TCP repeats", read: sample => sample.tcp.retransmission_percent_received },
    ] };
    case "pressure": return { unit: "observations / bucket", lines: [
      { name: "Host zero window", read: sample => count(sample.tcp.zero_window_observations_host) },
      { name: "Peer zero window", read: sample => count(sample.tcp.zero_window_observations_peer) },
    ] };
    default: return { unit: "bps", lines: [
      { name: "Download", read: sample => sample.traffic.received_bps },
      { name: "Upload", read: sample => sample.traffic.sent_bps },
    ] };
  }
});
// Category positions preserve observation order across clock corrections; nulls break epochs and gaps.
const points = computed(() => {
  const result: { at: string; sample: ExperienceSample | null }[] = [];
  let previous: ExperienceSample | null = null;
  for (const slot of data.value?.samples ?? []) {
    const sample = slot.sample;
    if (sample && previous && (sample.observation_epoch !== previous.observation_epoch ||
      sample.configured_host_id !== previous.configured_host_id || sample.interface?.name !== previous.interface?.name ||
      sample.configuration_revision !== previous.configuration_revision || previous.end_at !== sample.start_at)) {
      result.push({ at: slot.start_at, sample: null });
    }
    result.push({ at: slot.end_at, sample });
    previous = sample;
  }
  return result;
});
const series = computed(() => definitions.value.lines.map(line => ({
  name: line.name, data: points.value.map(point => point.sample ? line.read(point.sample) : null),
})));
const options = computed<ApexOptions>(() => ({
  chart: { type: "line", background: "transparent", foreColor: "#b1b8c0", fontFamily: "inherit", animations: { enabled: false }, toolbar: { show: false }, zoom: { enabled: false } },
  theme: { mode: "dark" }, colors: ["#38bdf8", "#a78bfa", "#34d399"],
  stroke: { width: 2, curve: "straight" }, markers: { size: 2, hover: { size: 4 } },
  grid: { borderColor: "#29313d", padding: { left: 14, right: 14 } },
  xaxis: {
    type: "category", categories: points.value.map(point => point.at), tickAmount: 4,
    axisTicks: { show: false },
    title: { text: `Time (${timeZone.value})` },
    labels: { formatter: value => formatTimestamp(value), hideOverlappingLabels: true, rotate: 0 },
  },
  yaxis: { min: 0, ...(metric.value === "experience" ? { max: 100 } : {}),
    title: { text: definitions.value.unit }, labels: { formatter: value => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, notation: "compact" }).format(value) } },
  tooltip: {
    x: { formatter: (_value, context?: { dataPointIndex: number }) => {
      const point = points.value[context?.dataPointIndex ?? -1];
      return point ? `${formatTimestamp(point.at)} ${timeZone.value}` : "Unavailable";
    } },
    y: { formatter: value => value == null ? "Unavailable" : `${value} ${definitions.value.unit}` },
  },
  noData: { text: "No observed history yet" }, legend: { position: "top" },
  responsive: [{ breakpoint: 700, options: { xaxis: { tickAmount: 1 } } }],
}));
const host = computed(() => data.value?.host ?? props.latestHost);
const sample = computed(() => {
  const observed = data.value?.samples.filter(slot => slot.sample !== null);
  return observed?.at(-1)?.sample ?? null;
});
const reasons = computed(() => [...new Set([...(sample.value?.experience.reasons ?? []), ...(sample.value?.coverage.reasons ?? [])])]);
</script>

<template>
  <section
    class="mt-6"
    aria-label="Selected host experience history"
  >
    <div class="d-flex align-center justify-space-between ga-3 mb-3">
      <h2 class="text-subtitle-1">
        {{ host?.configured_name || address }} · {{ address }} · 1-hour history
      </h2>
      <v-btn
        variant="text"
        size="small"
        aria-label="Close host history"
        @click="$emit('close')"
      >
        Close
      </v-btn>
    </div>
    <p
      v-if="!data && !error"
      role="status"
    >
      Loading host history...
    </p>
    <v-alert
      v-if="error || data?.error"
      type="error"
      variant="tonal"
      role="alert"
      class="mb-3"
    >
      {{ error || data?.error }}
    </v-alert>
    <template v-if="data">
      <p
        v-if="stale"
        role="status"
        class="text-warning mb-2"
      >
        History refresh failed; retained observations are shown.
      </p>
      <div class="d-flex flex-wrap ga-2 mb-3">
        <v-chip
          v-if="!data.coverage_complete"
          size="small"
          variant="tonal"
        >
          Incomplete coverage · {{ data.returned_samples }}/360 observations
        </v-chip>
        <v-chip
          v-if="!data.host.currently_protected"
          size="small"
          variant="tonal"
        >
          No longer protected
        </v-chip>
        <v-chip
          v-if="data.clock_discontinuity"
          size="small"
          color="warning"
          variant="tonal"
        >
          Clock changed · observation order preserved
        </v-chip>
        <v-chip
          size="small"
          variant="tonal"
          :title="sample?.connections.observed_at ? `Observed (${timeZone}): ${formatTimestamp(sample.connections.observed_at)}` : 'No connection observation'"
        >
          Connections: {{ sample?.connections.total ?? "Unavailable" }}
        </v-chip>
        <v-chip
          size="small"
          variant="tonal"
        >
          Managed drops: {{ sumExperienceCounters(sample?.firewall.dropped_sent_packets, sample?.firewall.dropped_received_packets) ?? "Unavailable" }}
        </v-chip>
      </div>
      <v-select
        v-model="metric"
        :items="choices"
        aria-label="History metric"
        density="compact"
        hide-details
        class="history-metric mb-3"
      />
      <VueApexCharts
        :key="`${address}-${metric}`"
        type="line"
        height="270"
        :options="options"
        :series="series"
      />
      <p class="text-caption text-medium-emphasis">
        Missing observations are gaps, not zero. Last seen is observed traffic, not reachability.
        Managed policy drops do not reduce experience scores.
      </p>
      <p
        v-if="reasons.length"
        class="text-caption mt-2"
      >
        {{ reasons.map(experienceLabel).join(" · ") }}
      </p>
      <div
        v-if="sample?.experience.components.length"
        class="d-flex flex-wrap ga-2 mt-2"
        aria-label="Experience contributors"
      >
        <v-chip
          v-for="component in sample.experience.components"
          :key="component.code"
          size="small"
          variant="tonal"
          :title="`${component.samples} observations · component score ${component.score}/100`"
        >
          {{ experienceLabel(component.code) }}: {{ component.value }} {{ component.unit }}
        </v-chip>
      </div>
    </template>
  </section>
</template>

<style scoped>
.history-metric { max-width: 340px; }
</style>
