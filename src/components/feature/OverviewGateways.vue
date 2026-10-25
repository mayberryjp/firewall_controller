<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useControllerStore } from "@/stores/controller";
import { formatMetric, gatewayHealth, gatewayMetricIndicator, gatewaySampleState } from "@/services/gatewayHealth";
import { stableJson } from "@/services/configuration";
import OverviewWidget from "./OverviewWidget.vue";
const store = useControllerStore(), now = ref(Date.now());
let clock: ReturnType<typeof setInterval> | undefined;
onMounted(() => { clock = setInterval(() => { now.value = Date.now(); }, 500); });
onUnmounted(() => clearInterval(clock));
const stored = computed(() => store.state.data?.active_transaction?.candidate ?? store.state.data?.desired);
const measured = ref<Record<string, { identity: string; health: string }>>({});
const observations = computed(() => [...new Set([
  ...(stored.value?.gateway_monitors.map(item => item.name) ?? []),
  ...(store.gatewayStatistics.data?.monitors.map(item => item.name) ?? []),
])].map(name => {
  const config = stored.value?.gateway_monitors.find(item => item.name === name);
  const sample = store.gatewayStatistics.data?.monitors.find(item => item.name === name);
  const stale = store.gatewayStatistics.stale || Boolean(store.gatewayStatistics.error);
  const sampleState = sample ? gatewaySampleState(sample, config, now.value, stale) : "unavailable";
  const health = sample ? gatewayHealth(sample, config, now.value, stale) : "unknown";
  return { name, config, sample, health, sampleState,
    identity: stableJson([config, sample?.started_at, sample?.resolved_source_address, sample?.resolved_gateway, sample?.resolved_routing_table]),
    retainable: store.connected && !stale && config?.enabled === true && sample?.process_state === "running" &&
      sample.sample_status === "available" && !sample.error && !sample.reason,
    metricsAvailable: !stale && sample?.sample_status === "available" && sample.process_state === "running" && !sample.error,
  };
}));
watch(observations, values => {
  const next: typeof measured.value = {};
  for (const row of values) {
    if (!row.retainable) continue;
    if (row.health !== "unknown") next[row.name] = { identity: row.identity, health: row.health };
    else if (measured.value[row.name]?.identity === row.identity) next[row.name] = measured.value[row.name]!;
  }
  measured.value = next;
}, { immediate: true });
const rows = computed(() => observations.value.map(row => {
  const previous = measured.value[row.name];
  const retained = row.health === "unknown" && row.retainable && previous?.identity === row.identity;
  const health = retained ? previous.health : row.health;
  const metrics = [
    { name: "Mean RTT", value: row.metricsAvailable ? row.sample?.rtt_avg_ms ?? null : null, unit: "ms" },
    { name: "Stddev", value: row.metricsAvailable ? row.sample?.rtt_stddev_ms ?? null : null, unit: "ms" },
    { name: "Loss", value: row.metricsAvailable ? row.sample?.loss_percent ?? null : null, unit: "%" },
  ] as const;
  return { ...row, health, retained,
    metrics: metrics.map(metric => ({
      name: metric.name, text: formatMetric(metric.value, metric.unit),
      ...gatewayMetricIndicator(metric.name, metric.value, row.metricsAvailable && row.sampleState === "available" && row.config?.enabled === true),
    })),
    status: row.config?.enabled === false ? "Disabled" : row.sampleState === "simulated" ? "Simulated" : health === "up" ? "Online" : health === "down" ? "Down" : health === "degraded" ? "Degraded" : "Unknown",
  };
}));
</script>

<template>
  <OverviewWidget
    title="Gateways"
    to="/gateway-monitors"
    :note="store.gatewayStatistics.error ? 'Unavailable' : store.gatewayStatistics.stale ? 'Stale' : undefined"
    :detail="store.gatewayStatistics.error ?? undefined"
  >
    <v-table density="compact">
      <thead><tr><th>Name</th><th>RTT</th><th>RTTsd</th><th>Loss</th><th>Status</th></tr></thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.name"
        >
          <td :title="row.config?.target">
            {{ row.name }}
          </td>
          <td
            v-for="metric in row.metrics"
            :key="metric.name"
            :data-metric="metric.name"
          >
            <v-chip
              :color="metric.color"
              :title="metric.tooltip"
              :aria-label="`${metric.name}: ${metric.text} (${metric.rating})`"
              size="small"
              variant="tonal"
            >
              {{ metric.text }}
            </v-chip>
          </td>
          <td
            :title="row.retained ? 'Last measured status; awaiting a fresh probe sample.' : undefined"
          >
            <v-chip
              :color="row.health === 'up' ? 'success' : row.health === 'down' ? 'error' : row.health === 'degraded' ? 'warning' : 'default'"
              size="small"
              variant="tonal"
            >
              {{ row.status }}
            </v-chip>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="5">
            {{ stored ? "No gateway monitors." : "Gateway status unavailable." }}
          </td>
        </tr>
      </tbody>
    </v-table>
  </OverviewWidget>
</template>