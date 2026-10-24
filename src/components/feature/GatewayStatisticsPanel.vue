<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useControllerStore } from "@/stores/controller";
import { formatMetric, gatewayHealth, gatewaySampleState } from "@/services/gatewayHealth";
import DatasetStatus from "@/components/base/DatasetStatus.vue";
import JsonPanel from "@/components/base/JsonPanel.vue";
const store = useControllerStore();
const now = ref(Date.now());
let clock: ReturnType<typeof setInterval> | undefined;
const stored = computed(() => store.activeTransactions.find(item => item.status === "pending_confirmation")?.candidate ?? store.state.data?.desired);
const names = computed(() => [...new Set([
  ...(stored.value?.gateway_monitors.map(item => item.name) ?? []),
  ...(store.gatewayStatistics.data?.monitors.map(item => item.name) ?? []),
])].sort());
const rows = computed(() => names.value.map(name => ({
  name, config: stored.value?.gateway_monitors.find(item => item.name === name),
  data: store.gatewayStatistics.data?.monitors.find(item => item.name === name),
})));
onMounted(() => {
  store.gatewayMonitoring = true;
  void store.refreshGatewayStatistics();
  clock = setInterval(() => { now.value = Date.now(); }, 500);
});
onUnmounted(() => { store.gatewayMonitoring = false; clearInterval(clock); });
const workerStates = ["disabled", "simulated", "not_running", "running", "exited"];
const sampleStates = ["disabled", "simulated", "warming_up", "available", "stale", "unavailable"];
function label(state: string, known: string[]): string { return known.includes(state) ? state : `Unknown (${state})`; }
</script>
<template>
  <section
    class="my-4"
    aria-label="Gateway health statistics"
  >
    <DatasetStatus
      :query="store.gatewayStatistics"
      label="Independent cached gateway statistics"
    />
    <v-table>
      <thead><tr><th>Monitor</th><th>Sample</th><th>Health</th><th>Loss</th><th>Mean RTT</th><th>Stddev</th><th>Details</th></tr></thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.name"
        >
          <td>{{ row.name }}</td>
          <template v-if="row.data">
            <td>{{ label(gatewaySampleState(row.data, row.config, now, store.gatewayStatistics.stale), sampleStates) }}</td>
            <td>{{ gatewayHealth(row.data, row.config, now, store.gatewayStatistics.stale) }}</td>
            <td>{{ formatMetric(row.data.loss_percent, "%") }}</td>
            <td>{{ formatMetric(row.data.rtt_avg_ms, "ms") }}</td>
            <td>{{ formatMetric(row.data.rtt_stddev_ms, "ms") }}</td>
            <td>
              <JsonPanel
                label="Measurements"
                :value="{
                  worker: label(row.data.process_state, workerStates),
                  minimum_RTT: formatMetric(row.data.rtt_min_ms, 'ms'),
                  maximum_RTT: formatMetric(row.data.rtt_max_ms, 'ms'),
                  p50_RTT: formatMetric(row.data.rtt_p50_ms, 'ms'),
                  p95_RTT: formatMetric(row.data.rtt_p95_ms, 'ms'),
                  RTT_variation: formatMetric(row.data.rtt_variation_ms, 'ms'),
                  variation_pairs: row.data.variation_pairs,
                  window_sent: row.data.sent,
                  window_received: row.data.received,
                  window_lost: row.data.lost,
                  window_pending: row.data.pending,
                  measured: row.data.collected_at,
                  started: row.data.started_at,
                  health_changed: row.data.health_changed_at,
                  last_success: row.data.last_success_at,
                }"
              />
              <p
                v-if="row.data.error"
                role="alert"
              >
                {{ row.data.error }}
              </p>
            </td>
          </template>
          <td
            v-else
            colspan="6"
          >
            Unknown (no monitor sample)
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="7">
            No gateway monitor records available.
          </td>
        </tr>
      </tbody>
    </v-table>
  </section>
</template>
