<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useControllerStore } from "@/stores/controller";
import { formatMetric, gatewayHealth, gatewaySampleState } from "@/services/gatewayHealth";
import OverviewWidget from "./OverviewWidget.vue";
const store = useControllerStore(), now = ref(Date.now());
let clock: ReturnType<typeof setInterval> | undefined;
onMounted(() => { clock = setInterval(() => { now.value = Date.now(); }, 500); });
onUnmounted(() => clearInterval(clock));
const stored = computed(() => store.state.data?.active_transaction?.candidate ?? store.state.data?.desired);
const rows = computed(() => [...new Set([
  ...(stored.value?.gateway_monitors.map(item => item.name) ?? []),
  ...(store.gatewayStatistics.data?.monitors.map(item => item.name) ?? []),
])].map(name => {
  const config = stored.value?.gateway_monitors.find(item => item.name === name);
  const sample = store.gatewayStatistics.data?.monitors.find(item => item.name === name);
  const stale = store.gatewayStatistics.stale || Boolean(store.gatewayStatistics.error);
  const sampleState = sample ? gatewaySampleState(sample, config, now.value, stale) : "unavailable";
  const health = sample ? gatewayHealth(sample, config, now.value, stale) : "unknown";
  return { name, config, sample, health,
    status: config?.enabled === false ? "Disabled" : sampleState === "simulated" ? "Simulated" : health === "up" ? "Online" : health === "down" ? "Down" : health === "degraded" ? "Degraded" : "Unknown",
    metricsAvailable: sampleState === "available" && sample?.process_state === "running" && !sample.error,
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
          <td>{{ row.metricsAvailable && row.sample ? formatMetric(row.sample.rtt_avg_ms, "ms") : "Unavailable" }}</td>
          <td>{{ row.metricsAvailable && row.sample ? formatMetric(row.sample.rtt_stddev_ms, "ms") : "Unavailable" }}</td>
          <td>{{ row.metricsAvailable && row.sample ? formatMetric(row.sample.loss_percent, "%") : "Unavailable" }}</td>
          <td :class="{ 'text-success': row.health === 'up', 'text-error': row.health === 'down', 'text-warning': row.health === 'degraded' }">
            {{ row.status }}
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